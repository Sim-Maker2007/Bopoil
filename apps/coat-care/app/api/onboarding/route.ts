import { eq } from "drizzle-orm";
import { getDb } from "../../../db";
import { auditEvents, communicationTemplates, locationHours, locations, organizations, salonSettings, services, staff, staffAvailability, staffLocations, staffServiceSkills } from "../../../db/schema";
import { getChatGPTUser } from "../../chatgpt-auth";
import { SalonAccessError, salonApiError } from "../../salon-access";

function clean(value: unknown, max: number) { return String(value || "").trim().slice(0, max); }
function slug(value: string) { return value.toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "").slice(0, 52) || "salon"; }
function timezone(value: unknown, fallback: string) {
  const candidate = clean(value, 80) || fallback;
  try { new Intl.DateTimeFormat("en", { timeZone: candidate }).format(); }
  catch { throw new SalonAccessError("Choose a valid salon timezone.", 400); }
  return candidate;
}

const starterServices = [
  { name: "Signature groom", description: "Bath, haircut, nails, ears & finishing touch", durationMinutes: 150, priceFromCents: 9500, depositCents: 2500, bathMinutes: 30, dryerMinutes: 30, groomingTableMinutes: 75 },
  { name: "Bath & brush", description: "Deep cleanse, blow-dry, brush-out & nails", durationMinutes: 90, priceFromCents: 5800, depositCents: 2000, bathMinutes: 30, dryerMinutes: 30, groomingTableMinutes: 15 },
  { name: "Puppy's first visit", description: "A gentle introduction for pups under 6 months", durationMinutes: 60, priceFromCents: 4800, depositCents: 1500, bathMinutes: 20, dryerMinutes: 20, groomingTableMinutes: 20 },
];

