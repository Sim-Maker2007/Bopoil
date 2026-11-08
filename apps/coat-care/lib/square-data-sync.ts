import { and, eq, getTableColumns, inArray, lt, or, sql, type SQL } from "drizzle-orm";
import type { PgColumn, PgTable } from "drizzle-orm/pg-core";
import { getDb } from "../db";
import { resolveStorefront } from "../db/public-storefront";
import {
  clients,
  integrationSyncStates,
  squareBookings,
  squareCustomers,
  squareOrders,
  squarePayments,
  squareRefunds,
  squareTeamMembers,
  staff,
} from "../db/schema";
import { normalizeClientPhone } from "./client-phone-auth";
import { squareConfig, squareRequest, SquareRequestError } from "./square";
import { linkedLocalIds, linkEntities, type Db } from "./square-links";
import { cents, isSquareResource, parseCheckpoint, passPlan, paymentShare, SQUARE_RESOURCES, SQUARE_WEBHOOK_EVENT_TYPES, squareCustomerName, type Checkpoint, type SquareResource } from "./square-plan";

export { cents, isSquareResource, parseCheckpoint, passPlan, paymentShare, SQUARE_RESOURCES, SQUARE_WEBHOOK_EVENT_TYPES, squareCustomerName, type SquareResource };
export type { Checkpoint };
type Money = { amount?: number; currency?: string };


// Pulls everything Square holds about the salon into the mirror tables:
// the customer directory, payments, refunds, orders, team members and the
// details of each booking. Square stays the source of truth; Coat & Care reads
// the mirror. Each resource keeps its own sync state with a checkpoint, so an
// hourly run limited by the function budget simply continues where it stopped,
// and a webhook applies one object at a time through the same upsert code.

type SquareAddress = Record<string, string | undefined>;

export type SquareCustomer = {
  id?: string;
  created_at?: string;
  updated_at?: string;
  given_name?: string;
  family_name?: string;
  nickname?: string;
  company_name?: string;
  email_address?: string;
  phone_number?: string;
  address?: SquareAddress;
  birthday?: string;
  reference_id?: string;
  note?: string;
  preferences?: { email_unsubscribed?: boolean };
  creation_source?: string;
  group_ids?: string[];
  segment_ids?: string[];
  version?: number;
};

export type SquarePayment = {
  id?: string;
  created_at?: string;
  updated_at?: string;
  amount_money?: Money;
  tip_money?: Money;
  total_money?: Money;
  approved_money?: Money;
  refunded_money?: Money;
  processing_fee?: Array<{ amount_money?: Money; type?: string }>;
  status?: string;
  source_type?: string;
  card_details?: { card?: { card_brand?: string; last_4?: string }; entry_method?: string };
  wallet_details?: { brand?: string };
  external_details?: { type?: string; source?: string };
  location_id?: string;
  order_id?: string;
  customer_id?: string;
  team_member_id?: string;
  employee_id?: string;
  receipt_number?: string;
  receipt_url?: string;
  note?: string;
  application_details?: { square_product?: string };
  device_details?: { device_name?: string };
};

export type SquareRefund = {
  id?: string;
  status?: string;
  location_id?: string;
  amount_money?: Money;
  processing_fee?: Array<{ amount_money?: Money }>;
  payment_id?: string;
  order_id?: string;
  reason?: string;
  created_at?: string;
  updated_at?: string;
};

export type SquareOrder = {
  id?: string;
  location_id?: string;
  reference_id?: string;
  source?: { name?: string };
  customer_id?: string;
  line_items?: Array<{
    uid?: string;
    name?: string;
    quantity?: string;
    catalog_object_id?: string;
    variation_name?: string;
    note?: string;
    item_type?: string;
    base_price_money?: Money;
    total_money?: Money;
    total_tax_money?: Money;
    total_discount_money?: Money;
  }>;
  total_money?: Money;
  total_tax_money?: Money;
  total_discount_money?: Money;
  total_tip_money?: Money;
  total_service_charge_money?: Money;
  net_amount_due_money?: Money;
  return_amounts?: { total_money?: Money };
  tenders?: Array<{ id?: string; type?: string; amount_money?: Money; payment_id?: string; card_details?: { card?: { card_brand?: string; last_4?: string } } }>;
  fulfillments?: Array<{ uid?: string; type?: string; state?: string }>;
  state?: string;
  version?: number;
  created_at?: string;
  updated_at?: string;
  closed_at?: string;
};

export type SquareTeamMember = {
  id?: string;
  reference_id?: string;
  is_owner?: boolean;
  status?: string;
  given_name?: string;
  family_name?: string;
  email_address?: string;
  phone_number?: string;
  created_at?: string;
  updated_at?: string;
  assigned_locations?: { assignment_type?: string; location_ids?: string[] };
};

export type SquareBookingDetails = {
  id?: string;
  version?: number;
  status?: string;
  created_at?: string;
  updated_at?: string;
  start_at?: string;
  location_id?: string;
  customer_id?: string;
  customer_note?: string;
  seller_note?: string;
  appointment_segments?: Array<{ duration_minutes?: number; intermission_minutes?: number; service_variation_id?: string; service_variation_version?: number; team_member_id?: string; any_team_member?: boolean }>;
  transition_time_minutes?: number;
  all_day?: boolean;
  location_type?: string;
  creator_details?: { creator_type?: string; team_member_id?: string; customer_id?: string };
  source?: string;
};

