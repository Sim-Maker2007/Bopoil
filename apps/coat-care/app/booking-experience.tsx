"use client";

import { BookingIntake } from "./booking-intake";
import { BookingWelcome, welcomeAlreadySeen } from "./booking-welcome";
import { CareChoices } from "./care-choices";
import { careLabel } from "../lib/care-options";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

type BookingStep = "search" | "services" | "times" | "confirmed";
type CatalogService = { id: string; name: string; description: string; durationMinutes: number; bufferMinutes: number; priceFromCents: number; depositCents: number };
type Catalog = { organization: { name: string; slug: string; contactPhone: string; contactEmail: string }; location: { name: string; slug: string; city: string; region: string; currency: string; timezone: string }; locations: Array<{ slug: string; name: string; city: string; region: string }>; booking: { allowOnlineBooking: boolean; bookingMode: string; managedBySquare?: boolean; minimumLeadMinutes: number; bookingWindowDays: number; requireOnlineDeposit: boolean; depositHoldMinutes: number }; delivery?: { email?: { configured?: boolean }; sms?: { configured?: boolean } }; services: CatalogService[] };
type Slot = { startsAt: string; endsAt: string; date: string; timeLabel: string; staff: Array<{ id: string; name: string }>; remainingCapacity: number };
type Availability = { bookingMode: string; range: { from: string; through: string; bookingWindowEnd: string; previousFrom: string | null; nextFrom: string | null }; dates: Array<{ date: string; slots: Slot[] }> };
type BookingRecommendation = { serviceId: string; serviceName: string; locationId: string; locationSlug: string; locationName: string };
type BookingPet = { id: string; name: string; breed: string; species?: string; sizeLabel?: string | null; recommendation: BookingRecommendation | null };
type BookingContext = { firstName: string; fastPhoneSignInEnabled?: boolean; organization: { slug: string }; lastLocation: { id: string; slug: string; name: string }; pets: BookingPet[] };
type ClientAuthStep = "closed" | "phone" | "code";
type ClientAuthResult = { ok?: boolean; configured?: boolean; expiresInSeconds?: number; retryAfterSeconds?: number; verified?: boolean; authenticated?: boolean; fastSignInEnabled?: boolean; status?: "returning_client" | "new_client"; message?: string; error?: string };

const isDevelopmentPreview = process.env.NODE_ENV === "development";
const bookingSteps = ["Votre profil et votre animal", "Ses soins", "La date et l’heure", "Confirmation"];
// Deep links (a saved pet, a service, a chosen time, an expired portal link) skip the welcome tour.
const deepLinkKeys = ["pet", "service", "date", "startsAt", "portal"];
function money(cents: number, currency = "CAD") { return new Intl.NumberFormat("fr-CA", { style: "currency", currency }).format(cents / 100); }
function duration(minutes: number) { return minutes >= 60 ? `${Math.floor(minutes / 60)} hr${minutes % 60 ? ` ${minutes % 60} min` : ""}` : `${minutes} min`; }
function dayLabel(day: string, compact = false) { return new Intl.DateTimeFormat("fr-CA", { weekday: compact ? "short" : "long", month: "short", day: "numeric", timeZone: "UTC" }).format(new Date(`${day}T12:00:00Z`)); }
function addDays(day: string, amount: number) { const [year, month, date] = day.split("-").map(Number); return new Date(Date.UTC(year, month - 1, date + amount)).toISOString().slice(0, 10); }
function validDateKey(value: string) { return /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(new Date(`${value}T12:00:00Z`).getTime()); }
function slotPeriod(slot: Slot, timezone: string) {
  const hour = Number(new Intl.DateTimeFormat("en-CA", { timeZone: timezone, hour: "2-digit", hourCycle: "h23" }).formatToParts(new Date(slot.startsAt)).find((part) => part.type === "hour")?.value || 0);
  return hour < 12 ? "morning" : hour < 17 ? "afternoon" : "evening";
}
function suggestedSlots(slots: Slot[], timezone: string) {
  const suggestions: Slot[] = [];
  for (const period of ["morning", "afternoon", "evening"]) {
    const group = slots.filter((slot) => slotPeriod(slot, timezone) === period);
    if (group.length <= 2) suggestions.push(...group);
    else suggestions.push(group[0], group[group.length - 1]);
  }
  return suggestions;
}
function bookingUrl(organizationSlug: string, location: string, petId?: string, preferredServiceId?: string) {
  const base = location ? `/book/${encodeURIComponent(organizationSlug)}/${encodeURIComponent(location)}` : `/book/${encodeURIComponent(organizationSlug)}`;
  const query = new URLSearchParams();
  if (petId) query.set("pet", petId);
  if (preferredServiceId) query.set("service", preferredServiceId);
  return `${base}${query.size ? `?${query.toString()}` : ""}`;
}

