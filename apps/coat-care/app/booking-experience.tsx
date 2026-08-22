"use client";

import Image from "next/image";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

type BookingStep = "search" | "services" | "times" | "confirmed";
type CatalogService = { id: string; name: string; description: string; durationMinutes: number; bufferMinutes: number; priceFromCents: number; depositCents: number };
type Catalog = { organization: { name: string; slug: string; contactPhone: string; contactEmail: string }; location: { name: string; slug: string; city: string; region: string; currency: string; timezone: string }; locations: Array<{ slug: string; name: string; city: string; region: string }>; booking: { allowOnlineBooking: boolean; bookingMode: string; minimumLeadMinutes: number; bookingWindowDays: number; requireOnlineDeposit: boolean; depositHoldMinutes: number }; delivery?: { email?: { configured?: boolean }; sms?: { configured?: boolean } }; services: CatalogService[] };
type Slot = { startsAt: string; endsAt: string; date: string; timeLabel: string; staff: Array<{ id: string; name: string }>; remainingCapacity: number };
type Availability = { bookingMode: string; range: { from: string; through: string; bookingWindowEnd: string; previousFrom: string | null; nextFrom: string | null }; dates: Array<{ date: string; slots: Slot[] }> };
type BookingRecommendation = { serviceId: string; serviceName: string; locationId: string; locationSlug: string; locationName: string };
type BookingPet = { id: string; name: string; breed: string; recommendation: BookingRecommendation | null };
type BookingContext = { firstName: string; fastPhoneSignInEnabled?: boolean; organization: { slug: string }; lastLocation: { id: string; slug: string; name: string }; pets: BookingPet[] };
type ClientAuthStep = "closed" | "phone" | "code";
type ClientAuthResult = { ok?: boolean; configured?: boolean; expiresInSeconds?: number; retryAfterSeconds?: number; verified?: boolean; authenticated?: boolean; fastSignInEnabled?: boolean; status?: "returning_client" | "new_client"; message?: string; error?: string };