export type SyncScope = { organizationId: string; locationId: string; externalLocationIds: string[]; currency: string };
export type SyncOptions = { now?: Date; force?: boolean; full?: boolean; deadline?: number; fetcher?: typeof fetch; pageBudget?: number };
export type SyncResult = { resource: SquareResource | "bookings"; skipped?: boolean; count: number; complete: boolean; error?: string; mode?: string };

const PAGE_LIMIT = 100;
const RUN_SPACING_MS = 55 * 60 * 1000;

function clean(value: unknown, max = 200) {
  return String(value ?? "").trim().slice(0, max);
}

function phoneDigits(value: string) {
  return value.replace(/\D/g, "").slice(-10);
}

function now(options: SyncOptions) {
  return options.now || new Date();
}

function pastDeadline(options: SyncOptions) {
  return options.deadline !== undefined && Date.now() > options.deadline;
}

function describeError(error: unknown) {
  if (error instanceof SquareRequestError) {
    const hint = error.status === 401 ? " Check SQUARE_ACCESS_TOKEN." : error.status === 403 ? " The access token lacks the permission for this data." : "";
    return `${error.message}${hint}`.slice(0, 500);
  }
  return (error instanceof Error ? error.message : "Square synchronization failed").slice(0, 500);
}

// One multi-row upsert per page. Every column except the key and the owner is
// refreshed from the incoming row (Postgres' "excluded" row), so a webhook or a
// later pass replaces stale values without a read first.
type InsertRow<T extends PgTable> = T["$inferInsert"];
async function upsertRows<T extends PgTable>(db: Db, table: T, rows: Array<InsertRow<T>>, keep: string[] = ["id", "organizationId"]) {
  if (!rows.length) return;
  const columns = getTableColumns(table) as Record<string, { name: string }>;
  const keys = Object.keys(rows[0] as object).filter((key) => !keep.includes(key));
  const set = Object.fromEntries(keys.map((key) => [key, sql.raw(`excluded."${columns[key].name}"`)])) as Record<string, SQL>;
  const idColumn = (table as unknown as Record<string, PgColumn>).id;
  const unique = [...new Map(rows.map((row) => [(row as { id: string }).id, row])).values()];
  for (let index = 0; index < unique.length; index += PAGE_LIMIT) {
    await db.insert(table).values(unique.slice(index, index + PAGE_LIMIT) as never).onConflictDoUpdate({ target: idColumn, set: set as never });
  }
}

// ---------------------------------------------------------------------------
// Sync state and checkpoints
// ---------------------------------------------------------------------------

type SyncStateRow = typeof integrationSyncStates.$inferSelect;

export async function loadSyncState(db: Db, locationId: string, resource: SquareResource | "bookings") {
  const [state] = await db.select().from(integrationSyncStates).where(and(
    eq(integrationSyncStates.provider, "square"),
    eq(integrationSyncStates.locationId, locationId),
    eq(integrationSyncStates.resource, resource),
  )).limit(1);
  return state as SyncStateRow | undefined;
}

// Decides whether a resource runs, marks it running, hands the pass its
// checkpoint, and records the outcome. A run that stops at the deadline keeps
// status "succeeded" with a checkpoint; the next run continues from it.
async function withSyncState(db: Db, scope: SyncScope, resource: SquareResource, options: SyncOptions, pass: (checkpoint: Checkpoint, state?: SyncStateRow) => Promise<{ count: number; checkpoint: Checkpoint; complete: boolean; mode?: string }>): Promise<SyncResult> {
  const state = await loadSyncState(db, scope.locationId, resource);
  const started = now(options);
  const lastStarted = state?.lastStartedAt ? Date.parse(state.lastStartedAt) : 0;
  const pending = Object.keys(parseCheckpoint(state)).some((key) => ["cursor", "passStartedAt", "passEnd"].includes(key));
  if (!options.force && state && state.status !== "failed" && !pending && lastStarted > started.getTime() - RUN_SPACING_MS) return { resource, skipped: true, count: 0, complete: true };
  const startedAt = started.toISOString();
  const stateId = state?.id || crypto.randomUUID();
  await db.insert(integrationSyncStates).values({ id: stateId, organizationId: scope.organizationId, locationId: scope.locationId, provider: "square", resource, status: "running", lastStartedAt: startedAt, updatedAt: startedAt })
    .onConflictDoUpdate({ target: [integrationSyncStates.provider, integrationSyncStates.locationId, integrationSyncStates.resource], set: { status: "running", lastStartedAt: startedAt, error: "", updatedAt: startedAt } });
  try {
    const result = await pass(parseCheckpoint(state), state);
    const completedAt = new Date().toISOString();
    await db.update(integrationSyncStates).set({ status: "succeeded", lastSyncedAt: result.complete ? completedAt : state?.lastSyncedAt || null, checkpointJson: JSON.stringify(result.checkpoint), lastRunCount: result.count, error: "", updatedAt: completedAt }).where(eq(integrationSyncStates.id, stateId));
    return { resource, count: result.count, complete: result.complete, mode: result.mode };
  } catch (error) {
    const message = describeError(error);
    await db.update(integrationSyncStates).set({ status: "failed", error: message, updatedAt: new Date().toISOString() }).where(eq(integrationSyncStates.id, stateId));
    return { resource, count: 0, complete: false, error: message };
  }
}

