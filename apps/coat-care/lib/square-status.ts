import { and, desc, eq, gte, isNotNull, like, sql } from "drizzle-orm";
import { integrationSyncStates, providerWebhookEvents, squareBookings, squareCustomers, squareOrders, squarePayments, squareRefunds, squareTeamMembers } from "../db/schema";
import { squareConfig } from "./square";
import { parseCheckpoint, SQUARE_RESOURCES, SQUARE_WEBHOOK_EVENT_TYPES } from "./square-data-sync";
import type { Db } from "./square-links";

// What the Square integration panel shows: configuration, the last run of
// every resource, how much each mirror holds, and recent webhook deliveries.

export async function squareStatusPayload(db: Db, membership: { organizationId: string; locationId: string; role: string }) {
  const config = squareConfig();
  const scope = { organizationId: membership.organizationId, locationId: membership.locationId };
  const thirtyDaysAgo = new Date(Date.now() - 30 * 86_400_000).toISOString();
  const total = (query: Promise<Array<{ value: number }>>) => query.then(([row]) => Number(row?.value || 0));
  const counter = sql<number>`count(*)`.mapWith(Number);
  const [states, events, customers, linkedCustomers, payments, refunds, orders, team, bookings, [recent]] = await Promise.all([
    db.select().from(integrationSyncStates).where(and(eq(integrationSyncStates.provider, "square"), eq(integrationSyncStates.locationId, scope.locationId))),
    db.select({ id: providerWebhookEvents.id, eventType: providerWebhookEvents.eventType, status: providerWebhookEvents.status, error: providerWebhookEvents.error, createdAt: providerWebhookEvents.createdAt, processedAt: providerWebhookEvents.processedAt })
      .from(providerWebhookEvents).where(and(eq(providerWebhookEvents.provider, "square"), like(providerWebhookEvents.id, "square:%"))).orderBy(desc(providerWebhookEvents.createdAt)).limit(25),
    total(db.select({ value: counter }).from(squareCustomers).where(and(eq(squareCustomers.organizationId, scope.organizationId), eq(squareCustomers.deleted, false)))),
    total(db.select({ value: counter }).from(squareCustomers).where(and(eq(squareCustomers.organizationId, scope.organizationId), eq(squareCustomers.deleted, false), isNotNull(squareCustomers.clientId)))),
    total(db.select({ value: counter }).from(squarePayments).where(and(eq(squarePayments.organizationId, scope.organizationId), eq(squarePayments.locationId, scope.locationId)))),
    total(db.select({ value: counter }).from(squareRefunds).where(and(eq(squareRefunds.organizationId, scope.organizationId), eq(squareRefunds.locationId, scope.locationId)))),
    total(db.select({ value: counter }).from(squareOrders).where(and(eq(squareOrders.organizationId, scope.organizationId), eq(squareOrders.locationId, scope.locationId)))),
    total(db.select({ value: counter }).from(squareTeamMembers).where(eq(squareTeamMembers.organizationId, scope.organizationId))),
    total(db.select({ value: counter }).from(squareBookings).where(and(eq(squareBookings.organizationId, scope.organizationId), eq(squareBookings.locationId, scope.locationId)))),
    db.select({ grossCents: sql<number>`coalesce(sum(${squarePayments.totalCents}), 0)`.mapWith(Number), refundedCents: sql<number>`coalesce(sum(${squarePayments.refundedCents}), 0)`.mapWith(Number), payments: counter })
      .from(squarePayments).where(and(eq(squarePayments.organizationId, scope.organizationId), eq(squarePayments.locationId, scope.locationId), eq(squarePayments.status, "COMPLETED"), gte(squarePayments.squareCreatedAt, thirtyDaysAgo))),
  ]);
  const records = { bookings, customers, payments, refunds, orders, team } as const;
  const resources = (["bookings", ...SQUARE_RESOURCES] as const).map((resource) => {
    const state = states.find((item) => item.resource === resource);
    const checkpoint = parseCheckpoint(state);
    return {
      resource,
      status: state?.status || "idle",
      lastStartedAt: state?.lastStartedAt || null,
      lastSyncedAt: state?.lastSyncedAt || null,
      lastRunCount: state?.lastRunCount || 0,
      error: state?.error || "",
      pending: Boolean(checkpoint.cursor) || (resource === "bookings" && checkpoint.historyComplete === false),
      mode: typeof checkpoint.mode === "string" ? checkpoint.mode : null,
      fullCompletedAt: typeof checkpoint.fullCompletedAt === "string" ? checkpoint.fullCompletedAt : null,
      records: records[resource],
    };
  });
  return {
    config: {
      syncConfigured: config.syncConfigured,
      webhookConfigured: config.webhookConfigured,
      publicBookingConfigured: config.publicBookingConfigured,
      webhookNotificationUrl: config.webhookNotificationUrl,
      externalLocationId: config.externalLocationId,
      apiVersion: config.apiVersion,
    },
    webhookEventTypes: SQUARE_WEBHOOK_EVENT_TYPES,
    resources,
    totals: { customers, linkedCustomers, payments, refunds, orders, team, bookings, last30Days: { grossCents: recent?.grossCents || 0, refundedCents: recent?.refundedCents || 0, payments: recent?.payments || 0 } },
    recentEvents: events,
    canManage: ["owner", "manager"].includes(membership.role),
  };
}
