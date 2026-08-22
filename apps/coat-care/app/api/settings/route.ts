import { and, asc, eq } from "drizzle-orm";
import type { BatchItem } from "drizzle-orm/batch";
import { auditEvents, communicationTemplates, locationHours, locations, organizations, paymentProviderAccounts, salonSettings, services, staff, staffInvitations, staffLocations } from "../../../db/schema";
import { stripeConfig } from "../../../lib/stripe";
import { requireSalonAccess, requireSalonManager, requireSalonOwner, requireWorkspacePermission, salonApiError, SalonAccessError } from "../../salon-access";

const currencies = ["CAD", "USD"];
const countries = ["CA", "US"];
const timezones = ["America/Toronto", "America/Vancouver", "America/Edmonton", "America/Winnipeg", "America/Halifax", "America/St_Johns", "America/New_York", "America/Chicago", "America/Denver", "America/Los_Angeles", "America/Phoenix"];

function clean(value: unknown, max = 120) { return String(value || "").trim().slice(0, max); }
function integer(value: unknown, min: number, max: number, label: string) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < min || parsed > max) throw new SalonAccessError(`${label} is outside the allowed range.`, 400);
  return parsed;
}
function slug(value: string) { return value.toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 60) || `location-${Date.now()}`; }
function chunks<T>(values: T[], size: number) { return Array.from({ length: Math.ceil(values.length / size) }, (_, index) => values.slice(index * size, (index + 1) * size)); }
function validTime(value: string) { const match = /^(\d{2}):(\d{2})$/.exec(value); return Boolean(match && Number(match[1]) < 24 && Number(match[2]) < 60); }

async function settingsPayload(db: ReturnType<typeof import("../../../db").getDb>, membership: Awaited<ReturnType<typeof requireSalonAccess>>["membership"]) {
  const [[organization], [location], [settings], hours, people, invitations, serviceRows, [paymentAccount]] = await Promise.all([
    db.select().from(organizations).where(eq(organizations.id, membership.organizationId)).limit(1),
    db.select().from(locations).where(and(eq(locations.id, membership.locationId), eq(locations.organizationId, membership.organizationId))).limit(1),
    db.select().from(salonSettings).where(eq(salonSettings.locationId, membership.locationId)).limit(1),
    db.select().from(locationHours).where(eq(locationHours.locationId, membership.locationId)).orderBy(asc(locationHours.weekday)),
    db.select({ id: staff.id, displayName: staff.displayName, email: staff.email, role: staffLocations.role }).from(staffLocations).innerJoin(staff, eq(staffLocations.staffId, staff.id)).where(and(eq(staffLocations.locationId, membership.locationId), eq(staffLocations.active, true), eq(staff.active, true))).orderBy(asc(staff.displayName)),
    db.select().from(staffInvitations).where(and(eq(staffInvitations.locationId, membership.locationId), eq(staffInvitations.status, "pending"))).orderBy(asc(staffInvitations.createdAt)),
    db.select({ id: services.id }).from(services).where(and(eq(services.locationId, membership.locationId), eq(services.active, true))),
    db.select().from(paymentProviderAccounts).where(eq(paymentProviderAccounts.organizationId, membership.organizationId)).limit(1),
  ]);
  const checklist = [
    { key: "identity", label: "Business identity", complete: Boolean(organization?.name && organization?.contactEmail && location?.addressLine1) },
    { key: "hours", label: "Opening hours", complete: hours.length === 7 && hours.some((day) => day.open) },
    { key: "services", label: "Service menu", complete: serviceRows.length > 0 },
    { key: "team", label: "Team access", complete: people.length > 0 },
    { key: "booking", label: "Online booking", complete: Boolean(settings?.allowOnlineBooking) },
  ];
  const payments = stripeConfig(); return { organization, location, settings, hours, people, invitations, locations: membership.locations, checklist, readiness: Math.round(checklist.filter((item) => item.complete).length / checklist.length * 100), canEditOrganization: membership.role === "owner", canCreateLocation: membership.role === "owner", paymentReadiness: { configured: payments.configured, webhookConfigured: Boolean(payments.webhookSecret), connected: Boolean(paymentAccount), chargesEnabled: Boolean(paymentAccount?.chargesEnabled), payoutsEnabled: Boolean(paymentAccount?.payoutsEnabled) } };
}