// ---------------------------------------------------------------------------
// Scope: which Coat & Care location and which Square location ids
// ---------------------------------------------------------------------------

export async function squareLocationIds(fetcher?: typeof fetch) {
  const config = squareConfig();
  if (config.externalLocationId) return [config.externalLocationId];
  const response = await squareRequest<{ locations?: Array<{ id?: string; status?: string }> }>("locations", { fetcher });
  return (response.locations || []).filter((location) => location.id && location.status !== "INACTIVE").map((location) => String(location.id));
}

export async function squareSyncScope(fetcher?: typeof fetch): Promise<SyncScope> {
  const config = squareConfig();
  const storefront = await resolveStorefront({ organizationSlug: config.organizationSlug || undefined, locationSlug: config.locationSlug || undefined });
  const externalLocationIds = await squareLocationIds(fetcher).catch(() => config.externalLocationId ? [config.externalLocationId] : []);
  return { organizationId: storefront.organization.id, locationId: storefront.location.id, externalLocationIds, currency: storefront.location.currency };
}

function inScope(scope: SyncScope, externalLocationId: string | undefined) {
  if (!scope.externalLocationIds.length) return true;
  return !externalLocationId || scope.externalLocationIds.includes(externalLocationId);
}

// ---------------------------------------------------------------------------
// Customers
// ---------------------------------------------------------------------------

function customerRow(scope: SyncScope, customer: SquareCustomer, syncedAt: string): typeof squareCustomers.$inferInsert {
  return {
    id: String(customer.id),
    organizationId: scope.organizationId,
    locationId: scope.locationId,
    clientId: null,
    givenName: clean(customer.given_name, 100),
    familyName: clean(customer.family_name, 100),
    companyName: clean(customer.company_name, 120),
    nickname: clean(customer.nickname, 100),
    emailAddress: clean(customer.email_address, 180).toLowerCase(),
    phoneNumber: clean(customer.phone_number, 40),
    note: clean(customer.note, 4000),
    referenceId: clean(customer.reference_id, 120),
    birthday: clean(customer.birthday, 20),
    addressJson: JSON.stringify(customer.address || {}),
    creationSource: clean(customer.creation_source, 40),
    emailUnsubscribed: customer.preferences?.email_unsubscribed === true,
    groupIdsJson: JSON.stringify(customer.group_ids || []),
    segmentIdsJson: JSON.stringify(customer.segment_ids || []),
    version: Number(customer.version || 0),
    squareCreatedAt: clean(customer.created_at, 40),
    squareUpdatedAt: clean(customer.updated_at, 40),
    deleted: false,
    rawJson: JSON.stringify(customer),
    syncedAt,
  };
}

