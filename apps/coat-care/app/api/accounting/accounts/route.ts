import { and, asc, eq, inArray, lte } from "drizzle-orm";
import { auditEvents, financialAccounts, financialAccountTransactions, locations, organizations } from "../../../../db/schema";
import { sha256 } from "../../../../lib/employee-crypto";
import { requireBookkeepingAccess, requireSalonAccess, salonApiError, SalonAccessError } from "../../../salon-access";

const datePattern = /^\d{4}-\d{2}-\d{2}$/;
function validDate(value: string) { const date = new Date(`${value}T12:00:00Z`); return datePattern.test(value) && Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value; }
function permittedLocationIds(membership: Awaited<ReturnType<typeof requireSalonAccess>>["membership"]) { return membership.locations.map((item) => item.locationId); }

async function ensureDefaultAccounts(db: Awaited<ReturnType<typeof requireSalonAccess>>["db"], membership: Awaited<ReturnType<typeof requireSalonAccess>>["membership"]) {
  const existing = await db.select({ id: financialAccounts.id }).from(financialAccounts).where(eq(financialAccounts.organizationId, membership.organizationId)).limit(1);
  if (existing.length) return;
  const [organization] = await db.select({ currency: organizations.currency }).from(organizations).where(eq(organizations.id, membership.organizationId)).limit(1);
  if (!organization) throw new SalonAccessError("Organisation introuvable.", 404);
  await db.batch([
    db.insert(financialAccounts).values({ id: crypto.randomUUID(), organizationId: membership.organizationId, name: "Banque Desjardins", provider: "desjardins", accountType: "bank", currency: organization.currency, createdByStaffId: membership.id }).onConflictDoNothing(),
    db.insert(financialAccounts).values({ id: crypto.randomUUID(), organizationId: membership.organizationId, name: "Square", provider: "square", accountType: "processor", currency: organization.currency, createdByStaffId: membership.id }).onConflictDoNothing(),
  ]);
}

export async function GET(request: Request) {
  try {
    const { db, membership } = await requireSalonAccess(); requireBookkeepingAccess(membership);
    await ensureDefaultAccounts(db, membership);
    const params = new URL(request.url).searchParams, from = params.get("from") || "2000-01-01", to = params.get("to") || "2999-12-31", scope = params.get("scope") === "all" ? "all" : "current";
    if (!validDate(from) || !validDate(to) || from > to) throw new SalonAccessError("Période invalide.", 400);
    const allowed = permittedLocationIds(membership), scopedIds = scope === "all" ? allowed : [membership.locationId];
    const [accounts, transactions, locationRows] = await Promise.all([
      db.select().from(financialAccounts).where(and(eq(financialAccounts.organizationId, membership.organizationId), eq(financialAccounts.active, true))).orderBy(asc(financialAccounts.name)),
      db.select().from(financialAccountTransactions).where(and(eq(financialAccountTransactions.organizationId, membership.organizationId), lte(financialAccountTransactions.transactionDate, to))).orderBy(asc(financialAccountTransactions.transactionDate)),
      db.select({ id: locations.id, name: locations.name }).from(locations).where(and(eq(locations.organizationId, membership.organizationId), inArray(locations.id, allowed))),
    ]);
    const visibleAccounts = accounts.filter((account) => !account.locationId || scopedIds.includes(account.locationId));
    const names = new Map(locationRows.map((location) => [location.id, location.name]));
    const visibleTransactions = transactions.filter((item) => visibleAccounts.some((account) => account.id === item.accountId) && (!item.locationId || scopedIds.includes(item.locationId)));
    const rangeTransactions = visibleTransactions.filter((item) => item.transactionDate >= from);
    return Response.json({
      accounts: visibleAccounts.map((account) => { const balanceRows = visibleTransactions.filter((item) => item.accountId === account.id), periodRows = rangeTransactions.filter((item) => item.accountId === account.id); return { ...account, locationName: account.locationId ? names.get(account.locationId) || "" : "Tous les emplacements", balanceCents: account.openingBalanceCents + balanceRows.reduce((sum, row) => sum + row.amountCents, 0), transactionCount: periodRows.length }; }),
      transactions: rangeTransactions.map((item) => ({ ...item, accountName: accounts.find((account) => account.id === item.accountId)?.name || "Compte", locationName: item.locationId ? names.get(item.locationId) || "" : "Tous" })),
      locations: locationRows,
      canManage: ["owner", "manager", "accountant"].includes(membership.role),
    });
  } catch (error) { return salonApiError(error, "Les comptes ne peuvent pas être chargés."); }
}

