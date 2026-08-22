import { and, asc, eq } from "drizzle-orm";
import { getDb } from ".";
import { communicationTemplates, locationHours, locations, organizations, salonSettings, services, staff, staffAvailability, staffLocations, staffServiceSkills } from "./schema";

export const PILOT = {
  organizationId: "org_coat_care",
  locationId: "loc_queen_west",
  locationSlug: "gatineau",
};

const pilotServices = [
  {
    id: "svc_signature",
    name: "Signature groom",
    description: "Bath, haircut, nails, ears & finishing spritz",
    durationMinutes: 150,
    bufferMinutes: 15,
    priceFromCents: 9500,
    depositCents: 2500,
    bathMinutes: 30,
    dryerMinutes: 30,
    groomingTableMinutes: 75,
    kennelMinutes: 0,
  },
  {
    id: "svc_bath_brush",
    name: "Bath & brush",
    description: "Deep cleanse, blow-dry, brush-out & nails",
    durationMinutes: 90,
    bufferMinutes: 15,
    priceFromCents: 5800,
    depositCents: 2000,
    bathMinutes: 30,
    dryerMinutes: 30,
    groomingTableMinutes: 15,
    kennelMinutes: 0,
  },
  {
    id: "svc_puppy",
    name: "Puppy's first visit",
    description: "A gentle introduction for pups under 6 months",
    durationMinutes: 60,
    bufferMinutes: 15,
    priceFromCents: 4800,
    depositCents: 1500,
    bathMinutes: 20,
    dryerMinutes: 20,
    groomingTableMinutes: 20,
    kennelMinutes: 0,
  },
];

const pilotTemplates = [
  { id: "tpl_booking_deposit_required", key: "booking_deposit_required", name: "Booking deposit required", channel: "email" as const, subject: "Complete {{pet_name}}’s deposit to hold the opening", body: "Hi {{client_name}},\n\nWe’re holding {{pet_name}}’s {{service_name}} opening for {{hold_minutes}} minutes. Complete the {{deposit_amount}} deposit here:\n\n{{checkout_url}}\n\nThe booking confirms only after secure payment. If the hold expires, the opening returns to live availability.\n\n— BOPOIL" },
  { id: "tpl_booking_deposit_expired", key: "booking_deposit_expired", name: "Booking deposit hold expired", channel: "email" as const, subject: "{{pet_name}}’s booking hold has closed", body: "Hi {{client_name}},\n\nThe deposit window for {{pet_name}}’s {{service_name}} has closed, so the opening returned to live availability. Your pet profile is still saved.\n\nUse this fresh private link to choose another time:\n\n{{portal_url}}\n\n— BOPOIL" },
  { id: "tpl_booking_request_received", key: "booking_request_received", name: "Booking request received", channel: "email" as const, subject: "We received {{pet_name}}’s booking request", body: "Hi {{client_name}},\n\nWe received your request for {{pet_name}}’s {{service_name}} on {{appointment_date}} at {{appointment_time}}. Our team will review it and confirm shortly.\n\nManage pets and appointments: {{portal_url}}\n\n— BOPOIL" },
  { id: "tpl_booking_confirmation", key: "booking_confirmation", name: "Booking confirmation", channel: "email" as const, subject: "{{pet_name}} is booked at BOPOIL", body: "Hi {{client_name}},\n\n{{pet_name}} is confirmed for {{service_name}} on {{appointment_date}} at {{appointment_time}}.\n\nManage pets and appointments: {{portal_url}}\n\nWe can’t wait to welcome you both.\n\n— BOPOIL" },
  { id: "tpl_portal_access", key: "portal_access", name: "Pet parent portal access", channel: "email" as const, subject: "Your secure BOPOIL link", body: "Hi {{client_name}},\n\nUse this private link to manage your pets, vaccination records, and upcoming appointments:\n\n{{portal_url}}\n\nThis link expires in 15 minutes. After you open it, this browser stays trusted for 30 days.\n\n— BOPOIL" },
  { id: "tpl_waitlist_joined", key: "waitlist_joined", name: "Waitlist confirmation", channel: "email" as const, subject: "{{pet_name}} is on the BOPOIL waitlist", body: "Hi {{client_name}},\n\nWe saved {{pet_name}}’s request for {{service_name}} between {{preferred_from}} and {{preferred_to}}. We’ll contact you when a safe opening matches.\n\nThere’s nothing else you need to do.\n\n— BOPOIL" },
  { id: "tpl_waitlist_opening_available", key: "waitlist_opening_available", name: "Waitlist opening available", channel: "email" as const, subject: "An opening may fit {{pet_name}}", body: "Hi {{client_name}},\n\nAn opening for {{pet_name}}’s {{service_name}} is currently available on {{opening_date}} at {{opening_time}}.\n\nOpen your private booking link to confirm it:\n\n{{portal_url}}\n\nThis opening is not held and goes to the first client who completes booking. If it is gone, your waitlist request remains available to our team.\n\n— BOPOIL" },
  { id: "tpl_appointment_reminder", key: "appointment_reminder", name: "24-hour reminder", channel: "email" as const, subject: "A friendly reminder for {{pet_name}}’s visit", body: "Hi {{client_name}},\n\nA quick reminder that {{pet_name}}’s {{service_name}} appointment is tomorrow at {{appointment_time}}.\n\nManage or reschedule securely: {{portal_url}}\n\nReply or call us if anything has changed.\n\n— BOPOIL" },
  { id: "tpl_ready_pickup", key: "ready_pickup", name: "Ready for pickup", channel: "sms" as const, subject: "", body: "Hi {{client_name}} — {{pet_name}} is fresh, happy, and ready for pickup at BOPOIL. See you soon!" },
  { id: "tpl_receipt", key: "receipt", name: "Payment receipt", channel: "email" as const, subject: "Your BOPOIL receipt · {{invoice_number}}", body: "Hi {{client_name}},\n\nThank you for visiting BOPOIL with {{pet_name}}. We received {{payment_total}} for invoice {{invoice_number}}.\n\nWe hope to see you both again soon.\n\n— BOPOIL" },
  { id: "tpl_approval_request", key: "approval_request", name: "Additional work approval", channel: "sms" as const, subject: "", body: "Hi {{client_name}} — we found that {{pet_name}} needs {{approval_title}} ({{approval_amount}}). Please review and approve here: {{approval_url}}" },
  { id: "tpl_report_card", key: "report_card", name: "Grooming report card", channel: "email" as const, subject: "{{pet_name}}’s BOPOIL report card", body: "Hi {{client_name}},\n\n{{pet_name}} did beautifully today. Here’s the groomer’s note:\n\n{{report_card}}\n\nThank you for trusting BOPOIL.\n\n— BOPOIL" },
];