// Links a page of Square customers to Coat & Care clients: an existing link
// wins, then one client sharing the email or phone, otherwise a new client is
// seeded from Square. Coat & Care stays authoritative: an existing client's
// name and contact details are never replaced by Square's copy, and a customer
// whose details match several clients is left for staff review.
export async function linkSquareCustomers(db: Db, scope: SyncScope, customers: SquareCustomer[]) {
  const pageIds = customers.map((customer) => String(customer.id || "")).filter(Boolean);
  if (!pageIds.length) return new Map<string, string>();
  const links = await linkedLocalIds(db, scope.organizationId, "client", pageIds);
  const linkedClientIds = [...new Set(links.values())];
  const existingClients = linkedClientIds.length ? await db.select({ id: clients.id }).from(clients).where(and(eq(clients.organizationId, scope.organizationId), inArray(clients.id, linkedClientIds))) : [];
  const existingIds = new Set(existingClients.map((row) => row.id));
  const resolved = new Map<string, string>();
  const unresolved: SquareCustomer[] = [];
  for (const customer of customers) {
    const id = String(customer.id || "");
    const linked = links.get(id);
    if (linked && existingIds.has(linked)) resolved.set(id, linked);
    else unresolved.push(customer);
  }
  if (unresolved.length) {
    const emails = [...new Set(unresolved.map((customer) => clean(customer.email_address, 180).toLowerCase()).filter(Boolean))];
    const digits = [...new Set(unresolved.map((customer) => phoneDigits(clean(customer.phone_number, 40))).filter((value) => value.length === 10))];
    const phoneExpression = sql<string>`right(regexp_replace(${clients.phone}, '\\D', '', 'g'), 10)`;
    const candidates = emails.length || digits.length ? await db.select({ id: clients.id, email: sql<string>`lower(${clients.email})`, digits: phoneExpression }).from(clients).where(and(
      eq(clients.organizationId, scope.organizationId),
      or(
        emails.length ? inArray(sql<string>`lower(${clients.email})`, emails) : undefined,
        digits.length ? inArray(phoneExpression, digits) : undefined,
      ),
    )) : [];
    const byEmail = new Map<string, Set<string>>();
    const byDigits = new Map<string, Set<string>>();
    for (const candidate of candidates) {
      if (candidate.email) byEmail.set(candidate.email, (byEmail.get(candidate.email) || new Set()).add(candidate.id));
      if (candidate.digits && candidate.digits.length === 10) byDigits.set(candidate.digits, (byDigits.get(candidate.digits) || new Set()).add(candidate.id));
    }
    const newClients: Array<typeof clients.$inferInsert> = [];
    for (const customer of unresolved) {
      const id = String(customer.id || "");
      const email = clean(customer.email_address, 180).toLowerCase();
      const phoneRaw = clean(customer.phone_number, 40);
      const phone = normalizeClientPhone(phoneRaw) || phoneRaw;
      const matches = new Set<string>([...(email ? byEmail.get(email) || [] : []), ...(phoneDigits(phoneRaw).length === 10 ? byDigits.get(phoneDigits(phoneRaw)) || [] : [])]);
      if (matches.size > 1) continue; // ambiguous: staff review
      if (matches.size === 1) { resolved.set(id, [...matches][0]); continue; }
      const name = squareCustomerName({ givenName: clean(customer.given_name, 100), familyName: clean(customer.family_name, 100), companyName: clean(customer.company_name, 120), nickname: clean(customer.nickname, 100), emailAddress: email, phoneNumber: phone });
      if (!email && !phoneRaw && name === "Square customer") continue; // nothing to identify a client by
      const clientId = crypto.randomUUID();
      newClients.push({ id: clientId, organizationId: scope.organizationId, fullName: name.slice(0, 100), email, phone });
      resolved.set(id, clientId);
      // Later customers on this page sharing the contact reuse the new client.
      if (email) byEmail.set(email, new Set([clientId]));
      if (phoneDigits(phoneRaw).length === 10) byDigits.set(phoneDigits(phoneRaw), new Set([clientId]));
    }
    for (let index = 0; index < newClients.length; index += PAGE_LIMIT) await db.insert(clients).values(newClients.slice(index, index + PAGE_LIMIT));
    const newLinks = unresolved.filter((customer) => resolved.has(String(customer.id || ""))).map((customer) => ({ organizationId: scope.organizationId, locationId: scope.locationId, entityType: "client" as const, localEntityId: resolved.get(String(customer.id || ""))!, externalEntityId: String(customer.id || "") }));
    await linkEntities(db, newLinks);
    // Money already imported for these customers now belongs to their client.
    for (const link of newLinks) {
      await db.update(squarePayments).set({ clientId: link.localEntityId }).where(and(eq(squarePayments.organizationId, scope.organizationId), eq(squarePayments.customerId, link.externalEntityId)));
      await db.update(squareOrders).set({ clientId: link.localEntityId }).where(and(eq(squareOrders.organizationId, scope.organizationId), eq(squareOrders.customerId, link.externalEntityId)));
    }
  }
  return resolved;
}

export async function upsertSquareCustomers(db: Db, scope: SyncScope, customers: SquareCustomer[], syncedAt = new Date().toISOString()) {
  const valid = customers.filter((customer) => customer.id);
  if (!valid.length) return 0;
  const clientIds = await linkSquareCustomers(db, scope, valid);
  await upsertRows(db, squareCustomers, valid.map((customer) => ({ ...customerRow(scope, customer, syncedAt), clientId: clientIds.get(String(customer.id)) || null })));
  return valid.length;
}

export async function markSquareCustomerDeleted(db: Db, scope: SyncScope, customerId: string) {
  await db.update(squareCustomers).set({ deleted: true, syncedAt: new Date().toISOString() }).where(and(eq(squareCustomers.organizationId, scope.organizationId), eq(squareCustomers.id, customerId)));
}

async function syncCustomers(db: Db, scope: SyncScope, options: SyncOptions): Promise<SyncResult> {
  return withSyncState(db, scope, "customers", options, async (checkpoint, state) => {
    const plan = passPlan(checkpoint, state, options, "customers");
    let cursor = plan.cursor;
    let count = 0;
    let pages = 0;
    const budget = options.pageBudget ?? 40;
    do {
      const response = plan.mode === "full"
        ? await squareRequest<{ customers?: SquareCustomer[]; cursor?: string }>("customers", { query: new URLSearchParams({ limit: String(PAGE_LIMIT), sort_field: "CREATED_AT", sort_order: "ASC", ...(cursor ? { cursor } : {}) }), fetcher: options.fetcher })
        : await squareRequest<{ customers?: SquareCustomer[]; cursor?: string }>("customers/search", { body: { limit: PAGE_LIMIT, ...(cursor ? { cursor } : {}), query: { filter: { updated_at: { start_at: plan.sinceIso } }, sort: { field: "CREATED_AT", order: "ASC" } } }, fetcher: options.fetcher });
      count += await upsertSquareCustomers(db, scope, response.customers || [], plan.passStartedAt);
      cursor = response.cursor || "";
      pages += 1;
      if (cursor && (pages >= budget || pastDeadline(options))) return { count, checkpoint: plan.progress(cursor), complete: false, mode: plan.mode };
    } while (cursor);
    if (plan.mode === "full") {
      // A customer Square no longer lists was deleted or merged there.
      await db.update(squareCustomers).set({ deleted: true }).where(and(eq(squareCustomers.organizationId, scope.organizationId), eq(squareCustomers.deleted, false), lt(squareCustomers.syncedAt, plan.passStartedAt)));
    }
    return { count, checkpoint: plan.done(), complete: true, mode: plan.mode };
  });
}

