import { sql } from "drizzle-orm";
import { index, integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

export const organizations = sqliteTable("organizations", {
  id: text("id").primaryKey(),
  slug: text("slug").notNull().unique(),
  name: text("name").notNull(),
  country: text("country").notNull().default("CA"),
  currency: text("currency").notNull().default("CAD"),
  timezone: text("timezone").notNull().default("America/Toronto"),
  contactEmail: text("contact_email").notNull().default(""),
  contactPhone: text("contact_phone").notNull().default(""),
  website: text("website").notNull().default(""),
  onboardingCompleted: integer("onboarding_completed", { mode: "boolean" }).notNull().default(false),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
});

export const locations = sqliteTable("locations", {
  id: text("id").primaryKey(),
  organizationId: text("organization_id").notNull().references(() => organizations.id),
  slug: text("slug").notNull(),
  name: text("name").notNull(),
  addressLine1: text("address_line_1").notNull(),
  city: text("city").notNull(),
  region: text("region").notNull(),
  postalCode: text("postal_code").notNull(),
  contactEmail: text("contact_email").notNull().default(""),
  contactPhone: text("contact_phone").notNull().default(""),
  currency: text("currency").notNull().default("CAD"),
  timezone: text("timezone").notNull().default("America/Toronto"),
  taxLabel: text("tax_label").notNull().default("Tax"),
  taxRateBps: integer("tax_rate_bps").notNull().default(0),
  active: integer("active", { mode: "boolean" }).notNull().default(true),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
}, (table) => [
  uniqueIndex("locations_org_slug_unique").on(table.organizationId, table.slug),
]);

export const staff = sqliteTable("staff", {
  id: text("id").primaryKey(),
  organizationId: text("organization_id").notNull().references(() => organizations.id),
  locationId: text("location_id").notNull().references(() => locations.id),
  email: text("email"),
  displayName: text("display_name").notNull(),
  role: text("role", { enum: ["owner", "manager", "receptionist", "groomer", "bather", "accountant"] }).notNull(),
  active: integer("active", { mode: "boolean" }).notNull().default(true),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
}, (table) => [
  uniqueIndex("staff_org_email_unique").on(table.organizationId, table.email),
  index("staff_location_idx").on(table.locationId),
]);

export const staffLocations = sqliteTable("staff_locations", {
  id: text("id").primaryKey(),
  organizationId: text("organization_id").notNull().references(() => organizations.id),
  staffId: text("staff_id").notNull().references(() => staff.id),
  locationId: text("location_id").notNull().references(() => locations.id),
  role: text("role", { enum: ["owner", "manager", "receptionist", "groomer", "bather", "accountant"] }).notNull(),
  permissionsJson: text("permissions_json"),
  active: integer("active", { mode: "boolean" }).notNull().default(true),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
}, (table) => [
  uniqueIndex("staff_locations_staff_location_unique").on(table.staffId, table.locationId),
  index("staff_locations_org_location_idx").on(table.organizationId, table.locationId),
]);

export const staffInvitations = sqliteTable("staff_invitations", {
  id: text("id").primaryKey(),
  organizationId: text("organization_id").notNull().references(() => organizations.id),
  locationId: text("location_id").notNull().references(() => locations.id),
  email: text("email").notNull(),
  role: text("role", { enum: ["manager", "receptionist", "groomer", "bather", "accountant"] }).notNull(),
  token: text("token").notNull().unique(),
  status: text("status", { enum: ["pending", "accepted", "revoked", "expired"] }).notNull().default("pending"),
  invitedByStaffId: text("invited_by_staff_id").references(() => staff.id),
  expiresAt: text("expires_at").notNull(),
  acceptedAt: text("accepted_at"),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
}, (table) => [
  index("staff_invitations_org_email_idx").on(table.organizationId, table.email),
  index("staff_invitations_location_status_idx").on(table.locationId, table.status),
]);

export const salonSettings = sqliteTable("salon_settings", {
  id: text("id").primaryKey(),
  organizationId: text("organization_id").notNull().references(() => organizations.id),
  locationId: text("location_id").notNull().references(() => locations.id),
  bookingMode: text("booking_mode", { enum: ["automatic", "request"] }).notNull().default("automatic"),
  cancellationHours: integer("cancellation_hours").notNull().default(24),
  minimumLeadMinutes: integer("minimum_lead_minutes").notNull().default(120),
  bookingWindowDays: integer("booking_window_days").notNull().default(120),
  maxConcurrentPets: integer("max_concurrent_pets").notNull().default(4),
  bathStations: integer("bath_stations").notNull().default(2),
  groomingTables: integer("grooming_tables").notNull().default(3),
  dryers: integer("dryers").notNull().default(2),
  kennels: integer("kennels").notNull().default(6),
  allowOnlineBooking: integer("allow_online_booking", { mode: "boolean" }).notNull().default(true),
  requireOnlineDeposit: integer("require_online_deposit", { mode: "boolean" }).notNull().default(false),
  depositHoldMinutes: integer("deposit_hold_minutes").notNull().default(30),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
}, (table) => [uniqueIndex("salon_settings_location_unique").on(table.locationId)]);

export const locationHours = sqliteTable("location_hours", {
  id: text("id").primaryKey(),
  organizationId: text("organization_id").notNull().references(() => organizations.id),
  locationId: text("location_id").notNull().references(() => locations.id),
  weekday: integer("weekday").notNull(),
  open: integer("open", { mode: "boolean" }).notNull().default(true),
  opensAt: text("opens_at").notNull().default("09:00"),
  closesAt: text("closes_at").notNull().default("18:00"),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
}, (table) => [
  uniqueIndex("location_hours_day_unique").on(table.locationId, table.weekday),
  index("location_hours_org_idx").on(table.organizationId),
]);

export const clients = sqliteTable("clients", {
  id: text("id").primaryKey(),
  organizationId: text("organization_id").notNull().references(() => organizations.id),
  fullName: text("full_name").notNull(),
  email: text("email").notNull(),
  phone: text("phone").notNull(),
  marketingConsent: integer("marketing_consent", { mode: "boolean" }).notNull().default(false),
  emailDeliverability: text("email_deliverability", { enum: ["unknown", "reachable", "bounced", "complained", "suppressed"] }).notNull().default("unknown"),
  smsDeliverability: text("sms_deliverability", { enum: ["unknown", "reachable", "undelivered", "failed"] }).notNull().default("unknown"),
  emailDeliverabilityAt: text("email_deliverability_at"),
  smsDeliverabilityAt: text("sms_deliverability_at"),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
}, (table) => [
  uniqueIndex("clients_org_email_unique").on(table.organizationId, table.email).where(sql`${table.email} <> ''`),
  index("clients_org_phone_idx").on(table.organizationId, table.phone),
]);

export const clientPortalSessions = sqliteTable("client_portal_sessions", {
  id: text("id").primaryKey(),
  organizationId: text("organization_id").notNull().references(() => organizations.id),
  clientId: text("client_id").notNull().references(() => clients.id),
  tokenHash: text("token_hash").notNull().unique(),
  expiresAt: text("expires_at").notNull(),
  lastUsedAt: text("last_used_at"),
  revokedAt: text("revoked_at"),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
}, (table) => [index("client_portal_sessions_client_idx").on(table.clientId, table.createdAt)]);

export const portalAccessRequests = sqliteTable("portal_access_requests", {
  id: text("id").primaryKey(),
  organizationId: text("organization_id").notNull().references(() => organizations.id),
  emailHash: text("email_hash").notNull(),
  sourceHash: text("source_hash").notNull().default(""),
  requestedAt: text("requested_at").notNull().default(sql`CURRENT_TIMESTAMP`),
}, (table) => [index("portal_access_requests_email_time_idx").on(table.emailHash, table.requestedAt)]);

export const clientPhoneIdentities = sqliteTable("client_phone_identities", {
  id: text("id").primaryKey(),
  organizationId: text("organization_id").notNull().references(() => organizations.id),
  clientId: text("client_id").notNull().references(() => clients.id),
  phoneE164: text("phone_e164").notNull(),
  verifiedAt: text("verified_at").notNull(),
  lastUsedAt: text("last_used_at"),
  revokedAt: text("revoked_at"),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
}, (table) => [
  uniqueIndex("client_phone_identities_active_phone_unique")
    .on(table.organizationId, table.phoneE164)
    .where(sql`${table.revokedAt} is null`),
  index("client_phone_identities_client_idx").on(table.clientId, table.createdAt),
]);

export const clientPhoneOtpChallenges = sqliteTable("client_phone_otp_challenges", {
  id: text("id").primaryKey(),
  organizationId: text("organization_id").notNull().references(() => organizations.id),
  phoneE164: text("phone_e164").notNull(),
  destinationHash: text("destination_hash").notNull(),
  sourceHash: text("source_hash").notNull(),
  challengeTokenHash: text("challenge_token_hash").notNull().unique(),
  codeHash: text("code_hash").notNull(),
  attemptCount: integer("attempt_count").notNull().default(0),
  deliveryStatus: text("delivery_status", { enum: ["pending", "accepted", "failed", "uncertain"] }).notNull().default("pending"),
  providerMessageId: text("provider_message_id"),
  enrollmentClientId: text("enrollment_client_id").references(() => clients.id),
  enrollmentSessionId: text("enrollment_session_id").references(() => clientPortalSessions.id),
  expiresAt: text("expires_at").notNull(),
  verifiedAt: text("verified_at"),
  proofExpiresAt: text("proof_expires_at"),
  proofConsumedAt: text("proof_consumed_at"),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
}, (table) => [
  index("client_phone_otp_destination_time_idx").on(table.organizationId, table.destinationHash, table.createdAt),
  index("client_phone_otp_source_time_idx").on(table.organizationId, table.sourceHash, table.createdAt),
  index("client_phone_otp_expiry_idx").on(table.organizationId, table.expiresAt),
]);

export const pets = sqliteTable("pets", {
  id: text("id").primaryKey(),
  organizationId: text("organization_id").notNull().references(() => organizations.id),
  clientId: text("client_id").notNull().references(() => clients.id),
  name: text("name").notNull(),
  species: text("species").notNull().default("dog"),
  breed: text("breed").notNull().default("Unknown"),
  weightKg: integer("weight_kg"),
  dateOfBirth: text("date_of_birth").notNull().default(""),
  sex: text("sex", { enum: ["unknown", "female", "male"] }).notNull().default("unknown"),
  color: text("color").notNull().default(""),
  clientNotes: text("client_notes").notNull().default(""),
  handlingNotes: text("handling_notes").notNull().default(""),
  safetyLevel: text("safety_level", { enum: ["standard", "attention", "high"] }).notNull().default("standard"),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
}, (table) => [
  uniqueIndex("pets_client_name_unique").on(table.clientId, table.name),
  index("pets_org_idx").on(table.organizationId),
]);

export const petCareProfiles = sqliteTable("pet_care_profiles", {
  id: text("id").primaryKey(),
  organizationId: text("organization_id").notNull().references(() => organizations.id),
  petId: text("pet_id").notNull().references(() => pets.id),
  sizeLabel: text("size_label").notNull().default(""),
  healthNotes: text("health_notes").notNull().default(""),
  behaviorNotes: text("behavior_notes").notNull().default(""),
  sterilized: text("sterilized", { enum: ["unknown", "yes", "no"] }).notNull().default("unknown"),
  treatsAllowed: integer("treats_allowed", { mode: "boolean" }),
  marketingPhotosAllowed: integer("marketing_photos_allowed", { mode: "boolean" }),
  source: text("source").notNull().default("staff"),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
}, (table) => [
  uniqueIndex("pet_care_profiles_pet_unique").on(table.petId),
  index("pet_care_profiles_org_idx").on(table.organizationId),
]);

export const publicIntakeSubmissions = sqliteTable("public_intake_submissions", {
  id: text("id").primaryKey(),
  organizationId: text("organization_id").notNull().references(() => organizations.id),
  locationId: text("location_id").notNull().references(() => locations.id),
  clientId: text("client_id").references(() => clients.id),
  petId: text("pet_id").references(() => pets.id),
  submissionKey: text("submission_key").notNull(),
  sourceHash: text("source_hash").notNull(),
  contactHash: text("contact_hash").notNull(),
  status: text("status", { enum: ["received", "processed", "review"] }).notNull().default("received"),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
}, (table) => [
  uniqueIndex("public_intake_submission_key_unique").on(table.organizationId, table.submissionKey),
  index("public_intake_source_time_idx").on(table.organizationId, table.sourceHash, table.createdAt),
  index("public_intake_contact_time_idx").on(table.organizationId, table.contactHash, table.createdAt),
]);

export const externalEntityLinks = sqliteTable("external_entity_links", {
  id: text("id").primaryKey(),
  organizationId: text("organization_id").notNull().references(() => organizations.id),
  locationId: text("location_id").references(() => locations.id),
  provider: text("provider", { enum: ["square"] }).notNull(),
  entityType: text("entity_type", { enum: ["appointment", "client", "location", "service", "staff"] }).notNull(),
  localEntityId: text("local_entity_id").notNull(),
  externalEntityId: text("external_entity_id").notNull(),
  externalVersion: text("external_version").notNull().default(""),
  metadataJson: text("metadata_json").notNull().default("{}"),
  lastSyncedAt: text("last_synced_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
}, (table) => [
  uniqueIndex("external_entity_provider_external_unique").on(table.organizationId, table.provider, table.entityType, table.externalEntityId),
  index("external_entity_provider_local_idx").on(table.organizationId, table.provider, table.entityType, table.localEntityId),
]);

export const integrationSyncStates = sqliteTable("integration_sync_states", {
  id: text("id").primaryKey(),
  organizationId: text("organization_id").notNull().references(() => organizations.id),
  locationId: text("location_id").notNull().references(() => locations.id),
  provider: text("provider", { enum: ["square"] }).notNull(),
  status: text("status", { enum: ["idle", "running", "succeeded", "failed"] }).notNull().default("idle"),
  lastStartedAt: text("last_started_at"),
  lastSyncedAt: text("last_synced_at"),
  error: text("error").notNull().default(""),
  updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
}, (table) => [
  uniqueIndex("integration_sync_provider_location_unique").on(table.provider, table.locationId),
  index("integration_sync_org_status_idx").on(table.organizationId, table.status, table.updatedAt),
]);

export const vaccinationRecords = sqliteTable("vaccination_records", {
  id: text("id").primaryKey(),
  organizationId: text("organization_id").notNull().references(() => organizations.id),
  petId: text("pet_id").notNull().references(() => pets.id),
  vaccineName: text("vaccine_name").notNull(),
  administeredOn: text("administered_on").notNull().default(""),
  expiresOn: text("expires_on").notNull(),
  veterinarian: text("veterinarian").notNull().default(""),
  status: text("status", { enum: ["client_submitted", "verified", "rejected"] }).notNull().default("client_submitted"),
  r2Key: text("r2_key").unique(),
  originalFilename: text("original_filename").notNull().default(""),
  mimeType: text("mime_type").notNull().default(""),
  sizeBytes: integer("size_bytes").notNull().default(0),
  verifiedByStaffId: text("verified_by_staff_id").references(() => staff.id),
  verifiedAt: text("verified_at"),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
}, (table) => [
  index("vaccination_records_pet_expiry_idx").on(table.petId, table.expiresOn),
  index("vaccination_records_org_status_idx").on(table.organizationId, table.status),
]);

export const services = sqliteTable("services", {
  id: text("id").primaryKey(),
  organizationId: text("organization_id").notNull().references(() => organizations.id),
  locationId: text("location_id").notNull().references(() => locations.id),
  name: text("name").notNull(),
  description: text("description").notNull(),
  durationMinutes: integer("duration_minutes").notNull(),
  bufferMinutes: integer("buffer_minutes").notNull().default(15),
  priceFromCents: integer("price_from_cents").notNull(),
  depositCents: integer("deposit_cents").notNull().default(2500),
  bathMinutes: integer("bath_minutes").notNull().default(30),
  dryerMinutes: integer("dryer_minutes").notNull().default(30),
  groomingTableMinutes: integer("grooming_table_minutes").notNull().default(30),
  kennelMinutes: integer("kennel_minutes").notNull().default(0),
  active: integer("active", { mode: "boolean" }).notNull().default(true),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
}, (table) => [
  uniqueIndex("services_location_name_unique").on(table.locationId, table.name),
  index("services_org_idx").on(table.organizationId),
]);

export const staffAvailability = sqliteTable("staff_availability", {
  id: text("id").primaryKey(),
  organizationId: text("organization_id").notNull().references(() => organizations.id),
  locationId: text("location_id").notNull().references(() => locations.id),
  staffId: text("staff_id").notNull().references(() => staff.id),
  weekday: integer("weekday").notNull(),
  startTime: text("start_time").notNull().default("09:00"),
  endTime: text("end_time").notNull().default("17:00"),
  active: integer("active", { mode: "boolean" }).notNull().default(true),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
}, (table) => [
  uniqueIndex("staff_availability_day_unique").on(table.staffId, table.locationId, table.weekday),
  index("staff_availability_org_idx").on(table.organizationId),
]);

export const staffServiceSkills = sqliteTable("staff_service_skills", {
  id: text("id").primaryKey(),
  organizationId: text("organization_id").notNull().references(() => organizations.id),
  locationId: text("location_id").notNull().references(() => locations.id),
  staffId: text("staff_id").notNull().references(() => staff.id),
  serviceId: text("service_id").notNull().references(() => services.id),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
}, (table) => [
  uniqueIndex("staff_service_skill_unique").on(table.staffId, table.serviceId),
  index("staff_service_skills_org_idx").on(table.organizationId),
]);

export const appointments = sqliteTable("appointments", {
  id: text("id").primaryKey(),
  organizationId: text("organization_id").notNull().references(() => organizations.id),
  locationId: text("location_id").notNull().references(() => locations.id),
  clientId: text("client_id").notNull().references(() => clients.id),
  petId: text("pet_id").notNull().references(() => pets.id),
  serviceId: text("service_id").notNull().references(() => services.id),
  staffId: text("staff_id").references(() => staff.id),
  status: text("status", { enum: ["requested", "confirmed", "arrived", "bathing", "drying", "grooming", "quality_check", "ready", "completed", "cancelled", "no_show"] }).notNull().default("confirmed"),
  startsAt: text("starts_at").notNull(),
  endsAt: text("ends_at").notNull(),
  priceEstimateCents: integer("price_estimate_cents").notNull(),
  depositCents: integer("deposit_cents").notNull().default(0),
  depositStatus: text("deposit_status", { enum: ["not_required", "pending", "paid", "waived", "refunded", "failed"] }).notNull().default("not_required"),
  depositDueAt: text("deposit_due_at"),
  depositPaidAt: text("deposit_paid_at"),
  currency: text("currency").notNull().default("CAD"),
  clientNotes: text("client_notes").notNull().default(""),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
}, (table) => [
  index("appointments_org_start_idx").on(table.organizationId, table.startsAt),
  index("appointments_location_start_idx").on(table.locationId, table.startsAt),
  index("appointments_staff_start_idx").on(table.staffId, table.startsAt),
]);

export const appointmentReservations = sqliteTable("appointment_reservations", {
  id: text("id").primaryKey(),
  organizationId: text("organization_id").notNull().references(() => organizations.id),
  locationId: text("location_id").notNull().references(() => locations.id),
  appointmentId: text("appointment_id").notNull().references(() => appointments.id),
  kind: text("kind", { enum: ["staff", "pet_capacity", "bath", "table", "dryer", "kennel"] }).notNull(),
  resourceKey: text("resource_key").notNull(),
  segmentStart: text("segment_start").notNull(),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
}, (table) => [
  uniqueIndex("appointment_reservations_resource_segment_unique").on(table.locationId, table.kind, table.resourceKey, table.segmentStart),
  uniqueIndex("appointment_reservations_appointment_segment_unique").on(table.appointmentId, table.kind, table.segmentStart),
  index("appointment_reservations_location_segment_idx").on(table.locationId, table.segmentStart),
]);

export const appointmentChangeClaims = sqliteTable("appointment_change_claims", {
  id: text("id").primaryKey(),
  organizationId: text("organization_id").notNull().references(() => organizations.id),
  appointmentId: text("appointment_id").notNull().references(() => appointments.id),
  expectedUpdatedAt: text("expected_updated_at").notNull(),
  actorType: text("actor_type", { enum: ["client", "staff", "system"] }).notNull(),
  actorId: text("actor_id"),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
}, (table) => [uniqueIndex("appointment_change_claims_version_unique").on(table.appointmentId, table.expectedUpdatedAt)]);

export const waitlistEntries = sqliteTable("waitlist_entries", {
  id: text("id").primaryKey(),
  organizationId: text("organization_id").notNull().references(() => organizations.id),
  locationId: text("location_id").notNull().references(() => locations.id),
  clientId: text("client_id").notNull().references(() => clients.id),
  petId: text("pet_id").notNull().references(() => pets.id),
  serviceId: text("service_id").notNull().references(() => services.id),
  preferredFrom: text("preferred_from").notNull(),
  preferredTo: text("preferred_to").notNull(),
  timePreference: text("time_preference", { enum: ["anytime", "morning", "afternoon"] }).notNull().default("anytime"),
  status: text("status", { enum: ["waiting", "contacted", "booked", "closed"] }).notNull().default("waiting"),
  sourceHash: text("source_hash").notNull().default(""),
  clientNotes: text("client_notes").notNull().default(""),
  staffNotes: text("staff_notes").notNull().default(""),
  contactedAt: text("contacted_at"),
  convertedAppointmentId: text("converted_appointment_id").references(() => appointments.id),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
}, (table) => [
  index("waitlist_location_status_idx").on(table.locationId, table.status, table.createdAt),
  index("waitlist_client_idx").on(table.clientId, table.createdAt),
  uniqueIndex("waitlist_active_pet_service_unique").on(table.locationId, table.petId, table.serviceId).where(sql`${table.status} in ('waiting','contacted')`),
]);

export const waitlistConversionClaims = sqliteTable("waitlist_conversion_claims", {
  id: text("id").primaryKey(),
  organizationId: text("organization_id").notNull().references(() => organizations.id),
  waitlistEntryId: text("waitlist_entry_id").notNull().references(() => waitlistEntries.id),
  expectedUpdatedAt: text("expected_updated_at").notNull(),
  appointmentId: text("appointment_id").notNull().references(() => appointments.id),
  staffId: text("staff_id").notNull().references(() => staff.id),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
}, (table) => [
  uniqueIndex("waitlist_conversion_entry_unique").on(table.waitlistEntryId),
  uniqueIndex("waitlist_conversion_appointment_unique").on(table.appointmentId),
]);

export const invoices = sqliteTable("invoices", {
  id: text("id").primaryKey(),
  organizationId: text("organization_id").notNull().references(() => organizations.id),
  locationId: text("location_id").notNull().references(() => locations.id),
  appointmentId: text("appointment_id").notNull().references(() => appointments.id),
  invoiceNumber: text("invoice_number").notNull(),
  status: text("status", { enum: ["open", "partially_paid", "paid", "partially_refunded", "refunded", "void"] }).notNull().default("open"),
  subtotalCents: integer("subtotal_cents").notNull(),
  discountCents: integer("discount_cents").notNull().default(0),
  discountReason: text("discount_reason").notNull().default(""),
  taxLabel: text("tax_label").notNull().default("Tax"),
  taxRateBps: integer("tax_rate_bps").notNull().default(0),
  taxCents: integer("tax_cents").notNull().default(0),
  tipCents: integer("tip_cents").notNull().default(0),
  totalCents: integer("total_cents").notNull(),
  amountPaidCents: integer("amount_paid_cents").notNull().default(0),
  amountRefundedCents: integer("amount_refunded_cents").notNull().default(0),
  mutationVersion: integer("mutation_version").notNull().default(0),
  currency: text("currency").notNull(),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  paidAt: text("paid_at"),
}, (table) => [
  uniqueIndex("invoices_appointment_unique").on(table.appointmentId),
  uniqueIndex("invoices_org_number_unique").on(table.organizationId, table.invoiceNumber),
  index("invoices_location_created_idx").on(table.locationId, table.createdAt),
]);

export const invoiceLineItems = sqliteTable("invoice_line_items", {
  id: text("id").primaryKey(),
  organizationId: text("organization_id").notNull().references(() => organizations.id),
  invoiceId: text("invoice_id").notNull().references(() => invoices.id),
  kind: text("kind", { enum: ["service", "product", "adjustment"] }).notNull(),
  description: text("description").notNull(),
  quantity: integer("quantity").notNull().default(1),
  unitPriceCents: integer("unit_price_cents").notNull(),
  totalCents: integer("total_cents").notNull(),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
}, (table) => [index("invoice_line_items_invoice_idx").on(table.invoiceId)]);

export const paymentEvents = sqliteTable("payment_events", {
  id: text("id").primaryKey(),
  organizationId: text("organization_id").notNull().references(() => organizations.id),
  locationId: text("location_id").notNull().references(() => locations.id),
  invoiceId: text("invoice_id").notNull().references(() => invoices.id),
  appointmentId: text("appointment_id").notNull().references(() => appointments.id),
  kind: text("kind", { enum: ["payment", "refund"] }).notNull(),
  method: text("method", { enum: ["cash", "card_terminal", "e_transfer", "external"] }).notNull(),
  amountCents: integer("amount_cents").notNull(),
  taxAmountCents: integer("tax_amount_cents").notNull().default(0),
  tipAmountCents: integer("tip_amount_cents").notNull().default(0),
  status: text("status", { enum: ["pending", "succeeded", "failed"] }).notNull().default("succeeded"),
  externalReference: text("external_reference").notNull().default(""),
  idempotencyKey: text("idempotency_key").notNull(),
  note: text("note").notNull().default(""),
  parentPaymentId: text("parent_payment_id"),
  actorStaffId: text("actor_staff_id").references(() => staff.id),
  occurredAt: text("occurred_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
}, (table) => [
  index("payment_events_invoice_idx").on(table.invoiceId),
  index("payment_events_location_occurred_idx").on(table.locationId, table.occurredAt),
  uniqueIndex("payment_events_org_idempotency_unique").on(table.organizationId, table.idempotencyKey),
]);

export const invoiceMutationClaims = sqliteTable("invoice_mutation_claims", {
  id: text("id").primaryKey(),
  organizationId: text("organization_id").notNull().references(() => organizations.id),
  invoiceId: text("invoice_id").notNull().references(() => invoices.id),
  expectedMutationVersion: integer("expected_mutation_version").notNull(),
  mutationType: text("mutation_type", { enum: ["payment", "refund", "reconcile"] }).notNull(),
  idempotencyKey: text("idempotency_key").notNull(),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
}, (table) => [
  uniqueIndex("invoice_mutation_claims_invoice_version_unique").on(table.invoiceId, table.expectedMutationVersion),
  uniqueIndex("invoice_mutation_claims_org_idempotency_unique").on(table.organizationId, table.idempotencyKey),
  index("invoice_mutation_claims_invoice_idx").on(table.invoiceId, table.createdAt),
]);

export const expenses = sqliteTable("expenses", {
  id: text("id").primaryKey(),
  organizationId: text("organization_id").notNull().references(() => organizations.id),
  locationId: text("location_id").notNull().references(() => locations.id),
  vendor: text("vendor").notNull(),
  description: text("description").notNull(),
  category: text("category", { enum: ["grooming_supplies", "retail_inventory", "equipment", "rent", "utilities", "payroll", "marketing", "insurance", "professional_fees", "merchant_fees", "travel", "repairs", "education", "other"] }).notNull(),
  treatment: text("treatment", { enum: ["operating", "capital", "non_deductible"] }).notNull().default("operating"),
  paymentMethod: text("payment_method", { enum: ["cash", "credit_card", "debit_card", "bank_transfer", "e_transfer", "other"] }).notNull(),
  amountCents: integer("amount_cents").notNull(),
  taxAmountCents: integer("tax_amount_cents").notNull().default(0),
  gstAmountCents: integer("gst_amount_cents").notNull().default(0),
  qstAmountCents: integer("qst_amount_cents").notNull().default(0),
  recoverableTax: integer("recoverable_tax", { mode: "boolean" }).notNull().default(false),
  businessUseBps: integer("business_use_bps").notNull().default(10_000),
  currency: text("currency").notNull(),
  incurredOn: text("incurred_on").notNull(),
  paidOn: text("paid_on").notNull(),
  reference: text("reference").notNull().default(""),
  idempotencyKey: text("idempotency_key").notNull(),
  status: text("status", { enum: ["posted", "void"] }).notNull().default("posted"),
  voidReason: text("void_reason").notNull().default(""),
  enteredByStaffId: text("entered_by_staff_id").references(() => staff.id),
  voidedByStaffId: text("voided_by_staff_id").references(() => staff.id),
  voidedAt: text("voided_at"),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
}, (table) => [
  index("expenses_location_paid_idx").on(table.locationId, table.paidOn),
  index("expenses_org_category_idx").on(table.organizationId, table.category, table.paidOn),
  uniqueIndex("expenses_org_idempotency_unique").on(table.organizationId, table.idempotencyKey),
]);

export const expenseReceipts = sqliteTable("expense_receipts", {
  id: text("id").primaryKey(),
  organizationId: text("organization_id").notNull().references(() => organizations.id),
  locationId: text("location_id").notNull().references(() => locations.id),
  expenseId: text("expense_id").notNull().references(() => expenses.id),
  r2Key: text("r2_key").notNull().unique(),
  originalFilename: text("original_filename").notNull(),
  mimeType: text("mime_type").notNull(),
  sizeBytes: integer("size_bytes").notNull(),
  uploadedByStaffId: text("uploaded_by_staff_id").references(() => staff.id),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
}, (table) => [index("expense_receipts_expense_idx").on(table.expenseId, table.createdAt)]);

export const financialAccounts = sqliteTable("financial_accounts", {
  id: text("id").primaryKey(),
  organizationId: text("organization_id").notNull().references(() => organizations.id),
  locationId: text("location_id").references(() => locations.id),
  name: text("name").notNull(),
  provider: text("provider", { enum: ["desjardins", "square", "other"] }).notNull(),
  accountType: text("account_type", { enum: ["bank", "processor", "credit_card", "cash", "other"] }).notNull(),
  openingBalanceCents: integer("opening_balance_cents").notNull().default(0),
  currency: text("currency").notNull().default("CAD"),
  active: integer("active", { mode: "boolean" }).notNull().default(true),
  createdByStaffId: text("created_by_staff_id").references(() => staff.id),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
}, (table) => [
  uniqueIndex("financial_accounts_org_name_unique").on(table.organizationId, table.name),
  index("financial_accounts_org_location_idx").on(table.organizationId, table.locationId),
]);

export const financialAccountTransactions = sqliteTable("financial_account_transactions", {
  id: text("id").primaryKey(),
  organizationId: text("organization_id").notNull().references(() => organizations.id),
  locationId: text("location_id").references(() => locations.id),
  accountId: text("account_id").notNull().references(() => financialAccounts.id),
  transactionDate: text("transaction_date").notNull(),
  description: text("description").notNull(),
  amountCents: integer("amount_cents").notNull(),
  reference: text("reference").notNull().default(""),
  source: text("source", { enum: ["csv_import", "manual"] }).notNull().default("csv_import"),
  importHash: text("import_hash").notNull(),
  importedByStaffId: text("imported_by_staff_id").references(() => staff.id),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
}, (table) => [
  uniqueIndex("financial_transactions_account_hash_unique").on(table.accountId, table.importHash),
  index("financial_transactions_account_date_idx").on(table.accountId, table.transactionDate),
  index("financial_transactions_org_date_idx").on(table.organizationId, table.transactionDate),
]);

export const dailyCloseouts = sqliteTable("daily_closeouts", {
  id: text("id").primaryKey(),
  organizationId: text("organization_id").notNull().references(() => organizations.id),
  locationId: text("location_id").notNull().references(() => locations.id),
  businessDate: text("business_date").notNull(),
  status: text("status", { enum: ["closed", "reopened"] }).notNull().default("closed"),
  netCollectedCents: integer("net_collected_cents").notNull(),
  expectedCashCents: integer("expected_cash_cents").notNull(),
  countedCashCents: integer("counted_cash_cents").notNull(),
  cashVarianceCents: integer("cash_variance_cents").notNull(),
  salesTaxCents: integer("sales_tax_cents").notNull(),
  tipsCents: integer("tips_cents").notNull(),
  refundsCents: integer("refunds_cents").notNull(),
  transactionCount: integer("transaction_count").notNull(),
  note: text("note").notNull().default(""),
  closedByStaffId: text("closed_by_staff_id").notNull().references(() => staff.id),
  closedAt: text("closed_at").notNull(),
  reopenedByStaffId: text("reopened_by_staff_id").references(() => staff.id),
  reopenedAt: text("reopened_at"),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
}, (table) => [
  uniqueIndex("daily_closeouts_location_date_unique").on(table.locationId, table.businessDate),
  index("daily_closeouts_org_date_idx").on(table.organizationId, table.businessDate),
]);

export const suppliers = sqliteTable("suppliers", {
  id: text("id").primaryKey(),
  organizationId: text("organization_id").notNull().references(() => organizations.id),
  locationId: text("location_id").notNull().references(() => locations.id),
  name: text("name").notNull(),
  contactName: text("contact_name").notNull().default(""),
  email: text("email").notNull().default(""),
  phone: text("phone").notNull().default(""),
  website: text("website").notNull().default(""),
  accountNumber: text("account_number").notNull().default(""),
  paymentTermsDays: integer("payment_terms_days").notNull().default(0),
  notes: text("notes").notNull().default(""),
  idempotencyKey: text("idempotency_key").notNull(),
  active: integer("active", { mode: "boolean" }).notNull().default(true),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
}, (table) => [
  index("suppliers_location_name_idx").on(table.locationId, table.name),
  uniqueIndex("suppliers_org_idempotency_unique").on(table.organizationId, table.idempotencyKey),
]);

export const inventoryItems = sqliteTable("inventory_items", {
  id: text("id").primaryKey(),
  organizationId: text("organization_id").notNull().references(() => organizations.id),
  locationId: text("location_id").notNull().references(() => locations.id),
  preferredSupplierId: text("preferred_supplier_id").references(() => suppliers.id),
  name: text("name").notNull(),
  sku: text("sku"),
  barcode: text("barcode"),
  category: text("category", { enum: ["grooming_supply", "retail_product"] }).notNull(),
  unit: text("unit", { enum: ["each", "ml", "g", "oz", "lb", "pack", "case"] }).notNull().default("each"),
  reorderPointMilli: integer("reorder_point_milli").notNull().default(0),
  targetStockMilli: integer("target_stock_milli").notNull().default(0),
  preferredOrderMilli: integer("preferred_order_milli").notNull().default(0),
  lastPurchaseUnitCostCents: integer("last_purchase_unit_cost_cents").notNull().default(0),
  sellingPriceCents: integer("selling_price_cents").notNull().default(0),
  taxable: integer("taxable", { mode: "boolean" }).notNull().default(true),
  idempotencyKey: text("idempotency_key").notNull(),
  stockVersion: integer("stock_version").notNull().default(0),
  active: integer("active", { mode: "boolean" }).notNull().default(true),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
}, (table) => [
  index("inventory_items_location_name_idx").on(table.locationId, table.name),
  uniqueIndex("inventory_items_location_sku_unique").on(table.locationId, table.sku),
  uniqueIndex("inventory_items_location_barcode_unique").on(table.locationId, table.barcode),
  uniqueIndex("inventory_items_org_idempotency_unique").on(table.organizationId, table.idempotencyKey),
]);

export const purchaseOrders = sqliteTable("purchase_orders", {
  id: text("id").primaryKey(),
  organizationId: text("organization_id").notNull().references(() => organizations.id),
  locationId: text("location_id").notNull().references(() => locations.id),
  supplierId: text("supplier_id").notNull().references(() => suppliers.id),
  orderNumber: text("order_number").notNull(),
  status: text("status", { enum: ["draft", "ordered", "received", "cancelled"] }).notNull().default("draft"),
  orderedOn: text("ordered_on"),
  expectedOn: text("expected_on"),
  receivedAt: text("received_at"),
  shippingCents: integer("shipping_cents").notNull().default(0),
  taxCents: integer("tax_cents").notNull().default(0),
  currency: text("currency").notNull(),
  notes: text("notes").notNull().default(""),
  idempotencyKey: text("idempotency_key").notNull(),
  createdByStaffId: text("created_by_staff_id").references(() => staff.id),
  updatedByStaffId: text("updated_by_staff_id").references(() => staff.id),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
}, (table) => [
  uniqueIndex("purchase_orders_location_number_unique").on(table.locationId, table.orderNumber),
  uniqueIndex("purchase_orders_org_idempotency_unique").on(table.organizationId, table.idempotencyKey),
  index("purchase_orders_location_status_idx").on(table.locationId, table.status, table.createdAt),
]);

export const purchaseOrderLines = sqliteTable("purchase_order_lines", {
  id: text("id").primaryKey(),
  organizationId: text("organization_id").notNull().references(() => organizations.id),
  locationId: text("location_id").notNull().references(() => locations.id),
  purchaseOrderId: text("purchase_order_id").notNull().references(() => purchaseOrders.id),
  inventoryItemId: text("inventory_item_id").notNull().references(() => inventoryItems.id),
  quantityMilli: integer("quantity_milli").notNull(),
  unitCostCents: integer("unit_cost_cents").notNull(),
  lotNumber: text("lot_number").notNull().default(""),
  expiresOn: text("expires_on"),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
}, (table) => [
  uniqueIndex("purchase_order_lines_order_item_unique").on(table.purchaseOrderId, table.inventoryItemId),
  index("purchase_order_lines_item_idx").on(table.inventoryItemId),
]);

export const purchaseOrderClaims = sqliteTable("purchase_order_claims", {
  id: text("id").primaryKey(),
  organizationId: text("organization_id").notNull().references(() => organizations.id),
  locationId: text("location_id").notNull().references(() => locations.id),
  purchaseOrderId: text("purchase_order_id").notNull().references(() => purchaseOrders.id),
  expectedUpdatedAt: text("expected_updated_at").notNull(),
  action: text("action", { enum: ["place_order", "cancel", "receive"] }).notNull(),
  actorStaffId: text("actor_staff_id").references(() => staff.id),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
}, (table) => [
  uniqueIndex("purchase_order_claims_order_version_unique").on(table.purchaseOrderId, table.expectedUpdatedAt),
  index("purchase_order_claims_org_order_idx").on(table.organizationId, table.purchaseOrderId),
]);

export const inventoryMovements = sqliteTable("inventory_movements", {
  id: text("id").primaryKey(),
  organizationId: text("organization_id").notNull().references(() => organizations.id),
  locationId: text("location_id").notNull().references(() => locations.id),
  inventoryItemId: text("inventory_item_id").notNull().references(() => inventoryItems.id),
  supplierId: text("supplier_id").references(() => suppliers.id),
  purchaseOrderId: text("purchase_order_id").references(() => purchaseOrders.id),
  kind: text("kind", { enum: ["opening", "purchase", "usage", "retail_sale", "waste", "adjustment", "return_to_supplier"] }).notNull(),
  quantityDeltaMilli: integer("quantity_delta_milli").notNull(),
  unitCostCents: integer("unit_cost_cents").notNull(),
  totalCostCents: integer("total_cost_cents").notNull(),
  lotNumber: text("lot_number").notNull().default(""),
  expiresOn: text("expires_on"),
  note: text("note").notNull().default(""),
  occurredAt: text("occurred_at").notNull(),
  idempotencyKey: text("idempotency_key").notNull(),
  enteredByStaffId: text("entered_by_staff_id").references(() => staff.id),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
}, (table) => [
  index("inventory_movements_item_time_idx").on(table.inventoryItemId, table.occurredAt),
  index("inventory_movements_location_time_idx").on(table.locationId, table.occurredAt),
  uniqueIndex("inventory_movements_org_idempotency_unique").on(table.organizationId, table.idempotencyKey),
]);

export const inventoryMovementClaims = sqliteTable("inventory_movement_claims", {
  id: text("id").primaryKey(),
  organizationId: text("organization_id").notNull().references(() => organizations.id),
  locationId: text("location_id").notNull().references(() => locations.id),
  inventoryItemId: text("inventory_item_id").notNull().references(() => inventoryItems.id),
  expectedStockVersion: integer("expected_stock_version").notNull(),
  movementGroupId: text("movement_group_id").notNull(),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
}, (table) => [
  uniqueIndex("inventory_movement_claims_item_version_unique").on(table.inventoryItemId, table.expectedStockVersion),
  index("inventory_movement_claims_org_group_idx").on(table.organizationId, table.movementGroupId),
]);

export const paymentProviderAccounts = sqliteTable("payment_provider_accounts", {
  id: text("id").primaryKey(),
  organizationId: text("organization_id").notNull().references(() => organizations.id),
  provider: text("provider", { enum: ["stripe"] }).notNull().default("stripe"),
  connectedAccountId: text("connected_account_id").notNull().unique(),
  country: text("country").notNull(),
  defaultCurrency: text("default_currency").notNull(),
  detailsSubmitted: integer("details_submitted", { mode: "boolean" }).notNull().default(false),
  chargesEnabled: integer("charges_enabled", { mode: "boolean" }).notNull().default(false),
  payoutsEnabled: integer("payouts_enabled", { mode: "boolean" }).notNull().default(false),
  onboardingStatus: text("onboarding_status", { enum: ["pending", "active", "restricted"] }).notNull().default("pending"),
  lastSyncedAt: text("last_synced_at"),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
}, (table) => [uniqueIndex("payment_provider_accounts_org_unique").on(table.organizationId)]);

export const onlinePaymentSessions = sqliteTable("online_payment_sessions", {
  id: text("id").primaryKey(),
  organizationId: text("organization_id").notNull().references(() => organizations.id),
  locationId: text("location_id").notNull().references(() => locations.id),
  clientId: text("client_id").notNull().references(() => clients.id),
  appointmentId: text("appointment_id").notNull().references(() => appointments.id),
  invoiceId: text("invoice_id").references(() => invoices.id),
  purpose: text("purpose", { enum: ["deposit", "invoice"] }).notNull(),
  providerSessionId: text("provider_session_id").notNull().unique(),
  providerPaymentIntentId: text("provider_payment_intent_id").notNull().default(""),
  amountCents: integer("amount_cents").notNull(),
  applicationFeeCents: integer("application_fee_cents").notNull().default(0),
  currency: text("currency").notNull(),
  status: text("status", { enum: ["open", "paid", "expired", "cancelled", "failed", "refunded"] }).notNull().default("open"),
  checkoutUrl: text("checkout_url").notNull(),
  idempotencyKey: text("idempotency_key").notNull(),
  expiresAt: text("expires_at").notNull(),
  completedAt: text("completed_at"),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
}, (table) => [
  uniqueIndex("online_payment_sessions_org_idempotency_unique").on(table.organizationId, table.idempotencyKey),
  uniqueIndex("online_payment_sessions_one_open_invoice_unique").on(table.invoiceId).where(sql`${table.status} = 'open'`),
  index("online_payment_sessions_appointment_idx").on(table.appointmentId, table.createdAt),
  index("online_payment_sessions_invoice_idx").on(table.invoiceId, table.createdAt),
]);

export const providerWebhookEvents = sqliteTable("provider_webhook_events", {
  id: text("id").primaryKey(),
  provider: text("provider", { enum: ["stripe", "square"] }).notNull().default("stripe"),
  eventType: text("event_type").notNull(),
  livemode: integer("livemode", { mode: "boolean" }).notNull().default(false),
  payloadHash: text("payload_hash").notNull(),
  status: text("status", { enum: ["received", "processed", "failed", "ignored"] }).notNull().default("received"),
  error: text("error").notNull().default(""),
  processedAt: text("processed_at"),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
}, (table) => [index("provider_webhook_events_status_idx").on(table.status, table.createdAt)]);

export const organizationSubscriptions = sqliteTable("organization_subscriptions", {
  id: text("id").primaryKey(),
  organizationId: text("organization_id").notNull().references(() => organizations.id),
  providerCustomerId: text("provider_customer_id").notNull().default(""),
  providerSubscriptionId: text("provider_subscription_id").notNull().default(""),
  providerPriceId: text("provider_price_id").notNull().default(""),
  plan: text("plan", { enum: ["starter", "growth", "multi"] }).notNull().default("starter"),
  status: text("status", { enum: ["trialing", "active", "past_due", "cancelled", "incomplete", "unpaid"] }).notNull().default("trialing"),
  trialEndsAt: text("trial_ends_at"),
  currentPeriodEnd: text("current_period_end"),
  cancelAtPeriodEnd: integer("cancel_at_period_end", { mode: "boolean" }).notNull().default(false),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
}, (table) => [uniqueIndex("organization_subscriptions_org_unique").on(table.organizationId)]);

export const communicationTemplates = sqliteTable("communication_templates", {
  id: text("id").primaryKey(),
  organizationId: text("organization_id").notNull().references(() => organizations.id),
  locationId: text("location_id").notNull().references(() => locations.id),
  key: text("key").notNull(),
  name: text("name").notNull(),
  channel: text("channel", { enum: ["email", "sms"] }).notNull(),
  category: text("category", { enum: ["transactional", "marketing"] }).notNull().default("transactional"),
  subject: text("subject").notNull().default(""),
  body: text("body").notNull(),
  active: integer("active", { mode: "boolean" }).notNull().default(true),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
}, (table) => [
  uniqueIndex("communication_templates_location_key_unique").on(table.locationId, table.key),
  index("communication_templates_location_idx").on(table.locationId),
]);

export const messages = sqliteTable("messages", {
  id: text("id").primaryKey(),
  organizationId: text("organization_id").notNull().references(() => organizations.id),
  locationId: text("location_id").notNull().references(() => locations.id),
  clientId: text("client_id").notNull().references(() => clients.id),
  appointmentId: text("appointment_id").references(() => appointments.id),
  templateId: text("template_id").references(() => communicationTemplates.id),
  dedupeKey: text("dedupe_key").notNull(),
  direction: text("direction", { enum: ["outbound", "inbound"] }).notNull().default("outbound"),
  channel: text("channel", { enum: ["email", "sms"] }).notNull(),
  category: text("category", { enum: ["transactional", "marketing"] }).notNull().default("transactional"),
  status: text("status", { enum: ["action_required", "scheduled", "processing", "sent", "delivered", "failed", "cancelled"] }).notNull().default("action_required"),
  recipientName: text("recipient_name").notNull(),
  recipientAddress: text("recipient_address").notNull(),
  subject: text("subject").notNull().default(""),
  body: text("body").notNull(),
  provider: text("provider").notNull().default("unconnected"),
  providerMessageId: text("provider_message_id").notNull().default(""),
  deliveryAttempts: integer("delivery_attempts").notNull().default(0),
  processingStartedAt: text("processing_started_at"),
  lastError: text("last_error").notNull().default(""),
  scheduledFor: text("scheduled_for").notNull().default(sql`CURRENT_TIMESTAMP`),
  sentAt: text("sent_at"),
  deliveredAt: text("delivered_at"),
  createdByStaffId: text("created_by_staff_id").references(() => staff.id),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
}, (table) => [
  uniqueIndex("messages_org_dedupe_unique").on(table.organizationId, table.dedupeKey),
  index("messages_location_scheduled_idx").on(table.locationId, table.scheduledFor),
  index("messages_client_created_idx").on(table.clientId, table.createdAt),
]);

export const messageEvents = sqliteTable("message_events", {
  id: text("id").primaryKey(),
  organizationId: text("organization_id").notNull().references(() => organizations.id),
  locationId: text("location_id").notNull().references(() => locations.id),
  messageId: text("message_id").notNull().references(() => messages.id),
  type: text("type").notNull(),
  actorType: text("actor_type", { enum: ["staff", "client", "system", "provider"] }).notNull(),
  actorId: text("actor_id"),
  detailsJson: text("details_json").notNull().default("{}"),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
}, (table) => [
  index("message_events_message_idx").on(table.messageId, table.createdAt),
  index("message_events_location_idx").on(table.locationId, table.createdAt),
]);

export const deliveryProviderEvents = sqliteTable("delivery_provider_events", {
  id: text("id").primaryKey(),
  provider: text("provider", { enum: ["resend", "twilio"] }).notNull(),
  providerEventId: text("provider_event_id").notNull(),
  providerMessageId: text("provider_message_id").notNull(),
  eventType: text("event_type").notNull(),
  messageId: text("message_id").references(() => messages.id),
  status: text("status", { enum: ["processing", "processed", "ignored", "failed"] }).notNull().default("processing"),
  error: text("error").notNull().default(""),
  receivedAt: text("received_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  processedAt: text("processed_at"),
}, (table) => [
  uniqueIndex("delivery_provider_events_provider_event_unique").on(table.provider, table.providerEventId),
  index("delivery_provider_events_message_idx").on(table.messageId, table.receivedAt),
  index("delivery_provider_events_status_idx").on(table.status, table.receivedAt),
]);

export const petWarnings = sqliteTable("pet_warnings", {
  id: text("id").primaryKey(),
  organizationId: text("organization_id").notNull().references(() => organizations.id),
  petId: text("pet_id").notNull().references(() => pets.id),
  category: text("category", { enum: ["allergy", "medical", "behavior", "mobility", "bite_risk", "dryer_restriction", "kennel_restriction", "emergency", "other"] }).notNull(),
  severity: text("severity", { enum: ["attention", "high", "critical"] }).notNull(),
  title: text("title").notNull(),
  details: text("details").notNull(),
  active: integer("active", { mode: "boolean" }).notNull().default(true),
  expiresAt: text("expires_at"),
  authorStaffId: text("author_staff_id").references(() => staff.id),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
}, (table) => [
  index("pet_warnings_pet_active_idx").on(table.petId, table.active),
  index("pet_warnings_org_idx").on(table.organizationId),
]);

export const appointmentCareRecords = sqliteTable("appointment_care_records", {
  id: text("id").primaryKey(),
  organizationId: text("organization_id").notNull().references(() => organizations.id),
  locationId: text("location_id").notNull().references(() => locations.id),
  appointmentId: text("appointment_id").notNull().references(() => appointments.id),
  coatCondition: text("coat_condition", { enum: ["not_assessed", "healthy", "tangled", "matted", "severely_matted", "skin_concern"] }).notNull().default("not_assessed"),
  styleNotes: text("style_notes").notNull().default(""),
  productsUsed: text("products_used").notNull().default(""),
  internalNotes: text("internal_notes").notNull().default(""),
  clientReport: text("client_report").notNull().default(""),
  reportPublished: integer("report_published", { mode: "boolean" }).notNull().default(false),
  completedByStaffId: text("completed_by_staff_id").references(() => staff.id),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
}, (table) => [
  uniqueIndex("appointment_care_record_unique").on(table.appointmentId),
  index("appointment_care_records_org_idx").on(table.organizationId),
]);

export const mediaAssets = sqliteTable("media_assets", {
  id: text("id").primaryKey(),
  organizationId: text("organization_id").notNull().references(() => organizations.id),
  locationId: text("location_id").notNull().references(() => locations.id),
  appointmentId: text("appointment_id").notNull().references(() => appointments.id),
  petId: text("pet_id").notNull().references(() => pets.id),
  kind: text("kind", { enum: ["before", "after", "coat_issue", "incident"] }).notNull(),
  r2Key: text("r2_key").notNull().unique(),
  originalFilename: text("original_filename").notNull(),
  mimeType: text("mime_type").notNull(),
  sizeBytes: integer("size_bytes").notNull(),
  caption: text("caption").notNull().default(""),
  uploadedByStaffId: text("uploaded_by_staff_id").references(() => staff.id),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
}, (table) => [
  index("media_assets_appointment_idx").on(table.appointmentId, table.createdAt),
  index("media_assets_pet_idx").on(table.petId, table.createdAt),
]);

export const approvalRequests = sqliteTable("approval_requests", {
  id: text("id").primaryKey(),
  organizationId: text("organization_id").notNull().references(() => organizations.id),
  locationId: text("location_id").notNull().references(() => locations.id),
  appointmentId: text("appointment_id").notNull().references(() => appointments.id),
  clientId: text("client_id").notNull().references(() => clients.id),
  token: text("token").notNull().unique(),
  title: text("title").notNull(),
  explanation: text("explanation").notNull(),
  amountCents: integer("amount_cents").notNull(),
  currency: text("currency").notNull(),
  status: text("status", { enum: ["pending", "approved", "declined", "expired", "cancelled"] }).notNull().default("pending"),
  expiresAt: text("expires_at").notNull(),
  requestedByStaffId: text("requested_by_staff_id").references(() => staff.id),
  requestedAt: text("requested_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  respondedAt: text("responded_at"),
  responseName: text("response_name").notNull().default(""),
}, (table) => [
  index("approval_requests_appointment_idx").on(table.appointmentId, table.requestedAt),
  index("approval_requests_org_status_idx").on(table.organizationId, table.status),
]);

export const consentRecords = sqliteTable("consent_records", {
  id: text("id").primaryKey(),
  organizationId: text("organization_id").notNull().references(() => organizations.id),
  clientId: text("client_id").notNull().references(() => clients.id),
  appointmentId: text("appointment_id").references(() => appointments.id),
  type: text("type").notNull(),
  policyVersion: text("policy_version").notNull(),
  accepted: integer("accepted", { mode: "boolean" }).notNull(),
  source: text("source").notNull(),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
}, (table) => [index("consent_client_idx").on(table.clientId)]);

export const compensationProfiles = sqliteTable("compensation_profiles", {
  id: text("id").primaryKey(),
  organizationId: text("organization_id").notNull().references(() => organizations.id),
  locationId: text("location_id").notNull().references(() => locations.id),
  staffId: text("staff_id").notNull().references(() => staff.id),
  workerClass: text("worker_class", { enum: ["employee", "contractor"] }).notNull().default("employee"),
  payType: text("pay_type", { enum: ["hourly", "salary"] }).notNull().default("hourly"),
  hourlyRateCents: integer("hourly_rate_cents").notNull().default(0),
  annualSalaryCents: integer("annual_salary_cents").notNull().default(0),
  overtimeEligible: integer("overtime_eligible", { mode: "boolean" }).notNull().default(true),
  weeklyOvertimeMinutes: integer("weekly_overtime_minutes").notNull().default(2400),
  overtimeMultiplierBps: integer("overtime_multiplier_bps").notNull().default(15000),
  serviceCommissionBps: integer("service_commission_bps").notNull().default(0),
  retailCommissionBps: integer("retail_commission_bps").notNull().default(0),
  currency: text("currency").notNull().default("CAD"),
  effectiveFrom: text("effective_from").notNull(),
  createdByStaffId: text("created_by_staff_id").notNull().references(() => staff.id),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
}, (table) => [
  uniqueIndex("compensation_staff_effective_unique").on(table.locationId, table.staffId, table.effectiveFrom),
  index("compensation_location_staff_idx").on(table.locationId, table.staffId, table.effectiveFrom),
]);

export const timeEntries = sqliteTable("time_entries", {
  id: text("id").primaryKey(), organizationId: text("organization_id").notNull().references(() => organizations.id),
  locationId: text("location_id").notNull().references(() => locations.id), staffId: text("staff_id").notNull().references(() => staff.id),
  clockIn: text("clock_in").notNull(), clockOut: text("clock_out"), breakMinutes: integer("break_minutes").notNull().default(0),
  status: text("status", { enum: ["open", "submitted", "approved", "rejected", "void"] }).notNull().default("open"),
  source: text("source", { enum: ["clock", "manual"] }).notNull().default("clock"), note: text("note").notNull().default(""),
  idempotencyKey: text("idempotency_key").notNull(), enteredByStaffId: text("entered_by_staff_id").notNull().references(() => staff.id),
  approvedByStaffId: text("approved_by_staff_id").references(() => staff.id), approvedAt: text("approved_at"),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`), updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
}, (table) => [uniqueIndex("time_entries_org_idempotency_unique").on(table.organizationId, table.idempotencyKey), index("time_entries_location_clock_idx").on(table.locationId, table.clockIn)]);

export const timeEntryAdjustments = sqliteTable("time_entry_adjustments", {
  id: text("id").primaryKey(), organizationId: text("organization_id").notNull().references(() => organizations.id),
  locationId: text("location_id").notNull().references(() => locations.id), timeEntryId: text("time_entry_id").notNull().references(() => timeEntries.id),
  clockIn: text("clock_in").notNull(), clockOut: text("clock_out").notNull(), breakMinutes: integer("break_minutes").notNull().default(0),
  reason: text("reason").notNull(), adjustedByStaffId: text("adjusted_by_staff_id").notNull().references(() => staff.id),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
}, (table) => [index("time_adjustments_entry_idx").on(table.timeEntryId, table.createdAt)]);

export const staffClockStates = sqliteTable("staff_clock_states", {
  id: text("id").primaryKey(), organizationId: text("organization_id").notNull().references(() => organizations.id),
  locationId: text("location_id").notNull().references(() => locations.id), staffId: text("staff_id").notNull().references(() => staff.id),
  status: text("status", { enum: ["clocked_out", "clocked_in"] }).notNull().default("clocked_out"), openEntryId: text("open_entry_id").references(() => timeEntries.id),
  version: integer("version").notNull().default(0), updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
}, (table) => [uniqueIndex("staff_clock_state_unique").on(table.locationId, table.staffId)]);

export const timeClockClaims = sqliteTable("time_clock_claims", {
  id: text("id").primaryKey(), organizationId: text("organization_id").notNull().references(() => organizations.id),
  locationId: text("location_id").notNull().references(() => locations.id), staffId: text("staff_id").notNull().references(() => staff.id),
  expectedVersion: integer("expected_version").notNull(), action: text("action", { enum: ["clock_in", "clock_out"] }).notNull(),
  timeEntryId: text("time_entry_id").notNull().references(() => timeEntries.id), createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
}, (table) => [uniqueIndex("time_clock_claim_staff_version_unique").on(table.locationId, table.staffId, table.expectedVersion)]);

export const employeePortalCredentials = sqliteTable("employee_portal_credentials", {
  id: text("id").primaryKey(), organizationId: text("organization_id").notNull().references(() => organizations.id),
  staffId: text("staff_id").notNull().references(() => staff.id), employeeCode: text("employee_code").notNull(),
  pinSalt: text("pin_salt").notNull(), pinHash: text("pin_hash").notNull(), failedAttempts: integer("failed_attempts").notNull().default(0),
  lockedUntil: text("locked_until"), active: integer("active", { mode: "boolean" }).notNull().default(true),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`), updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
}, (table) => [uniqueIndex("employee_portal_staff_unique").on(table.staffId), uniqueIndex("employee_portal_code_unique").on(table.employeeCode)]);

export const employeePortalInvitations = sqliteTable("employee_portal_invitations", {
  id: text("id").primaryKey(), organizationId: text("organization_id").notNull().references(() => organizations.id),
  staffId: text("staff_id").notNull().references(() => staff.id), tokenHash: text("token_hash").notNull(),
  expiresAt: text("expires_at").notNull(), usedAt: text("used_at"), revokedAt: text("revoked_at"),
  invitedByStaffId: text("invited_by_staff_id").notNull().references(() => staff.id), createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
}, (table) => [uniqueIndex("employee_portal_invite_token_unique").on(table.tokenHash), index("employee_portal_invite_staff_idx").on(table.staffId, table.createdAt)]);

export const employeePortalSessions = sqliteTable("employee_portal_sessions", {
  id: text("id").primaryKey(), organizationId: text("organization_id").notNull().references(() => organizations.id),
  staffId: text("staff_id").notNull().references(() => staff.id), tokenHash: text("token_hash").notNull(),
  expiresAt: text("expires_at").notNull(), lastUsedAt: text("last_used_at"), revokedAt: text("revoked_at"),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
}, (table) => [uniqueIndex("employee_portal_session_token_unique").on(table.tokenHash), index("employee_portal_session_staff_idx").on(table.staffId, table.expiresAt)]);

export const timesheetWeeks = sqliteTable("timesheet_weeks", {
  id: text("id").primaryKey(), organizationId: text("organization_id").notNull().references(() => organizations.id),
  staffId: text("staff_id").notNull().references(() => staff.id), weekStartsOn: text("week_starts_on").notNull(),
  status: text("status", { enum: ["draft", "submitted", "approved"] }).notNull().default("draft"), submittedAt: text("submitted_at"),
  revision: integer("revision").notNull().default(0), updatedByStaffId: text("updated_by_staff_id").references(() => staff.id),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`), updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
}, (table) => [uniqueIndex("timesheet_week_staff_start_unique").on(table.staffId, table.weekStartsOn), index("timesheet_week_org_start_idx").on(table.organizationId, table.weekStartsOn)]);

export const timesheetShifts = sqliteTable("timesheet_shifts", {
  id: text("id").primaryKey(), organizationId: text("organization_id").notNull().references(() => organizations.id),
  weekId: text("week_id").notNull().references(() => timesheetWeeks.id), staffId: text("staff_id").notNull().references(() => staff.id),
  workDate: text("work_date").notNull(), locationId: text("location_id").references(() => locations.id), locationName: text("location_name").notNull(), startTime: text("start_time").notNull(),
  endTime: text("end_time").notNull(), tipsCents: integer("tips_cents").notNull().default(0),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`), updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
}, (table) => [index("timesheet_shift_week_date_idx").on(table.weekId, table.workDate), index("timesheet_shift_org_staff_idx").on(table.organizationId, table.staffId), index("timesheet_shift_location_date_idx").on(table.locationId, table.workDate)]);

export const payrollPeriods = sqliteTable("payroll_periods", {
  id: text("id").primaryKey(), organizationId: text("organization_id").notNull().references(() => organizations.id), locationId: text("location_id").notNull().references(() => locations.id),
  startsOn: text("starts_on").notNull(), endsOn: text("ends_on").notNull(), payDate: text("pay_date").notNull(),
  status: text("status", { enum: ["draft", "approved", "exported", "reopened"] }).notNull().default("draft"), currency: text("currency").notNull(),
  idempotencyKey: text("idempotency_key").notNull(), inputSnapshotJson: text("input_snapshot_json").notNull().default("{}"), inputSnapshotHash: text("input_snapshot_hash").notNull().default(""), approvedByStaffId: text("approved_by_staff_id").references(() => staff.id), approvedAt: text("approved_at"), exportedAt: text("exported_at"),
  createdByStaffId: text("created_by_staff_id").notNull().references(() => staff.id), createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`), updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
}, (table) => [uniqueIndex("payroll_period_location_dates_unique").on(table.locationId, table.startsOn, table.endsOn), uniqueIndex("payroll_period_org_idempotency_unique").on(table.organizationId, table.idempotencyKey)]);

export const payrollLines = sqliteTable("payroll_lines", {
  id: text("id").primaryKey(), organizationId: text("organization_id").notNull().references(() => organizations.id), locationId: text("location_id").notNull().references(() => locations.id),
  payrollPeriodId: text("payroll_period_id").notNull().references(() => payrollPeriods.id), staffId: text("staff_id").notNull().references(() => staff.id), staffName: text("staff_name").notNull(),
  regularMinutes: integer("regular_minutes").notNull().default(0), overtimeMinutes: integer("overtime_minutes").notNull().default(0), regularPayCents: integer("regular_pay_cents").notNull().default(0), overtimePayCents: integer("overtime_pay_cents").notNull().default(0),
  serviceCommissionCents: integer("service_commission_cents").notNull().default(0), retailCommissionCents: integer("retail_commission_cents").notNull().default(0), tipsCents: integer("tips_cents").notNull().default(0),
  otherEarningsCents: integer("other_earnings_cents").notNull().default(0), deductionsCents: integer("deductions_cents").notNull().default(0), reimbursementsCents: integer("reimbursements_cents").notNull().default(0), grossPayCents: integer("gross_pay_cents").notNull().default(0), payoutCents: integer("payout_cents").notNull().default(0),
  compensationSnapshotJson: text("compensation_snapshot_json").notNull().default("{}"), createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
}, (table) => [uniqueIndex("payroll_line_period_staff_unique").on(table.payrollPeriodId, table.staffId)]);

export const auditEvents = sqliteTable("audit_events", {
  id: text("id").primaryKey(),
  organizationId: text("organization_id").notNull().references(() => organizations.id),
  actorType: text("actor_type", { enum: ["client", "staff", "system"] }).notNull(),
  actorId: text("actor_id"),
  action: text("action").notNull(),
  entityType: text("entity_type").notNull(),
  entityId: text("entity_id").notNull(),
  detailsJson: text("details_json").notNull().default("{}"),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
}, (table) => [index("audit_org_created_idx").on(table.organizationId, table.createdAt)]);

export const salonAuthChallenges = sqliteTable("salon_auth_challenges", {
  id: text("id").primaryKey(),
  email: text("email").notNull(),
  tokenHash: text("token_hash").notNull().unique(),
  sourceHash: text("source_hash").notNull(),
  expiresAt: text("expires_at").notNull(),
  usedAt: text("used_at"),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
}, (table) => [
  index("salon_auth_challenges_email_time_idx").on(table.email, table.createdAt),
  index("salon_auth_challenges_source_time_idx").on(table.sourceHash, table.createdAt),
]);

export const salonAuthSessions = sqliteTable("salon_auth_sessions", {
  id: text("id").primaryKey(),
  email: text("email").notNull(),
  tokenHash: text("token_hash").notNull().unique(),
  expiresAt: text("expires_at").notNull(),
  lastUsedAt: text("last_used_at"),
  revokedAt: text("revoked_at"),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
}, (table) => [
  index("salon_auth_sessions_email_idx").on(table.email, table.expiresAt),
]);