export async function POST(request: Request) {
  try {
    const { db, membership } = await requireSalonAccess(); requireBookkeepingAccess(membership);
    const body = await request.json() as Record<string, unknown>, action = String(body.action || "import");
    const allowedLocations = new Set(permittedLocationIds(membership));
    if (action === "create_account") {
      const name = String(body.name || "").trim().slice(0, 80), provider = ["desjardins", "square", "other"].includes(String(body.provider)) ? String(body.provider) as "desjardins" | "square" | "other" : "other", accountType = ["bank", "processor", "credit_card", "cash", "other"].includes(String(body.accountType)) ? String(body.accountType) as "bank" | "processor" | "credit_card" | "cash" | "other" : "other", locationId = String(body.locationId || "") || null, openingBalanceCents = Math.round(Number(body.openingBalance || 0) * 100);
      if (name.length < 2 || !Number.isFinite(openingBalanceCents) || (locationId && !allowedLocations.has(locationId))) throw new SalonAccessError("Vérifiez le nom, le solde initial et l’emplacement.", 400);
      const [currencySource] = locationId
        ? await db.select({ currency: locations.currency }).from(locations).where(and(eq(locations.id, locationId), eq(locations.organizationId, membership.organizationId))).limit(1)
        : await db.select({ currency: organizations.currency }).from(organizations).where(eq(organizations.id, membership.organizationId)).limit(1);
      if (!currencySource) throw new SalonAccessError("Devise du compte introuvable.", 404);
      const [account] = await db.insert(financialAccounts).values({ id: crypto.randomUUID(), organizationId: membership.organizationId, locationId, name, provider, accountType, openingBalanceCents, currency: currencySource.currency, createdByStaffId: membership.id }).returning();
      await db.insert(auditEvents).values({ id: crypto.randomUUID(), organizationId: membership.organizationId, actorType: "staff", actorId: membership.id, action: "financial_account.created", entityType: "financial_account", entityId: account.id });
      return Response.json({ account }, { status: 201 });
    }
    if (action !== "import") throw new SalonAccessError("Action non reconnue.", 400);
    const accountId = String(body.accountId || ""), locationId = String(body.locationId || "") || null, rows = Array.isArray(body.rows) ? body.rows : [];
    if (!rows.length || rows.length > 2_000 || (locationId && !allowedLocations.has(locationId))) throw new SalonAccessError("Importez entre 1 et 2 000 transactions valides.", 400);
    const [account] = await db.select().from(financialAccounts).where(and(eq(financialAccounts.id, accountId), eq(financialAccounts.organizationId, membership.organizationId), eq(financialAccounts.active, true))).limit(1);
    if (!account) throw new SalonAccessError("Compte introuvable.", 404);
    if (account.locationId && !allowedLocations.has(account.locationId)) throw new SalonAccessError("Ce compte appartient à un autre emplacement.", 403);
    if (account.locationId && locationId && account.locationId !== locationId) throw new SalonAccessError("L’emplacement de l’import ne correspond pas à celui du compte.", 409);
    const effectiveLocationId = account.locationId || locationId;
    let imported = 0, duplicates = 0;
    for (const raw of rows) {
      const row = raw as Record<string, unknown>, transactionDate = String(row.transactionDate || ""), description = String(row.description || "").trim().slice(0, 240), reference = String(row.reference || "").trim().slice(0, 120), amountCents = Math.round(Number(row.amount) * 100);
      if (!validDate(transactionDate) || !description || !Number.isFinite(amountCents) || amountCents === 0 || Math.abs(amountCents) > 100_000_000) throw new SalonAccessError("Une transaction importée contient une date, une description ou un montant invalide.", 400);
      const importHash = await sha256(`${accountId}|${transactionDate}|${description.toLowerCase()}|${amountCents}|${reference}`);
      const [created] = await db.insert(financialAccountTransactions).values({ id: crypto.randomUUID(), organizationId: membership.organizationId, locationId: effectiveLocationId, accountId, transactionDate, description, amountCents, reference, source: "csv_import", importHash, importedByStaffId: membership.id }).onConflictDoNothing().returning();
      if (created) imported += 1; else duplicates += 1;
    }
    await db.insert(auditEvents).values({ id: crypto.randomUUID(), organizationId: membership.organizationId, actorType: "staff", actorId: membership.id, action: "financial_transactions.imported", entityType: "financial_account", entityId: account.id, detailsJson: JSON.stringify({ imported, duplicates, locationId: effectiveLocationId }) });
    return Response.json({ imported, duplicates });
  } catch (error) { return salonApiError(error, "L’import bancaire a échoué."); }
}

export async function PATCH(request: Request) {
  try {
    const { db, membership } = await requireSalonAccess(); requireBookkeepingAccess(membership);
    const body = await request.json() as Record<string, unknown>, accountId = String(body.accountId || ""), openingBalanceCents = Math.round(Number(body.openingBalance || 0) * 100);
    if (!Number.isFinite(openingBalanceCents)) throw new SalonAccessError("Solde initial invalide.", 400);
    const [account] = await db.update(financialAccounts).set({ openingBalanceCents, updatedAt: new Date().toISOString() }).where(and(eq(financialAccounts.id, accountId), eq(financialAccounts.organizationId, membership.organizationId))).returning();
    if (!account) throw new SalonAccessError("Compte introuvable.", 404);
    await db.insert(auditEvents).values({ id: crypto.randomUUID(), organizationId: membership.organizationId, actorType: "staff", actorId: membership.id, action: "financial_account.opening_balance_updated", entityType: "financial_account", entityId: account.id, detailsJson: JSON.stringify({ openingBalanceCents }) });
    return Response.json({ account });
  } catch (error) { return salonApiError(error, "Le compte n’a pas pu être modifié."); }
}
