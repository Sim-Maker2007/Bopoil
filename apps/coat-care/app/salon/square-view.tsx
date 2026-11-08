"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

// The Square workspace: everything Square holds about the salon, read from the
// mirror the hourly sync and the webhooks keep up to date. Overview shows the
// connection and lets a manager run a sync; Customers, Sales, Reservations and
// Team show the data itself, each behind the permission that governs it.

type Resource = "bookings" | "customers" | "team" | "orders" | "payments" | "refunds";
type ResourceState = { resource: Resource; status: string; lastStartedAt: string | null; lastSyncedAt: string | null; lastRunCount: number; error: string; pending: boolean; mode: string | null; fullCompletedAt: string | null; records: number };
type StatusData = {
  config: { syncConfigured: boolean; webhookConfigured: boolean; publicBookingConfigured: boolean; webhookNotificationUrl: string; externalLocationId: string; apiVersion: string };
  webhookEventTypes: string[];
  resources: ResourceState[];
  totals: { customers: number; linkedCustomers: number; payments: number; refunds: number; orders: number; team: number; bookings: number; last30Days: { grossCents: number; refundedCents: number; payments: number } };
  recentEvents: Array<{ id: string; eventType: string; status: string; error: string; createdAt: string; processedAt: string | null }>;
  canManage: boolean;
};
type Spend = { paymentCount: number; grossCents: number; refundedCents: number; lastPaymentAt: string | null; firstPaymentAt: string | null };
type Customer = { id: string; clientId: string | null; displayName: string; emailAddress: string; phoneNumber: string; note: string; referenceId: string; birthday: string; address: Record<string, string>; creationSource: string; emailUnsubscribed: boolean; groupIds: string[]; squareCreatedAt: string; squareUpdatedAt: string; deleted: boolean; clientName: string | null; clientEmail: string | null; clientPhone: string | null; spend: Spend };
type LineItem = { name: string; quantity: string; variationName: string; totalCents: number };
type CustomerPayment = { id: string; status: string; sourceType: string; cardBrand: string; cardLast4: string; amountCents: number; tipCents: number; totalCents: number; refundedCents: number; taxCents: number; currency: string; receiptNumber: string; receiptUrl: string; note: string; applicationName: string; squareCreatedAt: string; sourceName: string | null; lineItems: LineItem[] };
type CustomerBooking = { id: string; status: string; source: string; startAt: string; durationMinutes: number; sellerNote: string; customerNote: string; creatorType: string; appointmentId: string | null; appointmentStatus: string | null; petName: string | null };
type CustomerDetail = { customer: Customer; payments: CustomerPayment[]; bookings: CustomerBooking[] };
type SalePayment = CustomerPayment & { tender: string; processingFeeCents: number; discountCents: number; clientName: string | null; clientId: string | null; deviceName: string; entryMethod: string };
type SalesData = {
  range: { from: string; to: string };
  location: { timezone: string; currency: string };
  totals: { payments: number; grossCents: number; tipsCents: number; taxCents: number; discountCents: number; feesCents: number; refundsCents: number; netCents: number; netSalesCents: number; otherStatuses: number };
  byTender: Array<{ label: string; count: number; amountCents: number }>;
  bySource: Array<{ label: string; count: number; amountCents: number }>;
  byDay: Array<{ day: string; amountCents: number; count: number }>;
  payments: SalePayment[];
  refunds: Array<{ id: string; paymentId: string; status: string; amountCents: number; reason: string; currency: string; squareCreatedAt: string }>;
};
type SquareBooking = { id: string; status: string; source: string; startAt: string; durationMinutes: number; sellerNote: string; customerNote: string; creatorType: string; creatorName: string; locationType: string; squareCreatedAt: string; appointmentId: string | null; appointmentStatus: string | null; petName: string | null; customerName: string; clientId: string | null; serviceName: string | null; staffName: string | null };
type TeamMember = { id: string; staffId: string | null; displayName: string; emailAddress: string; phoneNumber: string; status: string; isOwner: boolean; assignedLocations: { assignment_type?: string; location_ids?: string[] }; squareCreatedAt: string; staffName: string | null; staffRole: string | null; staffActive: boolean | null; sales: { payments: number; grossCents: number } };

const resourceLabels: Record<Resource, string> = { bookings: "Reservations", customers: "Customers", team: "Team members", orders: "Orders", payments: "Payments", refunds: "Refunds" };
const resourceHelp: Record<Resource, string> = {
  bookings: "Square Appointments bookings become appointments here. Recent weeks are refreshed every hour; older history is filled in a month at a time.",
  customers: "The whole Square customer directory, linked to Coat & Care clients by email or phone. Square never overwrites a client; a new one is created when nothing matches.",
  team: "Square team members, linked to teammates by email or name.",
  orders: "What each sale contained: items, quantities, taxes, discounts and how it was fulfilled.",
  payments: "Every payment Square processed: terminal, point of sale, invoices and the online store, with tip, tax share and processing fee.",
  refunds: "Every refund Square issued, tied to its payment.",
};