const icons = ["✦", "◌", "⌁", "◇", "♡"];
function money(cents: number, currency = "CAD") { return new Intl.NumberFormat(currency === "USD" ? "en-US" : "en-CA", { style: "currency", currency, maximumFractionDigits: 0 }).format(cents / 100); }
function duration(minutes: number) { return minutes >= 60 ? `${Math.floor(minutes / 60)} hr${minutes % 60 ? ` ${minutes % 60} min` : ""}` : `${minutes} min`; }
function dayLabel(day: string, compact = false) { return new Intl.DateTimeFormat("en-CA", { weekday: compact ? "short" : "long", month: "short", day: "numeric", timeZone: "UTC" }).format(new Date(`${day}T12:00:00Z`)); }
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
  const [step, setStep] = useState<BookingStep>("search");
  const [catalog, setCatalog] = useState<Catalog | null>(null); const [availability, setAvailability] = useState<Availability | null>(null);
  const [serviceId, setServiceId] = useState(""); const [selectedDate, setSelectedDate] = useState(""); const [selectedStartsAt, setSelectedStartsAt] = useState("");
  const [pet, setPet] = useState(""); const [clientName, setClientName] = useState(""); const [email, setEmail] = useState(""); const [phone, setPhone] = useState(""); const [breed, setBreed] = useState("");
  const [bookingContext, setBookingContext] = useState<BookingContext | null>(null); const [contextChecked, setContextChecked] = useState(false); const [selectedPetId, setSelectedPetId] = useState("");
  const [clientAuthStep, setClientAuthStep] = useState<ClientAuthStep>("closed"); const [clientAuthPurpose, setClientAuthPurpose] = useState<"signin" | "enroll">("signin"); const [authPhone, setAuthPhone] = useState(""); const [authCode, setAuthCode] = useState(""); const [authBusy, setAuthBusy] = useState(false); const [authRetryAfter, setAuthRetryAfter] = useState(0); const [authError, setAuthError] = useState(""); const [authMessage, setAuthMessage] = useState(""); const [fastAccessNotice, setFastAccessNotice] = useState("");
  const [policyAccepted, setPolicyAccepted] = useState(false); const [bookingBusy, setBookingBusy] = useState(false); const [availabilityLoading, setAvailabilityLoading] = useState(false); const [bookingError, setBookingError] = useState(""); const [bookingStatus, setBookingStatus] = useState("confirmed");
  const [manageOpen, setManageOpen] = useState(false); const [manageEmail, setManageEmail] = useState(""); const [manageMessage, setManageMessage] = useState(""); const [manageError, setManageError] = useState(""); const [manageBusy, setManageBusy] = useState(false);
  const [waitlistOpen, setWaitlistOpen] = useState(false); const [waitlistBusy, setWaitlistBusy] = useState(false); const [waitlistMessage, setWaitlistMessage] = useState(""); const [waitlistError, setWaitlistError] = useState(""); const [waitlistTo, setWaitlistTo] = useState(""); const [timePreference, setTimePreference] = useState("anytime"); const [waitlistNotes, setWaitlistNotes] = useState(""); const [contactConsent, setContactConsent] = useState(false);
  const [showAllTimes, setShowAllTimes] = useState(false); const [findingNextOpening, setFindingNextOpening] = useState(false); const [manageReturnTo, setManageReturnTo] = useState("");
  const [catalogVersion, setCatalogVersion] = useState(0);
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
  }, [availability?.range.nextFrom, requestAvailabilityPage, serviceId]);

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
    fetch(catalogUrl).then(async (response) => { const result = await response.json() as Catalog & { error?: string }; if (!response.ok) throw new Error(result.error || "Service menu unavailable."); setCatalog(result); const first = result.services[0]?.id || ""; setServiceId(first); if (result.booking.allowOnlineBooking) await loadAvailability(first); else { const today = new Date().toISOString().slice(0, 10); setAvailability({ bookingMode: result.booking.bookingMode, range: { from: today, through: today, bookingWindowEnd: today, previousFrom: null, nextFrom: null }, dates: [] }); setSelectedDate(""); setSelectedStartsAt(""); } }).catch((error) => setBookingError(error instanceof Error ? error.message : "Service menu unavailable."));
  }, [catalogVersion, loadAvailability, locationSlug, storefrontSlug]);

  useEffect(() => {
    const timer = window.setTimeout(() => { void loadBookingContext(); }, 0);
    return () => window.clearTimeout(timer);
  }, [loadBookingContext]);

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
      const nextServiceId = requestedService?.id || recommendedService?.id || catalog.services[0]?.id || "";
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

  function openServices() { setStep("services"); document.getElementById("booking")?.scrollIntoView({ behavior: "smooth", block: "start" }); }
  function chooseService(id: string) { setServiceId(id); setStep("times"); setShowAllTimes(false); if (catalog?.booking.allowOnlineBooking !== false) void loadAvailability(id, { preferredDate: "" }); document.getElementById("booking")?.scrollIntoView({ behavior: "smooth", block: "start" }); }
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
    const nextService = recommendation && catalog?.services.some((item) => item.id === recommendation.serviceId) ? recommendation.serviceId : serviceId;
    if (nextService) chooseService(nextService); else openServices();
  }
  function continueAsGuest() {
    if (authPhone.trim()) setPhone(authPhone.trim());
    setClientAuthStep("closed"); setAuthError(""); setAuthMessage(""); openServices();
  }
  function openEmailAccess() { setClientAuthStep("closed"); setAuthError(""); setAuthMessage(""); setManageOpen(true); }
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
    if (bookingContext && !selectedOwnedPet) { showBookingError("Choose one of the pets in your private profile."); return; }
    if (!authenticatedBooking) {
      const phoneDigits = phone.replace(/\D/g, "");
      if (!clientName.trim() || !pet.trim()) { showBookingError("Add your name and your pet’s name."); return; }
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) { showBookingError("Enter a valid email address."); return; }
      if (phoneDigits.length < 10 || phoneDigits.length > 15) { showBookingError("Enter a valid phone number with area code."); return; }
    }
    if (!policyAccepted) { showBookingError("Review and accept the booking and cancellation policy to continue."); return; }
    setBookingBusy(true); setBookingError("");
    try {
      const identity = authenticatedBooking
        ? { petId: selectedOwnedPet!.id }
        : { clientName, email, phone, petName: pet, breed };
      const response = await fetch("/api/bookings", { method: "POST", credentials: "same-origin", headers: { "content-type": "application/json" }, body: JSON.stringify({ salonSlug: storefrontSlug || undefined, locationSlug: locationSlug || undefined, ...identity, serviceId: service.id, startsAt: selectedSlot.startsAt, policyAccepted }) });
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
  const salonName = catalog?.organization.name || (storefrontSlug ? "Your grooming salon" : "Coat & Care");
  const brandInitial = salonName.slice(0, 1).toUpperCase();
  const onlineBookingOpen = catalog?.booking.allowOnlineBooking !== false;
  const requiresDeposit = Boolean(catalog?.booking.requireOnlineDeposit && service && service.depositCents > 0);
  const emailDeliveryConfigured = catalog?.delivery?.email?.configured !== false;
  const smsDeliveryConfigured = catalog?.delivery?.sms?.configured === true;
  return <main className="app-shell">
    <header className="topbar"><button className="brand" onClick={() => setStep("search")} aria-label={`${salonName} home`}><span className="brand-mark">{brandInitial}</span><span>{salonName}</span></button><nav className="view-switcher" aria-label="Application view"><button className="active">Client experience</button><button onClick={() => window.location.assign("/salon")}>Salon OS</button></nav><div className="top-actions"><button className="text-button" onClick={() => setManageOpen(true)}>Manage booking</button><button className="avatar-button" onClick={() => setManageOpen(true)} aria-label="Open pet-parent portal">♡</button></div></header>
    <div className="client-view">
      <section className="hero-section"><Image className="hero-image" src="/grooming-hero.jpg" alt="A freshly groomed poodle in a warm, modern salon" fill priority unoptimized sizes="(max-width: 760px) 100vw, 94vw"/><div className="hero-shade"/><div className="hero-content"><span className="eyebrow light">Thoughtful grooming, beautifully simple</span><h1>A happier grooming day<br/>starts right here.</h1><p>Book trusted care tailored to your pet—without the back-and-forth.</p></div>
        <form className={`search-panel ${catalog && catalog.locations.length > 1 ? "with-location" : ""}`} aria-label="Find an appointment" onSubmit={(event) => { event.preventDefault(); if (serviceId && onlineBookingOpen) chooseService(serviceId); }}>{catalog && catalog.locations.length > 1 && <label><span>Location</span><select value={catalog.location.slug} onChange={(event) => window.location.assign(bookingContext ? bookingUrl(catalog.organization.slug, event.target.value, selectedPetId, serviceId) : `/book/${encodeURIComponent(catalog.organization.slug)}/${encodeURIComponent(event.target.value)}`)}>{catalog.locations.map((item) => <option value={item.slug} key={item.slug}>{item.name} · {item.city}</option>)}</select></label>}<label><span>{bookingContext?.pets.length ? "Pet" : "Pet name"}</span>{bookingContext?.pets.length ? <select value={selectedPetId} onChange={(event) => selectOwnedPet(event.target.value)}>{bookingContext.pets.map((item) => <option key={item.id} value={item.id}>{item.name} · {item.breed}</option>)}</select> : <input value={pet} onChange={(event) => setPet(event.target.value)} placeholder="Your pet’s name" autoComplete="off"/>}</label><label><span>Service</span><select value={serviceId} onChange={(event) => { setServiceId(event.target.value); if (onlineBookingOpen) void loadAvailability(event.target.value); }}>{catalog?.services.map((item) => <option value={item.id} key={item.id}>{item.name}</option>)}</select></label><label><span>When</span><select value={selectedDate} onChange={(event) => chooseDate(event.target.value)} disabled={!onlineBookingOpen || availabilityLoading}>{availability?.dates.filter((item) => item.slots.length).map((item) => <option key={item.date} value={item.date}>{dayLabel(item.date)}</option>)}</select></label><button type="submit" className="search-button" disabled={!serviceId || !selectedDate || availabilityLoading || !onlineBookingOpen}>{onlineBookingOpen ? availabilityLoading ? "Checking…" : "Find a time" : "Online booking paused"} <span aria-hidden="true">→</span></button></form>
        {!catalog && bookingError && <div className="catalog-error" role="alert"><span>{bookingError}</span><button onClick={() => { setBookingError(""); setCatalogVersion((value) => value + 1); }}>Try again</button></div>}
      </section>
      <section className="trust-row" aria-label="Booking qualities"><div><strong>Live</strong><span>◎</span><small>Capacity-checked availability</small></div><div><strong>Calm</strong><span>♡</span><small>Care notes travel with your pet</small></div><div><strong>Private</strong><span>✓</span><small>Secure booking management</small></div></section>
      <section className="services-section" id="services"><div className="section-heading"><div><span className="eyebrow">Care for every kind of coat</span><h2>Choose their perfect visit</h2></div><button className="text-link" onClick={openServices}>View all services →</button></div><div className="service-grid">{catalog?.services.map((item, index) => <button className="service-card" key={item.id} onClick={() => chooseService(item.id)}><span className={`service-art art-${index % 3 + 1}`}><b>{icons[index % icons.length]}</b><i>{duration(item.durationMinutes)}</i></span><span className="service-copy"><strong>{item.name}</strong><small>{item.description}</small><span><b>from {money(item.priceFromCents, catalog.location.currency)}</b><em>{duration(item.durationMinutes)}</em></span></span></button>)}</div></section>
      <section className="booking-flow" id="booking"><div className="booking-intro"><span className="eyebrow">Booking made calm</span><h2>{step === "confirmed" ? bookingStatus === "requested" ? "Request received." : "You’re all set." : "Let’s plan their visit."}</h2><p>{step === "confirmed" ? bookingStatus === "requested" ? `The team at ${catalog?.location.name || "the salon"} will review ${pet}’s time and confirm shortly.` : `Everything ${pet} needs is saved and ready for the salon.` : "Every opening below is checked against team skills, working hours, equipment, and pets already in care."}</p><div className="step-track" aria-label={`Step ${stepNumber} of 4`}>{[1,2,3,4].map((number) => <span key={number} className={number <= stepNumber ? "done" : ""}/>)}</div></div>
        <div className="booking-card" ref={bookingCard}>
          {step === "search" && !contextChecked && <div className="booking-context-loading" role="status" aria-live="polite"><span className="pet-medallion">♡</span><h3>Getting everything ready…</h3><p>Checking this browser for your private pet profile.</p></div>}
          {step === "search" && contextChecked && clientAuthStep !== "closed" && <div className="client-auth-card">
            <button type="button" className="auth-back" onClick={() => { setClientAuthStep("closed"); setAuthError(""); setAuthMessage(""); }}>← {clientAuthPurpose === "enroll" ? "Not now" : "Back"}</button>
            <span className="eyebrow">{clientAuthPurpose === "enroll" ? "Faster next time" : "Welcome back"}</span>
            <h3>{clientAuthStep === "phone" ? clientAuthPurpose === "enroll" ? "Use this mobile next time." : "Bring back your pet profile." : "Enter your secure code."}</h3>
            <p id="client-auth-instructions">{clientAuthStep === "phone" ? clientAuthPurpose === "enroll" ? "Verify the mobile you want to use for fast, private access on a new device." : "We’ll text a short code. We never reveal whether a number is already on file." : authMessage}</p>
            {clientAuthStep === "phone" ? <form onSubmit={(event) => { event.preventDefault(); void startClientAuth(); }}>
              <label>
                <span>Mobile number</span>
                <input ref={authPhoneInput} type="tel" inputMode="tel" enterKeyHint="send" autoComplete="tel" value={authPhone} onChange={(event) => { setAuthPhone(event.target.value); setAuthError(""); }} placeholder="(416) 555-0123" aria-invalid={Boolean(authError)} aria-describedby={authError ? "client-auth-instructions auth-phone-error" : "client-auth-instructions"} autoFocus/>
              </label>
              {authError && <p id="auth-phone-error" className="booking-error" role="alert">{authError}</p>}
              <button className="primary-button wide" disabled={authBusy}>{authBusy ? "Preparing secure text…" : "Text me a code"}</button>
            </form> : <form onSubmit={(event) => { event.preventDefault(); void verifyClientAuth(); }}>
              <label>
                <span>Six-digit code</span>
                <input ref={authCodeInput} className="one-time-code" type="text" inputMode="numeric" enterKeyHint="done" autoComplete="one-time-code" pattern="[0-9]*" maxLength={6} value={authCode} onChange={(event) => { setAuthCode(event.target.value.replace(/\D/g, "").slice(0, 6)); setAuthError(""); }} placeholder="000000" aria-invalid={Boolean(authError)} aria-describedby={authError ? "client-auth-instructions auth-code-error" : "client-auth-instructions"} autoFocus/>
              </label>
              {authError && <p id="auth-code-error" className="booking-error" role="alert">{authError}</p>}
              <button className="primary-button wide" disabled={authBusy || authCode.length !== 6}>{authBusy ? "Checking code…" : clientAuthPurpose === "enroll" ? "Use this mobile next time" : "Continue securely"}</button>
              <button type="button" className="auth-resend" disabled={authBusy || authRetryAfter > 0} onClick={() => void startClientAuth()}>{authRetryAfter > 0 ? `Send another code in ${authRetryAfter}s` : "Send another code"}</button>
              <button type="button" className="auth-resend" disabled={authBusy} onClick={() => { setClientAuthStep("phone"); setAuthCode(""); setAuthRetryAfter(0); setAuthError(""); focusAuthInput("phone"); }}>Use a different number</button>
            </form>}
            <div className="auth-alternatives">{clientAuthPurpose === "signin" ? <><button type="button" onClick={openEmailAccess}>Use email instead</button><span aria-hidden="true">or</span><button type="button" onClick={continueAsGuest}>Continue as guest</button></> : <button type="button" onClick={() => setClientAuthStep("closed")}>Not now</button>}</div>
          </div>}
          {step === "search" && contextChecked && clientAuthStep === "closed" && bookingContext && <div className="returning-booking"><div className="returning-heading"><span className="eyebrow">Welcome back</span><h3>Hi {bookingContext.firstName}, who’s visiting?</h3><p>Your saved details stay private and are added securely at confirmation.</p></div>{fastAccessNotice && <div className="fast-access-notice" role="status">✓ {fastAccessNotice}</div>}{bookingContext.pets.length ? <div className="returning-pets">{bookingContext.pets.map((item, index) => <button type="button" key={item.id} className={selectedPetId === item.id ? "selected" : ""} onClick={() => bookAgain(item)}><span className={`pet-medallion small tone-${index % 3}`}>{item.name.slice(0,1)}</span><span><strong>{item.name}</strong><small>{item.breed}</small><em>{item.recommendation ? `${item.recommendation.serviceName} · ${item.recommendation.locationName}` : "Choose their next service"}</em></span><b>{item.recommendation ? "Book again →" : "Choose care →"}</b></button>)}</div> : <div className="returning-empty"><span className="pet-medallion">♡</span><p>Add a pet in your private portal before booking with saved details.</p><button type="button" onClick={() => window.location.assign("/portal")}>Open pet portal</button></div>}<div className="returning-actions"><button type="button" className="secondary-button" onClick={openServices}>Choose another service</button>{smsDeliveryConfigured && bookingContext.fastPhoneSignInEnabled === false && <button type="button" className="fast-access-button" onClick={() => openClientAuth("enroll")}>Use this mobile next time</button>}</div></div>}
          {step === "search" && contextChecked && clientAuthStep === "closed" && !bookingContext && <div className="empty-booking"><span className="pet-medallion">♡</span><h3>Ready when they are.</h3><p>Browse tailored services and genuine availability, or securely bring back your saved pets.</p><button className="primary-button" onClick={openServices}>Start a new booking</button>{smsDeliveryConfigured ? <button className="returning-link" onClick={() => openClientAuth("signin")}>Already a client? Continue with mobile →</button> : <button className="returning-link" onClick={openEmailAccess}>Already a client? Use email →</button>}</div>}
          {step === "services" && <div><div className="card-title"><div><small>Step 2 of 4</small><h3 data-booking-step-heading tabIndex={-1}>What does {pet || "your pet"} need?</h3></div><span className="pet-medallion small">{pet.slice(0,1) || "♡"}</span></div><div className="option-list">{catalog?.services.map((item) => <button key={item.id} onClick={() => chooseService(item.id)}><span><strong>{item.name}</strong><small>{item.description}</small></span><span><b>{money(item.priceFromCents, catalog.location.currency)}</b><em>→</em></span></button>)}</div>{bookingError && <p ref={bookingErrorAlert} className="booking-error" role="alert" tabIndex={-1}>{bookingError}</p>}</div>}
          {step === "times" && <div><div className="card-title"><div><small>Step 3 of 4</small><h3 data-booking-step-heading tabIndex={-1}>{onlineBookingOpen ? "Pick a live opening" : "Online booking is paused"}</h3></div><button className="mini-link" onClick={openServices}>Change service</button></div>{service && <div className="booking-summary"><span aria-hidden="true">✦</span><div><strong>{service.name}</strong><small>{duration(service.durationMinutes)} · {availability?.bookingMode === "request" ? "request confirmation" : "instant confirmation"}</small></div><b>{money(service.priceFromCents, catalog?.location.currency)}</b></div>}
            {!onlineBookingOpen ? <div className="booking-paused" role="status"><strong>This salon is not taking online bookings right now.</strong><p>Contact {catalog?.organization.contactPhone || catalog?.organization.contactEmail || salonName} and the team can help plan a visit.</p></div> : availabilityLoading ? <div className="slot-loading" role="status" aria-live="polite" aria-label={findingNextOpening ? "Finding the next available opening" : "Checking live openings"}><span/><span/><span/></div> : availability ? <>
              <div className="calendar-navigation" role="group" aria-label="Browse the salon booking window">
                <button type="button" className="secondary-button" disabled={!availability.range.previousFrom} onClick={() => availability.range.previousFrom && void loadAvailability(serviceId, { from: availability.range.previousFrom, preferredDate: "" })} aria-label="Show earlier appointment dates">← Earlier</button>
                <span role="status">{dayLabel(availability.range.from, true)} – {dayLabel(availability.range.through, true)}</span>
                <button type="button" className="secondary-button" disabled={!availability.range.nextFrom} onClick={() => availability.range.nextFrom && void loadAvailability(serviceId, { from: availability.range.nextFrom, preferredDate: "" })} aria-label="Show later appointment dates">Later →</button>
                {availability.range.nextFrom && <button type="button" className="secondary-button" onClick={() => void findNextOpening()} aria-label={`Find the next available ${service?.name || "service"} opening after ${dayLabel(availability.range.through)}`}>Find next opening</button>}
              </div>
              <div className="date-strip" role="group" aria-label="Available dates">{availability.dates.map((item) => <button type="button" key={item.date} className={selectedDate === item.date ? "selected" : ""} aria-label={`${dayLabel(item.date)}: ${item.slots.length ? `${item.slots.length} available ${item.slots.length === 1 ? "time" : "times"}` : "no available times"}`} aria-pressed={selectedDate === item.date} disabled={!item.slots.length} onClick={() => chooseDate(item.date)}><small>{dayLabel(item.date, true).split(",")[0]}</small><strong>{new Date(`${item.date}T12:00:00Z`).getUTCDate()}</strong><em>{item.slots.length || "—"}</em></button>)}</div>
              {dateSlots.length ? <>
                <div className="time-periods">
                  {(["morning", "afternoon", "evening"] as const).map((period) => {
                    const periodSlots = visibleDateSlots.filter((slot) => slotPeriod(slot, catalog?.location.timezone || "America/Toronto") === period);
                    if (!periodSlots.length) return null;
                    const headingId = `booking-times-${period}`;
                    return <section className="time-period" key={period} aria-labelledby={headingId}><h4 id={headingId}>{period[0].toUpperCase()}{period.slice(1)}</h4><div className="time-grid live-times" role="group" aria-labelledby={headingId}>{periodSlots.map((slot) => { const staffLabel = slot.staff.length > 1 ? `${slot.staff.length} groomers available` : slot.staff[0]?.name ? `with ${slot.staff[0].name}` : "with the care team"; return <button type="button" key={slot.startsAt} className={selectedStartsAt === slot.startsAt ? "selected" : ""} aria-label={`${dayLabel(selectedDate)} at ${slot.timeLabel}, ${staffLabel}`} aria-pressed={selectedStartsAt === slot.startsAt} onClick={() => { setSelectedStartsAt(slot.startsAt); setBookingError(""); }}><strong>{slot.timeLabel}</strong><small>{staffLabel}</small></button>; })}</div></section>;
                  })}
                </div>
                {suggestedDateSlots.length < dateSlots.length && <button type="button" className="secondary-button wide" aria-expanded={showAllTimes} onClick={() => setShowAllTimes((value) => !value)}>{showAllTimes ? "Show suggested times" : `Show all ${dateSlots.length} times`}</button>}
                <p id="time-selection-status" className={`time-selection-status ${selectedSlot ? "selected" : ""}`} role="status" aria-live="polite">{selectedSlot ? `Selected ${dayLabel(selectedDate)} at ${selectedSlot.timeLabel}` : `Choose a time on ${dayLabel(selectedDate)} to continue.`}</p>
              </> : <div className="no-slots"><span aria-hidden="true">♡</span><strong>No safe openings this day</strong><small>Try later dates, find the next opening, or join the priority list and we’ll contact you when a matching opening appears.</small><button type="button" onClick={openWaitlist}>Join priority list</button></div>}
            </> : null}
            {authenticatedBooking ? <div className="saved-booking-identity"><span className="pet-medallion small">{selectedOwnedPet?.name.slice(0,1)}</span><div><strong>{selectedOwnedPet?.name} · {selectedOwnedPet?.breed}</strong><small>Your saved contact and care details will be used securely.</small></div><button type="button" onClick={() => setStep("search")}>Change pet</button></div> : <div className="booking-fields"><label><span>Your name</span><input value={clientName} onChange={(e) => setClientName(e.target.value)} placeholder="Pet parent name" autoComplete="name" required/></label><label><span>Pet name</span><input value={pet} onChange={(e) => setPet(e.target.value)} placeholder="Your pet’s name" autoComplete="off" required/></label><label><span>Email</span><input value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@example.com" type="email" autoComplete="email" required/></label><label><span>Phone</span><input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="(416) 555-0123" type="tel" inputMode="tel" autoComplete="tel" required/></label><label><span>Breed or mix <small>(optional)</small></span><input value={breed} onChange={(e) => setBreed(e.target.value)} placeholder="You can add this later"/></label></div>}
            {onlineBookingOpen && <><div className={`deposit-note ${requiresDeposit ? "required" : ""}`}><span aria-hidden="true">{requiresDeposit ? "↗" : "✓"}</span><p><strong>{service && service.depositCents > 0 ? `${money(service.depositCents, catalog?.location.currency)} deposit${requiresDeposit ? " due securely now" : " listed for this service"}.` : "No online deposit is due for this service."}</strong><br/>{requiresDeposit ? `We’ll hold this opening for ${catalog?.booking.depositHoldMinutes} minutes while you pay. It confirms only after verified payment.` : "Your selected opening is rechecked when you reserve."}</p></div><details className="booking-policy"><summary>Review booking &amp; cancellation policy</summary><p>Appointments are subject to the salon’s current cancellation, late-arrival, no-show, and deposit terms. Contact {catalog?.organization.contactPhone || catalog?.organization.contactEmail || "the salon"} before continuing if you have not received or reviewed those terms.</p></details><label className="policy-check"><input type="checkbox" checked={policyAccepted} onChange={(e) => { setPolicyAccepted(e.target.checked); setBookingError(""); }}/><span>I have reviewed and agree to the booking and cancellation policy.</span></label>{bookingError && <p ref={bookingErrorAlert} className="booking-error" role="alert" tabIndex={-1}>{bookingError}</p>}<button type="button" className="primary-button wide" onClick={confirmBooking} aria-describedby={dateSlots.length ? "time-selection-status" : undefined} disabled={bookingBusy || availabilityLoading || !selectedSlot}>{bookingBusy ? requiresDeposit ? "Opening secure checkout…" : "Rechecking & reserving…" : selectedSlot ? requiresDeposit ? `Continue to ${money(service?.depositCents || 0, catalog?.location.currency)} deposit` : `${availability?.bookingMode === "request" ? "Request" : "Reserve"} ${selectedSlot.timeLabel}` : "Choose an available time"}</button></>}
          </div>}
          {step === "confirmed" && <div className="confirmation"><span className="success-mark">✓</span><small>{bookingStatus === "requested" ? "Awaiting salon confirmation" : "Appointment confirmed"}</small><h3 data-booking-step-heading tabIndex={-1}>{bookingStatus === "requested" ? `${pet}’s requested time` : `${pet} is booked for`}<br/>{selectedDate ? dayLabel(selectedDate) : ""} at {selectedSlot?.timeLabel}</h3><div className="confirmation-details"><span className="pet-medallion small">{pet.slice(0,1)}</span><div><strong>{service?.name}</strong><small>{locationName} · with {selectedSlot?.staff[0]?.name || "the care team"}</small></div></div><p className="portal-link-note">{authenticatedBooking ? "This visit is already connected to your private pet profile." : "Use “Manage booking” anytime to request a fresh private access link."}</p><button className="primary-button wide" onClick={() => setStep("search")}>Done</button></div>}
        </div>
      </section>
      <footer><div className="brand footer-brand"><span className="brand-mark">{brandInitial}</span><span>{salonName}</span></div><p>Better days for pets, their people, and the teams who care for them.</p><span>Booking powered by Coat &amp; Care · Canada / US</span></footer>
    </div>
    {manageOpen && <div className="portal-request-backdrop" onMouseDown={(event) => { if (event.currentTarget === event.target) setManageOpen(false); }}><section className="portal-request" ref={manageDialog} role="dialog" aria-modal="true" aria-labelledby="portal-dialog-title"><button type="button" className="portal-request-close" onClick={() => setManageOpen(false)} aria-label="Close pet-parent portal">×</button><span className="pet-medallion" aria-hidden="true">♡</span><small>Pet-parent portal</small><h2 id="portal-dialog-title">Manage pets and appointments.</h2><p>{emailDeliveryConfigured ? "Request a private link for the email used on your booking. For privacy, we never confirm whether an address is on file." : `Submit your booking email and ${salonName} will prepare secure access. Automatic email delivery is not available yet, so contact the salon if you need the link right away.`}</p><form onSubmit={(event) => { event.preventDefault(); void requestPortalLink(); }}><label><span>Booking email</span><input type="email" autoComplete="email" required value={manageEmail} onChange={(event) => setManageEmail(event.target.value)} placeholder="you@example.com"/></label>{manageMessage && <div className="portal-request-message" role="status">{manageMessage}</div>}{manageError && <div className="booking-error" role="alert">{manageError}</div>}<button type="submit" className="primary-button wide" disabled={manageBusy}>{manageBusy ? "Preparing link…" : emailDeliveryConfigured ? "Email my private link" : "Request private link"}</button></form></section></div>}
    {waitlistOpen && <div className="portal-request-backdrop" onMouseDown={(event) => { if (event.currentTarget === event.target && !waitlistBusy) setWaitlistOpen(false); }}>
      <section className="portal-request waitlist-request" ref={waitlistDialog} role="dialog" aria-modal="true" aria-labelledby="waitlist-dialog-title">
        <button type="button" disabled={waitlistBusy} className="portal-request-close" onClick={() => setWaitlistOpen(false)} aria-label="Close priority waitlist">×</button>
        <span className="pet-medallion" aria-hidden="true">♡</span><small>Priority waitlist</small>
        <h2 id="waitlist-dialog-title">{waitlistMessage ? `${pet} is on the list.` : "Be first to know."}</h2>
        {waitlistMessage ? <>
          <div className="waitlist-success" role="status"><span aria-hidden="true">✓</span><p>{waitlistMessage}</p></div>
          <button className="primary-button wide" onClick={() => setWaitlistOpen(false)}>Done</button>
        </> : <form onSubmit={(event) => { event.preventDefault(); void joinWaitlist(); }}>
          <p>We’ll watch real team and equipment capacity for {service?.name.toLowerCase()} openings that fit your preferences.</p>
          {authenticatedBooking ? <div className="saved-booking-identity">
            <span className="pet-medallion small">{selectedOwnedPet?.name.slice(0, 1)}</span>
            <div><strong>{selectedOwnedPet?.name} · {selectedOwnedPet?.breed}</strong><small>Your saved contact details will be used securely.</small></div>
          </div> : <>
            <div className="waitlist-window">
              <label><span>Your name</span><input required autoComplete="name" value={clientName} onChange={(event) => setClientName(event.target.value)} placeholder="Pet parent name"/></label>
              <label><span>Pet</span><input required value={pet} onChange={(event) => setPet(event.target.value)} placeholder="Pet name"/></label>
              <label><span>Email</span><input required type="email" autoComplete="email" value={email} onChange={(event) => setEmail(event.target.value)} placeholder="you@example.com"/></label>
              <label><span>Phone</span><input required type="tel" autoComplete="tel" value={phone} onChange={(event) => setPhone(event.target.value)} placeholder="(416) 555-0123"/></label>
            </div>
            <label><span>Breed or mix <small>(optional)</small></span><input value={breed} onChange={(event) => setBreed(event.target.value)} placeholder="You can add this later"/></label>
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