// ---------------------------------------------------------------------------
// Team members
// ---------------------------------------------------------------------------

async function matchStaff(db: Db, scope: SyncScope, members: SquareTeamMember[]) {
  const ids = members.map((member) => String(member.id || "")).filter(Boolean);
  const links = await linkedLocalIds(db, scope.organizationId, "staff", ids);
  const roster = await db.select({ id: staff.id, email: staff.email, displayName: staff.displayName }).from(staff).where(eq(staff.organizationId, scope.organizationId));
  const byEmail = new Map(roster.filter((person) => person.email).map((person) => [String(person.email).toLowerCase(), person.id]));
  const byName = new Map(roster.map((person) => [person.displayName.trim().toLowerCase(), person.id]));
  const resolved = new Map<string, string>();
  const newLinks: Parameters<typeof linkEntities>[1] = [];
  for (const member of members) {
    const id = String(member.id || "");
    const linked = links.get(id);
    if (linked && roster.some((person) => person.id === linked)) { resolved.set(id, linked); continue; }
    const email = clean(member.email_address, 180).toLowerCase();
    const name = [member.given_name, member.family_name].filter(Boolean).join(" ").trim().toLowerCase();
    const match = (email && byEmail.get(email)) || (name && byName.get(name)) || "";
    if (!match) continue;
    resolved.set(id, match);
    newLinks.push({ organizationId: scope.organizationId, locationId: scope.locationId, entityType: "staff", localEntityId: match, externalEntityId: id });
  }
  await linkEntities(db, newLinks);
  return resolved;
}

export async function upsertSquareTeamMembers(db: Db, scope: SyncScope, members: SquareTeamMember[], syncedAt = new Date().toISOString()) {
  const valid = members.filter((member) => member.id);
  if (!valid.length) return 0;
  const staffIds = await matchStaff(db, scope, valid);
  await upsertRows(db, squareTeamMembers, valid.map((member): typeof squareTeamMembers.$inferInsert => ({
    id: String(member.id),
    organizationId: scope.organizationId,
    staffId: staffIds.get(String(member.id)) || null,
    givenName: clean(member.given_name, 100),
    familyName: clean(member.family_name, 100),
    emailAddress: clean(member.email_address, 180).toLowerCase(),
    phoneNumber: clean(member.phone_number, 40),
    referenceId: clean(member.reference_id, 120),
    status: clean(member.status, 20) || "ACTIVE",
    isOwner: member.is_owner === true,
    assignedLocationsJson: JSON.stringify(member.assigned_locations || {}),
    squareCreatedAt: clean(member.created_at, 40),
    squareUpdatedAt: clean(member.updated_at, 40),
    rawJson: JSON.stringify(member),
    syncedAt,
  })));
  return valid.length;
}

async function syncTeam(db: Db, scope: SyncScope, options: SyncOptions): Promise<SyncResult> {
  return withSyncState(db, scope, "team", options, async () => {
    let cursor = "";
    let count = 0;
    const syncedAt = now(options).toISOString();
    do {
      const response = await squareRequest<{ team_members?: SquareTeamMember[]; cursor?: string }>("team-members/search", { body: { limit: PAGE_LIMIT, ...(cursor ? { cursor } : {}), query: { filter: scope.externalLocationIds.length ? { location_ids: scope.externalLocationIds } : {} } }, fetcher: options.fetcher });
      count += await upsertSquareTeamMembers(db, scope, response.team_members || [], syncedAt);
      cursor = response.cursor || "";
    } while (cursor && !pastDeadline(options));
    return { count, checkpoint: { fullCompletedAt: syncedAt }, complete: !cursor, mode: "full" };
  });
}

// ---------------------------------------------------------------------------
// Orders
// ---------------------------------------------------------------------------