function money(cents: number, currency = "CAD") { return new Intl.NumberFormat("en-CA", { style: "currency", currency }).format(cents / 100); }
function when(value: string | null | undefined, timeZone: string, withTime = true) {
  if (!value) return "—";
  const date = new Date(value.includes("T") ? value : `${value.replace(" ", "T")}Z`);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("en-CA", { timeZone, month: "short", day: "numeric", year: "numeric", ...(withTime ? { hour: "numeric", minute: "2-digit" } : {}) }).format(date);
}
function dayKey(date: Date, timeZone: string) { return new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(date); }
function shiftDay(day: string, days: number) { const date = new Date(`${day}T12:00:00Z`); date.setUTCDate(date.getUTCDate() + days); return date.toISOString().slice(0, 10); }
function title(value: string) { return value.toLowerCase().replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase()); }
function sourceLabel(value: string) {
  return ({ FIRST_PARTY_MERCHANT: "Booked by the salon", FIRST_PARTY_BUYER: "Booked online by the client", THIRD_PARTY_BUYER: "Booked through a partner", API: "Booked through the website" } as Record<string, string>)[value] || (value ? title(value) : "—");
}
function creationLabel(value: string) {
  return ({ DIRECTORY: "Added in Square", APPOINTMENTS: "Square Appointments", ONLINE_STORE: "Online store", THIRD_PARTY: "Website", THIRD_PARTY_IMPORT: "Import", TERMINAL: "Terminal", INSTANT_PROFILE: "Receipt profile", INVOICES: "Invoices", LOYALTY: "Loyalty", MERGE: "Merged", UNMERGE_RECOVERY: "Recovered", EGIFTING: "Gift card", EMAIL_COLLECTION: "Email sign-up", FEEDBACK: "Feedback", IMPORT: "Import", MARKETING: "Marketing", COUPON: "Coupon" } as Record<string, string>)[value] || (value ? title(value) : "Square");
}
async function json<T>(response: Response) { const result = await response.json() as T & { error?: string }; if (!response.ok) throw new Error(result.error || "Something went wrong."); return result; }

export function SquareView({ notify, timezone, currency, permissions, role }: { notify: (message: string) => void; timezone: string; currency: string; permissions: string[]; role: string }) {
  const isManager = ["owner", "manager"].includes(role);
  const tabs = useMemo(() => [
    ...(isManager && permissions.includes("settings") ? [["overview", "Connection & sync"]] : []),
    ...(permissions.includes("clients") ? [["customers", "Customers"]] : []),
    ...(permissions.includes("finance") && ["owner", "manager", "receptionist", "accountant"].includes(role) ? [["sales", "Sales & refunds"]] : []),
    ...(permissions.includes("calendar") ? [["bookings", "Reservations"]] : []),
    ...(isManager && permissions.includes("settings") ? [["team", "Team"]] : []),
  ] as Array<[string, string]>, [isManager, permissions, role]);
  const [chosenTab, setTab] = useState("");
  const tab = tabs.some(([key]) => key === chosenTab) ? chosenTab : tabs[0]?.[0] || "";
  if (!tabs.length) return <section className="business-panel"><div className="directory-empty detail">Your access does not include Square data.</div></section>;
  return <section className="settings-shell square-shell">
    <nav className="settings-tabs" aria-label="Square sections">{tabs.map(([key, label]) => <button aria-current={tab === key ? "page" : undefined} className={tab === key ? "active" : ""} key={key} onClick={() => setTab(key)}>{label}</button>)}</nav>
    {tab === "overview" && <SquareOverview notify={notify} timezone={timezone} currency={currency} />}
    {tab === "customers" && <SquareCustomers timezone={timezone} currency={currency} />}
    {tab === "sales" && <SquareSales timezone={timezone} currency={currency} />}
    {tab === "bookings" && <SquareBookings timezone={timezone} />}
    {tab === "team" && <SquareTeam timezone={timezone} currency={currency} />}
  </section>;
}

