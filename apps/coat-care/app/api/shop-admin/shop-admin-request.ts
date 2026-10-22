import { auditEvents } from "../../../db/schema";
import { SquareRequestError } from "../../../lib/square";
import { ShopAdminError } from "../../../lib/shop-admin";
import { requireBoutiqueManagement, requireSalonAccess, salonApiError, SalonAccessError } from "../../salon-access";
import type { getDb } from "../../../db";

// Shared by the Online store admin routes: who may write to the Square
// catalog, how its refusals read, and the audit trail of every change.

const SQUARE_ID = /^[A-Za-z0-9_-]{1,64}$/;

export function squareId(value: unknown, label = "entry") {
  const id = String(value ?? "").trim();
  if (!SQUARE_ID.test(id)) throw new SalonAccessError(`Choose a valid ${label}.`, 400);
  return id;
}

export function squareIds(value: unknown, label: string, max: number) {
  if (!Array.isArray(value) || value.length > max) throw new SalonAccessError(`Choose up to ${max} ${label}.`, 400);
  return [...new Set(value.map((entry) => squareId(entry, label)))];
}

export async function requireShopAdmin() {
  const access = await requireSalonAccess();
  requireBoutiqueManagement(access.membership);
  return access;
}

export async function recordShopChange(db: ReturnType<typeof getDb>, membership: { id: string; organizationId: string }, action: string, entityType: string, entityId: string, details: Record<string, unknown>) {
  try {
    await db.insert(auditEvents).values({ id: crypto.randomUUID(), organizationId: membership.organizationId, actorType: "staff", actorId: membership.id, action, entityType, entityId, detailsJson: JSON.stringify(details) });
  } catch (error) {
    // Square already holds the change; a missing audit row must not report it as failed.
    console.error("Online store change saved in Square but not recorded in the audit trail.", error);
  }
}

export function shopAdminError(error: unknown, fallback: string) {
  if (error instanceof ShopAdminError) return salonApiError(new SalonAccessError(error.message, error.status), fallback);
  if (error instanceof SquareRequestError) {
    console.error(fallback, error);
    const message = error.status === 401 || error.status === 403 || error.code === "INSUFFICIENT_SCOPES"
      ? "Square refused the change: the access token needs the ITEMS_WRITE permission to edit the catalog."
      : `Square refused the change: ${error.message}`;
    return Response.json({ error: message, code: error.code || undefined }, { status: 502 });
  }
  return salonApiError(error, fallback);
}