export async function GET() {
  try {
    const { db, membership } = await requireSalonAccess(); requireWorkspacePermission(membership, "settings"); requireSalonManager(membership);
    return Response.json(await settingsPayload(db, membership));
  } catch (error) { return salonApiError(error, "Salon settings unavailable"); }
}

export async function PATCH(request: Request) {
  try {
    const { db, membership } = await requireSalonAccess(); requireWorkspacePermission(membership, "settings"); requireSalonManager(membership);
    const body = await request.json() as Record<string, unknown>;
    const organization = body.organization as Record<string, unknown> | undefined;
    const location = body.location as Record<string, unknown> | undefined;
    const settings = body.settings as Record<string, unknown> | undefined;
    const hours = body.hours as Array<Record<string, unknown>> | undefined;
    const now = new Date().toISOString();
    let organizationValues: {
      name: string; country: "CA" | "US"; currency: "CAD" | "USD";
      contactEmail: string; contactPhone: string; website: string; updatedAt: string;
    } | null = null;
    if (organization) {
      requireSalonOwner(membership);
      const country = clean(organization.country, 2);
      const name = clean(organization.name, 80);
      const contactEmail = clean(organization.contactEmail, 160).toLowerCase();
      if (!countries.includes(country)) throw new SalonAccessError("Choose Canada or the United States.", 400);
      organizationValues = { name, country: country as "CA" | "US", currency: country === "US" ? "USD" : "CAD", contactEmail, contactPhone: clean(organization.contactPhone, 40), website: clean(organization.website, 200), updatedAt: now };
    }
    let locationValues: {
      name: string; addressLine1: string; city: string; region: string; postalCode: string;
      contactEmail: string; contactPhone: string; currency: string; timezone: string;
      taxLabel: string; taxRateBps: number; updatedAt: string;
    } | null = null;
    if (location) {
      const currency = clean(location.currency, 3); const timezone = clean(location.timezone, 60);
      if (!currencies.includes(currency) || !timezones.includes(timezone)) throw new SalonAccessError("Choose a supported currency and time zone.", 400);
      const name = clean(location.name, 80), addressLine1 = clean(location.addressLine1, 120), city = clean(location.city, 80), region = clean(location.region, 40), postalCode = clean(location.postalCode, 20), contactEmail = clean(location.contactEmail, 160).toLowerCase(), taxLabel = clean(location.taxLabel, 20);
      locationValues = { name, addressLine1, city, region, postalCode, contactEmail, contactPhone: clean(location.contactPhone, 40), currency, timezone, taxLabel, taxRateBps: integer(location.taxRateBps, 0, 3000, "Tax rate"), updatedAt: now };
    }
    let settingsValues: {
      bookingMode: "automatic" | "request"; cancellationHours: number; minimumLeadMinutes: number;
      bookingWindowDays: number; maxConcurrentPets: number; bathStations: number; groomingTables: number;
      dryers: number; kennels: number; allowOnlineBooking: boolean; requireOnlineDeposit: boolean;
      depositHoldMinutes: number; updatedAt: string;
    } | null = null;
    if (settings) {
      const bookingMode = clean(settings.bookingMode, 12); if (!["automatic", "request"].includes(bookingMode)) throw new SalonAccessError("Choose a valid booking mode.", 400);
      const requireOnlineDeposit = settings.requireOnlineDeposit === true;
      if (requireOnlineDeposit) { const [account] = await db.select().from(paymentProviderAccounts).where(eq(paymentProviderAccounts.organizationId, membership.organizationId)).limit(1); const payments = stripeConfig(); if (!payments.configured || !payments.webhookSecret || !account?.chargesEnabled || !account.payoutsEnabled) throw new SalonAccessError("Finish Stripe payouts and verified webhooks before requiring online booking deposits.", 409); }
      settingsValues = { bookingMode: bookingMode as "automatic" | "request", cancellationHours: integer(settings.cancellationHours, 0, 168, "Cancellation window"), minimumLeadMinutes: integer(settings.minimumLeadMinutes, 0, 10080, "Minimum lead time"), bookingWindowDays: integer(settings.bookingWindowDays, 1, 365, "Booking window"), maxConcurrentPets: integer(settings.maxConcurrentPets, 1, 50, "Concurrent pet capacity"), bathStations: integer(settings.bathStations, 0, 30, "Bath stations"), groomingTables: integer(settings.groomingTables, 0, 50, "Grooming tables"), dryers: integer(settings.dryers, 0, 50, "Dryers"), kennels: integer(settings.kennels, 0, 100, "Kennels"), allowOnlineBooking: settings.allowOnlineBooking !== false, requireOnlineDeposit, depositHoldMinutes: integer(settings.depositHoldMinutes ?? 30, 30, 60, "Deposit hold"), updatedAt: now };
    }
    let hourValues: Array<{ weekday: number; open: boolean; opensAt: string; closesAt: string }> | null = null;
    if (hours) {
      if (!Array.isArray(hours) || hours.length !== 7) throw new SalonAccessError("Provide all seven days of opening hours.", 400);
      hourValues = hours.map((day) => {
        const weekday = integer(day.weekday, 0, 6, "Weekday"); const opensAt = clean(day.opensAt, 5); const closesAt = clean(day.closesAt, 5);
        if (!validTime(opensAt) || !validTime(closesAt) || (day.open !== false && opensAt >= closesAt)) throw new SalonAccessError("Check each location opening and closing time.", 400);
        return { weekday, open: day.open !== false, opensAt, closesAt };
      });
      if (new Set(hourValues.map((day) => day.weekday)).size !== 7) throw new SalonAccessError("Provide each day of the week exactly once.", 400);
    }
    const statements: [BatchItem<"sqlite">, ...BatchItem<"sqlite">[]] = [
      db.insert(auditEvents).values({ id: crypto.randomUUID(), organizationId: membership.organizationId, actorType: "staff", actorId: membership.id, action: "salon.settings_updated", entityType: "location", entityId: membership.locationId, detailsJson: JSON.stringify({ organization: Boolean(organizationValues), location: Boolean(locationValues), settings: Boolean(settingsValues), hours: Boolean(hourValues) }) }),
    ];
    if (organizationValues) statements.push(db.update(organizations).set(organizationValues).where(eq(organizations.id, membership.organizationId)));
    if (locationValues) statements.push(db.update(locations).set(locationValues).where(and(eq(locations.id, membership.locationId), eq(locations.organizationId, membership.organizationId))));
    if (settingsValues) statements.push(db.update(salonSettings).set(settingsValues).where(and(eq(salonSettings.locationId, membership.locationId), eq(salonSettings.organizationId, membership.organizationId))));
    for (const day of hourValues || []) statements.push(db.update(locationHours).set({ open: day.open, opensAt: day.opensAt, closesAt: day.closesAt, updatedAt: now }).where(and(eq(locationHours.organizationId, membership.organizationId), eq(locationHours.locationId, membership.locationId), eq(locationHours.weekday, day.weekday))));
    await db.batch(statements);
    return Response.json(await settingsPayload(db, membership));
  } catch (error) { return salonApiError(error, "Salon settings could not be saved"); }
}