function SquareOverview({ notify, timezone, currency }: { notify: (message: string) => void; timezone: string; currency: string }) {
  const [data, setData] = useState<StatusData | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState("");
  const [rounds, setRounds] = useState(0);
  const load = useCallback(() => fetch("/api/integrations/square", { cache: "no-store" }).then((response) => json<StatusData>(response)).then((result) => { setData(result); setError(""); }).catch((reason) => setError(reason instanceof Error ? reason.message : "Square status unavailable.")), []);
  useEffect(() => { void load(); }, [load]);
  const run = useCallback(async (resource: string, full = false) => {
    setBusy(resource); setError("");
    try {
      // A long first import stops at the function budget and continues on the
      // next call; keep calling while a resource reports it is not finished.
      let next: StatusData | null = null;
      for (let round = 0; round < 8; round += 1) {
        setRounds(round + 1);
        const result = await json<{ status: StatusData; results: Array<{ resource: string; error?: string }> }>(await fetch("/api/integrations/square", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ resource, full: full && round === 0 }) }));
        next = result.status;
        setData(next);
        const failed = result.results.find((item) => item.error);
        if (failed) { setError(`${resourceLabels[failed.resource as Resource] || failed.resource}: ${failed.error}`); break; }
        const stillPending = next.resources.filter((item) => item.pending && (resource === "all" || item.resource === resource) && item.resource !== "bookings");
        if (!stillPending.length) break;
      }
      notify(resource === "all" ? "Square data synchronized" : `${resourceLabels[resource as Resource] || resource} synchronized`);
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Square synchronization failed."); }
    finally { setBusy(""); setRounds(0); }
  }, [notify]);
  if (!data) return <section className="settings-loading" role={error ? "alert" : "status"}>{error ? <>{error} <button onClick={() => void load()}>Try again</button></> : "Loading the Square connection…"}</section>;
  const { config } = data;
  const connected = config.syncConfigured;
  return <div className="square-overview">
    {error && <p className="settings-error" role="alert">{error}</p>}
    <article className="settings-card">
      <header><h2>Square connection</h2><p>Square stays the source of truth for the calendar, the till and the online store. Coat & Care mirrors it so every customer, sale and reservation is visible here.</p></header>
      <div className="square-connection">
        <div className={connected ? "ready" : "pending"}><span>{connected ? "✓" : "!"}</span><div><strong>{connected ? "Access token configured" : "No Square access token"}</strong><small>{connected ? `API version ${config.apiVersion}${config.externalLocationId ? ` · location ${config.externalLocationId}` : " · every Square location"}` : "Set SQUARE_ACCESS_TOKEN (and SQUARE_LOCATION_ID) in the deployment’s environment variables, then redeploy."}</small></div></div>
        <div className={config.webhookConfigured ? "ready" : "pending"}><span>{config.webhookConfigured ? "✓" : "!"}</span><div><strong>{config.webhookConfigured ? "Webhooks verified" : "Webhooks not configured"}</strong><small>{config.webhookConfigured ? `Square notifies ${config.webhookNotificationUrl} the moment something changes.` : "Set SQUARE_WEBHOOK_SIGNATURE_KEY and DELIVERY_PUBLIC_URL, then register the endpoint in the Square Developer dashboard. Until then the hourly sync still runs."}</small></div></div>
        <div className={config.publicBookingConfigured ? "ready" : "neutral"}><span>{config.publicBookingConfigured ? "✓" : "○"}</span><div><strong>{config.publicBookingConfigured ? "Website booking writes to Square" : "Website booking in read-only mode"}</strong><small>{config.publicBookingConfigured ? "Online reservations are created directly in Square Appointments." : "Set SQUARE_BOOKING_MODE=api once the token has Appointments write access."}</small></div></div>
      </div>
      <details className="square-events-help"><summary>Webhook events to subscribe in Square ({data.webhookEventTypes.length})</summary><p>In the Square Developer dashboard, subscribe this endpoint to:</p><code>{data.webhookEventTypes.join(", ")}</code><p>The token needs read access to Customers, Orders, Payments, Team and Appointments (plus Items for the online store admin).</p></details>
    </article>
    <div className="report-metrics square-metrics">
      <article><span>Square customers</span><strong>{data.totals.customers}</strong><small>{data.totals.linkedCustomers} linked to a client file</small></article>
      <article><span>Sales · last 30 days</span><strong>{money(data.totals.last30Days.grossCents - data.totals.last30Days.refundedCents, currency)}</strong><small>{data.totals.last30Days.payments} payments{data.totals.last30Days.refundedCents ? ` · ${money(data.totals.last30Days.refundedCents, currency)} refunded` : ""}</small></article>
      <article><span>Reservations mirrored</span><strong>{data.totals.bookings}</strong><small>{data.totals.orders} orders · {data.totals.refunds} refunds</small></article>
      <article><span>Team members</span><strong>{data.totals.team}</strong><small>From Square’s roster</small></article>
    </div>
    <article className="settings-card">
      <header className="square-sync-head"><div><h2>Synchronization</h2><p>Runs every hour on its own and after every Square webhook. Run it now after changing the configuration or to pull the history for the first time.</p></div>{data.canManage && <div className="square-sync-actions"><button className="primary-button" disabled={Boolean(busy) || !connected} onClick={() => void run("all")}>{busy === "all" ? `Synchronizing… (${rounds})` : "Sync everything now"}</button></div>}</header>
      <div className="square-resource-table">
        <div className="square-resource-head"><span>Data</span><span>Records</span><span>Last completed</span><span>State</span><span /></div>
        {data.resources.map((item) => <div className={`square-resource-row ${item.status}`} key={item.resource}>
          <span><strong>{resourceLabels[item.resource]}</strong><small>{resourceHelp[item.resource]}</small></span>
          <span>{item.records.toLocaleString("en-CA")}</span>
          <span>{when(item.lastSyncedAt, timezone)}{item.lastRunCount ? <small>{item.lastRunCount} read last run</small> : null}</span>
          <span><i className={`square-state ${item.status}${item.pending ? " pending" : ""}`}>{item.status === "failed" ? "Failed" : item.pending ? (item.mode === "full" ? "Importing history…" : "Continuing…") : item.status === "running" ? "Running" : item.status === "succeeded" ? "Up to date" : "Never run"}</i>{item.error && <small className="square-error">{item.error}</small>}</span>
          <span>{data.canManage && <>
            <button className="text-button" disabled={Boolean(busy) || !connected} onClick={() => void run(item.resource)}>{busy === item.resource ? `Running… (${rounds})` : "Sync"}</button>
            {item.resource !== "bookings" && item.resource !== "team" && <button className="text-button" disabled={Boolean(busy) || !connected} onClick={() => { if (window.confirm(`Re-read all ${resourceLabels[item.resource].toLowerCase()} from Square? Existing records are refreshed, nothing is deleted here.`)) void run(item.resource, true); }}>Full refresh</button>}
          </>}</span>
        </div>)}
      </div>
    </article>
    <article className="settings-card">
      <header><h2>Recent webhook deliveries</h2><p>Each event Square sent, and what happened to it. A failed event is retried by Square and covered by the hourly sync.</p></header>
      {data.recentEvents.length ? <div className="square-event-list">{data.recentEvents.map((event) => <div key={event.id}><i className={`square-state ${event.status}`}>{title(event.status)}</i><strong>{event.eventType}</strong><small>{when(event.createdAt, timezone)}</small>{event.error && <em>{event.error}</em>}</div>)}</div> : <div className="report-empty">No Square webhook has reached this deployment yet.</div>}
    </article>
  </div>;
}