function orderRow(scope: SyncScope, order: SquareOrder, clientId: string | null, syncedAt: string): typeof squareOrders.$inferInsert {
  return {
    id: String(order.id),
    organizationId: scope.organizationId,
    locationId: scope.locationId,
    externalLocationId: clean(order.location_id, 60),
    customerId: clean(order.customer_id, 60),
    clientId,
    state: clean(order.state, 20),
    sourceName: clean(order.source?.name, 80),
    referenceId: clean(order.reference_id, 120),
    totalCents: cents(order.total_money),
    taxCents: cents(order.total_tax_money),
    discountCents: cents(order.total_discount_money),
    tipCents: cents(order.total_tip_money),
    serviceChargeCents: cents(order.total_service_charge_money),
    returnedCents: cents(order.return_amounts?.total_money),
    netAmountDueCents: cents(order.net_amount_due_money),
    currency: clean(order.total_money?.currency, 3) || scope.currency,
    lineItemsJson: JSON.stringify((order.line_items || []).map((line) => ({
      uid: clean(line.uid, 60),
      name: clean(line.name, 200),
      quantity: clean(line.quantity, 20) || "1",
      catalogObjectId: clean(line.catalog_object_id, 60),
      variationName: clean(line.variation_name, 120),
      itemType: clean(line.item_type, 30),
      note: clean(line.note, 500),
      basePriceCents: cents(line.base_price_money),
      totalCents: cents(line.total_money),
      taxCents: cents(line.total_tax_money),
      discountCents: cents(line.total_discount_money),
    }))),
    fulfillmentsJson: JSON.stringify((order.fulfillments || []).map((item) => ({ uid: clean(item.uid, 60), type: clean(item.type, 30), state: clean(item.state, 30) }))),
    tendersJson: JSON.stringify((order.tenders || []).map((tender) => ({ id: clean(tender.id, 60), type: clean(tender.type, 30), amountCents: cents(tender.amount_money), paymentId: clean(tender.payment_id, 60), cardBrand: clean(tender.card_details?.card?.card_brand, 30), last4: clean(tender.card_details?.card?.last_4, 4) }))),
    version: Number(order.version || 0),
    squareCreatedAt: clean(order.created_at, 40),
    squareUpdatedAt: clean(order.updated_at, 40),
    squareClosedAt: clean(order.closed_at, 40),
    rawJson: JSON.stringify(order),
    syncedAt,
  };
}

export async function upsertSquareOrders(db: Db, scope: SyncScope, orders: SquareOrder[], syncedAt = new Date().toISOString()) {
  const valid = orders.filter((order) => order.id && inScope(scope, order.location_id));
  if (!valid.length) return 0;
  const clientIds = await linkedLocalIds(db, scope.organizationId, "client", valid.map((order) => clean(order.customer_id, 60)));
  await upsertRows(db, squareOrders, valid.map((order) => orderRow(scope, order, clientIds.get(clean(order.customer_id, 60)) || null, syncedAt)));
  return valid.length;
}

export async function retrieveSquareOrders(db: Db, scope: SyncScope, orderIds: string[], fetcher?: typeof fetch) {
  const ids = [...new Set(orderIds.filter(Boolean))];
  for (let index = 0; index < ids.length; index += PAGE_LIMIT) {
    const response = await squareRequest<{ orders?: SquareOrder[] }>("orders/batch-retrieve", { body: { order_ids: ids.slice(index, index + PAGE_LIMIT) }, fetcher });
    await upsertSquareOrders(db, scope, response.orders || []);
  }
}

async function syncOrders(db: Db, scope: SyncScope, options: SyncOptions): Promise<SyncResult> {
  return withSyncState(db, scope, "orders", options, async (checkpoint, state) => {
    if (!scope.externalLocationIds.length) throw new Error("Set SQUARE_LOCATION_ID so orders can be searched for the salon's Square location.");
    const plan = passPlan(checkpoint, state, options, "orders");
    let cursor = plan.cursor;
    let count = 0;
    let pages = 0;
    const budget = options.pageBudget ?? 30;
    const field = plan.mode === "full" ? "CREATED_AT" : "UPDATED_AT";
    const range = plan.mode === "full" ? { start_at: plan.backfillStartIso, end_at: plan.passEnd } : { start_at: plan.sinceIso, end_at: plan.passEnd };
    do {
      const response = await squareRequest<{ orders?: SquareOrder[]; cursor?: string }>("orders/search", {
        body: { location_ids: scope.externalLocationIds, limit: PAGE_LIMIT, return_entries: false, ...(cursor ? { cursor } : {}), query: { filter: { date_time_filter: { [field.toLowerCase()]: range } }, sort: { sort_field: field, sort_order: "ASC" } } },
        fetcher: options.fetcher,
      });
      count += await upsertSquareOrders(db, scope, response.orders || [], plan.passStartedAt);
      cursor = response.cursor || "";
      pages += 1;
      if (cursor && (pages >= budget || pastDeadline(options))) return { count, checkpoint: plan.progress(cursor), complete: false, mode: plan.mode };
    } while (cursor);
    return { count, checkpoint: plan.done(), complete: true, mode: plan.mode };
  });
}

// ---------------------------------------------------------------------------
// Payments and refunds
// ---------------------------------------------------------------------------

function paymentRow(scope: SyncScope, payment: SquarePayment, links: { clientId: string | null; staffId: string | null; taxCents: number; discountCents: number }, syncedAt: string): typeof squarePayments.$inferInsert {
  return {
    id: String(payment.id),
    organizationId: scope.organizationId,
    locationId: scope.locationId,
    externalLocationId: clean(payment.location_id, 60),
    orderId: clean(payment.order_id, 60),
    customerId: clean(payment.customer_id, 60),
    clientId: links.clientId,
    teamMemberId: clean(payment.team_member_id || payment.employee_id, 60),
    staffId: links.staffId,
    status: clean(payment.status, 20),
    sourceType: clean(payment.source_type, 30),
    cardBrand: clean(payment.card_details?.card?.card_brand, 30),
    cardLast4: clean(payment.card_details?.card?.last_4, 4),
    entryMethod: clean(payment.card_details?.entry_method, 30),
    walletBrand: clean(payment.wallet_details?.brand || payment.external_details?.type, 40),
    amountCents: cents(payment.amount_money),
    tipCents: cents(payment.tip_money),
    totalCents: cents(payment.total_money) || cents(payment.amount_money) + cents(payment.tip_money),
    approvedCents: cents(payment.approved_money),
    processingFeeCents: (payment.processing_fee || []).reduce((sum, fee) => sum + cents(fee.amount_money), 0),
    refundedCents: cents(payment.refunded_money),
    taxCents: links.taxCents,
    discountCents: links.discountCents,
    currency: clean(payment.amount_money?.currency, 3) || scope.currency,
    receiptNumber: clean(payment.receipt_number, 40),
    receiptUrl: clean(payment.receipt_url, 400),
    note: clean(payment.note, 1000),
    applicationName: clean(payment.application_details?.square_product, 60),
    deviceName: clean(payment.device_details?.device_name, 120),
    squareCreatedAt: clean(payment.created_at, 40),
    squareUpdatedAt: clean(payment.updated_at, 40),
    rawJson: JSON.stringify(payment),
    syncedAt,
  };
}