export async function POST(request: Request) {
  try {
    const { db, membership } = await requireSalonAccess(); requireWorkspacePermission(membership, "settings"); requireSalonManager(membership);
    const body = await request.json() as Record<string, unknown>; const action = clean(body.action, 30);
    if (action === "invite") {
      throw new SalonAccessError("Add and invite teammates from Team so employee setup and CRM access stay together.", 409);
    } else if (action === "revoke_invitation") {
      const invitationId = clean(body.invitationId, 80);
      await db.batch([
        db.update(staffInvitations).set({ status: "revoked" }).where(and(eq(staffInvitations.id, invitationId), eq(staffInvitations.organizationId, membership.organizationId), eq(staffInvitations.locationId, membership.locationId), eq(staffInvitations.status, "pending"))),
        db.insert(auditEvents).values({ id: crypto.randomUUID(), organizationId: membership.organizationId, actorType: "staff", actorId: membership.id, action: "staff.invitation_revoked", entityType: "staff_invitation", entityId: invitationId }),
      ]);
    } else if (action === "create_location") {
      requireSalonOwner(membership);
      const name = clean(body.name, 80), city = clean(body.city, 80), addressLine1 = clean(body.addressLine1, 120), region = clean(body.region, 40), postalCode = clean(body.postalCode, 20), currency = clean(body.currency, 3), timezone = clean(body.timezone, 60);
      if (!name || !city || !addressLine1 || !region || !postalCode || !currencies.includes(currency) || !timezones.includes(timezone)) throw new SalonAccessError("Complete every required location field.", 400);
      const id = crypto.randomUUID(); const baseSlug = slug(name); const [collision] = await db.select({ id: locations.id }).from(locations).where(and(eq(locations.organizationId, membership.organizationId), eq(locations.slug, baseSlug))).limit(1); const locationSlug = collision ? `${baseSlug}-${crypto.randomUUID().slice(0, 6)}` : baseSlug;
      const cloneServices = body.cloneServices === true;
      const [source, templates] = cloneServices ? await Promise.all([
        db.select().from(services).where(and(eq(services.organizationId, membership.organizationId), eq(services.locationId, membership.locationId))),
        db.select().from(communicationTemplates).where(and(eq(communicationTemplates.organizationId, membership.organizationId), eq(communicationTemplates.locationId, membership.locationId))),
      ]) : [[], []];
      const serviceClones = source.map((service) => ({ id: crypto.randomUUID(), organizationId: membership.organizationId, locationId: id, name: service.name, description: service.description, durationMinutes: service.durationMinutes, bufferMinutes: service.bufferMinutes, priceFromCents: service.priceFromCents, depositCents: service.depositCents, bathMinutes: service.bathMinutes, dryerMinutes: service.dryerMinutes, groomingTableMinutes: service.groomingTableMinutes, kennelMinutes: service.kennelMinutes, active: service.active }));
      const templateClones = templates.map((template) => ({ id: crypto.randomUUID(), organizationId: membership.organizationId, locationId: id, key: template.key, name: template.name, channel: template.channel, category: template.category, subject: template.subject, body: template.body, active: template.active }));
      const statements: [BatchItem<"sqlite">, ...BatchItem<"sqlite">[]] = [
        db.insert(locations).values({ id, organizationId: membership.organizationId, slug: locationSlug, name, city, addressLine1, region, postalCode, currency, timezone }),
        db.insert(salonSettings).values({ id: crypto.randomUUID(), organizationId: membership.organizationId, locationId: id }),
        db.insert(locationHours).values(Array.from({ length: 7 }, (_, weekday) => ({ id: crypto.randomUUID(), organizationId: membership.organizationId, locationId: id, weekday, open: weekday !== 0 }))),
        db.insert(staffLocations).values({ id: crypto.randomUUID(), organizationId: membership.organizationId, staffId: membership.id, locationId: id, role: "owner" }),
        db.insert(auditEvents).values({ id: crypto.randomUUID(), organizationId: membership.organizationId, actorType: "staff", actorId: membership.id, action: "location.created", entityType: "location", entityId: id, detailsJson: JSON.stringify({ cloneServices, serviceCount: serviceClones.length, templateCount: templateClones.length }) }),
      ];
      for (const values of chunks(serviceClones, 6)) statements.push(db.insert(services).values(values));
      for (const values of chunks(templateClones, 8)) statements.push(db.insert(communicationTemplates).values(values));
      try {
        await db.batch(statements);
      } catch (error) {
        if (error instanceof Error && /constraint|unique/i.test(error.message)) throw new SalonAccessError("A location with that identity was created in another session. Refresh settings and try again.", 409);
        throw error;
      }
    } else throw new SalonAccessError("Unknown settings action.", 400);
    return Response.json(await settingsPayload(db, membership));
  } catch (error) { return salonApiError(error, "Settings action could not be completed"); }
}