function SquareCustomers({ timezone, currency }: { timezone: string; currency: string }) {
  const [query, setQuery] = useState("");
  const [customers, setCustomers] = useState<Customer[] | null>(null);
  const [selectedId, setSelectedId] = useState("");
  const [detail, setDetail] = useState<CustomerDetail | null>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    let cancelled = false;
    const timer = window.setTimeout(() => {
      fetch(`/api/integrations/square/customers?query=${encodeURIComponent(query)}&limit=80`, { cache: "no-store" }).then((response) => json<{ customers: Customer[] }>(response)).then((result) => { if (cancelled) return; setCustomers(result.customers); setError(""); setSelectedId((current) => result.customers.some((item) => item.id === current) ? current : result.customers[0]?.id || ""); }).catch((reason) => { if (!cancelled) setError(reason instanceof Error ? reason.message : "Square customers unavailable."); });
    }, 200);
    return () => { cancelled = true; window.clearTimeout(timer); };
  }, [query]);
  useEffect(() => {
    if (!selectedId) return;
    let cancelled = false;
    fetch(`/api/integrations/square/customers?id=${encodeURIComponent(selectedId)}`, { cache: "no-store" }).then((response) => json<CustomerDetail>(response)).then((result) => { if (!cancelled) setDetail(result); }).catch((reason) => { if (!cancelled) setError(reason instanceof Error ? reason.message : "Square customer unavailable."); });
    return () => { cancelled = true; };
  }, [selectedId]);
  const selected = detail?.customer.id === selectedId ? detail : null;
  return <section className="directory-panel square-customers">
    <div className="directory-toolbar"><div><h2>Square customer directory</h2><p>{customers ? `${customers.length}${customers.length >= 80 ? "+" : ""} customers${query ? " matching" : ""} · newest first` : "Loading…"}</p></div><label><span>⌕</span><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search name, email, phone, note or reference" aria-label="Search Square customers" /></label></div>
    {error && <p className="inline-error" role="alert">{error}</p>}
    <div className="directory-layout">
      <div className="client-list">{!customers ? <div className="dashboard-loading"><span /><span /><span /></div> : customers.length ? customers.map((customer) => <button className={customer.id === selectedId ? "selected" : ""} key={customer.id} onClick={() => setSelectedId(customer.id)}><span className="client-avatar">{customer.displayName.slice(0, 2).toUpperCase()}</span><span><strong>{customer.displayName}</strong><small>{customer.emailAddress || customer.phoneNumber || creationLabel(customer.creationSource)}{customer.spend.paymentCount ? ` · ${money(customer.spend.grossCents - customer.spend.refundedCents, currency)}` : ""}</small></span><em title={customer.clientId ? "Linked to a client file" : "Not linked to a client file"}>{customer.clientId ? "✓" : "–"}</em></button>) : <div className="directory-empty">No Square customer matches. Run the customer sync from Connection & sync if the directory is empty.</div>}</div>
      <div className="client-detail">{selected ? <>
        <header><span className="client-avatar large">{selected.customer.displayName.slice(0, 2).toUpperCase()}</span><div><h2>{selected.customer.displayName}</h2><p>{[selected.customer.emailAddress, selected.customer.phoneNumber].filter(Boolean).join(" · ") || "No contact details in Square"}</p></div><span className={selected.customer.clientId ? "consent yes" : "consent"}>{selected.customer.clientId ? `Client file: ${selected.customer.clientName}` : "No client file linked"}</span></header>
        <dl className="square-facts">
          <div><dt>In Square since</dt><dd>{when(selected.customer.squareCreatedAt, timezone, false)}</dd></div>
          <div><dt>Created through</dt><dd>{creationLabel(selected.customer.creationSource)}</dd></div>
          <div><dt>Lifetime in Square</dt><dd>{money(selected.customer.spend.grossCents - selected.customer.spend.refundedCents, currency)} · {selected.customer.spend.paymentCount} payment{selected.customer.spend.paymentCount === 1 ? "" : "s"}</dd></div>
          <div><dt>Last payment</dt><dd>{when(selected.customer.spend.lastPaymentAt, timezone, false)}</dd></div>
          {selected.customer.birthday && <div><dt>Birthday</dt><dd>{selected.customer.birthday}</dd></div>}
          {selected.customer.referenceId && <div><dt>Reference</dt><dd>{selected.customer.referenceId}</dd></div>}
          {Object.values(selected.customer.address).some(Boolean) && <div><dt>Address</dt><dd>{[selected.customer.address.address_line_1, selected.customer.address.address_line_2, selected.customer.address.locality, selected.customer.address.administrative_district_level_1, selected.customer.address.postal_code].filter(Boolean).join(", ")}</dd></div>}
          <div><dt>Email marketing</dt><dd>{selected.customer.emailUnsubscribed ? "Unsubscribed in Square" : "Allowed in Square"}</dd></div>
          {selected.customer.deleted && <div><dt>Status</dt><dd>Deleted or merged in Square</dd></div>}
        </dl>
        {selected.customer.note && <section className="square-note"><strong>Square note</strong><p>{selected.customer.note}</p></section>}
        <section className="square-history"><h3>Payments in Square</h3>{selected.payments.length ? <div className="square-table"><div className="square-table-head"><span>Date</span><span>Items</span><span>Tender</span><span>Total</span></div>{selected.payments.map((payment) => <div className={`square-table-row ${payment.status !== "COMPLETED" ? "muted" : ""}`} key={payment.id}><span>{when(payment.squareCreatedAt, timezone)}<small>{payment.sourceName || payment.applicationName || "Square"}{payment.receiptNumber ? ` · #${payment.receiptNumber}` : ""}</small></span><span>{payment.lineItems.length ? payment.lineItems.map((line) => `${line.quantity !== "1" ? `${line.quantity} × ` : ""}${line.name}${line.variationName && line.variationName !== "Regular" ? ` (${line.variationName})` : ""}`).join(", ") : payment.note || "—"}</span><span>{payment.sourceType === "CARD" ? `${title(payment.cardBrand || "card")}${payment.cardLast4 ? ` ·${payment.cardLast4}` : ""}` : title(payment.sourceType || "—")}{payment.status !== "COMPLETED" && <small>{title(payment.status)}</small>}</span><span><strong>{money(payment.totalCents, payment.currency)}</strong>{payment.tipCents ? <small>incl. {money(payment.tipCents, payment.currency)} tip</small> : null}{payment.refundedCents ? <small>−{money(payment.refundedCents, payment.currency)} refunded</small> : null}{payment.receiptUrl && <a href={payment.receiptUrl} target="_blank" rel="noreferrer">Receipt</a>}</span></div>)}</div> : <div className="report-empty">No Square payment on file for this customer.</div>}</section>
        <section className="square-history"><h3>Reservations in Square</h3>{selected.bookings.length ? <div className="square-table"><div className="square-table-head"><span>When</span><span>Pet & service</span><span>Source</span><span>Status</span></div>{selected.bookings.map((booking) => <div className="square-table-row" key={booking.id}><span>{when(booking.startAt, timezone)}<small>{booking.durationMinutes} min</small></span><span>{booking.petName || "Pet to assign"}{booking.sellerNote && <small>Note: {booking.sellerNote}</small>}{booking.customerNote && <small>Client: {booking.customerNote}</small>}</span><span>{sourceLabel(booking.source)}</span><span><i className={`square-state ${booking.status.toLowerCase()}`}>{title(booking.status)}</i>{booking.appointmentStatus && <small>Here: {title(booking.appointmentStatus)}</small>}</span></div>)}</div> : <div className="report-empty">No Square reservation on file for this customer.</div>}</section>
      </> : <div className="directory-empty detail">{selectedId ? "Loading…" : "Choose a customer to see what Square holds."}</div>}</div>
    </div>
  </section>;
}