export async function upsertSquarePayments(db: Db, scope: SyncScope, payments: SquarePayment[], syncedAt = new Date().toISOString(), fetcher?: typeof fetch) {
  const valid = payments.filter((payment) => payment.id && inScope(scope, payment.location_id));
  if (!valid.length) return 0;
  const orderIds = [...new Set(valid.map((payment) => clean(payment.order_id, 60)).filter(Boolean))];
  const loadOrders = () => orderIds.length ? db.select({ id: squareOrders.id, totalCents: squareOrders.totalCents, tipCents: squareOrders.tipCents, taxCents: squareOrders.taxCents, discountCents: squareOrders.discountCents }).from(squareOrders).where(and(eq(squareOrders.organizationId, scope.organizationId), inArray(squareOrders.id, orderIds))) : Promise.resolve([]);
  let orders = await loadOrders();
  const missing = orderIds.filter((id) => !orders.some((order) => order.id === id));
  if (missing.length) {
    // A payment can arrive before its order was imported (webhooks, first run).
    await retrieveSquareOrders(db, scope, missing, fetcher).catch(() => undefined);
    orders = await loadOrders();
  }
  const orderById = new Map(orders.map((order) => [order.id, order]));
  const [clientIds, staffIds] = await Promise.all([
    linkedLocalIds(db, scope.organizationId, "client", valid.map((payment) => clean(payment.customer_id, 60))),
    linkedLocalIds(db, scope.organizationId, "staff", valid.map((payment) => clean(payment.team_member_id || payment.employee_id, 60))),
  ]);
  await upsertRows(db, squarePayments, valid.map((payment) => {
    const order = orderById.get(clean(payment.order_id, 60));
    const share = order ? paymentShare(order, cents(payment.amount_money)) : { taxCents: 0, discountCents: 0 };
    return paymentRow(scope, payment, { clientId: clientIds.get(clean(payment.customer_id, 60)) || null, staffId: staffIds.get(clean(payment.team_member_id || payment.employee_id, 60)) || null, ...share }, syncedAt);
  }));
  return valid.length;
}

export async function upsertSquareRefunds(db: Db, scope: SyncScope, refunds: SquareRefund[], syncedAt = new Date().toISOString()) {
  const valid = refunds.filter((refund) => refund.id && inScope(scope, refund.location_id));
  if (!valid.length) return 0;
  await upsertRows(db, squareRefunds, valid.map((refund): typeof squareRefunds.$inferInsert => ({
    id: String(refund.id),
    organizationId: scope.organizationId,
    locationId: scope.locationId,
    paymentId: clean(refund.payment_id, 60),
    orderId: clean(refund.order_id, 60),
    status: clean(refund.status, 20),
    amountCents: cents(refund.amount_money),
    processingFeeCents: (refund.processing_fee || []).reduce((sum, fee) => sum + cents(fee.amount_money), 0),
    reason: clean(refund.reason, 500),
    currency: clean(refund.amount_money?.currency, 3) || scope.currency,
    squareCreatedAt: clean(refund.created_at, 40),
    squareUpdatedAt: clean(refund.updated_at, 40),
    rawJson: JSON.stringify(refund),
    syncedAt,
  })));
  return valid.length;
}

// ListPayments and ListPaymentRefunds share their paging parameters: a
// created_at window for the first pass, an updated_at window afterwards so
// status changes and refunds on older payments are picked up too.
function listQuery(plan: ReturnType<typeof passPlan>, scope: SyncScope, cursor: string) {
  const query = new URLSearchParams({ limit: String(PAGE_LIMIT), sort_order: "ASC" });
  if (scope.externalLocationIds.length === 1) query.set("location_id", scope.externalLocationIds[0]);
  if (plan.mode === "full") {
    query.set("sort_field", "CREATED_AT");
    query.set("begin_time", plan.backfillStartIso);
    query.set("end_time", plan.passEnd);
  } else {
    query.set("sort_field", "UPDATED_AT");
    query.set("updated_at_begin_time", plan.sinceIso);
    query.set("updated_at_end_time", plan.passEnd);
  }
  if (cursor) query.set("cursor", cursor);
  return query;
}

