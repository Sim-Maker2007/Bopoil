"use client";

import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";

type Locale = "en" | "fr";
type LocationOption = { id: string; name: string; label?: string };
type Shift = { id: string; workDate: string; locationId?: string | null; locationName: string; startTime: string; endTime: string; tips: number; paidMinutes?: number };
type Week = { id: string; weekStartsOn: string; status: "draft" | "submitted" | "approved"; revision: number; submittedAt: string | null };
type SheetData = { employee: { displayName: string }; organizationName?: string; currency?: string; locations: string[]; locationOptions?: LocationOption[]; week: Week; shifts: Shift[] };
type EmployeeLocation = { id: string; name: string; timezone: string; currency: string };
type Warning = { id: string; category: string; severity: string; title: string; details: string };
type CareContext = { coatCondition: string; styleNotes: string; productsUsed: string; internalNotes: string; clientReport: string; reportPublished: boolean; updatedAt: string };
type CareDraft = { coatCondition: string; styleNotes: string; productsUsed: string; internalNotes: string };
type DayAppointment = {
  id: string; locationId: string; locationName: string; timezone: string; startsAt: string; endsAt: string; status: string;
  clientNotes: string; petId: string; petName: string; breed: string; weightKg: number | null; petNotes: string;
  handlingNotes: string; safetyLevel: string; serviceName: string; warnings: Warning[]; care: CareContext | null;
  nextStage: string | null; careEditable: boolean;
};
type ClockState = { id: string; locationId: string; staffId: string; status: "clocked_in" | "clocked_out"; openEntryId: string | null; updatedAt: string };
type ClockEntry = { id: string; locationId: string; locationName: string; clockIn: string; clockOut: string | null; breakMinutes: number; status: string };
type DayData = {
  employee: { displayName: string };
  date: string;
  locations: EmployeeLocation[];
  appointments: DayAppointment[];
  clock: { states: ClockState[]; recentEntries: ClockEntry[] };
};