function SquareSales({ timezone, currency }: { timezone: string; currency: string }) {
  const [today] = useState(() => dayKey(new Date(), timezone));
  const [from, setFrom] = useState(() => shiftDay(dayKey(new Date(), timezone), -29));
  const [to, setTo] = useState(today);
  const [query, setQuery] = useState("");
  const [data, setData] = useState<SalesData | null>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    let cancelled = false;
    const timer = window.setTimeout(() => {
      fetch(`/api/integrations/square/sales?from=${from}&to=${to}&query=${encodeURIComponent(query)}`, { cache: "no-store" }).then((response) => json<SalesData>(response)).then((result) => { if (!cancelled) { setData(result); setError(""); } }).catch((reason) => { if (!cancelled) setError(reason instanceof Error ? reason.message : "Square sales unavailable."); });
    }, 150);
    return () => { cancelled = true; window.clearTimeout(timer); };
  }, [from, to, query]);
  const cur = data?.location.currency || currency;
  const maxDay = Math.max(1, ...(data?.byDay.map((item) => item.amountCents) || [1]));
  function preset(days: number) { setData(null); setTo(today); setFrom(shiftDay(today, -days + 1)); }
  return <section className="business-panel square-sales">
    <div className="business-toolbar"><div><h2>Square sales & refunds</h2><p>Every payment Square processed for this location, in the salon’s time zone. Compare the totals with Square’s own reports.</p></div><div className="intelligence-range square-range"><div><button onClick={() => preset(1)}>Today</button><button onClick={() => preset(7)}>7D</button><button onClick={() => preset(30)}>30D</button><button onClick={() => preset(90)}>90D</button><button onClick={() => preset(365)}>1Y</button></div><label>From<input type="date" value={from} max={to} onChange={(event) => { setData(null); setFrom(event.target.value); }} /></label><label>To<input type="date" value={to} min={from} onChange={(event) => { setData(null); setTo(event.target.value); }} /></label></div></div>
    {error && <p className="inline-error" role="alert">{error}</p>}
    {!data ? <div className="dashboard-loading" role="status" aria-label="Loading Square sales"><span /><span /><span /></div> : <>
      <div className="report-metrics square-metrics"><article><span>Collected</span><strong>{money(data.totals.grossCents, cur)}</strong><small>{data.totals.payments} completed payments</small></article><article><span>Refunds</span><strong>{money(data.totals.refundsCents, cur)}</strong><small>{data.refunds.length} refunds · net {money(data.totals.netCents, cur)}</small></article><article><span>Tips</span><strong>{money(data.totals.tipsCents, cur)}</strong><small>Paid out to the team</small></article><article><span>Tax collected</span><strong>{money(data.totals.taxCents, cur)}</strong><small>From the orders behind each payment</small></article><article><span>Net sales</span><strong>{money(data.totals.netSalesCents, cur)}</strong><small>After refunds, tips and tax</small></article><article><span>Processing fees</span><strong>{money(data.totals.feesCents, cur)}</strong><small>Kept by Square</small></article></div>
      <div className="square-breakdowns">
        <section className="closeout-card"><header><div><h3>By tender</h3><p>How clients paid</p></div></header><div className="tender-breakdown">{data.byTender.length ? data.byTender.map((item) => <div key={item.label}><span>{item.label} <small>({item.count})</small></span><strong>{money(item.amountCents, cur)}</strong></div>) : <div className="report-empty">No payment in this range.</div>}</div></section>
        <section className="closeout-card"><header><div><h3>By channel</h3><p>Terminal, point of sale, invoices, online store</p></div></header><div className="tender-breakdown">{data.bySource.map((item) => <div key={item.label}><span>{item.label} <small>({item.count})</small></span><strong>{money(item.amountCents, cur)}</strong></div>)}</div></section>
        <section className="closeout-card square-days"><header><div><h3>By day</h3><p>Collected per business day</p></div></header><div className="sales-bars">{data.byDay.map((item) => <div key={item.day} title={`${item.day}: ${money(item.amountCents, cur)} · ${item.count} payments`}><span style={{ height: `${Math.max(3, item.amountCents / maxDay * 100)}%` }} /><small>{data.byDay.length <= 31 ? item.day.slice(5) : item.day.endsWith("01") ? item.day.slice(5) : ""}</small></div>)}</div></section>
      </div>
      <section className="square-history"><div className="square-list-head"><h3>Payments</h3><label className="square-search"><span>⌕</span><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Client, receipt, item or last 4 digits" aria-label="Search Square payments" /></label></div>
        {data.payments.length ? <div className="square-table wide"><div className="square-table-head"><span>Date</span><span>Client</span><span>Items</span><span>Tender</span><span>Tip</span><span>Fee</span><span>Total</span></div>{data.payments.map((payment) => <div className={`square-table-row ${payment.status !== "COMPLETED" ? "muted" : ""}`} key={payment.id}><span>{when(payment.squareCreatedAt, timezone)}<small>{payment.sourceName || payment.applicationName || "Square"}{payment.receiptNumber ? ` · #${payment.receiptNumber}` : ""}</small></span><span>{payment.clientName || <em>Walk-in</em>}</span><span>{payment.lineItems.length ? payment.lineItems.map((line) => `${line.quantity !== "1" ? `${line.quantity} × ` : ""}${line.name}`).join(", ") : payment.note || "—"}</span><span>{payment.tender}{payment.cardLast4 ? <small>·{payment.cardLast4} {payment.entryMethod ? title(payment.entryMethod) : ""}</small> : null}{payment.status !== "COMPLETED" && <small>{title(payment.status)}</small>}</span><span>{payment.tipCents ? money(payment.tipCents, cur) : "—"}</span><span>{payment.processingFeeCents ? money(payment.processingFeeCents, cur) : "—"}</span><span><strong>{money(payment.totalCents, cur)}</strong>{payment.refundedCents ? <small>−{money(payment.refundedCents, cur)} refunded</small> : null}{payment.receiptUrl && <a href={payment.receiptUrl} target="_blank" rel="noreferrer">Receipt</a>}</span></div>)}</div> : <div className="report-empty">No Square payment in this range. If Square has sales here, run the sync from Connection & sync.</div>}
      </section>
      {data.refunds.length > 0 && <section className="square-history"><h3>Refunds</h3><div className="square-table"><div className="square-table-head"><span>Date</span><span>Reason</span><span>Status</span><span>Amount</span></div>{data.refunds.map((refund) => <div className="square-table-row" key={refund.id}><span>{when(refund.squareCreatedAt, timezone)}</span><span>{refund.reason || "—"}</span><span>{title(refund.status)}</span><span><strong>−{money(refund.amountCents, refund.currency)}</strong></span></div>)}</div></section>}
      <p className="books-disclaimer">Square payments are imported automatically. Record a payment in an appointment’s checkout only when the money was not taken through Square, otherwise it is counted twice in the finance views.</p>
    </>}
  </section>;
}