async function syncPayments(db: Db, scope: SyncScope, options: SyncOptions): Promise<SyncResult> {
  return withSyncState(db, scope, "payments", options, async (checkpoint, state) => {
    const plan = passPlan(checkpoint, state, options, "payments");
    let cursor = plan.cursor;
    let count = 0;
    let pages = 0;
    const budget = options.pageBudget ?? 30;
    do {
      const response = await squareRequest<{ payments?: SquarePayment[]; cursor?: string }>("payments", { query: listQuery(plan, scope, cursor), fetcher: options.fetcher });
      count += await upsertSquarePayments(db, scope, response.payments || [], plan.passStartedAt, options.fetcher);
      cursor = response.cursor || "";
      pages += 1;
      if (cursor && (pages >= budget || pastDeadline(options))) return { count, checkpoint: plan.progress(cursor), complete: false, mode: plan.mode };
    } while (cursor);
    return { count, checkpoint: plan.done(), complete: true, mode: plan.mode };
  });
}

async function syncRefunds(db: Db, scope: SyncScope, options: SyncOptions): Promise<SyncResult> {
  return withSyncState(db, scope, "refunds", options, async (checkpoint, state) => {
    const plan = passPlan(checkpoint, state, options, "refunds");
    let cursor = plan.cursor;
    let count = 0;
    let pages = 0;
    const budget = options.pageBudget ?? 20;
    do {
      const response = await squareRequest<{ refunds?: SquareRefund[]; cursor?: string }>("refunds", { query: listQuery(plan, scope, cursor), fetcher: options.fetcher });
      count += await upsertSquareRefunds(db, scope, response.refunds || [], plan.passStartedAt);
      cursor = response.cursor || "";
      pages += 1;
      if (cursor && (pages >= budget || pastDeadline(options))) return { count, checkpoint: plan.progress(cursor), complete: false, mode: plan.mode };
    } while (cursor);
    return { count, checkpoint: plan.done(), complete: true, mode: plan.mode };
  });
}

// ---------------------------------------------------------------------------
// Booking details (called by the booking sync for every booking it handles)
// ---------------------------------------------------------------------------

export async function upsertSquareBookingDetails(db: Db, scope: { organizationId: string; locationId: string }, booking: SquareBookingDetails, appointmentId: string | null) {
  if (!booking.id) return;
  const segments = booking.appointment_segments || [];
  await upsertRows(db, squareBookings, [{
    id: String(booking.id),
    organizationId: scope.organizationId,
    locationId: scope.locationId,
    appointmentId,
    customerId: clean(booking.customer_id, 60),
    status: clean(booking.status, 30),
    source: clean(booking.source, 30),
    startAt: clean(booking.start_at, 40),
    durationMinutes: segments.reduce((total, segment) => total + Number(segment.duration_minutes || 0) + Number(segment.intermission_minutes || 0), 0),
    version: Number(booking.version || 0),
    sellerNote: clean(booking.seller_note, 4000),
    customerNote: clean(booking.customer_note, 4000),
    creatorType: clean(booking.creator_details?.creator_type, 30),
    creatorTeamMemberId: clean(booking.creator_details?.team_member_id, 60),
    creatorCustomerId: clean(booking.creator_details?.customer_id, 60),
    locationType: clean(booking.location_type, 30),
    allDay: booking.all_day === true,
    transitionTimeMinutes: Number(booking.transition_time_minutes || 0),
    segmentsJson: JSON.stringify(segments.map((segment) => ({ durationMinutes: Number(segment.duration_minutes || 0), intermissionMinutes: Number(segment.intermission_minutes || 0), serviceVariationId: clean(segment.service_variation_id, 60), teamMemberId: clean(segment.team_member_id, 60), anyTeamMember: segment.any_team_member === true }))),
    squareCreatedAt: clean(booking.created_at, 40),
    squareUpdatedAt: clean(booking.updated_at, 40),
    rawJson: JSON.stringify(booking),
    syncedAt: new Date().toISOString(),
  }]);
}

// ---------------------------------------------------------------------------
// Orchestration
// ---------------------------------------------------------------------------

const syncers: Record<SquareResource, (db: Db, scope: SyncScope, options: SyncOptions) => Promise<SyncResult>> = {
  customers: syncCustomers,
  team: syncTeam,
  orders: syncOrders,
  payments: syncPayments,
  refunds: syncRefunds,
};

// Runs the requested resources in dependency order (customers and team before
// the money that references them). A failure in one is recorded on its own
// state and never stops the others.
export async function runSquareDataSync(db: Db = getDb(), options: SyncOptions & { resources?: SquareResource[] } = {}) {
  const config = squareConfig();
  if (!config.syncConfigured) return { configured: false as const, results: [] as SyncResult[] };
  const scope = await squareSyncScope(options.fetcher);
  const requested = options.resources?.length ? SQUARE_RESOURCES.filter((resource) => options.resources!.includes(resource)) : SQUARE_RESOURCES;
  const results: SyncResult[] = [];
  for (const resource of requested) {
    if (pastDeadline(options)) { results.push({ resource, skipped: true, count: 0, complete: false }); continue; }
    results.push(await syncers[resource](db, scope, options));
  }
  return { configured: true as const, scope, results };
}