const translations = {
  en: {
    employeeSpace: "Employee space", signOut: "Sign out", hello: "Hello", myDay: "My Day", timesheet: "Timesheet",
    dayIntro: "Your assigned pets, safety context, and time clock in one place.", noAppointments: "No pets are assigned to you today.",
    noAppointmentsDetail: "When the schedule changes, refresh My Day to see the latest assignments.", refresh: "Refresh",
    clock: "Time clock", clockIn: "Clock in", clockOut: "Clock out", clockedIn: "You’re clocked in.",
    clockedOut: "Ready when you are.", chooseLocation: "Location", breakMinutes: "Unpaid break minutes",
    recentPunches: "Recent punches", noPunches: "No recent punches.", now: "Now", submitted: "Submitted",
    assignedCare: "Assigned care", safety: "Safety & handling", standard: "Standard care", noSafety: "No special handling guidance.",
    visitNotes: "Visit notes", noVisitNotes: "No visit notes.", careContext: "Care context", noCare: "No care record has been started for this visit.",
    coat: "Coat", style: "Style", products: "Products", internal: "Team note", clientReport: "Client report",
    advanceTo: "Advance visit", editCare: "Edit care notes", addCare: "Add care notes", closeEditor: "Close",
    coatCondition: "Coat condition", styleNotes: "Style notes", productsUsed: "Products used", teamNotes: "Team notes",
    saveCare: "Save care notes", savingCare: "Saving…", stageUpdated: "Visit stage updated.", careSaved: "Care notes saved.",
    stageUpdateError: "The visit stage could not be updated.", careSaveError: "Care notes could not be saved.",
    carePrivacy: "These notes stay with the salon. Client reports and approvals are handled by authorized staff.",
    weekTitle: "My timesheet", weekIntro: "Enter your shifts, check the total, then submit the week.",
    draft: "Draft", approved: "Approved", weekOf: "Week of", previousWeek: "Previous week", nextWeek: "Next week",
    lockedTitle: "This week is locked.", lockedSubmitted: "A manager must reopen it before you can make a correction.",
    lockedApproved: "A manager approved this week and added it to the payroll time ledger.",
    noAssignedLocation: "No active location is assigned to your employee profile. Ask a manager to assign one before adding shifts.",
    location: "Location", start: "Start", end: "End", tips: "Tips", remove: "Remove", addShift: "Add shift",
    weekTotal: "Week total", saveDraft: "Save draft", saving: "Saving…", submitWeek: "Submit week", submitting: "Submitting…",
    correctionHelp: "Need a correction after submission? A manager can reopen your week.", loading: "Loading your employee space…",
    retry: "Try again", loadError: "Your employee space could not be loaded.", saved: "Draft saved.",
    submittedNotice: "Week submitted to your manager.", confirmSubmit: "Submit this week? You will need a manager to reopen it before making changes.",
    clockedInNotice: "Clocked in.", clockedOutNotice: "Clocked out and sent for manager review.", portal: "Team portal",
    loginTitle: "Employee access", loginIntro: "Use the employee code from your setup link and your personal PIN.",
    employeeCode: "Employee code", pin: "Six-digit PIN", signingIn: "Signing in…", signIn: "Open employee space",
    secure: "Personal, secure access", status: "Status", loginInvalid: "Invalid employee code or PIN.",
    loginLocked: "Access temporarily locked. Try again in 15 minutes.", loginPin: "The PIN must contain exactly six digits.",
  },
  fr: {
    employeeSpace: "Espace employé", signOut: "Déconnexion", hello: "Bonjour", myDay: "Ma journée", timesheet: "Feuille de temps",
    dayIntro: "Tes animaux assignés, les consignes de sécurité et l’horodateur au même endroit.", noAppointments: "Aucun animal ne t’est assigné aujourd’hui.",
    noAppointmentsDetail: "Si l’horaire change, actualise Ma journée pour voir les dernières assignations.", refresh: "Actualiser",
    clock: "Horodateur", clockIn: "Commencer", clockOut: "Terminer", clockedIn: "Ton quart est en cours.",
    clockedOut: "Prêt quand tu l’es.", chooseLocation: "Emplacement", breakMinutes: "Pause non payée (minutes)",
    recentPunches: "Pointages récents", noPunches: "Aucun pointage récent.", now: "Maintenant", submitted: "Soumise",
    assignedCare: "Soins assignés", safety: "Sécurité et manipulation", standard: "Soins standards", noSafety: "Aucune consigne spéciale.",
    visitNotes: "Notes de visite", noVisitNotes: "Aucune note de visite.", careContext: "Contexte de soins", noCare: "Aucun dossier de soins commencé pour cette visite.",
    coat: "Pelage", style: "Style", products: "Produits", internal: "Note d’équipe", clientReport: "Rapport client",
    advanceTo: "Faire avancer la visite", editCare: "Modifier les notes", addCare: "Ajouter des notes", closeEditor: "Fermer",
    coatCondition: "État du pelage", styleNotes: "Notes de style", productsUsed: "Produits utilisés", teamNotes: "Notes d’équipe",
    saveCare: "Enregistrer les notes", savingCare: "Enregistrement…", stageUpdated: "Étape de la visite mise à jour.", careSaved: "Notes de soins enregistrées.",
    stageUpdateError: "L’étape de la visite n’a pas pu être mise à jour.", careSaveError: "Les notes de soins n’ont pas pu être enregistrées.",
    carePrivacy: "Ces notes restent au salon. Les rapports clients et les approbations sont gérés par le personnel autorisé.",
    weekTitle: "Ma feuille de temps", weekIntro: "Entre tes quarts, vérifie le total, puis soumets ta semaine.",
    draft: "Brouillon", approved: "Approuvée", weekOf: "Semaine du", previousWeek: "Semaine précédente", nextWeek: "Semaine suivante",
    lockedTitle: "Cette semaine est verrouillée.", lockedSubmitted: "La direction doit la rouvrir avant une correction.",
    lockedApproved: "La direction a approuvé cette semaine et l’a ajoutée au registre de paie.",
    noAssignedLocation: "Aucun emplacement actif n’est assigné à ton profil. Demande à la direction d’en assigner un avant d’ajouter des quarts.",
    location: "Emplacement", start: "Début", end: "Fin", tips: "Pourboires", remove: "Supprimer", addShift: "Ajouter un quart",
    weekTotal: "Total de la semaine", saveDraft: "Enregistrer le brouillon", saving: "Enregistrement…", submitWeek: "Soumettre ma semaine", submitting: "Soumission…",
    correctionHelp: "Besoin d’une correction après la soumission? La direction peut rouvrir ta semaine.", loading: "Chargement de ton espace employé…",
    retry: "Réessayer", loadError: "Ton espace employé n’a pas pu être chargé.", saved: "Brouillon enregistré.",
    submittedNotice: "Semaine soumise à la direction.", confirmSubmit: "Soumettre cette semaine? La direction devra la rouvrir avant toute modification.",
    clockedInNotice: "Quart commencé.", clockedOutNotice: "Quart terminé et envoyé à la direction.", portal: "Portail de l’équipe",
    loginTitle: "Accès employé", loginIntro: "Utilise le code reçu avec ton lien d’activation et ton NIP personnel.",
    employeeCode: "Code employé", pin: "NIP à six chiffres", signingIn: "Connexion…", signIn: "Ouvrir mon espace",
    secure: "Accès personnel et sécurisé", status: "Statut", loginInvalid: "Code employé ou NIP invalide.",
    loginLocked: "Accès temporairement bloqué. Réessaie dans 15 minutes.", loginPin: "Le NIP doit contenir exactement six chiffres.",
  },
} as const;