export function BookingExperience({ storefrontSlug = "", locationSlug = "" }: { storefrontSlug?: string; locationSlug?: string }) {
  const [newProfile, setNewProfile] = useState(false);
  const [welcome, setWelcome] = useState<"pending" | "show" | "done">("pending");
  const [step, setStep] = useState<BookingStep>("search");
  const [catalog, setCatalog] = useState<Catalog | null>(null); const [availability, setAvailability] = useState<Availability | null>(null);
  const [serviceId, setServiceId] = useState(""); const [selectedDate, setSelectedDate] = useState(""); const [selectedStartsAt, setSelectedStartsAt] = useState("");
  const [pet, setPet] = useState(""); const [clientName, setClientName] = useState(""); const [email, setEmail] = useState(""); const [phone, setPhone] = useState(""); const [breed, setBreed] = useState("");
  const [bookingContext, setBookingContext] = useState<BookingContext | null>(null); const [contextChecked, setContextChecked] = useState(false); const [selectedPetId, setSelectedPetId] = useState("");
  const [clientAuthStep, setClientAuthStep] = useState<ClientAuthStep>("closed"); const [clientAuthPurpose, setClientAuthPurpose] = useState<"signin" | "enroll">("signin"); const [authPhone, setAuthPhone] = useState(""); const [authCode, setAuthCode] = useState(""); const [authBusy, setAuthBusy] = useState(false); const [authRetryAfter, setAuthRetryAfter] = useState(0); const [authError, setAuthError] = useState(""); const [authMessage, setAuthMessage] = useState(""); const [fastAccessNotice, setFastAccessNotice] = useState("");
  const [policyAccepted, setPolicyAccepted] = useState(false); const [informationCurrent, setInformationCurrent] = useState(false); const [bookingBusy, setBookingBusy] = useState(false); const [availabilityLoading, setAvailabilityLoading] = useState(false); const [bookingError, setBookingError] = useState(""); const [bookingStatus, setBookingStatus] = useState("confirmed");
  const [manageOpen, setManageOpen] = useState(false); const [manageEmail, setManageEmail] = useState(""); const [manageMessage, setManageMessage] = useState(""); const [manageError, setManageError] = useState(""); const [manageBusy, setManageBusy] = useState(false);
  const [waitlistOpen, setWaitlistOpen] = useState(false); const [waitlistBusy, setWaitlistBusy] = useState(false); const [waitlistMessage, setWaitlistMessage] = useState(""); const [waitlistError, setWaitlistError] = useState(""); const [waitlistTo, setWaitlistTo] = useState(""); const [timePreference, setTimePreference] = useState("anytime"); const [waitlistNotes, setWaitlistNotes] = useState(""); const [contactConsent, setContactConsent] = useState(false);
  const [showAllTimes, setShowAllTimes] = useState(false); const [findingNextOpening, setFindingNextOpening] = useState(false); const [manageReturnTo, setManageReturnTo] = useState("");
  const [catalogVersion, setCatalogVersion] = useState(0);
  const [demoReturningBusy, setDemoReturningBusy] = useState(false);
  const availabilityRequest = useRef(0); const selectedDateRef = useRef(""); const contextApplied = useRef(""); const manageDialog = useRef<HTMLElement>(null); const waitlistDialog = useRef<HTMLElement>(null);
  const authPhoneInput = useRef<HTMLInputElement>(null); const authCodeInput = useRef<HTMLInputElement>(null); const bookingCard = useRef<HTMLDivElement>(null); const bookingErrorAlert = useRef<HTMLParagraphElement>(null); const previousStep = useRef<BookingStep>(step);
  const stepNumber = useMemo(() => ({ search: 1, services: 2, times: 3, confirmed: 4 }[step]), [step]);
  const service = catalog?.services.find((item) => item.id === serviceId) || null;
  const selectedOwnedPet = bookingContext?.pets.find((item) => item.id === selectedPetId) || null;
  const authenticatedBooking = Boolean(bookingContext && selectedOwnedPet);
  const dateSlots = useMemo(() => availability?.dates.find((item) => item.date === selectedDate)?.slots || [], [availability, selectedDate]);
  const selectedSlot = dateSlots.find((item) => item.startsAt === selectedStartsAt) || null;
  const suggestedDateSlots = useMemo(() => suggestedSlots(dateSlots, catalog?.location.timezone || "America/Toronto"), [catalog?.location.timezone, dateSlots]);
  const visibleDateSlots = useMemo(() => {
    if (showAllTimes || suggestedDateSlots.length === dateSlots.length) return dateSlots;
    if (selectedSlot && !suggestedDateSlots.some((slot) => slot.startsAt === selectedSlot.startsAt)) return [...suggestedDateSlots, selectedSlot].sort((left, right) => left.startsAt.localeCompare(right.startsAt));
    return suggestedDateSlots;
  }, [dateSlots, selectedSlot, showAllTimes, suggestedDateSlots]);
  const storefrontQuery = `${storefrontSlug ? `&salon=${encodeURIComponent(storefrontSlug)}` : ""}${locationSlug ? `&location=${encodeURIComponent(locationSlug)}` : ""}`;
  const currentBookingReturnTo = useMemo(() => {
    const organization = catalog?.organization.slug || storefrontSlug;
    const location = catalog?.location.slug || locationSlug;
    if (!organization) return "/";
    const path = location ? `/book/${encodeURIComponent(organization)}/${encodeURIComponent(location)}` : `/book/${encodeURIComponent(organization)}`;
    const query = new URLSearchParams();
    if (authenticatedBooking && selectedOwnedPet) query.set("pet", selectedOwnedPet.id);
    if (serviceId) query.set("service", serviceId);
    if (selectedDate) query.set("date", selectedDate);
    if (selectedStartsAt) query.set("startsAt", selectedStartsAt);
    return `${path}${query.size ? `?${query.toString()}` : ""}`;
  }, [authenticatedBooking, catalog?.location.slug, catalog?.organization.slug, locationSlug, selectedDate, selectedOwnedPet, selectedStartsAt, serviceId, storefrontSlug]);

  const requestAvailabilityPage = useCallback(async (id: string, from = "") => {
    const fromQuery = from ? `&from=${encodeURIComponent(from)}` : "";
    const response = await fetch(`/api/availability?serviceId=${encodeURIComponent(id)}&days=14${fromQuery}${storefrontQuery}`);
    const result = await response.json() as Availability & { error?: string };
    if (!response.ok) throw new Error(result.error || "Live availability is unavailable.");
    return result;
  }, [storefrontQuery]);

  const loadAvailability = useCallback(async (id: string, options: { from?: string; preferredDate?: string; preferredStartsAt?: string } = {}) => {
    if (!id) return; const requestId = ++availabilityRequest.current; const preferredDate = options.preferredDate === undefined ? selectedDateRef.current : options.preferredDate; setAvailability(null); setSelectedStartsAt(""); setShowAllTimes(false); setAvailabilityLoading(true); setBookingError("");
    try {
      const result = await requestAvailabilityPage(id, options.from);
      if (requestId !== availabilityRequest.current) return;
      const requestedSlot = options.preferredStartsAt ? result.dates.flatMap((day) => day.slots).find((slot) => slot.startsAt === options.preferredStartsAt) : undefined;
      setAvailability(result); const preferred = result.dates.find((day) => day.date === (requestedSlot?.date || preferredDate) && day.slots.length); const first = preferred || result.dates.find((day) => day.slots.length); const nextDate = first?.date || result.dates[0]?.date || ""; selectedDateRef.current = nextDate; setSelectedDate(nextDate); setSelectedStartsAt(requestedSlot?.startsAt || "");
    } catch (error) { if (requestId === availabilityRequest.current) { setAvailability(null); setBookingError(error instanceof Error ? error.message : "Live availability is unavailable."); } }
    finally { if (requestId === availabilityRequest.current) setAvailabilityLoading(false); }
  }, [requestAvailabilityPage]);

  const findNextOpening = useCallback(async () => {
    if (!serviceId || !availability?.range.nextFrom) return;
    const requestId = ++availabilityRequest.current;
    let from: string | null = availability.range.nextFrom;
    setFindingNextOpening(true); setAvailabilityLoading(true); setSelectedStartsAt(""); setShowAllTimes(false); setBookingError("");
    try {
      while (from) {
        const result = await requestAvailabilityPage(serviceId, from);
        if (requestId !== availabilityRequest.current) return;
        const first = result.dates.find((day) => day.slots.length);
        if (first) {
          setAvailability(result); selectedDateRef.current = first.date; setSelectedDate(first.date); return;
        }
        from = result.range.nextFrom;
      }
      setBookingError("No later online openings are currently available inside the salon’s booking window.");
    } catch (error) {
      if (requestId === availabilityRequest.current) setBookingError(error instanceof Error ? error.message : "Later openings could not be checked.");
    } finally {
      setFindingNextOpening(false);
      if (requestId === availabilityRequest.current) setAvailabilityLoading(false);
    }
  }, [availability, requestAvailabilityPage, serviceId]);

  const loadBookingContext = useCallback(async () => {
    try {
      const query = new URLSearchParams();
      if (storefrontSlug) query.set("salon", storefrontSlug);
      if (locationSlug) query.set("location", locationSlug);
      const response = await fetch(`/api/booking-context${query.size ? `?${query.toString()}` : ""}`, { credentials: "same-origin", cache: "no-store" });
      if (response.status === 204 || response.status === 401) { setBookingContext(null); return null; }
      const result = await response.json() as BookingContext & { error?: string };
      if (!response.ok) { setBookingContext(null); return null; }
      setBookingContext(result);
      return result;
    } catch {
      setBookingContext(null);
      return null;
    } finally {
      setContextChecked(true);
    }
  }, [locationSlug, storefrontSlug]);

  useEffect(() => {
    const catalogUrl = storefrontSlug ? `/api/catalog?salon=${encodeURIComponent(storefrontSlug)}${locationSlug ? `&location=${encodeURIComponent(locationSlug)}` : ""}` : "/api/catalog";
    fetch(catalogUrl).then(async (response) => { const result = await response.json() as Catalog & { error?: string }; if (!response.ok) throw new Error(result.error || "Service menu unavailable."); setCatalog(result); setServiceId(""); if (!result.booking.allowOnlineBooking) { const today = new Date().toISOString().slice(0, 10); setAvailability({ bookingMode: result.booking.bookingMode, range: { from: today, through: today, bookingWindowEnd: today, previousFrom: null, nextFrom: null }, dates: [] }); setSelectedDate(""); setSelectedStartsAt(""); } }).catch((error) => setBookingError(error instanceof Error ? error.message : "Service menu unavailable."));
  }, [catalogVersion, loadAvailability, locationSlug, storefrontSlug]);

  useEffect(() => {
    const timer = window.setTimeout(() => { void loadBookingContext(); }, 0);
    return () => window.clearTimeout(timer);
  }, [loadBookingContext]);

  useEffect(() => {
    if (!contextChecked || welcome !== "pending") return;
    const timer = window.setTimeout(() => {
      const query = new URLSearchParams(window.location.search);
      const deepLink = deepLinkKeys.some((key) => query.has(key));
      setWelcome(bookingContext || deepLink || welcomeAlreadySeen() ? "done" : "show");
    }, 0);
    return () => window.clearTimeout(timer);
  }, [bookingContext, contextChecked, welcome]);

  useEffect(() => {
    const url = new URL(window.location.href);
    if (url.searchParams.get("portal") !== "expired") return;
    const returnTo = url.searchParams.get("return_to") || "";
    const timer = window.setTimeout(() => {
      setManageReturnTo(returnTo.startsWith("/") && !returnTo.startsWith("//") ? returnTo : "");
      setManageMessage("That private link has expired. Enter your booking email and we’ll prepare a fresh one without revealing whether an account is on file.");
      setManageOpen(true);
    }, 0);
    url.searchParams.delete("portal");
    url.searchParams.delete("return_to");
    window.history.replaceState({}, "", `${url.pathname}${url.search}${url.hash}`);
    return () => window.clearTimeout(timer);
  }, []);

  useEffect(() => {
    if (clientAuthStep !== "code" || authRetryAfter <= 0) return;
    const timer = window.setTimeout(() => setAuthRetryAfter((seconds) => Math.max(0, seconds - 1)), 1000);
    return () => window.clearTimeout(timer);
  }, [authRetryAfter, clientAuthStep]);

  useEffect(() => {
    if (previousStep.current === step) return;
    previousStep.current = step;
    const timer = window.setTimeout(() => bookingCard.current?.querySelector<HTMLElement>("[data-booking-step-heading]")?.focus(), 0);
    return () => window.clearTimeout(timer);
  }, [step]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      if (!catalog || !bookingContext || !bookingContext.pets.length) return;
      const query = new URLSearchParams(window.location.search);
      const requestedPet = bookingContext.pets.find((item) => item.id === query.get("pet"));
      const ownedPet = requestedPet || bookingContext.pets[0];
      const requestedServiceId = query.get("service") || "";
      const requestedDate = validDateKey(query.get("date") || "") ? String(query.get("date")) : "";
      const requestedStartsAt = query.get("startsAt") && !Number.isNaN(new Date(String(query.get("startsAt"))).getTime()) ? String(query.get("startsAt")) : "";
      const recommendedLocation = ownedPet.recommendation?.locationSlug || bookingContext.lastLocation.slug;
      const preferredServiceId = requestedServiceId || ownedPet.recommendation?.serviceId || "";

      if (!locationSlug && recommendedLocation && recommendedLocation !== catalog.location.slug) {
        window.location.assign(bookingUrl(bookingContext.organization.slug, recommendedLocation, ownedPet.id, preferredServiceId));
        return;
      }

      const requestedService = catalog.services.find((item) => item.id === requestedServiceId);
      const recommendedService = ownedPet.recommendation?.locationSlug === catalog.location.slug
        ? catalog.services.find((item) => item.id === ownedPet.recommendation?.serviceId)
        : undefined;
      const nextServiceId = requestedService?.id || recommendedService?.id || "";
      const appliedKey = `${catalog.location.slug}:${ownedPet.id}:${nextServiceId}:${requestedDate}:${requestedStartsAt}`;
      if (contextApplied.current === appliedKey) return;
      contextApplied.current = appliedKey;
      setSelectedPetId(ownedPet.id);
      setPet(ownedPet.name);
      setBreed(ownedPet.breed);
      if (nextServiceId) {
        if (nextServiceId !== serviceId) setServiceId(nextServiceId);
        if (catalog.booking.allowOnlineBooking && (nextServiceId !== serviceId || requestedDate)) {
          void loadAvailability(nextServiceId, { from: requestedDate || undefined, preferredDate: requestedDate || undefined, preferredStartsAt: requestedStartsAt || undefined });
        }
      }
      if (requestedDate || requestedStartsAt) {
        setStep("times");
      }
    }, 0);
    return () => window.clearTimeout(timer);
  }, [bookingContext, catalog, loadAvailability, locationSlug, serviceId]);

  useEffect(() => {
    const dialog = waitlistOpen ? waitlistDialog.current : manageOpen ? manageDialog.current : null;
    if (!dialog) return;
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const focusable = () => Array.from(dialog.querySelectorAll<HTMLElement>('button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), a[href]'));
    focusable()[0]?.focus();
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") { if (waitlistOpen) setWaitlistOpen(false); else setManageOpen(false); return; }
      if (event.key !== "Tab") return;
      const items = focusable(); if (!items.length) return; const first = items[0]; const last = items[items.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => { document.removeEventListener("keydown", handleKeyDown); document.body.style.overflow = previousOverflow; previousFocus?.focus(); };
  }, [manageOpen, waitlistOpen]);

  function openServices() { setStep(bookingContext ? "services" : "search"); document.getElementById("booking")?.scrollIntoView({ behavior: "smooth", block: "start" }); }
  function chooseService(id: string) { if (!bookingContext) { setStep("search"); return; } setServiceId(id); setPolicyAccepted(false); setInformationCurrent(false); setStep("times"); setShowAllTimes(false); if (catalog?.booking.allowOnlineBooking !== false) void loadAvailability(id, { preferredDate: "" }); document.getElementById("booking")?.scrollIntoView({ behavior: "smooth", block: "start" }); }
  function chooseDate(date: string) { selectedDateRef.current = date; setSelectedDate(date); setSelectedStartsAt(""); setShowAllTimes(false); }
  function focusAuthInput(target: "phone" | "code", select = false) {
    window.setTimeout(() => {
      const input = target === "phone" ? authPhoneInput.current : authCodeInput.current;
      input?.focus();
      if (select) input?.select();
    }, 0);
  }
  function showBookingError(message: string) {
    setBookingError(message);
    window.setTimeout(() => bookingErrorAlert.current?.focus(), 0);
  }
  function openClientAuth(purpose: "signin" | "enroll" = "signin") {
    if (catalog?.delivery?.sms?.configured !== true) {
      if (purpose === "signin") openEmailAccess();
      return;
    }
    setClientAuthPurpose(purpose); setClientAuthStep("phone"); setAuthCode(""); setAuthRetryAfter(0); setAuthError(""); setAuthMessage(""); setFastAccessNotice("");
    focusAuthInput("phone");
  }
  function selectOwnedPet(id: string) {
    const ownedPet = bookingContext?.pets.find((item) => item.id === id); if (!ownedPet) return;
    setSelectedPetId(ownedPet.id); setPet(ownedPet.name); setBreed(ownedPet.breed); setBookingError("");
    const recommendation = ownedPet.recommendation;
    if (recommendation && catalog && recommendation.locationSlug === catalog.location.slug && catalog.services.some((item) => item.id === recommendation.serviceId)) {
      setServiceId(recommendation.serviceId);
      if (catalog.booking.allowOnlineBooking) void loadAvailability(recommendation.serviceId);
    }
  }
  function bookAgain(ownedPet: BookingPet) {
    const recommendation = ownedPet.recommendation;
    if (recommendation && bookingContext && catalog && recommendation.locationSlug !== catalog.location.slug) {
      window.location.assign(bookingUrl(bookingContext.organization.slug, recommendation.locationSlug, ownedPet.id, recommendation.serviceId));
      return;
    }
    selectOwnedPet(ownedPet.id);
    availabilityRequest.current++; setServiceId(""); setAvailability(null); setSelectedStartsAt(""); setStep("services");
  }
  function continueAsGuest() {
    if (authPhone.trim()) setPhone(authPhone.trim());
    setClientAuthStep("closed"); setAuthError(""); setAuthMessage(""); setNewProfile(true); setStep("search");
  }
  function openEmailAccess() { setClientAuthStep("closed"); setAuthError(""); setAuthMessage(""); setManageOpen(true); }
  async function previewReturningCustomer() {
    setDemoReturningBusy(true); setBookingError("");
    try {
      const response = await fetch("/api/auth/client/demo", { method: "POST", credentials: "same-origin" });
      const result = await response.json().catch(() => ({})) as { error?: string };
      if (!response.ok) throw new Error(result.error || "The returning-client preview could not be opened.");
      const context = await loadBookingContext();
      if (!context) throw new Error("The returning-client preview could not be loaded.");
      setStep("search"); setClientAuthStep("closed"); setPet(""); setBreed("");
    } catch (error) {
      setBookingError(error instanceof Error ? error.message : "The returning-client preview could not be opened.");
    } finally {
      setDemoReturningBusy(false);
    }
  }
  async function startClientAuth() {
    const digits = authPhone.replace(/\D/g, "");
    if (!(digits.length === 10 || (digits.length === 11 && digits.startsWith("1")))) { setAuthError("Enter a valid Canada or US mobile number with area code."); focusAuthInput("phone"); return; }
    if (catalog?.delivery?.sms?.configured !== true) { setAuthError("Fast text sign-in is unavailable right now. Use email or continue as a guest."); focusAuthInput(clientAuthStep === "code" ? "code" : "phone"); return; }
    setAuthBusy(true); setAuthError(""); if (clientAuthStep === "phone") setAuthMessage("");
    try {
      const response = await fetch("/api/client-auth/start", { method: "POST", credentials: "same-origin", headers: { "content-type": "application/json" }, body: JSON.stringify({ phone: authPhone, salonSlug: storefrontSlug || undefined, locationSlug: locationSlug || undefined }) });
      const result = await response.json().catch(() => ({})) as ClientAuthResult;
      if (!response.ok || result.configured === false) throw new Error(result.error || result.message || "Fast text sign-in is unavailable right now. Use email or continue as a guest.");
      setClientAuthStep("code");
      setAuthCode("");
      setAuthRetryAfter(Math.max(1, result.retryAfterSeconds ?? 30));
      setAuthMessage("If this mobile can receive texts, a six-digit code is on its way.");
      focusAuthInput("code");
    } catch (error) {
      setAuthError(error instanceof Error ? error.message : "Fast text sign-in is unavailable right now. Use email or continue as a guest.");
      focusAuthInput(clientAuthStep === "code" ? "code" : "phone");
    } finally {
      setAuthBusy(false);
    }
  }
  async function verifyClientAuth() {
    const code = authCode.replace(/\D/g, "");
    if (code.length !== 6) { setAuthError("Enter the six-digit code from your text."); focusAuthInput("code", true); return; }
    setAuthBusy(true); setAuthError("");
    try {
      const response = await fetch("/api/client-auth/verify", { method: "POST", credentials: "same-origin", headers: { "content-type": "application/json" }, body: JSON.stringify({ phone: authPhone, code, salonSlug: storefrontSlug || undefined, locationSlug: locationSlug || undefined }) });
      const result = await response.json().catch(() => ({})) as ClientAuthResult;
      if (response.status === 409 && result.verified === true && result.fastSignInEnabled === false) {
        setClientAuthStep("phone"); setAuthCode(""); setAuthError(result.error || "That mobile is already linked to another profile. Use a different number."); focusAuthInput("phone", true); return;
      }
      if (!response.ok || result.configured === false || result.verified === false) throw new Error(result.error || result.message || "That code could not be verified. Check it and try again.");
      const returningClient = result.authenticated !== false && result.status !== "new_client";
      const nextContext = returningClient ? await loadBookingContext() : null;
      if (returningClient && !nextContext) {
        window.location.reload();
        return;
      }
      if (nextContext) {
        setClientAuthStep("closed"); setAuthCode(""); setAuthMessage("");
        if (clientAuthPurpose === "enroll") setFastAccessNotice("Fast mobile sign-in is ready for next time.");
      } else {
        setPhone(authPhone.trim()); setClientAuthStep("closed"); setAuthCode(""); setAuthMessage("");
        openServices();
      }
    } catch (error) {
      setAuthError(error instanceof Error ? error.message : "That code could not be verified. Check it and try again.");
      focusAuthInput("code", true);
    } finally {
      setAuthBusy(false);
    }
  }

  async function confirmBooking() {
    if (!service || !selectedSlot) { showBookingError("Choose one of the live appointment times."); return; }
    if (catalog?.booking.managedBySquare && !authenticatedBooking) { setStep("search"); showBookingError("Create or securely open your BOPOIL profile first so Square uses the correct customer record."); return; }
    if (bookingContext && !selectedOwnedPet) { showBookingError("Choose one of the pets in your private profile."); return; }
    if (!authenticatedBooking) {
      const phoneDigits = phone.replace(/\D/g, "");
      if (!clientName.trim() || !pet.trim()) { showBookingError("Add your name and your pet’s name."); return; }
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) { showBookingError("Enter a valid email address."); return; }
      if (phoneDigits.length < 10 || phoneDigits.length > 15) { showBookingError("Enter a valid phone number with area code."); return; }
    }
    if (!policyAccepted) { showBookingError("Review and accept the booking and cancellation policy to continue."); return; }
    if (!informationCurrent) { showBookingError("Confirm that your contact and pet information is current for this appointment."); return; }
    setBookingBusy(true); setBookingError("");
    try {
      const identity = authenticatedBooking
        ? { petId: selectedOwnedPet!.id }
        : { clientName, email, phone, petName: pet, breed };
      const endpoint = catalog?.booking.managedBySquare ? "/api/square-bookings" : "/api/bookings";
      const response = await fetch(endpoint, { method: "POST", credentials: "same-origin", headers: { "content-type": "application/json" }, body: JSON.stringify({ salonSlug: storefrontSlug || undefined, locationSlug: locationSlug || undefined, ...identity, serviceId: service.id, startsAt: selectedSlot.startsAt, policyAccepted, informationCurrent }) });
      const result = await response.json() as { appointment?: { status: string }; checkoutUrl?: string; recoveryAvailable?: boolean; recoverySession?: boolean; trustedSession?: boolean; intent?: string; error?: string };
      if (!response.ok) {
        if (result.intent === "secure_access_required") {
          setManageEmail(email.trim());
          setManageReturnTo(currentBookingReturnTo);
          setManageMessage("For privacy, secure access is prepared using the contact already on file when possible. You can also request another private link below.");
          setManageError("");
          setManageOpen(true);
          showBookingError(result.error || "Complete this booking through your secure client link.");
          return;
        } else if (result.recoveryAvailable) {
          const recovered = await loadBookingContext();
          const recoveredPet = recovered?.pets.find((item) => item.name.toLowerCase() === pet.trim().toLowerCase()) || recovered?.pets[0];
          if (recoveredPet) {
            setSelectedPetId(recoveredPet.id); setPet(recoveredPet.name); setBreed(recoveredPet.breed);
          }
          await loadAvailability(service.id);
        } else if (response.status === 409) {
          void loadAvailability(service.id);
        }
        throw new Error(result.error || "We couldn’t reserve that appointment.");
      }
      if (result.checkoutUrl) { window.location.assign(result.checkoutUrl); return; }
      if (result.trustedSession) {
        const trusted = await loadBookingContext();
        const trustedPet = trusted?.pets.find((item) => item.name.toLowerCase() === pet.trim().toLowerCase()) || trusted?.pets[0];
        if (trustedPet) {
          setSelectedPetId(trustedPet.id); setPet(trustedPet.name); setBreed(trustedPet.breed);
        }
      }
      setBookingStatus(result.appointment?.status || "confirmed"); setStep("confirmed");
    } catch (error) { showBookingError(error instanceof Error ? error.message : "We couldn’t reserve that appointment."); }
    finally { setBookingBusy(false); }
  }
  async function requestPortalLink() { setManageBusy(true); setManageMessage(""); setManageError(""); try { const response = await fetch("/api/portal/request-link", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email: manageEmail, petName: pet || undefined, salonSlug: storefrontSlug || undefined, locationSlug: locationSlug || undefined, returnTo: manageReturnTo || currentBookingReturnTo }) }); const result = await response.json() as { message?: string; error?: string }; if (!response.ok) throw new Error(result.error || "Could not request a link."); setManageMessage(result.message || (catalog?.delivery?.email?.configured ? "If the address matches a booking, a secure link is on its way." : `Your request is ready for ${salonName}. Contact the salon if you need access right away.`)); } catch (error) { setManageError(error instanceof Error ? error.message : "Could not request a link."); } finally { setManageBusy(false); } }
  function openWaitlist() { const from = selectedDate || availability?.dates[0]?.date || new Date().toISOString().slice(0, 10); setWaitlistTo(addDays(from, 7)); setWaitlistMessage(""); setWaitlistError(""); setWaitlistOpen(true); }
  async function joinWaitlist() {
    if (!service || !selectedDate) return;
    setWaitlistBusy(true); setWaitlistError("");
    try {
      const identity = authenticatedBooking
        ? { petId: selectedOwnedPet!.id }
        : { clientName, email, phone, petName: pet, breed };
      const response = await fetch("/api/waitlist", {
        method: "POST",
        credentials: "same-origin",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ salonSlug: storefrontSlug || undefined, locationSlug: locationSlug || undefined, ...identity, serviceId: service.id, preferredFrom: selectedDate, preferredTo: waitlistTo, timePreference, clientNotes: waitlistNotes, contactConsent }),
      });
      const result = await response.json() as { message?: string; trustedSession?: boolean; error?: string };
      if (!response.ok) throw new Error(result.error || "Could not join the waitlist.");
      if (result.trustedSession) await loadBookingContext();
      setWaitlistMessage(result.message || `${pet} is on the priority list.`);
    } catch (error) {
      setWaitlistError(error instanceof Error ? error.message : "Could not join the waitlist.");
    } finally {
      setWaitlistBusy(false);
    }
  }

  const locationName = catalog ? `${catalog.location.name} · ${catalog.location.city}, ${catalog.location.region}` : storefrontSlug ? "Loading salon location…" : "Coat & Care · Toronto, ON";
  const salonName = catalog?.organization.name || (storefrontSlug === "bopoil" ? "BOPOIL Toilettage & Boutique" : "Votre salon");
  const brandInitial = salonName.slice(0, 1).toUpperCase();
  const onlineBookingOpen = catalog?.booking.allowOnlineBooking !== false;
  const squareManaged = catalog?.booking.managedBySquare === true;
  const requiresDeposit = Boolean(catalog?.booking.requireOnlineDeposit && service && service.depositCents > 0);
  const emailDeliveryConfigured = catalog?.delivery?.email?.configured !== false;
  const smsDeliveryConfigured = catalog?.delivery?.sms?.configured === true;
  const searchReady = contextChecked && welcome !== "pending";
  const welcomeVisible = step === "search" && searchReady && clientAuthStep === "closed" && !bookingContext && welcome === "show";
  return <main className={`app-shell guided-booking${welcomeVisible ? " welcome-active" : ""}`} lang="fr">
    <header className="topbar"><button className="brand" onClick={() => setStep("search")} aria-label={`${salonName} home`}><span className="brand-mark">{brandInitial}</span><span>{salonName}</span></button><div className="top-actions"><button className="text-button" onClick={() => setManageOpen(true)}>Mon profil</button><button className="avatar-button" onClick={() => setManageOpen(true)} aria-label="Ouvrir mon profil">♡</button></div></header>
    <div className="client-view">
      <section className="booking-flow" id="booking"><div className="booking-intro"><span className="eyebrow">Votre rendez-vous chez BOPOIL</span><h1>Un soin adapté.<br/>Un animal heureux.</h1><p>Retrouvez votre animal, choisissez ses soins et réservez le moment qui vous convient.</p>{catalog && catalog.locations.length > 1 && <label className="guided-fields">Salon<select value={catalog.location.slug} onChange={(event) => window.location.assign(bookingUrl(catalog.organization.slug, event.target.value, selectedPetId))}>{catalog.locations.map((item) => <option key={item.slug} value={item.slug}>{item.name} · {item.city}</option>)}</select></label>}<ol className="guided-progress" aria-label="Étapes de réservation">{bookingSteps.map((label, index) => <li key={label} className={index + 1 < stepNumber ? "done" : undefined} aria-current={index + 1 === stepNumber ? "step" : undefined}><span>{index + 1}</span><em>{label}</em></li>)}</ol><p className="guided-progress-label" aria-hidden="true"><b>Étape {stepNumber} sur {bookingSteps.length}</b>{bookingSteps[stepNumber - 1]}</p><p className="guided-help">Besoin d’aide ? <a href={`tel:${(catalog?.organization.contactPhone || "+18199682827").replace(/[^+\d]/g, "")}`}>Appelez-nous</a></p></div>
        <div className="booking-card" ref={bookingCard}>
          {step === "search" && !searchReady && <div className="booking-context-loading" role="status" aria-live="polite"><span className="pet-medallion">♡</span><h3>Un instant…</h3><p>Nous recherchons votre profil sur cet appareil.</p></div>}
          {step === "search" && searchReady && clientAuthStep !== "closed" && <div className="client-auth-card">
            <button type="button" className="auth-back" onClick={() => { setClientAuthStep("closed"); setAuthError(""); setAuthMessage(""); }}>← {clientAuthPurpose === "enroll" ? "Plus tard" : "Retour"}</button>
            <span className="eyebrow">{clientAuthPurpose === "enroll" ? "Faster next time" : "Welcome back"}</span>
            <h3>{clientAuthStep === "phone" ? clientAuthPurpose === "enroll" ? "Utiliser ce téléphone la prochaine fois." : "Retrouvez votre profil." : "Entrez votre code."}</h3>
            <p id="client-auth-instructions">{clientAuthStep === "phone" ? clientAuthPurpose === "enroll" ? "Verify the mobile you want to use for fast, private access on a new device." : "Recevez un code par texto pour ouvrir votre profil en toute sécurité." : authMessage}</p>
            {clientAuthStep === "phone" ? <form onSubmit={(event) => { event.preventDefault(); void startClientAuth(); }}>
              <label>
                <span>Numéro de téléphone</span>
                <input ref={authPhoneInput} type="tel" inputMode="tel" enterKeyHint="send" autoComplete="tel" value={authPhone} onChange={(event) => { setAuthPhone(event.target.value); setAuthError(""); }} placeholder="(416) 555-0123" aria-invalid={Boolean(authError)} aria-describedby={authError ? "client-auth-instructions auth-phone-error" : "client-auth-instructions"} autoFocus/>
              </label>
              {authError && <p id="auth-phone-error" className="booking-error" role="alert">{authError}</p>}
              <button className="primary-button wide" disabled={authBusy}>{authBusy ? "Envoi du code…" : "Recevoir mon code"}</button>
            </form> : <form onSubmit={(event) => { event.preventDefault(); void verifyClientAuth(); }}>
              <label>
                <span>Code à six chiffres</span>
                <input ref={authCodeInput} className="one-time-code" type="text" inputMode="numeric" enterKeyHint="done" autoComplete="one-time-code" pattern="[0-9]*" maxLength={6} value={authCode} onChange={(event) => { setAuthCode(event.target.value.replace(/\D/g, "").slice(0, 6)); setAuthError(""); }} placeholder="000000" aria-invalid={Boolean(authError)} aria-describedby={authError ? "client-auth-instructions auth-code-error" : "client-auth-instructions"} autoFocus/>
              </label>
              {authError && <p id="auth-code-error" className="booking-error" role="alert">{authError}</p>}
              <button className="primary-button wide" disabled={authBusy || authCode.length !== 6}>{authBusy ? "Checking code…" : clientAuthPurpose === "enroll" ? "Use this mobile next time" : "Continue securely"}</button>
              <button type="button" className="auth-resend" disabled={authBusy || authRetryAfter > 0} onClick={() => void startClientAuth()}>{authRetryAfter > 0 ? `Send another code in ${authRetryAfter}s` : "Send another code"}</button>
              <button type="button" className="auth-resend" disabled={authBusy} onClick={() => { setClientAuthStep("phone"); setAuthCode(""); setAuthRetryAfter(0); setAuthError(""); focusAuthInput("phone"); }}>Use a different number</button>
            </form>}
            <div className="auth-alternatives">{clientAuthPurpose === "signin" ? <><button type="button" onClick={openEmailAccess}>Use email instead</button><span aria-hidden="true">or</span><button type="button" onClick={continueAsGuest}>Continue as guest</button></> : <button type="button" onClick={() => setClientAuthStep("closed")}>Not now</button>}</div>
          </div>}
          {step === "search" && searchReady && clientAuthStep === "closed" && bookingContext && <div className="returning-booking"><div className="returning-heading"><span className="eyebrow">Bon retour</span><h3>Bonjour {bookingContext.firstName}, qui vient nous voir ?</h3><p>Choisissez votre animal pour retrouver les soins qui lui conviennent.</p></div>{fastAccessNotice && <div className="fast-access-notice" role="status">✓ {fastAccessNotice}</div>}{bookingContext.pets.length ? <div className="returning-pets">{bookingContext.pets.map((item, index) => <button type="button" key={item.id} className={selectedPetId === item.id ? "selected" : ""} onClick={() => bookAgain(item)}><span className={`pet-medallion small tone-${index % 3}`}>{item.name.slice(0,1)}</span><span><strong>{item.name}</strong><small>{item.breed}</small><em>{item.recommendation ? `${careLabel(item.recommendation.serviceName)} · ${item.recommendation.locationName}` : "Choisir ses soins"}</em></span><b>Choisir ses soins →</b></button>)}</div> : <div className="returning-empty"><span className="pet-medallion">♡</span><p>Ajoutez un animal dans votre profil avant de réserver.</p><button type="button" onClick={() => window.location.assign("/portal")}>Ouvrir mon profil</button></div>}<div className="returning-actions"><button type="button" className="secondary-button" disabled={!bookingContext.pets.length} onClick={openServices}>Choisir les soins</button>{smsDeliveryConfigured && bookingContext.fastPhoneSignInEnabled === false && <button type="button" className="fast-access-button" onClick={() => openClientAuth("enroll")}>Use this mobile next time</button>}</div></div>}
          {welcomeVisible && <BookingWelcome salonName={salonName} onStart={() => setWelcome("done")} onSignIn={() => { setWelcome("done"); openClientAuth("signin"); }}/>}
          {step === "search" && searchReady && clientAuthStep === "closed" && !bookingContext && welcome === "done" && (newProfile ? <BookingIntake salonSlug={storefrontSlug} locationSlug={locationSlug} onBack={() => setNewProfile(false)} onSignIn={(address) => { setManageEmail(address); openEmailAccess(); }} onCreated={async () => { const context = await loadBookingContext(); if (!context) throw new Error("Votre profil est enregistré. Ouvrez-le avec votre courriel pour continuer."); setNewProfile(false); setStep("services"); }}/> : <div className="profile-choice"><span className="eyebrow">Bienvenue</span><h3 data-booking-step-heading tabIndex={-1}>On se connaît déjà ?</h3><p>Commencez par votre profil. Les soins et les disponibilités viendront ensuite.</p>
            <button className="profile-choice-button" onClick={() => openClientAuth("signin")}><i className="choice-icon returning" aria-hidden="true"><svg viewBox="0 0 24 24" focusable="false"><path d="M12 21c-3.6 0-6-2.1-6-4.6 0-2.4 2.7-4.4 6-4.4s6 2 6 4.4C18 18.9 15.6 21 12 21Z" fill="currentColor"/><circle cx="6.2" cy="9.4" r="2" fill="currentColor"/><circle cx="17.8" cy="9.4" r="2" fill="currentColor"/><circle cx="9.3" cy="5.6" r="2.1" fill="currentColor"/><circle cx="14.7" cy="5.6" r="2.1" fill="currentColor"/></svg></i><span className="choice-text"><strong>Je suis déjà client</strong><span>Ouvrir mon profil et retrouver mes animaux</span></span><b aria-hidden="true">›</b></button>
            <button className="profile-choice-button" onClick={() => setNewProfile(true)}><i className="choice-icon new" aria-hidden="true"><svg viewBox="0 0 24 24" focusable="false"><path d="M12 4v16M4 12h16" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" fill="none"/></svg></i><span className="choice-text"><strong>C’est ma première visite</strong><span>Créer mon profil et ajouter mon animal</span></span><b aria-hidden="true">›</b></button>
            <button type="button" className="returning-link" onClick={() => setWelcome("show")}>Revoir la présentation</button>
            {isDevelopmentPreview && <button className="returning-link" disabled={demoReturningBusy} onClick={() => void previewReturningCustomer()}>Preview returning client (local only) →</button>}</div>)}
          {!catalog && bookingError && <div className="booking-error" role="alert"><p>{bookingError}</p><button className="secondary-button" onClick={() => { setBookingError(""); setCatalogVersion((value) => value + 1); }}>Réessayer</button></div>}
          {step === "services" && (selectedOwnedPet && catalog ? <CareChoices key={selectedOwnedPet.id} pet={selectedOwnedPet} services={catalog.services} currency={catalog.location.currency} contactPhone={catalog.organization.contactPhone} onChoose={chooseService} onBack={() => setStep("search")}/> : <p role="status">Chargement de votre animal…</p>)}
          {step === "times" && <div><div className="card-title"><div><small>Étape 3 sur 4</small><h3 data-booking-step-heading tabIndex={-1}>{onlineBookingOpen ? "Choisissez la date et l’heure" : "Online booking is paused"}</h3></div><button className="mini-link" onClick={openServices}>Changer de soin</button></div>{service && <div className="booking-summary"><span aria-hidden="true">✦</span><div><strong>{careLabel(service.name)}</strong><small>{duration(service.durationMinutes)} · {availability?.bookingMode === "request" ? "sur confirmation du salon" : "confirmation immédiate"}</small></div><b>{money(service.priceFromCents, catalog?.location.currency)}</b></div>}
            {!onlineBookingOpen ? <div className="booking-paused" role="status"><strong>This salon is not taking online bookings right now.</strong><p>Contact {catalog?.organization.contactPhone || catalog?.organization.contactEmail || salonName} and the team can help plan a visit.</p></div> : availabilityLoading ? <div className="slot-loading" role="status" aria-live="polite" aria-label={findingNextOpening ? "Finding the next available opening" : "Checking live openings"}><span/><span/><span/></div> : availability ? <>
              <div className="calendar-navigation" role="group" aria-label="Browse the salon booking window">
                <button type="button" className="secondary-button" disabled={!availability.range.previousFrom} onClick={() => availability.range.previousFrom && void loadAvailability(serviceId, { from: availability.range.previousFrom, preferredDate: "" })} aria-label="Show earlier appointment dates">← Avant</button>
                <span role="status">{dayLabel(availability.range.from, true)} – {dayLabel(availability.range.through, true)}</span>
                <button type="button" className="secondary-button" disabled={!availability.range.nextFrom} onClick={() => availability.range.nextFrom && void loadAvailability(serviceId, { from: availability.range.nextFrom, preferredDate: "" })} aria-label="Show later appointment dates">Après →</button>
                {availability.range.nextFrom && <button type="button" className="secondary-button" onClick={() => void findNextOpening()} aria-label={`Find the next available ${service?.name || "service"} opening after ${dayLabel(availability.range.through)}`}>Prochaine disponibilité</button>}
              </div>
              <div className="date-strip" role="group" aria-label="Available dates">{availability.dates.map((item) => <button type="button" key={item.date} className={selectedDate === item.date ? "selected" : ""} aria-label={`${dayLabel(item.date)}: ${item.slots.length ? `${item.slots.length} available ${item.slots.length === 1 ? "time" : "times"}` : "no available times"}`} aria-pressed={selectedDate === item.date} disabled={!item.slots.length} onClick={() => chooseDate(item.date)}><small>{dayLabel(item.date, true).split(",")[0]}</small><strong>{new Date(`${item.date}T12:00:00Z`).getUTCDate()}</strong><em>{item.slots.length || "—"}</em></button>)}</div>
              {dateSlots.length ? <>
                <div className="time-periods">
                  {(["morning", "afternoon", "evening"] as const).map((period) => {
                    const periodSlots = visibleDateSlots.filter((slot) => slotPeriod(slot, catalog?.location.timezone || "America/Toronto") === period);
                    if (!periodSlots.length) return null;
                    const headingId = `booking-times-${period}`;
                    return <section className="time-period" key={period} aria-labelledby={headingId}><h4 id={headingId}>{{ morning: "Matin", afternoon: "Après-midi", evening: "Soir" }[period]}</h4><div className="time-grid live-times" role="group" aria-labelledby={headingId}>{periodSlots.map((slot) => { const staffLabel = slot.staff.length > 1 ? `${slot.staff.length} groomers available` : slot.staff[0]?.name ? `avec ${slot.staff[0].name}` : "avec notre équipe"; return <button type="button" key={slot.startsAt} className={selectedStartsAt === slot.startsAt ? "selected" : ""} aria-label={`${dayLabel(selectedDate)} at ${slot.timeLabel}, ${staffLabel}`} aria-pressed={selectedStartsAt === slot.startsAt} onClick={() => { setSelectedStartsAt(slot.startsAt); setBookingError(""); }}><strong>{slot.timeLabel}</strong><small>{staffLabel}</small></button>; })}</div></section>;
                  })}
                </div>
                {suggestedDateSlots.length < dateSlots.length && <button type="button" className="secondary-button wide" aria-expanded={showAllTimes} onClick={() => setShowAllTimes((value) => !value)}>{showAllTimes ? "Voir les heures suggérées" : `Voir les ${dateSlots.length} heures`}</button>}
                <p id="time-selection-status" className={`time-selection-status ${selectedSlot ? "selected" : ""}`} role="status" aria-live="polite">{selectedSlot ? `Le ${dayLabel(selectedDate)} à ${selectedSlot.timeLabel}` : `Choisissez une heure le ${dayLabel(selectedDate)} pour continuer.`}</p>
              </> : <div className="no-slots"><span aria-hidden="true">♡</span><strong>No safe openings this day</strong><small>Try later dates, find the next opening, or join the priority list and we’ll contact you when a matching opening appears.</small><button type="button" onClick={openWaitlist}>Join priority list</button></div>}
            </> : null}
            {authenticatedBooking ? <div className="saved-booking-identity"><span className="pet-medallion small">{selectedOwnedPet?.name.slice(0,1)}</span><div><strong>{selectedOwnedPet?.name} · {selectedOwnedPet?.breed}</strong><small>Vos coordonnées et renseignements enregistrés seront utilisés{squareManaged ? " pour ce rendez-vous" : ""}.</small></div><button type="button" onClick={() => setStep("search")}>Changer d’animal</button></div> : squareManaged ? <div className="booking-paused" role="status"><strong>Open your BOPOIL profile before reserving.</strong><p>This prevents Square from creating another customer or replacing your pet’s information.</p><button type="button" className="primary-button wide" onClick={() => window.location.assign(`/fiche-informations.html?continue=${encodeURIComponent(currentBookingReturnTo)}`)}>Create profile & add pet</button></div> : <div className="booking-fields"><label><span>Your name</span><input value={clientName} onChange={(e) => setClientName(e.target.value)} placeholder="Pet parent name" autoComplete="name" required/></label><label><span>Pet name</span><input value={pet} onChange={(e) => setPet(e.target.value)} placeholder="Your pet’s name" autoComplete="off" required/></label><label><span>Email</span><input value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@example.com" type="email" autoComplete="email" required/></label><label><span>Phone</span><input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="(416) 555-0123" type="tel" inputMode="tel" autoComplete="tel" required/></label><label><span>Breed or mix <small>(optional)</small></span><input value={breed} onChange={(e) => setBreed(e.target.value)} placeholder="À préciser plus tard"/></label></div>}
            {onlineBookingOpen && <><div className={`deposit-note ${requiresDeposit ? "required" : ""}`}><span aria-hidden="true">{requiresDeposit ? "↗" : "✓"}</span><p><strong>{service && service.depositCents > 0 ? `${money(service.depositCents, catalog?.location.currency)} deposit${requiresDeposit ? " due securely now" : " listed for this service"}.` : "Aucun acompte en ligne pour ce soin."}</strong><br/>{requiresDeposit ? `We’ll hold this opening for ${catalog?.booking.depositHoldMinutes} minutes while you pay. It confirms only after verified payment.` : "La disponibilité est vérifiée au moment de réserver."}</p></div><details className="booking-policy"><summary>Conditions de réservation et d’annulation</summary><p>Les conditions du salon concernant les annulations, retards, absences et acomptes s’appliquent. Contactez {catalog?.organization.contactPhone || catalog?.organization.contactEmail || "the salon"} avant de continuer si vous n’avez pas reçu ou lu ces conditions.</p></details><label className="policy-check"><input type="checkbox" checked={policyAccepted} onChange={(e) => { setPolicyAccepted(e.target.checked); setBookingError(""); }}/><span>J’ai lu et j’accepte les conditions de réservation et d’annulation.</span></label><label className="policy-check"><input type="checkbox" checked={informationCurrent} onChange={(e) => { setInformationCurrent(e.target.checked); setBookingError(""); }}/><span>Je confirme que mes coordonnées et les renseignements de mon animal sont à jour.</span></label>{bookingError && <p ref={bookingErrorAlert} className="booking-error" role="alert" tabIndex={-1}>{bookingError}</p>}<button type="button" className="primary-button wide" onClick={confirmBooking} aria-describedby={dateSlots.length ? "time-selection-status" : undefined} disabled={bookingBusy || availabilityLoading || !selectedSlot}>{bookingBusy ? requiresDeposit ? "Opening secure checkout…" : "Réservation en cours…" : selectedSlot ? requiresDeposit ? `Continue to ${money(service?.depositCents || 0, catalog?.location.currency)} deposit` : `${availability?.bookingMode === "request" ? "Demander" : "Réserver"} à ${selectedSlot.timeLabel}` : "Choisir une heure disponible"}</button></>}
          </div>}
          {step === "confirmed" && <div className="confirmation"><span className="success-mark">✓</span><small>{bookingStatus === "requested" ? "Awaiting salon confirmation" : "Rendez-vous confirmé"}</small><h3 data-booking-step-heading tabIndex={-1}>{bookingStatus === "requested" ? `${pet}’s requested time` : `Le rendez-vous de ${pet}`}<br/>{selectedDate ? dayLabel(selectedDate) : ""} à {selectedSlot?.timeLabel}</h3><div className="confirmation-details"><span className="pet-medallion small">{pet.slice(0,1)}</span><div><strong>{service ? careLabel(service.name) : ""}</strong><small>{locationName} · avec {selectedSlot?.staff[0]?.name || "the care team"}</small></div></div><p className="portal-link-note">{squareManaged ? "Votre rendez-vous est enregistré et relié au profil de votre animal. Retrouvez vos informations dans votre profil BOPOIL." : authenticatedBooking ? "This visit is already connected to your private pet profile." : "Use “Manage booking” anytime to request a fresh private access link."}</p><button className="primary-button wide" onClick={() => setStep("search")}>Terminer</button></div>}
        </div>
      </section>
      <footer><div className="brand footer-brand"><span className="brand-mark">{brandInitial}</span><span>{salonName}</span></div><p>Au plaisir de prendre soin de votre compagnon.</p><span>Réservation BOPOIL · Coat &amp; Care</span></footer>
    </div>
    {manageOpen && <div className="portal-request-backdrop" onMouseDown={(event) => { if (event.currentTarget === event.target) setManageOpen(false); }}><section className="portal-request" ref={manageDialog} role="dialog" aria-modal="true" aria-labelledby="portal-dialog-title"><button type="button" className="portal-request-close" onClick={() => setManageOpen(false)} aria-label="Fermer la connexion">×</button><span className="pet-medallion" aria-hidden="true">♡</span><small>Votre profil BOPOIL</small><h2 id="portal-dialog-title">Vos animaux et rendez-vous.</h2><p>{emailDeliveryConfigured ? "Entrez le courriel associé à votre profil. Nous vous enverrons un lien de connexion privé." : `Submit your booking email and ${salonName} will prepare secure access. Automatic email delivery is not available yet, so contact the salon if you need the link right away.`}</p><form onSubmit={(event) => { event.preventDefault(); void requestPortalLink(); }}><label><span>Votre courriel</span><input type="email" autoComplete="email" required value={manageEmail} onChange={(event) => setManageEmail(event.target.value)} placeholder="you@example.com"/></label>{manageMessage && <div className="portal-request-message" role="status">{manageMessage}</div>}{manageError && <div className="booking-error" role="alert">{manageError}</div>}<button type="submit" className="primary-button wide" disabled={manageBusy}>{manageBusy ? "Préparation du lien…" : emailDeliveryConfigured ? "Recevoir mon lien de connexion" : "Demander mon lien"}</button></form></section></div>}
    {waitlistOpen && <div className="portal-request-backdrop" onMouseDown={(event) => { if (event.currentTarget === event.target && !waitlistBusy) setWaitlistOpen(false); }}>
      <section className="portal-request waitlist-request" ref={waitlistDialog} role="dialog" aria-modal="true" aria-labelledby="waitlist-dialog-title">
        <button type="button" disabled={waitlistBusy} className="portal-request-close" onClick={() => setWaitlistOpen(false)} aria-label="Close priority waitlist">×</button>
        <span className="pet-medallion" aria-hidden="true">♡</span><small>Priority waitlist</small>
        <h2 id="waitlist-dialog-title">{waitlistMessage ? `${pet} is on the list.` : "Be first to know."}</h2>
        {waitlistMessage ? <>
          <div className="waitlist-success" role="status"><span aria-hidden="true">✓</span><p>{waitlistMessage}</p></div>
          <button className="primary-button wide" onClick={() => setWaitlistOpen(false)}>Terminer</button>
        </> : <form onSubmit={(event) => { event.preventDefault(); void joinWaitlist(); }}>
          <p>We’ll watch real team and equipment capacity for {service?.name.toLowerCase()} openings that fit your preferences.</p>
          {authenticatedBooking ? <div className="saved-booking-identity">
            <span className="pet-medallion small">{selectedOwnedPet?.name.slice(0, 1)}</span>
            <div><strong>{selectedOwnedPet?.name} · {selectedOwnedPet?.breed}</strong><small>Vos coordonnées enregistrées seront utilisées.</small></div>
          </div> : <>
            <div className="waitlist-window">
              <label><span>Your name</span><input required autoComplete="name" value={clientName} onChange={(event) => setClientName(event.target.value)} placeholder="Pet parent name"/></label>
              <label><span>Pet</span><input required value={pet} onChange={(event) => setPet(event.target.value)} placeholder="Pet name"/></label>
              <label><span>Email</span><input required type="email" autoComplete="email" value={email} onChange={(event) => setEmail(event.target.value)} placeholder="you@example.com"/></label>
              <label><span>Phone</span><input required type="tel" autoComplete="tel" value={phone} onChange={(event) => setPhone(event.target.value)} placeholder="(416) 555-0123"/></label>
            </div>
            <label><span>Breed or mix <small>(optional)</small></span><input value={breed} onChange={(event) => setBreed(event.target.value)} placeholder="À préciser plus tard"/></label>
          </>}
          <div className="waitlist-window">
            <label><span>From</span><input type="date" value={selectedDate} readOnly/></label>
            <label><span>Through</span><input required type="date" min={selectedDate} max={addDays(selectedDate, 14)} value={waitlistTo} onChange={(event) => setWaitlistTo(event.target.value)}/></label>
          </div>
          <label><span>Best time</span><select value={timePreference} onChange={(event) => setTimePreference(event.target.value)}><option value="anytime">Any time</option><option value="morning">Morning</option><option value="afternoon">Afternoon</option></select></label>
          <label><span>Anything we should know?</span><textarea value={waitlistNotes} onChange={(event) => setWaitlistNotes(event.target.value)} placeholder="Flexible days, timing, or care notes…"/></label>
          <label className="policy-check waitlist-consent"><input required type="checkbox" checked={contactConsent} onChange={(event) => setContactConsent(event.target.checked)}/><span>The salon may contact me about matching openings.</span></label>
          {waitlistError && <p className="booking-error" role="alert">{waitlistError}</p>}
          <button type="submit" className="primary-button wide" disabled={waitlistBusy || !contactConsent}>{waitlistBusy ? "Saving preferences…" : "Join priority list"}</button>
        </form>}
      </section>
    </div>}
  </main>;
}