export async function POST(request: Request) {
  try {
    const user = await getChatGPTUser();
    if (!user) throw new SalonAccessError("Sign in required", 401);
    const body = await request.json() as Record<string, unknown>;
    const salonName = clean(body.salonName, 80);
    const locationName = clean(body.locationName, 80) || "Main salon";
    const country = body.country === "US" ? "US" : "CA";
    const city = clean(body.city, 80);
    const region = clean(body.region, 40);
    const addressLine1 = clean(body.addressLine1, 120);
    const postalCode = clean(body.postalCode, 20);
    const contactPhone = clean(body.contactPhone, 40);
    if (!salonName || !city || !region || !addressLine1 || !postalCode) throw new SalonAccessError("Add the salon name and complete address.", 400);

    const db = getDb();
    let organizationSlug = slug(salonName);
    const [collision] = await db.select({ id: organizations.id }).from(organizations).where(eq(organizations.slug, organizationSlug)).limit(1);
    if (collision) organizationSlug = `${organizationSlug}-${crypto.randomUUID().slice(0, 6)}`;
    const organizationId = crypto.randomUUID();
    const locationId = crypto.randomUUID();
    const staffId = crypto.randomUUID();
    const currency = country === "US" ? "USD" : "CAD";
    const salonTimezone = timezone(body.timezone, country === "US" ? "America/New_York" : "America/Toronto");
    const email = user.email.toLowerCase();
    const brandName = salonName;

    const serviceRows = starterServices.map((service) => ({
      id: crypto.randomUUID(), organizationId, locationId, ...service, bufferMinutes: 15, kennelMinutes: 0,
    }));
    await db.batch([
      db.insert(organizations).values({
        id: organizationId, slug: organizationSlug, name: salonName, country, currency, timezone: salonTimezone,
        contactEmail: email, contactPhone, onboardingCompleted: true,
      }),
      db.insert(locations).values({
        id: locationId, organizationId, slug: slug(locationName), name: locationName, addressLine1, city, region,
        postalCode, contactEmail: email, contactPhone, currency, timezone: salonTimezone,
        taxLabel: country === "US" ? "Sales tax" : "Tax",
      }),
      db.insert(staff).values({
        id: staffId, organizationId, locationId, email, displayName: user.fullName || user.displayName, role: "owner",
      }),
      db.insert(staffLocations).values({ id: crypto.randomUUID(), organizationId, staffId, locationId, role: "owner" }),
      db.insert(salonSettings).values({ id: crypto.randomUUID(), organizationId, locationId }),
      db.insert(locationHours).values(Array.from({ length: 7 }, (_, weekday) => ({
        id: crypto.randomUUID(), organizationId, locationId, weekday, open: weekday !== 0,
        opensAt: weekday === 6 ? "09:00" : "08:00", closesAt: weekday === 6 ? "16:00" : "18:00",
      }))),
      db.insert(services).values(serviceRows),
      db.insert(staffAvailability).values([1, 2, 3, 4, 5, 6].map((weekday) => ({
        id: crypto.randomUUID(), organizationId, locationId, staffId, weekday,
        startTime: weekday === 6 ? "09:00" : "08:00", endTime: weekday === 6 ? "16:00" : "18:00",
      }))),
      db.insert(staffServiceSkills).values(serviceRows.map((service) => ({
        id: crypto.randomUUID(), organizationId, locationId, staffId, serviceId: service.id,
      }))),
      db.insert(communicationTemplates).values([
        { id: crypto.randomUUID(), organizationId, locationId, key: "booking_deposit_required", name: "Booking deposit required", channel: "email", subject: `Complete {{pet_name}}’s deposit to hold the opening`, body: `Hi {{client_name}},\n\nWe’re holding {{pet_name}}’s {{service_name}} opening for {{hold_minutes}} minutes. Complete the {{deposit_amount}} deposit here:\n\n{{checkout_url}}\n\nThe booking confirms only after secure payment. If the hold expires, the opening returns to live availability.\n\n— ${brandName}` },
        { id: crypto.randomUUID(), organizationId, locationId, key: "booking_deposit_expired", name: "Booking deposit hold expired", channel: "email", subject: `{{pet_name}}’s booking hold has closed`, body: `Hi {{client_name}},\n\nThe deposit window for {{pet_name}}’s {{service_name}} has closed, so the opening returned to live availability. Your pet profile is still saved.\n\nUse this fresh private link to choose another time:\n\n{{portal_url}}\n\n— ${brandName}` },
        { id: crypto.randomUUID(), organizationId, locationId, key: "booking_request_received", name: "Booking request received", channel: "email", subject: `We received {{pet_name}}’s booking request`, body: `Hi {{client_name}},\n\nWe received your request for {{pet_name}}’s {{service_name}} on {{appointment_date}} at {{appointment_time}}. We’ll confirm it shortly.\n\nManage your visit: {{portal_url}}\n\n— ${brandName}` },
        { id: crypto.randomUUID(), organizationId, locationId, key: "booking_confirmation", name: "Booking confirmation", channel: "email", subject: `{{pet_name}} is booked at ${brandName}`, body: `Hi {{client_name}},\n\n{{pet_name}} is confirmed for {{service_name}} on {{appointment_date}} at {{appointment_time}}.\n\nManage your visit: {{portal_url}}\n\n— ${brandName}` },
        { id: crypto.randomUUID(), organizationId, locationId, key: "appointment_reminder", name: "24-hour reminder", channel: "email", subject: `A friendly reminder for {{pet_name}}’s visit`, body: `Hi {{client_name}},\n\nA reminder that {{pet_name}}’s {{service_name}} appointment is tomorrow at {{appointment_time}}.\n\nManage or reschedule securely: {{portal_url}}\n\nReply or call us if anything has changed.\n\n— ${brandName}` },
        { id: crypto.randomUUID(), organizationId, locationId, key: "ready_pickup", name: "Ready for pickup", channel: "sms", subject: "", body: `Hi {{client_name}} — {{pet_name}} is fresh, happy, and ready for pickup at ${brandName}.` },
        { id: crypto.randomUUID(), organizationId, locationId, key: "receipt", name: "Payment receipt", channel: "email", subject: `Your ${brandName} receipt · {{invoice_number}}`, body: `Hi {{client_name}},\n\nWe received {{payment_total}} for invoice {{invoice_number}}. Thank you!\n\n— ${brandName}` },
        { id: crypto.randomUUID(), organizationId, locationId, key: "portal_access", name: "Pet-parent portal access", channel: "email", subject: `Your secure ${brandName} link`, body: `Hi {{client_name}},\n\nUse this private link to manage your pets, records, and appointments:\n\n{{portal_url}}\n\n— ${brandName}` },
        { id: crypto.randomUUID(), organizationId, locationId, key: "waitlist_joined", name: "Waitlist confirmation", channel: "email", subject: `{{pet_name}} is on the ${brandName} waitlist`, body: `Hi {{client_name}},\n\nWe saved {{pet_name}}’s request for {{service_name}} between {{preferred_from}} and {{preferred_to}}. We’ll contact you when a safe opening matches.\n\n— ${brandName}` },
        { id: crypto.randomUUID(), organizationId, locationId, key: "waitlist_opening_available", name: "Waitlist opening available", channel: "email", subject: `An opening may fit {{pet_name}}`, body: `Hi {{client_name}},\n\nAn opening for {{pet_name}}’s {{service_name}} is currently available on {{opening_date}} at {{opening_time}}.\n\nOpen your private booking link to confirm it:\n\n{{portal_url}}\n\nThis opening is not held and goes to the first client who completes booking. If it is gone, your waitlist request remains available to our team.\n\n— ${brandName}` },
        { id: crypto.randomUUID(), organizationId, locationId, key: "approval_request", name: "Additional work approval", channel: "sms", subject: "", body: `Hi {{client_name}} — {{pet_name}} needs {{approval_title}} ({{approval_amount}}). Review it here: {{approval_url}}` },
        { id: crypto.randomUUID(), organizationId, locationId, key: "report_card", name: "Grooming report card", channel: "email", subject: `{{pet_name}}’s ${brandName} report card`, body: `Hi {{client_name}},\n\n{{pet_name}} did beautifully today. Here’s the groomer’s note:\n\n{{report_card}}\n\n— ${brandName}` },
      ]),
      db.insert(auditEvents).values({ id: crypto.randomUUID(), organizationId, actorType: "staff", actorId: staffId, action: "organization.created", entityType: "organization", entityId: organizationId, detailsJson: JSON.stringify({ country, currency }) }),
    ]);

    const cookie = `Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=31536000`;
    const headers = new Headers();
    headers.append("Set-Cookie", `salon_organization=${encodeURIComponent(organizationId)}; ${cookie}`);
    headers.append("Set-Cookie", `salon_location=${encodeURIComponent(locationId)}; ${cookie}`);
    return Response.json({ organizationId, locationId }, { status: 201, headers });
  } catch (error) {
    return salonApiError(error, "Salon could not be created");
  }
}