function dateAdd(value: string, amount: number) { const date = new Date(`${value}T12:00:00Z`); date.setUTCDate(date.getUTCDate() + amount); return date.toISOString().slice(0, 10); }
function monday(value = new Date().toISOString().slice(0, 10)) { const date = new Date(`${value}T12:00:00Z`); date.setUTCDate(date.getUTCDate() - ((date.getUTCDay() + 6) % 7)); return date.toISOString().slice(0, 10); }
function duration(shift: Shift) { const [sh, sm] = shift.startTime.split(":").map(Number); const [eh, em] = shift.endTime.split(":").map(Number); return Number.isFinite(sh + sm + eh + em) ? Math.max(0, eh * 60 + em - sh * 60 - sm) : 0; }
function hours(minutes: number) { return `${Math.floor(minutes / 60)} h ${String(minutes % 60).padStart(2, "0")}`; }
function money(value: number, currency: string, locale: Locale) { return new Intl.NumberFormat(locale === "fr" ? "fr-CA" : "en-CA", { style: "currency", currency }).format(value || 0); }
function initials(value: string) { return value.split(/\s+/).filter(Boolean).map((word) => word[0]).join("").slice(0, 2).toUpperCase() || "EP"; }
function readable(value: string) { return value.replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase()); }
function stageLabel(value: string, locale: Locale) {
  const labels: Record<Locale, Record<string, string>> = {
    en: { requested: "Requested", confirmed: "Confirmed", arrived: "Arrived", bathing: "Bathing", drying: "Drying", grooming: "Grooming", quality_check: "Quality check", ready: "Ready for pickup", completed: "Completed" },
    fr: { requested: "Demandé", confirmed: "Confirmé", arrived: "Arrivé", bathing: "Bain", drying: "Séchage", grooming: "Toilettage", quality_check: "Contrôle qualité", ready: "Prêt pour le départ", completed: "Terminé" },
  };
  return labels[locale][value] || readable(value);
}
function stageAction(value: string, locale: Locale) {
  const labels: Record<Locale, Record<string, string>> = {
    en: { arrived: "Mark arrived", bathing: "Start bathing", drying: "Start drying", grooming: "Start grooming", quality_check: "Send to quality check", ready: "Ready for pickup" },
    fr: { arrived: "Marquer arrivé", bathing: "Commencer le bain", drying: "Commencer le séchage", grooming: "Commencer le toilettage", quality_check: "Passer au contrôle qualité", ready: "Prêt pour le départ" },
  };
  return labels[locale][value] || stageLabel(value, locale);
}
function coatLabel(value: string, locale: Locale) {
  const labels: Record<Locale, Record<string, string>> = {
    en: { not_assessed: "Not assessed", healthy: "Healthy", tangled: "Tangled", matted: "Matted", severely_matted: "Severely matted", skin_concern: "Skin concern" },
    fr: { not_assessed: "Non évalué", healthy: "Sain", tangled: "Emmêlé", matted: "Feutré", severely_matted: "Très feutré", skin_concern: "Problème de peau" },
  };
  return labels[locale][value] || readable(value);
}