function SquareBookings({ timezone }: { timezone: string }) {
  const [today] = useState(() => dayKey(new Date(), timezone));
  const [from, setFrom] = useState(() => shiftDay(dayKey(new Date(), timezone), -7));
  const [to, setTo] = useState(() => shiftDay(dayKey(new Date(), timezone), 30));
  const [data, setData] = useState<{ bookings: SquareBooking[] } | null>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    let cancelled = false;
    fetch(`/api/integrations/square/bookings?from=${from}&to=${to}`, { cache: "no-store" }).then((response) => json<{ bookings: SquareBooking[] }>(response)).then((result) => { if (!cancelled) { setData(result); setError(""); } }).catch((reason) => { if (!cancelled) setError(reason instanceof Error ? reason.message : "Square reservations unavailable."); });
    return () => { cancelled = true; };
  }, [from, to]);
  const counts = useMemo(() => { const map = new Map<string, number>(); for (const booking of data?.bookings || []) map.set(booking.status, (map.get(booking.status) || 0) + 1); return [...map.entries()]; }, [data]);
  return <section className="business-panel square-bookings">
    <div className="business-toolbar"><div><h2>Reservations in Square</h2><p>Square’s status, source and notes for every booking, next to the appointment it became here.</p></div><div className="intelligence-range square-range"><div><button onClick={() => { setData(null); setFrom(shiftDay(today, -7)); setTo(shiftDay(today, 30)); }}>Upcoming</button><button onClick={() => { setData(null); setFrom(shiftDay(today, -30)); setTo(today); }}>Past 30D</button><button onClick={() => { setData(null); setFrom(shiftDay(today, -365)); setTo(today); }}>Past year</button></div><label>From<input type="date" value={from} max={to} onChange={(event) => { setData(null); setFrom(event.target.value); }} /></label><label>To<input type="date" value={to} min={from} onChange={(event) => { setData(null); setTo(event.target.value); }} /></label></div></div>
    {error && <p className="inline-error" role="alert">{error}</p>}
    {!data ? <div className="dashboard-loading" role="status" aria-label="Loading Square reservations"><span /><span /><span /></div> : <>
      <div className="square-chips">{counts.map(([status, count]) => <span key={status} className={`square-state ${status.toLowerCase()}`}>{title(status)} · {count}</span>)}{!counts.length && <span className="square-state">No reservation in this range</span>}</div>
      {data.bookings.length > 0 && <div className="square-table wide"><div className="square-table-head"><span>When</span><span>Client & pet</span><span>Service · groomer</span><span>Source</span><span>Notes</span><span>Square status</span><span>Here</span></div>{data.bookings.map((booking) => <div className="square-table-row" key={booking.id}><span>{when(booking.startAt, timezone)}<small>{booking.durationMinutes} min · booked {when(booking.squareCreatedAt, timezone, false)}</small></span><span><strong>{booking.customerName}</strong><small>{booking.petName || "Pet to assign"}</small></span><span>{booking.serviceName || "—"}<small>{booking.staffName || "Any team member"}</small></span><span>{sourceLabel(booking.source)}{booking.creatorName && <small>by {booking.creatorName}</small>}</span><span>{booking.sellerNote && <small>Salon: {booking.sellerNote}</small>}{booking.customerNote && <small>Client: {booking.customerNote}</small>}{!booking.sellerNote && !booking.customerNote && "—"}</span><span><i className={`square-state ${booking.status.toLowerCase()}`}>{title(booking.status)}</i></span><span>{booking.appointmentStatus ? title(booking.appointmentStatus) : <em>Not imported</em>}</span></div>)}</div>}
    </>}
  </section>;
}

