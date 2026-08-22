"use client";

import { useCallback, useEffect, useRef, useState } from "react";

type Match = { startsAt: string; endsAt: string; timeLabel: string; date: string; staffName: string };
type Entry = { id: string; clientName: string; email: string; phone: string; petName: string; breed: string; serviceName: string; preferredFrom: string; preferredTo: string; timePreference: string; status: string; clientNotes: string; staffNotes: string; createdAt: string; matches: Match[] };
type Payload = { entries: Entry[]; summary: { waiting: number; contacted: number; matched: number }; timezone: string; refreshedAt: string };

function day(day: string) { return new Intl.DateTimeFormat("en-CA", { weekday: "short", month: "short", day: "numeric", timeZone: "UTC" }).format(new Date(`${day}T12:00:00Z`)); }
function age(value: string) { const days = Math.max(0, Math.floor((Date.now() - new Date(value).getTime()) / 86400000)); return days === 0 ? "Joined today" : `${days} day${days === 1 ? "" : "s"} waiting`; }

export function WaitlistView({ notify, onMatchedCount }: { notify: (message: string) => void; onMatchedCount?: (count: number) => void }) {
  const requestId = useRef(0);
  const [data, setData] = useState<Payload | null>(null); const [error, setError] = useState(""); const [busy, setBusy] = useState("");
  const load = useCallback(async () => {
    const currentRequest = requestId.current + 1; requestId.current = currentRequest;
    try {
      const response = await fetch("/api/waitlist/manage", { cache: "no-store" }); const result = await response.json() as Payload & { error?: string };
      if (!response.ok) throw new Error(result.error || "Waitlist unavailable");
      if (requestId.current !== currentRequest) return;
      setError(""); setData(result); onMatchedCount?.(result.summary.matched);
    } catch (reason) {
      if (requestId.current === currentRequest) setError(reason instanceof Error ? reason.message : "Waitlist unavailable");
    }
  }, [onMatchedCount]);
  useEffect(() => {
    const refresh = () => { void load(); };
    const initial = window.setTimeout(refresh, 0);
    const interval = window.setInterval(refresh, 30_000);
    const onVisibility = () => { if (document.visibilityState === "visible") refresh(); };
    window.addEventListener("focus", refresh);
    window.addEventListener("salon:schedule-changed", refresh);
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      window.clearTimeout(initial); window.clearInterval(interval);
      window.removeEventListener("focus", refresh);
      window.removeEventListener("salon:schedule-changed", refresh);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [load]);
  async function update(entry: Entry, action: "contacted" | "closed" | "restore" | "book", startsAt?: string) {
    if (action === "book" && !window.confirm(`Book ${entry.petName} into this live opening? A confirmation will be queued for ${entry.clientName}.`)) return;
    setBusy(`${entry.id}:${startsAt || action}`); setError("");
    try { const response = await fetch("/api/waitlist/manage", { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ waitlistId: entry.id, action, startsAt, staffNotes: entry.staffNotes }) }); const result = await response.json() as { error?: string }; if (!response.ok) throw new Error(result.error || "Waitlist could not be updated"); await load(); notify(action === "book" ? `${entry.petName} is booked — confirmation queued` : action === "closed" ? "Request closed" : action === "restore" ? "Request restored" : `${entry.clientName} marked contacted`); }
    catch (reason) { setError(reason instanceof Error ? reason.message : "Waitlist could not be updated"); } finally { setBusy(""); }
  }
  return <section className="waitlist-panel">
    <div className="waitlist-toolbar"><div><span className="eyebrow">Demand recovery</span><h2>Priority waitlist</h2><p>Turn unavailable dates into confirmed appointments when safe capacity opens.</p>{data?.refreshedAt && <small aria-live="polite">{data.summary.matched} live match{data.summary.matched === 1 ? "" : "es"} · refreshed {new Intl.DateTimeFormat("en-CA", { hour: "numeric", minute: "2-digit" }).format(new Date(data.refreshedAt))}</small>}</div><button className="secondary-button" onClick={() => void load()} disabled={Boolean(busy)}>↻ Refresh matches</button></div>
    {data && <div className="waitlist-metrics"><article><span>Waiting</span><strong>{data.summary.waiting}</strong><small>Active requests</small></article><article><span>Ready to match</span><strong>{data.summary.matched}</strong><small>Live openings found</small></article><article><span>Contacted</span><strong>{data.summary.contacted}</strong><small>Awaiting decision</small></article></div>}
    {error && <p className="booking-error" role="alert">{error}</p>}
    {!data ? <div className="dashboard-loading"><span/><span/><span/></div> : data.entries.length ? <div className="waitlist-list">{data.entries.map((entry) => <article className="waitlist-card" key={entry.id}>
      <header><span className="pet-avatar coral">{entry.petName.slice(0, 1)}</span><div><strong>{entry.petName} · {entry.serviceName}</strong><small>{entry.breed} · {entry.clientName}</small></div><span className={`waitlist-state ${entry.status}`}>{entry.status}</span></header>
      <div className="waitlist-preferences"><span><small>Preferred window</small><strong>{day(entry.preferredFrom)}–{day(entry.preferredTo)}</strong></span><span><small>Time</small><strong>{entry.timePreference}</strong></span><span><small>Priority</small><strong>{age(entry.createdAt)}</strong></span></div>
      {entry.clientNotes && <p className="waitlist-note">“{entry.clientNotes}”</p>}
      <div className="waitlist-contact"><a href={`tel:${entry.phone}`}>{entry.phone}</a><a href={`mailto:${entry.email}`}>{entry.email}</a></div>
      <section className={entry.matches.length ? "waitlist-matches ready" : "waitlist-matches"}><div><strong>{entry.matches.length ? "Live matches" : "No matching opening yet"}</strong><small>{entry.matches.length ? "Capacity, equipment, skills, and preferences all checked." : "Refresh after a cancellation or schedule change."}</small></div>{entry.matches.length > 0 && <div>{entry.matches.map((match) => <button key={match.startsAt} disabled={Boolean(busy)} onClick={() => void update(entry, "book", match.startsAt)}><span>{day(match.date)}</span><strong>{match.timeLabel}</strong><small>{match.staffName}</small></button>)}</div>}</section>
      <footer>{entry.status === "waiting" ? <button disabled={Boolean(busy)} onClick={() => void update(entry, "contacted")}>Mark contacted</button> : <button disabled={Boolean(busy)} onClick={() => void update(entry, "restore")}>Return to waiting</button>}<button className="quiet-danger" disabled={Boolean(busy)} onClick={() => void update(entry, "closed")}>Close request</button></footer>
    </article>)}</div> : <div className="waitlist-empty"><span>♡</span><h3>No one is waiting.</h3><p>When a preferred day is full, client requests will land here automatically.</p></div>}
  </section>;
}