export function EmployeePortal({ initiallySignedIn }: { initiallySignedIn: boolean }) {
  const [signedIn, setSignedIn] = useState(initiallySignedIn);
  const [locale, setLocale] = useState<Locale>("en");
  const [tab, setTab] = useState<"day" | "timesheet">("day");
  const [weekStart, setWeekStart] = useState(monday());
  const [sheet, setSheet] = useState<SheetData | null>(null);
  const [day, setDay] = useState<DayData | null>(null);
  const [shifts, setShifts] = useState<Shift[]>([]);
  const [selectedLocationId, setSelectedLocationId] = useState("");
  const [breakMinutes, setBreakMinutes] = useState(0);
  const [careEditor, setCareEditor] = useState("");
  const [careDrafts, setCareDrafts] = useState<Record<string, CareDraft>>({});
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const t = translations[locale];

  useEffect(() => {
    const timer = window.setTimeout(() => {
      const saved = window.localStorage.getItem("employee-locale");
      setLocale(saved === "fr" || (!saved && navigator.language.toLowerCase().startsWith("fr")) ? "fr" : "en");
    }, 0);
    return () => window.clearTimeout(timer);
  }, []);
  function chooseLocale(next: Locale) { setLocale(next); window.localStorage.setItem("employee-locale", next); }

  const loadSheet = useCallback(async () => {
    const response = await fetch(`/api/employee/timesheet?week=${weekStart}`, { cache: "no-store" });
    const body = await response.json() as SheetData & { error?: string };
    if (response.status === 401) { setSignedIn(false); setSheet(null); return; }
    if (!response.ok) throw new Error(body.error || "Timesheet unavailable.");
    setSheet(body); setShifts(body.shifts); setSignedIn(true);
  }, [weekStart]);

  const loadDay = useCallback(async () => {
    const response = await fetch("/api/employee/day", { cache: "no-store" });
    const body = await response.json() as DayData & { error?: string };
    if (response.status === 401) { setSignedIn(false); setDay(null); return; }
    if (!response.ok) throw new Error(body.error || "My Day unavailable.");
    setDay(body);
    const active = body.clock.states.find((state) => state.status === "clocked_in");
    setSelectedLocationId((current) => active?.locationId || (body.locations.some((location) => location.id === current) ? current : body.locations[0]?.id || ""));
    setSignedIn(true);
  }, []);

  useEffect(() => {
    if (!signedIn) return;
    let cancelled = false;
    const timer = window.setTimeout(() => {
      setLoading(true); setError("");
      Promise.all([loadSheet(), loadDay()]).catch((reason) => { if (!cancelled) setError(reason instanceof Error ? reason.message : t.loadError); }).finally(() => { if (!cancelled) setLoading(false); });
    }, 0);
    return () => { cancelled = true; window.clearTimeout(timer); };
  }, [signedIn, loadSheet, loadDay, t.loadError]);

  const totals = useMemo(() => ({ minutes: shifts.reduce((sum, shift) => sum + duration(shift), 0), tips: shifts.reduce((sum, shift) => sum + Number(shift.tips || 0), 0) }), [shifts]);
  const activeClock = day?.clock.states.find((state) => state.status === "clocked_in") || null;
  const clockLocationId = activeClock?.locationId || selectedLocationId;

  function addShift(workDate: string) {
    if (!sheet || sheet.week.status !== "draft") return;
    const options = sheet.locationOptions?.length ? sheet.locationOptions : sheet.locations.map((name) => ({ id: "", name }));
    const location = options[0];
    if (!location) { setError(t.noAssignedLocation); return; }
    setShifts((current) => [...current, { id: crypto.randomUUID(), workDate, locationId: location.id || null, locationName: location.name, startTime: "09:00", endTime: "17:00", tips: 0 }]);
  }
  function change(id: string, values: Partial<Shift>) { setShifts((current) => current.map((shift) => shift.id === id ? { ...shift, ...values } : shift)); }

  async function save(showNotice = true) {
    if (!sheet) return null;
    setBusy("save"); setError("");
    try {
      const response = await fetch("/api/employee/timesheet", { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ weekStartsOn: sheet.week.weekStartsOn, revision: sheet.week.revision, shifts }) });
      const body = await response.json() as { week?: Week; error?: string };
      if (!response.ok || !body.week) throw new Error(body.error || "Timesheet could not be saved.");
      setSheet({ ...sheet, week: body.week });
      if (showNotice) setNotice(t.saved);
      return body.week;
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : t.loadError);
      return null;
    } finally {
      setBusy("");
    }
  }

  async function submitWeek() {
    const saved = await save(false);
    if (!saved || !sheet || !window.confirm(t.confirmSubmit)) return;
    setBusy("submit"); setError("");
    try {
      const response = await fetch("/api/employee/timesheet", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ weekStartsOn: sheet.week.weekStartsOn }) });
      const body = await response.json() as { week?: Week; error?: string };
      if (!response.ok || !body.week) throw new Error(body.error || "Timesheet could not be submitted.");
      setSheet({ ...sheet, week: body.week }); setNotice(t.submittedNotice);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : t.loadError);
    } finally {
      setBusy("");
    }
  }

  async function updateClock() {
    if (!clockLocationId) return;
    setBusy("clock"); setError("");
    try {
      const action = activeClock ? "clock_out" : "clock_in";
      const response = await fetch("/api/employee/clock", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action, locationId: clockLocationId, breakMinutes, idempotencyKey: crypto.randomUUID() }),
      });
      const body = await response.json() as { error?: string };
      if (!response.ok) throw new Error(body.error || "Time clock unavailable.");
      setBreakMinutes(0); setNotice(activeClock ? t.clockedOutNotice : t.clockedInNotice); await loadDay();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Time clock unavailable.");
    } finally {
      setBusy("");
    }
  }

  function openCare(appointment: DayAppointment) {
    if (!appointment.careEditable) return;
    setCareDrafts((current) => current[appointment.id] ? current : {
      ...current,
      [appointment.id]: {
        coatCondition: appointment.care?.coatCondition || "not_assessed",
        styleNotes: appointment.care?.styleNotes || "",
        productsUsed: appointment.care?.productsUsed || "",
        internalNotes: appointment.care?.internalNotes || "",
      },
    });
    setCareEditor((current) => current === appointment.id ? "" : appointment.id);
  }

  function changeCare(appointmentId: string, values: Partial<CareDraft>) {
    setCareDrafts((current) => ({
      ...current,
      [appointmentId]: {
        coatCondition: current[appointmentId]?.coatCondition || "not_assessed",
        styleNotes: current[appointmentId]?.styleNotes || "",
        productsUsed: current[appointmentId]?.productsUsed || "",
        internalNotes: current[appointmentId]?.internalNotes || "",
        ...values,
      },
    }));
  }

  async function advanceStage(appointment: DayAppointment) {
    if (!appointment.nextStage) return;
    setBusy(`stage:${appointment.id}`); setError(""); setNotice("");
    try {
      const response = await fetch("/api/employee/care", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "advance_stage", appointmentId: appointment.id, status: appointment.nextStage }),
      });
      const body = await response.json() as { error?: string };
      if (!response.ok) throw new Error(body.error || t.stageUpdateError);
      await loadDay();
      setNotice(t.stageUpdated);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : t.stageUpdateError);
    } finally {
      setBusy("");
    }
  }

  async function saveCare(appointment: DayAppointment) {
    const draft = careDrafts[appointment.id];
    if (!draft) return;
    setBusy(`care:${appointment.id}`); setError(""); setNotice("");
    try {
      const response = await fetch("/api/employee/care", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          action: "save_care",
          appointmentId: appointment.id,
          expectedUpdatedAt: appointment.care?.updatedAt || null,
          ...draft,
        }),
      });
      const body = await response.json() as { error?: string };
      if (!response.ok) throw new Error(body.error || t.careSaveError);
      await loadDay();
      setCareEditor("");
      setCareDrafts((current) => {
        const next = { ...current };
        delete next[appointment.id];
        return next;
      });
      setNotice(t.careSaved);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : t.careSaveError);
    } finally {
      setBusy("");
    }
  }

  async function logout() { await fetch("/api/employee/session", { method: "DELETE" }); setSignedIn(false); setSheet(null); setDay(null); }
  if (!signedIn) return <EmployeeLogin locale={locale} chooseLocale={chooseLocale} onSuccess={() => setSignedIn(true)} />;
  if ((!sheet || !day) && loading) return <main className="employee-sheet-shell" lang={locale === "fr" ? "fr-CA" : "en-CA"}><div className="employee-loading" role="status">{t.loading}</div></main>;
  if (!sheet || !day) return <main className="employee-sheet-shell" lang={locale === "fr" ? "fr-CA" : "en-CA"}><div className="employee-loading" role="alert"><p>{error || t.loadError}</p><button className="secondary" onClick={() => window.location.reload()}>{t.retry}</button></div></main>;

  const locationOptions: LocationOption[] = sheet.locationOptions?.length ? sheet.locationOptions : sheet.locations.map((name) => ({ id: "", name }));
  const usesStableLocationIds = Boolean(sheet.locationOptions?.length);
  const noAssignedLocations = !locationOptions.length;
  const locked = sheet.week.status !== "draft" || noAssignedLocations;
  const organizationName = sheet.organizationName || "Coat & Care";
  const localeCode = locale === "fr" ? "fr-CA" : "en-CA";
  const dayNames = locale === "fr" ? ["Lundi", "Mardi", "Mercredi", "Jeudi", "Vendredi", "Samedi", "Dimanche"] : ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];
  const clockLocation = day.locations.find((location) => location.id === clockLocationId);

  return <main className="employee-sheet-shell" lang={localeCode}>
    <header className="employee-topbar">
      <div className="employee-brand"><div className="employee-mark small">{initials(organizationName)}</div><div><strong>{organizationName}</strong><small>{t.employeeSpace}</small></div></div>
      <div className="employee-topbar-actions"><LanguageSwitch locale={locale} choose={chooseLocale} /><button onClick={() => void logout()}>{t.signOut}</button></div>
    </header>
    <section className="employee-sheet">
      <div className="employee-sheet-heading"><div><span className="employee-kicker">{t.hello} {sheet.employee.displayName.split(" ")[0]}</span><h1>{tab === "day" ? t.myDay : t.weekTitle}</h1><p>{tab === "day" ? t.dayIntro : t.weekIntro}</p></div></div>
      <nav className="employee-tabs" aria-label={t.employeeSpace}>
        <button className={tab === "day" ? "active" : ""} aria-current={tab === "day" ? "page" : undefined} onClick={() => setTab("day")}>{t.myDay}</button>
        <button className={tab === "timesheet" ? "active" : ""} aria-current={tab === "timesheet" ? "page" : undefined} onClick={() => setTab("timesheet")}>{t.timesheet}</button>
      </nav>
      {notice && <div className="employee-notice" role="status">{notice}<button onClick={() => setNotice("")} aria-label="Close">×</button></div>}
      {error && <div className="employee-error" role="alert">{error}</div>}

      {tab === "day" ? <div className="employee-day-workspace">
        <section className={`employee-clock-card ${activeClock ? "running" : ""}`}>
          <div><span className="employee-kicker">{t.clock}</span><h2>{activeClock ? t.clockedIn : t.clockedOut}</h2><p>{activeClock && clockLocation ? clockLocation.name : new Date(`${day.date}T12:00:00`).toLocaleDateString(localeCode, { weekday: "long", month: "long", day: "numeric" })}</p></div>
          <div className="employee-clock-controls">
            <label>{t.chooseLocation}<select disabled={Boolean(activeClock) || busy === "clock"} value={clockLocationId} onChange={(event) => setSelectedLocationId(event.target.value)}>{day.locations.map((location) => <option value={location.id} key={location.id}>{location.name}</option>)}</select></label>
            {activeClock && <label>{t.breakMinutes}<input disabled={busy === "clock"} type="number" min="0" max="720" value={breakMinutes} onChange={(event) => setBreakMinutes(Number(event.target.value))} /></label>}
            <button disabled={busy === "clock" || !clockLocationId} onClick={() => void updateClock()}>{busy === "clock" ? "…" : activeClock ? t.clockOut : t.clockIn}</button>
          </div>
        </section>
        <div className="employee-day-section-title"><div><h2>{t.assignedCare}</h2><p>{new Date(`${day.date}T12:00:00`).toLocaleDateString(localeCode, { weekday: "long", month: "long", day: "numeric", year: "numeric" })}</p></div><button onClick={() => void loadDay()}>{t.refresh}</button></div>
        {day.appointments.length ? <div className="employee-appointment-list">{day.appointments.map((appointment) => {
          const draft = careDrafts[appointment.id] || {
            coatCondition: appointment.care?.coatCondition || "not_assessed",
            styleNotes: appointment.care?.styleNotes || "",
            productsUsed: appointment.care?.productsUsed || "",
            internalNotes: appointment.care?.internalNotes || "",
          };
          const editingCare = careEditor === appointment.id;
          return <article className={`employee-appointment ${appointment.safetyLevel}`} key={appointment.id}>
            <header><time>{new Intl.DateTimeFormat(localeCode, { timeZone: appointment.timezone, hour: "numeric", minute: "2-digit" }).format(new Date(appointment.startsAt))}</time><div><h3>{appointment.petName}</h3><p>{appointment.breed} · {appointment.serviceName} · {appointment.locationName}</p></div><span>{stageLabel(appointment.status, locale)}</span></header>
            <div className="employee-care-grid">
              <section><h4>{t.safety}</h4>{appointment.handlingNotes || appointment.warnings.length ? <>{appointment.handlingNotes && <p>{appointment.handlingNotes}</p>}{appointment.warnings.map((warning) => <div className={`employee-warning ${warning.severity}`} key={warning.id}><strong>{warning.title}</strong><span>{warning.details}</span></div>)}</> : <p>{t.noSafety}</p>}<small>{appointment.safetyLevel === "standard" ? t.standard : readable(appointment.safetyLevel)}</small></section>
              <section><h4>{t.visitNotes}</h4><p>{appointment.clientNotes || appointment.petNotes || t.noVisitNotes}</p>{appointment.weightKg ? <small>{appointment.weightKg} kg</small> : null}</section>
              <section><h4>{t.careContext}</h4>{appointment.care ? <dl><div><dt>{t.coat}</dt><dd>{coatLabel(appointment.care.coatCondition, locale)}</dd></div>{appointment.care.styleNotes && <div><dt>{t.style}</dt><dd>{appointment.care.styleNotes}</dd></div>}{appointment.care.productsUsed && <div><dt>{t.products}</dt><dd>{appointment.care.productsUsed}</dd></div>}{appointment.care.internalNotes && <div><dt>{t.internal}</dt><dd>{appointment.care.internalNotes}</dd></div>}{appointment.care.clientReport && <div><dt>{t.clientReport}</dt><dd>{appointment.care.clientReport}</dd></div>}</dl> : <p>{t.noCare}</p>}</section>
            </div>
            {(appointment.nextStage || appointment.careEditable) && <div className="employee-appointment-actions">
              {appointment.nextStage && <button className="primary" disabled={Boolean(busy)} onClick={() => void advanceStage(appointment)} aria-label={`${t.advanceTo}: ${stageAction(appointment.nextStage || "", locale)}`}>{busy === `stage:${appointment.id}` ? "…" : stageAction(appointment.nextStage, locale)}</button>}
              {appointment.careEditable && <button className="secondary" disabled={Boolean(busy)} onClick={() => openCare(appointment)}>{editingCare ? t.closeEditor : appointment.care ? t.editCare : t.addCare}</button>}
            </div>}
            {editingCare && <form className="employee-care-editor" onSubmit={(event) => { event.preventDefault(); void saveCare(appointment); }}>
              <div className="employee-care-fields">
                <label>{t.coatCondition}<select value={draft.coatCondition} onChange={(event) => changeCare(appointment.id, { coatCondition: event.target.value })}>{["not_assessed", "healthy", "tangled", "matted", "severely_matted", "skin_concern"].map((condition) => <option value={condition} key={condition}>{coatLabel(condition, locale)}</option>)}</select></label>
                <label>{t.productsUsed}<input maxLength={1200} value={draft.productsUsed} onChange={(event) => changeCare(appointment.id, { productsUsed: event.target.value })} /></label>
                <label className="wide">{t.styleNotes}<textarea maxLength={3000} rows={3} value={draft.styleNotes} onChange={(event) => changeCare(appointment.id, { styleNotes: event.target.value })} /></label>
                <label className="wide">{t.teamNotes}<textarea maxLength={3000} rows={3} value={draft.internalNotes} onChange={(event) => changeCare(appointment.id, { internalNotes: event.target.value })} /></label>
              </div>
              <footer><small>{t.carePrivacy}</small><button disabled={Boolean(busy)}>{busy === `care:${appointment.id}` ? t.savingCare : t.saveCare}</button></footer>
            </form>}
          </article>;
        })}</div> : <div className="employee-empty-day"><strong>{t.noAppointments}</strong><p>{t.noAppointmentsDetail}</p></div>}
        <section className="employee-recent-punches"><h2>{t.recentPunches}</h2>{day.clock.recentEntries.length ? day.clock.recentEntries.map((entry) => { const entryLocation = day.locations.find((location) => location.id === entry.locationId); const timezone = entryLocation?.timezone || "America/Toronto"; return <article key={entry.id}><div><strong>{new Intl.DateTimeFormat(localeCode, { timeZone: timezone, month: "short", day: "numeric" }).format(new Date(entry.clockIn))}</strong><small>{entry.locationName}</small></div><span>{new Intl.DateTimeFormat(localeCode, { timeZone: timezone, hour: "numeric", minute: "2-digit" }).format(new Date(entry.clockIn))} – {entry.clockOut ? new Intl.DateTimeFormat(localeCode, { timeZone: timezone, hour: "numeric", minute: "2-digit" }).format(new Date(entry.clockOut)) : t.now}</span><em>{readable(entry.status)}</em></article>; }) : <p>{t.noPunches}</p>}</section>
      </div> : <>
        <div className="employee-timesheet-heading"><span className={`employee-week-status ${sheet.week.status}`}>{sheet.week.status === "approved" ? `✓ ${t.approved}` : sheet.week.status === "submitted" ? `✓ ${t.submitted}` : t.draft}</span></div>
        <div className="employee-week-picker"><button aria-label={t.previousWeek} onClick={() => setWeekStart(dateAdd(weekStart, -7))}>‹</button><div><small>{t.weekOf}</small><strong>{new Date(`${weekStart}T12:00:00`).toLocaleDateString(localeCode, { day: "numeric", month: "long" })} – {new Date(`${dateAdd(weekStart, 6)}T12:00:00`).toLocaleDateString(localeCode, { day: "numeric", month: "long", year: "numeric" })}</strong></div><button aria-label={t.nextWeek} onClick={() => setWeekStart(dateAdd(weekStart, 7))}>›</button></div>
        {locked && <div className="employee-locked"><span aria-hidden="true">🔒</span><div><strong>{noAssignedLocations ? t.location : t.lockedTitle}</strong><p>{noAssignedLocations ? t.noAssignedLocation : sheet.week.status === "approved" ? t.lockedApproved : t.lockedSubmitted}</p></div></div>}
        <div className="employee-days">{dayNames.map((name, index) => { const date = dateAdd(sheet.week.weekStartsOn, index); const dayShifts = shifts.filter((shift) => shift.workDate === date); const dayMinutes = dayShifts.reduce((sum, shift) => sum + duration(shift), 0); const dayTips = dayShifts.reduce((sum, shift) => sum + Number(shift.tips || 0), 0); return <article className="employee-day" key={date}><header><div><strong>{name}</strong><small>{new Date(`${date}T12:00:00`).toLocaleDateString(localeCode, { day: "numeric", month: "short" })}</small></div><span>{hours(dayMinutes)} · {money(dayTips, sheet.currency || "CAD", locale)}</span></header>{dayShifts.map((shift) => <div className="employee-shift" key={shift.id}><label>{t.location}<select disabled={locked} value={usesStableLocationIds ? shift.locationId || "" : shift.locationName} onChange={(event) => { const location = usesStableLocationIds ? locationOptions.find((option) => option.id === event.target.value) : locationOptions.find((option) => option.name === event.target.value); if (location) change(shift.id, { locationId: usesStableLocationIds ? location.id : null, locationName: location.name }); }}>{usesStableLocationIds && !shift.locationId && <option value="">Choose a location</option>}{locationOptions.map((location) => <option value={usesStableLocationIds ? location.id : location.name} key={location.id || location.name}>{location.label || location.name}</option>)}</select></label><div className="employee-time-row"><label>{t.start}<input disabled={locked} type="time" value={shift.startTime} onChange={(event) => change(shift.id, { startTime: event.target.value })} /></label><span>–</span><label>{t.end}<input disabled={locked} type="time" value={shift.endTime} onChange={(event) => change(shift.id, { endTime: event.target.value })} /></label><label>{t.tips}<input disabled={locked} type="number" min="0" step="0.01" inputMode="decimal" value={shift.tips} onChange={(event) => change(shift.id, { tips: Number(event.target.value) })} /></label></div><footer><strong>{hours(duration(shift))}</strong>{!locked && <button onClick={() => setShifts((current) => current.filter((item) => item.id !== shift.id))}>{t.remove}</button>}</footer></div>)}{!locked && <button className="employee-add-shift" onClick={() => addShift(date)}>＋ {t.addShift}</button>}</article>; })}</div>
        <div className="employee-week-total"><div><small>{t.weekTotal}</small><strong>{hours(totals.minutes)}</strong></div><div><small>{t.tips}</small><strong>{money(totals.tips, sheet.currency || "CAD", locale)}</strong></div></div>
        {!locked && <div className="employee-sheet-actions"><button className="secondary" disabled={Boolean(busy)} onClick={() => void save()}>{busy === "save" ? t.saving : t.saveDraft}</button><button className="primary" disabled={Boolean(busy) || !shifts.length} onClick={() => void submitWeek()}>{busy === "submit" ? t.submitting : t.submitWeek}</button></div>}
        <p className="employee-help">{t.correctionHelp}</p>
      </>}
    </section>
  </main>;
}