const legacyAppointmentReminderBody = "Hi {{client_name}},\n\nA quick reminder that {{pet_name}}’s {{service_name}} appointment is tomorrow at {{appointment_time}}. Reply or call us if anything has changed.\n\n— Coat & Care";
const appointmentReminderBody = pilotTemplates.find((template) => template.key === "appointment_reminder")!.body;

function chunks<T>(values: T[], size = 8) {
  return Array.from({ length: Math.ceil(values.length / size) }, (_, index) => values.slice(index * size, (index + 1) * size));
}

async function seedPilotData() {
  const db = getDb();
  await db.insert(organizations).values({
    id: PILOT.organizationId,
    slug: "bopoil",
    name: "BOPOIL Toilettage & Boutique",
    country: "CA",
    currency: "CAD",
    timezone: "America/Toronto",
    contactEmail: "info@bopoil.ca",
    contactPhone: "+1 819 968-2827",
    website: "https://bopoil.ca",
    onboardingCompleted: true,
  }).onConflictDoNothing();

  await db.insert(locations).values({
    id: PILOT.locationId,
    organizationId: PILOT.organizationId,
    slug: PILOT.locationSlug,
    name: "Gatineau",
    addressLine1: "38 Av Gatineau",
    city: "Gatineau",
    region: "QC",
    postalCode: "J8T 4J1",
    contactEmail: "info@bopoil.ca",
    contactPhone: "+1 819 968-2827",
    currency: "CAD",
    timezone: "America/Toronto",
    taxLabel: "GST/QST",
    taxRateBps: 1498,
  }).onConflictDoNothing();

  const pilotStaff = [
    { id: "staff_maya", organizationId: PILOT.organizationId, locationId: PILOT.locationId, displayName: "Maya", role: "groomer" },
    { id: "staff_nadia", organizationId: PILOT.organizationId, locationId: PILOT.locationId, displayName: "Nadia", role: "groomer" },
    { id: "staff_jonah", organizationId: PILOT.organizationId, locationId: PILOT.locationId, displayName: "Jonah", role: "bather" },
  ] as const;
  for (const values of chunks([...pilotStaff])) await db.insert(staff).values(values).onConflictDoNothing();

  const pilotMemberships = [
    { id: "membership_maya_queen_west", organizationId: PILOT.organizationId, staffId: "staff_maya", locationId: PILOT.locationId, role: "groomer" },
    { id: "membership_nadia_queen_west", organizationId: PILOT.organizationId, staffId: "staff_nadia", locationId: PILOT.locationId, role: "groomer" },
    { id: "membership_jonah_queen_west", organizationId: PILOT.organizationId, staffId: "staff_jonah", locationId: PILOT.locationId, role: "bather" },
  ] as const;
  for (const values of chunks([...pilotMemberships])) await db.insert(staffLocations).values(values).onConflictDoNothing();

  await db.insert(salonSettings).values({ id: "settings_queen_west", organizationId: PILOT.organizationId, locationId: PILOT.locationId, bookingMode: "automatic", cancellationHours: 24, minimumLeadMinutes: 120, bookingWindowDays: 120, maxConcurrentPets: 4, bathStations: 2, groomingTables: 3, dryers: 2, kennels: 6 }).onConflictDoNothing();
  const pilotHours = Array.from({ length: 7 }, (_, weekday) => ({ id: `hours_queen_west_${weekday}`, organizationId: PILOT.organizationId, locationId: PILOT.locationId, weekday, open: weekday !== 0, opensAt: weekday === 6 ? "09:00" : "08:00", closesAt: weekday === 6 ? "16:00" : "18:00" }));
  for (const values of chunks(pilotHours)) await db.insert(locationHours).values(values).onConflictDoNothing();

  const serviceRows = pilotServices.map((service) => ({
    ...service,
    organizationId: PILOT.organizationId,
    locationId: PILOT.locationId,
  }));
  for (const values of chunks(serviceRows)) await db.insert(services).values(values).onConflictDoNothing();

  const weekdays = [1, 2, 3, 4, 5];
  const staffIds = ["staff_maya", "staff_nadia", "staff_jonah"];
  const availabilityRows = staffIds.flatMap((staffId) => weekdays.map((weekday) => ({
    id: `availability_${staffId}_${weekday}`,
    organizationId: PILOT.organizationId,
    locationId: PILOT.locationId,
    staffId,
    weekday,
    startTime: staffId === "staff_nadia" ? "10:00" : "09:00",
    endTime: staffId === "staff_jonah" ? "16:00" : "18:00",
  })));
  for (const values of chunks(availabilityRows)) await db.insert(staffAvailability).values(values).onConflictDoNothing();

  const skillRows = staffIds.flatMap((staffId) => pilotServices
    .filter((service) => staffId !== "staff_jonah" || service.id !== "svc_signature")
    .map((service) => ({
      id: `skill_${staffId}_${service.id}`,
      organizationId: PILOT.organizationId,
      locationId: PILOT.locationId,
      staffId,
      serviceId: service.id,
    })));
  for (const values of chunks(skillRows)) await db.insert(staffServiceSkills).values(values).onConflictDoNothing();

  const templateRows = pilotTemplates.map((template) => ({
    ...template,
    organizationId: PILOT.organizationId,
    locationId: PILOT.locationId,
    category: "transactional" as const,
  }));
  for (const values of chunks(templateRows)) await db.insert(communicationTemplates).values(values).onConflictDoNothing();
  await db.update(communicationTemplates).set({
    body: appointmentReminderBody,
    updatedAt: new Date().toISOString(),
  }).where(and(
    eq(communicationTemplates.id, "tpl_appointment_reminder"),
    eq(communicationTemplates.organizationId, PILOT.organizationId),
    eq(communicationTemplates.locationId, PILOT.locationId),
    eq(communicationTemplates.body, legacyAppointmentReminderBody),
  ));
}

let pilotSeedPromise: Promise<void> | null = null;

export function ensurePilotData() {
  if (!pilotSeedPromise) pilotSeedPromise = seedPilotData().catch((error) => { pilotSeedPromise = null; throw error; });
  return pilotSeedPromise;
}

export async function getPilotServices() {
  await ensurePilotData();
  return getDb().select().from(services).where(and(
    eq(services.organizationId, PILOT.organizationId),
    eq(services.locationId, PILOT.locationId),
    eq(services.active, true),
  )).orderBy(asc(services.priceFromCents));
}
