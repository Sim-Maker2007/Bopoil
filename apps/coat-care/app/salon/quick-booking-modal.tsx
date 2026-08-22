"use client";

import { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";

type Service = { id: string; name: string; durationMinutes: number; priceFromCents: number; active: boolean };
type Slot = { startsAt: string; endsAt: string; staff: Array<{ id: string; name: string }> };
type ClientMatch = {
  id: string;
  fullName: string;
  email: string;
  phone: string;
  pets: Array<{ id: string; name: string; breed: string }>;
};
type AvailabilityPayload = {
  slots?: Slot[];
  timezone?: string;
  bookingWindowEnd?: string;
  hasMore?: boolean;
  nextFrom?: string | null;
  error?: string;
};

function dayKey(value: string, timezone: string) {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(new Date(value));
  const values = Object.fromEntries(parts.filter((part) => part.type !== "literal").map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}
function dayLabel(value: string, timezone: string) { return new Intl.DateTimeFormat("en-CA", { timeZone: timezone, weekday: "short", month: "short", day: "numeric" }).format(new Date(value)); }
function timeLabel(value: string, timezone: string) { return new Intl.DateTimeFormat("en-CA", { timeZone: timezone, hour: "numeric", minute: "2-digit" }).format(new Date(value)); }
function money(cents: number, currency: string) { return new Intl.NumberFormat(currency === "USD" ? "en-US" : "en-CA", { style: "currency", currency, maximumFractionDigits: 0 }).format(cents / 100); }

export function QuickBookingModal({ currency, onClose, onCreated }: { currency: string; onClose: () => void; onCreated: (message: string) => void }) {
  const dialogRef = useRef<HTMLFormElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const availabilityRequest = useRef(0);
  const loadedSlotCount = useRef(0);
  const clientRequest = useRef(0);
  const [services, setServices] = useState<Service[]>([]);
  const [serviceId, setServiceId] = useState("");
  const [slots, setSlots] = useState<Slot[]>([]);
  const [timezone, setTimezone] = useState("America/Toronto");
  const [selectedDay, setSelectedDay] = useState("");
  const [startsAt, setStartsAt] = useState("");
  const [staffId, setStaffId] = useState("");
  const [nextFrom, setNextFrom] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [bookingWindowEnd, setBookingWindowEnd] = useState("");
  const [walkIn, setWalkIn] = useState(false);
  const [clientMode, setClientMode] = useState<"existing" | "new">("existing");
  const [clientQuery, setClientQuery] = useState("");
  const [clientMatches, setClientMatches] = useState<ClientMatch[]>([]);
  const [selectedClient, setSelectedClient] = useState<ClientMatch | null>(null);
  const [selectedPetId, setSelectedPetId] = useState("");
  const [addingPet, setAddingPet] = useState(false);
  const [clientLoading, setClientLoading] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    const dialog = dialogRef.current;
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    closeRef.current?.focus();
    const keydown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !saving) { onClose(); return; }
      if (event.key !== "Tab" || !dialog) return;
      const items = Array.from(dialog.querySelectorAll<HTMLElement>('button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), a[href]'));
      if (!items.length) return;
      const first = items[0], last = items[items.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    };
    window.addEventListener("keydown", keydown);
    return () => { window.removeEventListener("keydown", keydown); document.body.style.overflow = previousOverflow; previousFocus?.focus(); };
  }, [onClose, saving]);

  const loadOpenings = useCallback((nextServiceId: string, options: { reset: boolean; from?: string | null; walkIn: boolean }) => {
    const requestId = availabilityRequest.current + 1;
    availabilityRequest.current = requestId;
    if (options.reset) {
      loadedSlotCount.current = 0;
      setLoading(true);
      setSlots([]);
      setSelectedDay("");
      setStartsAt("");
      setStaffId("");
      setHasMore(false);
      setNextFrom(null);
      setBookingWindowEnd("");
    } else {
      setLoadingMore(true);
    }
    setError("");
    const parameters = new URLSearchParams({ serviceId: nextServiceId, days: "14" });
    if (options.from) parameters.set("from", options.from);
    if (options.walkIn) parameters.set("walkIn", "1");
    return fetch(`/api/appointments?${parameters}`).then(async (response) => {
      const result = await response.json() as AvailabilityPayload;
      if (!response.ok) throw new Error(result.error || "Live openings unavailable.");
      if (availabilityRequest.current !== requestId) return;
      const openings = result.slots || [];
      const zone = result.timezone || "America/Toronto";
      const chooseFirstDay = openings.length > 0 && (options.reset || loadedSlotCount.current === 0);
      setSlots((current) => {
        const combined = options.reset ? openings : [...current, ...openings];
        const unique = [...new Map(combined.map((slot) => [slot.startsAt, slot])).values()].sort((left, right) => left.startsAt.localeCompare(right.startsAt));
        loadedSlotCount.current = unique.length;
        return unique;
      });
      setTimezone(zone);
      setHasMore(result.hasMore === true);
      setNextFrom(result.nextFrom || null);
      setBookingWindowEnd(result.bookingWindowEnd || "");
      if (chooseFirstDay) setSelectedDay(dayKey(openings[0].startsAt, zone));
    }).catch((reason) => {
      if (availabilityRequest.current === requestId) setError(reason instanceof Error ? reason.message : "Live openings unavailable.");
    }).finally(() => {
      if (availabilityRequest.current === requestId) {
        setLoading(false);
        setLoadingMore(false);
      }
    });
  }, []);

  useEffect(() => {
    fetch("/api/services").then(async (response) => {
      const result = await response.json() as { services?: Service[]; error?: string };
      if (!response.ok) throw new Error(result.error || "Services unavailable.");
      const active = (result.services || []).filter((service) => service.active);
      const firstServiceId = active[0]?.id || "";
      setServices(active);
      setServiceId(firstServiceId);
      if (firstServiceId) void loadOpenings(firstServiceId, { reset: true, walkIn: false });
      else setLoading(false);
    }).catch((reason) => { setError(reason instanceof Error ? reason.message : "Services unavailable."); setLoading(false); });
  }, [loadOpenings]);

  useEffect(() => {
    if (clientMode !== "existing" || clientQuery.trim().length < 2 || (selectedClient && clientQuery === selectedClient.fullName)) return;
    const requestId = clientRequest.current + 1;
    clientRequest.current = requestId;
    const timer = window.setTimeout(() => {
      setClientLoading(true);
      fetch(`/api/appointments?clientQuery=${encodeURIComponent(clientQuery.trim())}`).then(async (response) => {
        const result = await response.json() as { clients?: ClientMatch[]; error?: string };
        if (!response.ok) throw new Error(result.error || "Client search unavailable.");
        if (clientRequest.current === requestId) setClientMatches(result.clients || []);
      }).catch((reason) => {
        if (clientRequest.current === requestId) setError(reason instanceof Error ? reason.message : "Client search unavailable.");
      }).finally(() => {
        if (clientRequest.current === requestId) setClientLoading(false);
      });
    }, 220);
    return () => window.clearTimeout(timer);
  }, [clientMode, clientQuery, selectedClient]);

  const days = useMemo(() => Array.from(new Set(slots.map((slot) => dayKey(slot.startsAt, timezone)))), [slots, timezone]);
  const daySlots = slots.filter((slot) => dayKey(slot.startsAt, timezone) === selectedDay);
  const selectedService = services.find((service) => service.id === serviceId);
  const selectedSlot = slots.find((slot) => slot.startsAt === startsAt);
  const selectedPet = selectedClient?.pets.find((pet) => pet.id === selectedPetId);
  const clientReady = clientMode === "new" || Boolean(selectedClient && (selectedPet || addingPet));

  function chooseClient(client: ClientMatch) {
    setSelectedClient(client);
    setSelectedPetId(client.pets[0]?.id || "");
    setAddingPet(client.pets.length === 0);
    setClientQuery(client.fullName);
    setClientMatches([]);
  }

  function changeClientMode(mode: "existing" | "new") {
    clientRequest.current += 1;
    setClientMode(mode);
    setError("");
    setClientLoading(false);
    setClientMatches([]);
    if (mode === "new") {
      setSelectedClient(null);
      setSelectedPetId("");
      setAddingPet(false);
    }
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (loading || !selectedService || !selectedSlot || !selectedSlot.staff.some((person) => person.id === staffId)) { setError("Choose a current live opening before booking."); return; }
    if (!clientReady) { setError("Choose an existing client and pet, or add a new profile."); return; }
    setSaving(true);
    setError("");
    const form = new FormData(event.currentTarget);
    const profile = clientMode === "existing"
      ? addingPet
        ? { clientId: selectedClient?.id, addPetToExisting: true, petName: form.get("existingPetName"), breed: form.get("existingPetBreed") }
        : { clientId: selectedClient?.id, petId: selectedPetId }
      : { clientName: form.get("clientName"), email: form.get("email"), phone: form.get("phone"), petName: form.get("petName"), breed: form.get("breed") };
    try {
      const response = await fetch("/api/appointments", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ...profile, clientNotes: form.get("clientNotes"), serviceId, staffId, startsAt, walkIn }),
      });
      const result = await response.json() as { appointment?: { petName: string; staffName: string }; error?: string; code?: string };
      if (!response.ok) {
        if (result.code === "existing_client_selection_required") {
          const identity = String(form.get("email") || form.get("phone") || "").trim();
          changeClientMode("existing");
          setClientQuery(identity);
        } else if (result.code === "existing_pet_selection_required") {
          setAddingPet(false);
          setSelectedPetId(selectedClient?.pets.find((pet) => pet.name.toLowerCase() === String(form.get("existingPetName") || "").trim().toLowerCase())?.id || selectedClient?.pets[0]?.id || "");
        }
        throw new Error(result.error || "Appointment could not be created.");
      }
      onCreated(`${result.appointment?.petName || "Appointment"} ${walkIn ? "checked in" : "booked"} with ${result.appointment?.staffName || "the team"}`);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Appointment could not be created.");
      setSaving(false);
    }
  }

  return <div className="modal-backdrop quick-booking-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget && !saving) onClose(); }}>
    <form ref={dialogRef} className="business-modal quick-booking-modal" role="dialog" aria-modal="true" aria-labelledby="quick-booking-title" aria-describedby="quick-booking-description" onSubmit={submit}>
      <header><div><span className="eyebrow">Front desk booking</span><h2 id="quick-booking-title">Add an appointment</h2><p id="quick-booking-description">Live capacity, without leaving the workspace. Find the client once, then confirm.</p></div><button ref={closeRef} type="button" aria-label="Close quick booking" onClick={onClose} disabled={saving}>×</button></header>
      {error && <p className="booking-error" role="alert">{error}</p>}
      <section className="quick-booking-section"><div className="quick-booking-step"><span>1</span><div><strong>Choose the visit</strong><small>Only openings the salon can safely hold are shown.</small></div></div>
        <label>Service<select value={serviceId} onChange={(event) => { const nextServiceId = event.target.value; setServiceId(nextServiceId); void loadOpenings(nextServiceId, { reset: true, walkIn }); }} disabled={loading || saving}>{services.length ? services.map((service) => <option key={service.id} value={service.id}>{service.name} · {service.durationMinutes} min · {money(service.priceFromCents, currency)}</option>) : <option value="">No active services</option>}</select></label>
        <label><input type="checkbox" checked={walkIn} onChange={(event) => { const nextWalkIn = event.target.checked; setWalkIn(nextWalkIn); if (serviceId) void loadOpenings(serviceId, { reset: true, walkIn: nextWalkIn }); }} disabled={loading || saving} /> Walk-in here now <small>Uses the next safe opening without the public booking lead time.</small></label>
        {days.length > 0 && <label>Date<select value={selectedDay} onChange={(event) => { setSelectedDay(event.target.value); setStartsAt(""); setStaffId(""); }}>{days.map((day) => { const example = slots.find((slot) => dayKey(slot.startsAt, timezone) === day)!; return <option key={day} value={day}>{dayLabel(example.startsAt, timezone)}</option>; })}</select></label>}
        <div className="quick-time-grid" aria-label="Available appointment times" aria-busy={loading}>{loading ? <span className="quick-loading" role="status">Checking live openings…</span> : daySlots.length ? daySlots.map((slot) => <button type="button" className={startsAt === slot.startsAt ? "selected" : ""} aria-pressed={startsAt === slot.startsAt} key={slot.startsAt} onClick={() => { setStartsAt(slot.startsAt); setStaffId(slot.staff[0]?.id || ""); }}><strong>{timeLabel(slot.startsAt, timezone)}</strong><small>{slot.staff.map((person) => person.name).join(" or ")}</small></button>) : <span className="quick-loading" role="status">No openings in these dates. Load more or try another service.</span>}</div>
        {selectedSlot && selectedSlot.staff.length > 1 && <label>Groomer<select value={staffId} onChange={(event) => setStaffId(event.target.value)}>{selectedSlot.staff.map((person) => <option key={person.id} value={person.id}>{person.name}</option>)}</select></label>}
        {hasMore && nextFrom && <button type="button" className="secondary-button" disabled={loadingMore || loading} onClick={() => void loadOpenings(serviceId, { reset: false, from: nextFrom, walkIn })}>{loadingMore ? "Loading…" : "Load more dates"}</button>}
        {bookingWindowEnd && <small>Booking window ends {bookingWindowEnd}.</small>}
      </section>
      <section className="quick-booking-section"><div className="quick-booking-step"><span>2</span><div><strong>Client &amp; pet</strong><small>Reuse the verified salon profile or explicitly create a new one.</small></div></div>
        <div role="group" aria-label="Client type"><button type="button" className={clientMode === "existing" ? "secondary-button selected" : "secondary-button"} aria-pressed={clientMode === "existing"} onClick={() => changeClientMode("existing")}>Existing client</button><button type="button" className={clientMode === "new" ? "secondary-button selected" : "secondary-button"} aria-pressed={clientMode === "new"} onClick={() => changeClientMode("new")}>New client</button></div>
        {clientMode === "existing" ? <>
          <label>Search by name, phone, email, pet, or breed<input value={clientQuery} onChange={(event) => { const value = event.target.value; setClientQuery(value); setSelectedClient(null); setSelectedPetId(""); setAddingPet(false); if (value.trim().length < 2) { clientRequest.current += 1; setClientMatches([]); setClientLoading(false); } }} autoComplete="off" placeholder="Start typing…" /></label>
          {clientLoading && <small role="status">Searching salon profiles…</small>}
          {clientMatches.length > 0 && <div className="client-list" role="listbox" aria-label="Matching clients">{clientMatches.map((client) => <button type="button" role="option" aria-selected={selectedClient?.id === client.id} key={client.id} onClick={() => chooseClient(client)}><span className="client-avatar">{client.fullName.slice(0, 2).toUpperCase()}</span><span><strong>{client.fullName}</strong><small>{client.phone} · {client.pets.map((pet) => pet.name).join(", ") || "No pets"}</small></span></button>)}</div>}
          {selectedClient && <div><strong>{selectedClient.fullName}</strong><small>{selectedClient.email} · {selectedClient.phone}</small>
            {!addingPet && selectedClient.pets.length > 0 && <label>Pet<select value={selectedPetId} onChange={(event) => setSelectedPetId(event.target.value)}>{selectedClient.pets.map((pet) => <option key={pet.id} value={pet.id}>{pet.name} · {pet.breed}</option>)}</select></label>}
            {addingPet && <div className="field-pair"><label>New pet name<input name="existingPetName" required maxLength={80} /></label><label>Breed<input name="existingPetBreed" maxLength={100} placeholder="Optional" /></label></div>}
            <button type="button" className="secondary-button" onClick={() => { setAddingPet((current) => !current); if (addingPet && selectedClient.pets.length) setSelectedPetId(selectedClient.pets[0].id); }}>
              {addingPet && selectedClient.pets.length ? "Choose a saved pet" : addingPet ? "Cancel new pet" : "Add another pet"}
            </button>
          </div>}
        </> : <>
          <div className="field-pair"><label>Client name<input name="clientName" autoComplete="name" required maxLength={100} /></label><label>Pet name<input name="petName" required maxLength={80} /></label></div>
          <div className="field-pair"><label>Email<input name="email" type="email" autoComplete="email" required /></label><label>Phone<input name="phone" type="tel" autoComplete="tel" required /></label></div>
          <label>Breed<input name="breed" maxLength={100} placeholder="Optional" /></label>
        </>}
        <label>Visit notes<textarea name="clientNotes" maxLength={1000} placeholder="Requests, coat notes, or front-desk context" /></label>
      </section>
      <div className="quick-booking-summary"><span>✓</span><p><strong>Staff-created and auditable.</strong> Profile ownership and capacity are rechecked when you confirm. It does not record client policy consent.</p></div>
      <div className="modal-actions"><button type="button" className="secondary-button" onClick={onClose} disabled={saving}>Cancel</button><button type="submit" className="primary-button" disabled={loading || !selectedSlot || !staffId || !clientReady || saving}>{saving ? "Booking…" : walkIn ? "Check in walk-in" : selectedService ? `Book ${selectedService.name}` : "Book appointment"}</button></div>
    </form>
  </div>;
}