function LanguageSwitch({ locale, choose }: { locale: Locale; choose: (locale: Locale) => void }) {
  return <div className="employee-language" aria-label="Language / Langue"><button aria-pressed={locale === "en"} onClick={() => choose("en")}>EN</button><button aria-pressed={locale === "fr"} onClick={() => choose("fr")}>FR</button></div>;
}

function EmployeeLogin({ locale, chooseLocale, onSuccess }: { locale: Locale; chooseLocale: (locale: Locale) => void; onSuccess: () => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const t = translations[locale];
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    setBusy(true); setError("");
    try {
      const response = await fetch("/api/employee/session", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "login", employeeCode: data.get("employeeCode"), pin: data.get("pin") }) });
      const body = await response.json() as { error?: string; code?: string };
      if (!response.ok) {
        const localizedError = body.code === "invalid_credentials"
          ? t.loginInvalid
          : body.code === "temporarily_locked"
            ? t.loginLocked
            : body.code === "invalid_pin"
              ? t.loginPin
              : body.error;
        throw new Error(localizedError || "Sign-in failed.");
      }
      onSuccess();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Sign-in failed.");
    } finally {
      setBusy(false);
    }
  }
  return <main className="employee-auth-shell" lang={locale === "fr" ? "fr-CA" : "en-CA"}><section className="employee-auth-card"><div className="employee-auth-language"><LanguageSwitch locale={locale} choose={chooseLocale} /></div><div className="employee-mark">EP</div><span className="employee-kicker">{t.portal}</span><h1>{t.loginTitle}</h1><p>{t.loginIntro}</p>{error && <div className="employee-error" role="alert">{error}</div>}<form onSubmit={submit}><label>{t.employeeCode}<input name="employeeCode" autoCapitalize="characters" autoCorrect="off" required /></label><label>{t.pin}<input name="pin" type="password" inputMode="numeric" pattern="[0-9]{6}" minLength={6} maxLength={6} autoComplete="current-password" required /></label><button disabled={busy}>{busy ? t.signingIn : t.signIn}</button></form><small className="employee-security">{t.secure}</small></section></main>;
}