function SquareTeam({ timezone, currency }: { timezone: string; currency: string }) {
  const [data, setData] = useState<{ members: TeamMember[] } | null>(null);
  const [error, setError] = useState("");
  useEffect(() => { fetch("/api/integrations/square/team", { cache: "no-store" }).then((response) => json<{ members: TeamMember[] }>(response)).then(setData).catch((reason) => setError(reason instanceof Error ? reason.message : "Square team unavailable.")); }, []);
  return <section className="business-panel">
    <div className="business-toolbar"><div><h2>Square team</h2><p>Who is on the Square roster, who they are here, and what each has rung up. Add teammates and permissions from Team; this view only reads Square.</p></div></div>
    {error && <p className="inline-error" role="alert">{error}</p>}
    {!data ? <div className="dashboard-loading" role="status" aria-label="Loading Square team"><span /><span /><span /></div> : data.members.length ? <div className="square-table wide"><div className="square-table-head"><span>Team member</span><span>Contact</span><span>Square status</span><span>Linked teammate</span><span>Sales rung up</span><span>Since</span></div>{data.members.map((member) => <div className={`square-table-row ${member.status !== "ACTIVE" ? "muted" : ""}`} key={member.id}><span><strong>{member.displayName}</strong>{member.isOwner && <small>Square account owner</small>}</span><span>{member.emailAddress || "—"}<small>{member.phoneNumber}</small></span><span><i className={`square-state ${member.status.toLowerCase()}`}>{title(member.status)}</i>{member.assignedLocations.assignment_type === "ALL_CURRENT_AND_FUTURE_LOCATIONS" ? <small>All locations</small> : null}</span><span>{member.staffName ? <>{member.staffName}<small>{title(member.staffRole || "")}{member.staffActive === false ? " · inactive" : ""}</small></> : <em>Not matched — add them in Team with the same email</em>}</span><span>{member.sales.payments ? <>{money(member.sales.grossCents, currency)}<small>{member.sales.payments} payments</small></> : "—"}</span><span>{when(member.squareCreatedAt, timezone, false)}</span></div>)}</div> : <div className="report-empty">No Square team member imported yet. Run the team sync from Connection & sync.</div>}
  </section>;
}
