"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { ReportsView, ServicesView, TeamView } from "./business-views";
import { CheckoutModal, FinanceView } from "./financial-views";
import { CommunicationsView } from "./communications-view";
import { CareWorkspace } from "./care-workspace";
import { SettingsView } from "./settings-view";
import { WaitlistView } from "./waitlist-view";
import { SalonOnboarding } from "./salon-onboarding";
import { InventoryView } from "./inventory-view";
import { WorkforceView } from "./workforce-view";
import { QuickBookingModal } from "./quick-booking-modal";

type WorkspaceView =
  | "today"
  | "calendar"
  | "waitlist"
  | "clients"
  | "messages"
  | "services"
  | "team"
  | "workforce"
  | "inventory"
  | "finance"
  | "reports"
  | "settings";

type Appointment = {
  id: string;
  clientId: string;
  petId: string;
  serviceId: string;
  staffId: string | null;
  startsAt: string;
  endsAt: string;
  status: string;
  depositStatus: string;
  depositDueAt: string | null;
  priceEstimateCents: number;
  petName: string;
  breed: string;
  safetyLevel: string;
  handlingNotes: string;
  clientName: string;
  clientEmail: string;
  clientPhone: string;
  serviceName: string;
  staffName: string | null;
  managedBySquare: boolean;
};

type DashboardData = {
  user: {
    id: string;
    displayName: string;
    role: string;
    permissions: string[];
  };
  salon: {
    name: string;
    slug: string;
    location: string;
    locationSlug: string;
    city: string;
    region: string;
    currency: string;
    timezone: string;
  };
  locations: Array<{
    locationId: string;
    locationName: string;
    city: string;
    region: string;
    role: string;
  }>;
  organizations: Array<{
    organizationId: string;
    organizationName: string;
    organizationSlug: string;
    role: string;
  }>;
  metrics: {
    revenueCents: number;
    appointments: number;
    activePets: number;
    actionableMessages: number;
  };
  appointments: Appointment[];
};

type DirectoryPet = {
  id: string;
  name: string;
  breed: string;
  species: string;
  safetyLevel: string;
  handlingNotes: string;
  appointments: Array<{ id: string; status: string; startsAt: string }>;
  vaccinations: Array<{
    id: string;
    vaccineName: string;
    expiresOn: string;
    status: string;
    originalFilename: string;
  }>;
};

type DirectoryClient = {
  id: string;
  fullName: string;
  email: string;
  phone: string;
  marketingConsent: boolean;
  pets: DirectoryPet[];
};

const toneByStatus: Record<string, string> = {
  requested: "gold",
  confirmed: "lilac",
  arrived: "sage",
  bathing: "gold",
  drying: "gold",
  grooming: "coral",
  quality_check: "sage",
  ready: "sage",
  completed: "sage",
  cancelled: "muted",
  no_show: "muted",
};

const stages = [
  "requested",
  "confirmed",
  "arrived",
  "bathing",
  "drying",
  "grooming",
  "quality_check",
  "ready",
  "completed",
];
const nextStage: Record<string, string | undefined> = {
  requested: "confirmed",
  confirmed: "arrived",
  arrived: "bathing",
  bathing: "drying",
  drying: "grooming",
  grooming: "quality_check",
  quality_check: "ready",
  ready: "completed",
};
const operationalStageTargets = new Set([
  "arrived",
  "bathing",
  "drying",
  "grooming",
  "quality_check",
  "ready",
]);

const stageAction: Record<string, string> = {
  confirmed: "Confirm request",
  arrived: "Check in",
  bathing: "Start bathing",
  drying: "Move to drying",
  grooming: "Start grooming",
  quality_check: "Send to quality check",
  ready: "Mark ready for pickup",
  completed: "Complete appointment",
};

function formatMoney(cents: number, currency = "CAD") {
  return new Intl.NumberFormat(currency === "USD" ? "en-US" : "en-CA", {
    style: "currency",
    currency,
    maximumFractionDigits: 0,
  }).format(cents / 100);
}

function formatTime(value: string, timezone: string) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(value));
}

function dateKeyInZone(value: string | Date, timezone: string) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(typeof value === "string" ? new Date(value) : value);
  const fields = Object.fromEntries(
    parts
      .filter((part) => part.type !== "literal")
      .map((part) => [part.type, part.value]),
  );
  return `${fields.year}-${fields.month}-${fields.day}`;
}

function addDateKey(value: string, amount: number) {
  const date = new Date(`${value}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + amount);
  return date.toISOString().slice(0, 10);
}

function formatDay(value: string, timezone: string) {
  const key = dateKeyInZone(value, timezone);
  const today = dateKeyInZone(new Date(), timezone);
  if (key === today) return "Today";
  if (key === addDateKey(today, 1)) return "Tomorrow";
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    weekday: "short",
    month: "short",
    day: "numeric",
  }).format(new Date(value));
}

function statusLabel(status: string) {
  return status
    .replaceAll("_", " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

async function copyToClipboard(value: string) {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(value);
    return;
  }
  const field = document.createElement("textarea");
  field.value = value;
  field.setAttribute("readonly", "");
  field.style.position = "fixed";
  field.style.opacity = "0";
  document.body.appendChild(field);
  field.select();
  const copied = document.execCommand("copy");
  field.remove();
  if (!copied) throw new Error("Clipboard access is unavailable.");
}

function sameDay(value: string, day: string, timezone: string) {
  return dateKeyInZone(value, timezone) === day;
}

export function SalonWorkspace({ signedInName }: { signedInName: string }) {
  const [data, setData] = useState<DashboardData | null>(null);
  const [error, setError] = useState("");
  const [onboardingRequired, setOnboardingRequired] = useState(false);
  const [creatingSalon, setCreatingSalon] = useState(false);
  const [notice, setNotice] = useState("");
  const [filter, setFilter] = useState("All appointments");
  const [activeView, setActiveView] = useState<WorkspaceView>("today");
  const [selectedAppointment, setSelectedAppointment] =
    useState<Appointment | null>(null);
  const [actionBusy, setActionBusy] = useState(false);
  const [drawerError, setDrawerError] = useState("");
  const [handlingNotes, setHandlingNotes] = useState("");
  const [safetyLevel, setSafetyLevel] = useState("standard");
  const [clients, setClients] = useState<DirectoryClient[]>([]);
  const [clientsLoading, setClientsLoading] = useState(false);
  const [clientQuery, setClientQuery] = useState("");
  const [selectedClientId, setSelectedClientId] = useState<string | null>(null);
  const [checkoutAppointmentId, setCheckoutAppointmentId] = useState<
    string | null
  >(null);
  const [careAppointment, setCareAppointment] = useState<Appointment | null>(
    null,
  );
  const [quickBookingOpen, setQuickBookingOpen] = useState(false);
  const [matchedWaitlistCount, setMatchedWaitlistCount] = useState<
    number | null
  >(null);
  const [mobileToolsOpen, setMobileToolsOpen] = useState(false);
  const [teamCreateSignal, setTeamCreateSignal] = useState(0);
  const mobileToolsDialog = useRef<HTMLElement>(null);

  const loadDashboard = useCallback(async () => {
    const response = await fetch("/api/dashboard");
    const result = (await response.json()) as DashboardData & {
      error?: string;
      code?: string;
    };
    if (!response.ok) {
      const failure = new Error(result.error || "Dashboard unavailable");
      failure.name = result.code || "DashboardError";
      throw failure;
    }
    return result;
  }, []);

  useEffect(() => {
    let cancelled = false;
    loadDashboard()
      .then((result) => {
        if (!cancelled) setData(result);
      })
      .catch((reason) => {
        if (!cancelled) {
          if (reason instanceof Error && reason.name === "onboarding_required")
            setOnboardingRequired(true);
          else
            setError(
              reason instanceof Error
                ? reason.message
                : "Dashboard unavailable",
            );
        }
      });
    return () => {
      cancelled = true;
    };
  }, [loadDashboard]);

  useEffect(() => {
    if (activeView !== "clients") return;
    let cancelled = false;
    const timer = window.setTimeout(() => {
      setClientsLoading(true);
      fetch(`/api/clients?query=${encodeURIComponent(clientQuery)}`)
        .then(async (response) => {
          const result = (await response.json()) as {
            clients?: DirectoryClient[];
            error?: string;
          };
          if (!response.ok)
            throw new Error(result.error || "Directory unavailable");
          if (!cancelled) {
            setClients(result.clients || []);
            setSelectedClientId((current) =>
              current && result.clients?.some((client) => client.id === current)
                ? current
                : result.clients?.[0]?.id || null,
            );
          }
        })
        .catch((reason) => {
          if (!cancelled)
            showNotice(
              reason instanceof Error
                ? reason.message
                : "Directory unavailable",
            );
        })
        .finally(() => {
          if (!cancelled) setClientsLoading(false);
        });
    }, 220);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [activeView, clientQuery]);

  useEffect(() => {
    const dialog = mobileToolsOpen ? mobileToolsDialog.current : null;
    if (!dialog) return;
    const previousFocus =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const focusable = () =>
      Array.from(
        dialog.querySelectorAll<HTMLElement>(
          "button:not([disabled]), select:not([disabled]), a[href]",
        ),
      );
    focusable()[0]?.focus();
    const keydown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setMobileToolsOpen(false);
        return;
      }
      if (event.key !== "Tab") return;
      const items = focusable();
      if (!items.length) return;
      const first = items[0],
        last = items[items.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", keydown);
    return () => {
      document.removeEventListener("keydown", keydown);
      document.body.style.overflow = previousOverflow;
      previousFocus?.focus();
    };
  }, [mobileToolsOpen]);

  const filteredAppointments = useMemo(() => {
    if (!data) return [];
    if (filter === "All appointments") return data.appointments;
    return data.appointments.filter((item) => item.staffName === filter);
  }, [data, filter]);

  const calendarDays = useMemo(() => {
    const first = dateKeyInZone(
      new Date(),
      data?.salon.timezone || "America/Toronto",
    );
    return Array.from({ length: 7 }, (_, index) => addDateKey(first, index));
  }, [data?.salon.timezone]);

  const selectedClient =
    clients.find((client) => client.id === selectedClientId) || null;
  const hasAccess = useCallback(
    (permission: string) =>
      Boolean(data?.user.permissions.includes(permission)),
    [data],
  );
  const canSchedule = Boolean(
    data &&
      hasAccess("calendar") &&
      hasAccess("clients") &&
      ["owner", "manager", "receptionist"].includes(data.user.role),
  );
  const canOperateStages = Boolean(
    data &&
      hasAccess("calendar") &&
      ["owner", "manager", "receptionist", "groomer", "bather"].includes(
        data.user.role,
      ),
  );

  function showNotice(message: string) {
    setNotice(message);
    window.setTimeout(() => setNotice(""), 2400);
  }

  function openAppointment(appointment: Appointment) {
    setSelectedAppointment(appointment);
    setHandlingNotes(appointment.handlingNotes || "");
    setSafetyLevel(appointment.safetyLevel || "standard");
    setDrawerError("");
  }

  async function changeStatus(status: string) {
    if (!selectedAppointment) return;
    setActionBusy(true);
    setDrawerError("");
    try {
      const response = await fetch("/api/appointments", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ appointmentId: selectedAppointment.id, status }),
      });
      const result = (await response.json()) as {
        appointment?: { status: string };
        error?: string;
      };
      if (!response.ok)
        throw new Error(result.error || "Appointment could not be updated.");
      const updated = {
        ...selectedAppointment,
        status: result.appointment?.status || status,
      };
      setSelectedAppointment(updated);
      setData((current) =>
        current
          ? {
              ...current,
              appointments: current.appointments.map((item) =>
                item.id === updated.id ? updated : item,
              ),
              metrics: {
                ...current.metrics,
                activePets: current.appointments
                  .map((item) => (item.id === updated.id ? updated : item))
                  .filter((item) =>
                    [
                      "arrived",
                      "bathing",
                      "drying",
                      "grooming",
                      "quality_check",
                      "ready",
                    ].includes(item.status),
                  ).length,
              },
            }
          : current,
      );
      window.dispatchEvent(new CustomEvent("salon:schedule-changed"));
      showNotice(`${updated.petName} moved to ${statusLabel(updated.status)}`);
    } catch (reason) {
      setDrawerError(
        reason instanceof Error
          ? reason.message
          : "Appointment could not be updated.",
      );
    } finally {
      setActionBusy(false);
    }
  }

  async function rescheduleAppointment(startsAt: string, staffId: string) {
    if (!selectedAppointment) return false;
    setActionBusy(true);
    setDrawerError("");
    try {
      const response = await fetch("/api/appointments", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          appointmentId: selectedAppointment.id,
          action: "reschedule",
          startsAt,
          staffId,
        }),
      });
      const result = (await response.json()) as {
        appointment?: {
          startsAt: string;
          endsAt: string;
          staffId: string | null;
          staffName: string | null;
        };
        error?: string;
      };
      if (!response.ok || !result.appointment)
        throw new Error(
          result.error || "Appointment could not be rescheduled.",
        );
      const updated = {
        ...selectedAppointment,
        startsAt: result.appointment.startsAt,
        endsAt: result.appointment.endsAt,
        staffId: result.appointment.staffId,
        staffName: result.appointment.staffName,
      };
      setSelectedAppointment(updated);
      setData((current) =>
        current
          ? {
              ...current,
              appointments: current.appointments.map((item) =>
                item.id === updated.id ? updated : item,
              ),
            }
          : current,
      );
      window.dispatchEvent(new CustomEvent("salon:schedule-changed"));
      showNotice(
        `${updated.petName} rescheduled to ${formatDay(updated.startsAt, data?.salon.timezone || "America/Toronto")} at ${formatTime(updated.startsAt, data?.salon.timezone || "America/Toronto")}`,
      );
      return true;
    } catch (reason) {
      setDrawerError(
        reason instanceof Error
          ? reason.message
          : "Appointment could not be rescheduled.",
      );
      return false;
    } finally {
      setActionBusy(false);
    }
  }

  async function waiveDeposit() {
    if (!selectedAppointment) return;
    setActionBusy(true);
    setDrawerError("");
    try {
      const response = await fetch("/api/appointments", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          appointmentId: selectedAppointment.id,
          action: "waive_deposit",
        }),
      });
      const result = (await response.json()) as {
        appointment?: { status: string; depositStatus: string };
        error?: string;
      };
      if (!response.ok)
        throw new Error(result.error || "Deposit could not be waived.");
      const updated = {
        ...selectedAppointment,
        status: result.appointment?.status || "confirmed",
        depositStatus: result.appointment?.depositStatus || "waived",
      };
      setSelectedAppointment(updated);
      setData((current) =>
        current
          ? {
              ...current,
              appointments: current.appointments.map((item) =>
                item.id === updated.id ? updated : item,
              ),
            }
          : current,
      );
      showNotice(`${updated.petName} confirmed with deposit waived`);
    } catch (reason) {
      setDrawerError(
        reason instanceof Error
          ? reason.message
          : "Deposit could not be waived.",
      );
    } finally {
      setActionBusy(false);
    }
  }

  async function saveSafetyNotes() {
    if (!selectedAppointment) return;
    setActionBusy(true);
    setDrawerError("");
    try {
      const response = await fetch("/api/pets", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          petId: selectedAppointment.petId,
          safetyLevel,
          handlingNotes,
        }),
      });
      const result = (await response.json()) as {
        pet?: { safetyLevel: string; handlingNotes: string };
        error?: string;
      };
      if (!response.ok)
        throw new Error(result.error || "Pet record could not be updated.");
      const updated = {
        ...selectedAppointment,
        safetyLevel: result.pet?.safetyLevel || safetyLevel,
        handlingNotes: result.pet?.handlingNotes || handlingNotes,
      };
      setSelectedAppointment(updated);
      setData((current) =>
        current
          ? {
              ...current,
              appointments: current.appointments.map((item) =>
                item.petId === updated.petId
                  ? {
                      ...item,
                      safetyLevel: updated.safetyLevel,
                      handlingNotes: updated.handlingNotes,
                    }
                  : item,
              ),
            }
          : current,
      );
      showNotice(`${updated.petName}'s safety notes saved`);
    } catch (reason) {
      setDrawerError(
        reason instanceof Error
          ? reason.message
          : "Pet record could not be updated.",
      );
    } finally {
      setActionBusy(false);
    }
  }

  async function reviewVaccination(
    vaccinationId: string,
    status: "verified" | "rejected",
  ) {
    try {
      const response = await fetch("/api/vaccinations", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ vaccinationId, status }),
      });
      const result = (await response.json()) as {
        vaccination?: { id: string; status: string };
        error?: string;
      };
      if (!response.ok)
        throw new Error(result.error || "Vaccination could not be reviewed.");
      setClients((current) =>
        current.map((client) => ({
          ...client,
          pets: client.pets.map((pet) => ({
            ...pet,
            vaccinations: pet.vaccinations.map((record) =>
              record.id === vaccinationId
                ? { ...record, status: result.vaccination?.status || status }
                : record,
            ),
          })),
        })),
      );
      showNotice(`Vaccination ${status}`);
    } catch (reason) {
      showNotice(
        reason instanceof Error
          ? reason.message
          : "Vaccination could not be reviewed.",
      );
    }
  }

  async function switchLocation(locationId: string) {
    try {
      const response = await fetch("/api/location", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ locationId }),
      });
      const result = (await response.json()) as { error?: string };
      if (!response.ok)
        throw new Error(result.error || "Location could not be changed.");
      window.location.reload();
    } catch (reason) {
      showNotice(
        reason instanceof Error
          ? reason.message
          : "Location could not be changed.",
      );
    }
  }

  async function switchOrganization(organizationId: string) {
    try {
      const response = await fetch("/api/location", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ organizationId }),
      });
      const result = (await response.json()) as { error?: string };
      if (!response.ok)
        throw new Error(result.error || "Salon could not be changed.");
      window.location.reload();
    } catch (reason) {
      showNotice(
        reason instanceof Error
          ? reason.message
          : "Salon could not be changed.",
      );
    }
  }

  const viewCopy: Record<WorkspaceView, [string, string]> = {
    today: ["Good morning", "Run every appointment from one calm workspace."],
    calendar: [
      "Salon calendar",
      "A seven-day view of staff capacity and pet flow.",
    ],
    waitlist: [
      "Priority waitlist",
      "Recover demand the moment a safe opening becomes available.",
    ],
    clients: [
      "Clients & pets",
      "Every relationship, preference, and visit history in one place.",
    ],
    messages: [
      "Client communications",
      "Keep every touchpoint warm, timely, and traceable.",
    ],
    services: [
      "Services & pricing",
      "Shape your menu, timing, deposits, and online availability.",
    ],
    team: [
      "Your team",
      "Keep skills and working hours aligned with the booking calendar.",
    ],
    workforce: [
      "Workforce & payroll",
      "Track time, approve work, and prepare a traceable gross-pay handoff.",
    ],
    inventory: [
      "Inventory & purchasing",
      "Know what is on the shelf, what it costs, and what needs ordering.",
    ],
    finance: [
      "Finance & books",
      "Keep every sale, expense, receipt, tax amount, and closeout traceable.",
    ],
    reports: [
      "Reports",
      "See the operational signals behind a healthier salon.",
    ],
    settings: [
      "Salon settings",
      "Shape the business, booking rules, access, and every location.",
    ],
  };
  const [viewTitle, viewDescription] = viewCopy[activeView];
  const storefrontUrl = data
    ? `/book/${encodeURIComponent(data.salon.slug)}/${encodeURIComponent(data.salon.locationSlug)}`
    : "/";

  if (onboardingRequired || creatingSalon)
    return (
      <SalonOnboarding
        signedInName={signedInName}
        onCancel={
          onboardingRequired ? undefined : () => setCreatingSalon(false)
        }
      />
    );

  return (
    <main className="app-shell salon-mode">
      {notice && (
        <div className="toast" role="status">
          {notice}
        </div>
      )}
      <div className="dashboard-layout">
        <aside className="sidebar">
          <div className="salon-id">
            <span>
              {data?.salon.name
                .split(" ")
                .map((word) => word[0])
                .join("")
                .slice(0, 2) || "S"}
            </span>
            <div>
              {data && data.organizations.length > 1 ? (
                <select
                  className="organization-switcher"
                  aria-label="Current salon"
                  value={
                    data.organizations.find(
                      (item) => item.organizationName === data.salon.name,
                    )?.organizationId
                  }
                  onChange={(event) =>
                    void switchOrganization(event.target.value)
                  }
                >
                  {data.organizations.map((item) => (
                    <option
                      key={item.organizationId}
                      value={item.organizationId}
                    >
                      {item.organizationName}
                    </option>
                  ))}
                </select>
              ) : (
                <strong>{data?.salon.name || "Salon workspace"}</strong>
              )}
              {data && data.locations.length > 1 ? (
                <select
                  aria-label="Current salon location"
                  value={
                    data.locations.find(
                      (item) => item.locationName === data.salon.location,
                    )?.locationId
                  }
                  onChange={(event) => void switchLocation(event.target.value)}
                >
                  {data.locations.map((item) => (
                    <option key={item.locationId} value={item.locationId}>
                      {item.locationName} · {item.city}
                    </option>
                  ))}
                </select>
              ) : (
                <small>
                  {data
                    ? `${data.salon.location} · ${data.salon.city}`
                    : "Loading location…"}
                </small>
              )}
            </div>
          </div>
          <nav aria-label="Salon navigation">
            <button
              className={activeView === "today" ? "selected" : ""}
              onClick={() => setActiveView("today")}
            >
              <span>⌂</span>Today
            </button>
            {hasAccess("calendar") && (
              <button
                className={activeView === "calendar" ? "selected" : ""}
                onClick={() => setActiveView("calendar")}
              >
                <span>□</span>Calendar
              </button>
            )}
            {hasAccess("calendar") &&
              data &&
              ["owner", "manager", "receptionist"].includes(data.user.role) && (
                <button
                  className={activeView === "waitlist" ? "selected" : ""}
                  onClick={() => setActiveView("waitlist")}
                >
                  <span>♡</span>Waitlist
                  {matchedWaitlistCount != null && matchedWaitlistCount > 0 && (
                    <em
                      className="count-badge"
                      aria-label={`${matchedWaitlistCount} waitlist matches`}
                    >
                      {matchedWaitlistCount}
                    </em>
                  )}
                </button>
              )}
            {hasAccess("clients") && (
              <button
                className={activeView === "clients" ? "selected" : ""}
                onClick={() => setActiveView("clients")}
              >
                <span>♢</span>Clients &amp; pets
              </button>
            )}
            {hasAccess("messages") && (
              <button
                className={activeView === "messages" ? "selected" : ""}
                onClick={() => setActiveView("messages")}
              >
                <span>✦</span>Messages
                {Boolean(data?.metrics.actionableMessages) && (
                  <em
                    className="count-badge"
                    aria-label={`${data?.metrics.actionableMessages} messages need action`}
                  >
                    {data?.metrics.actionableMessages}
                  </em>
                )}
              </button>
            )}
            {hasAccess("services") && (
              <button
                className={activeView === "services" ? "selected" : ""}
                onClick={() => setActiveView("services")}
              >
                <span>◇</span>Services
              </button>
            )}
            {hasAccess("team") && (
              <button
                className={activeView === "team" ? "selected" : ""}
                onClick={() => setActiveView("team")}
              >
                <span>♙</span>Team
              </button>
            )}
            {hasAccess("workforce") && (
              <button
                className={activeView === "workforce" ? "selected" : ""}
                onClick={() => setActiveView("workforce")}
              >
                <span>◷</span>Workforce
              </button>
            )}
            {hasAccess("inventory") && (
              <button
                className={activeView === "inventory" ? "selected" : ""}
                onClick={() => setActiveView("inventory")}
              >
                <span>▤</span>Inventory
              </button>
            )}
            {hasAccess("finance") && (
              <button
                className={activeView === "finance" ? "selected" : ""}
                onClick={() => setActiveView("finance")}
              >
                <span>＄</span>Finance
              </button>
            )}
            {hasAccess("reports") && (
              <button
                className={activeView === "reports" ? "selected" : ""}
                onClick={() => setActiveView("reports")}
              >
                <span>▥</span>Intelligence
              </button>
            )}
            <button
              className="sidebar-more-button"
              aria-haspopup="dialog"
              aria-expanded={mobileToolsOpen}
              onClick={() => setMobileToolsOpen(true)}
            >
              <span>•••</span>More
            </button>
          </nav>
          <div className="sidebar-bottom">
            {data?.user.role === "owner" && (
              <button onClick={() => setCreatingSalon(true)}>
                <span>＋</span>Add another salon
              </button>
            )}
            {hasAccess("settings") && (
              <button
                className={activeView === "settings" ? "selected" : ""}
                onClick={() => setActiveView("settings")}
              >
                <span>⚙</span>Settings
              </button>
            )}
            <div className="manager-card">
              <span>{signedInName.slice(0, 2).toUpperCase()}</span>
              <div>
                <strong>{signedInName}</strong>
                <small>{data?.user.role || "Owner"}</small>
              </div>
              <a
                href="/api/auth/salon/logout?return_to=%2F"
                aria-label="Sign out"
              >
                ↗
              </a>
            </div>
          </div>
        </aside>

        <section className="dashboard-main">
          <div className="dashboard-head">
            <div>
              <span className="eyebrow">Live salon workspace</span>
              <h1>
                {viewTitle}
                {activeView === "today"
                  ? `, ${data?.user.displayName.split(" ")[0] || signedInName.split(" ")[0]}.`
                  : ""}
              </h1>
              <p>{viewDescription}</p>
            </div>
            <div className="dashboard-actions">
              <Link
                className="secondary-button salon-link"
                href={storefrontUrl}
              >
                View storefront
              </Link>
              {activeView === "team" &&
              hasAccess("team") &&
              ["owner", "manager"].includes(data?.user.role || "") ? (
                <button
                  className="primary-button"
                  onClick={() => setTeamCreateSignal((value) => value + 1)}
                >
                  ＋ Add team member
                </button>
              ) : (
                canSchedule && (
                  <button
                    className="primary-button"
                    onClick={() => setQuickBookingOpen(true)}
                  >
                    ＋ New appointment
                  </button>
                )
              )}
            </div>
          </div>

          {error ? (
            <section className="dashboard-error">
              <strong>We couldn’t load the salon yet.</strong>
              <p>{error}</p>
              <button
                className="secondary-button"
                onClick={() => window.location.reload()}
              >
                Try again
              </button>
            </section>
          ) : activeView === "today" ? (
            <TodayView
              data={data}
              appointments={filteredAppointments}
              filter={filter}
              setFilter={setFilter}
              onOpen={openAppointment}
              onCreate={
                canSchedule ? () => setQuickBookingOpen(true) : undefined
              }
              timezone={data?.salon.timezone || "America/Toronto"}
            />
          ) : activeView === "calendar" ? (
            <CalendarView
              data={data}
              days={calendarDays}
              onOpen={openAppointment}
              timezone={data?.salon.timezone || "America/Toronto"}
            />
          ) : activeView === "waitlist" ? (
            <WaitlistView
              notify={showNotice}
              onMatchedCount={setMatchedWaitlistCount}
            />
          ) : activeView === "clients" ? (
            <ClientsView
              clients={clients}
              loading={clientsLoading}
              query={clientQuery}
              setQuery={setClientQuery}
              selectedClient={selectedClient}
              setSelectedClientId={setSelectedClientId}
              canReviewVaccines={Boolean(
                data &&
                  ["owner", "manager", "receptionist"].includes(data.user.role),
              )}
              canSharePortal={canSchedule}
              onReviewVaccine={reviewVaccination}
              notify={showNotice}
              timezone={data?.salon.timezone || "America/Toronto"}
            />
          ) : activeView === "messages" ? (
            <CommunicationsView notify={showNotice} />
          ) : activeView === "services" ? (
            <ServicesView
              notify={showNotice}
              currency={data?.salon.currency || "CAD"}
            />
          ) : activeView === "team" ? (
            <TeamView
              notify={showNotice}
              openCreateSignal={teamCreateSignal}
              locationName={data?.salon.location}
            />
          ) : activeView === "workforce" ? (
            <WorkforceView
              notify={showNotice}
              organizationName={data?.salon.name}
              currency={data?.salon.currency}
              timezone={data?.salon.timezone}
            />
          ) : activeView === "inventory" ? (
            <InventoryView />
          ) : activeView === "finance" ? (
            <FinanceView
              onCheckout={setCheckoutAppointmentId}
              timezone={data?.salon.timezone}
            />
          ) : activeView === "reports" ? (
            <ReportsView />
          ) : (
            <SettingsView notify={showNotice} />
          )}
        </section>
      </div>

      {selectedAppointment && (
        <AppointmentDrawer
          appointment={selectedAppointment}
          currency={data?.salon.currency || "CAD"}
          timezone={data?.salon.timezone || "America/Toronto"}
          busy={actionBusy}
          error={drawerError}
          handlingNotes={handlingNotes}
          safetyLevel={safetyLevel}
          setHandlingNotes={setHandlingNotes}
          setSafetyLevel={setSafetyLevel}
          onClose={() => setSelectedAppointment(null)}
          onStatus={changeStatus}
          onReschedule={rescheduleAppointment}
          onWaiveDeposit={waiveDeposit}
          onSaveSafety={saveSafetyNotes}
          onCheckout={() => setCheckoutAppointmentId(selectedAppointment.id)}
          onCare={() => setCareAppointment(selectedAppointment)}
          canCheckout={Boolean(data?.user.permissions.includes("checkout"))}
          canManageDeposit={Boolean(
            data && ["owner", "manager"].includes(data.user.role),
          )}
          canSchedule={canSchedule}
          canOperateStages={Boolean(
            canOperateStages &&
              data &&
              (!["groomer", "bather"].includes(data.user.role) ||
                selectedAppointment.staffId === data.user.id),
          )}
        />
      )}
      {checkoutAppointmentId && (
        <CheckoutModal
          appointmentId={checkoutAppointmentId}
          onClose={() => setCheckoutAppointmentId(null)}
          onRecorded={() => {
            showNotice("Financial ledger and appointment status updated");
            window.dispatchEvent(new CustomEvent("salon:schedule-changed"));
            loadDashboard()
              .then(setData)
              .catch((reason) =>
                showNotice(
                  reason instanceof Error
                    ? reason.message
                    : "Refresh the workspace to see the payment.",
                ),
              );
          }}
        />
      )}
      {careAppointment && (
        <CareWorkspace
          appointment={careAppointment}
          onClose={() => setCareAppointment(null)}
          notify={showNotice}
          organizationName={data?.salon.name}
          currency={data?.salon.currency}
          timezone={data?.salon.timezone}
        />
      )}
      {quickBookingOpen && (
        <QuickBookingModal
          currency={data?.salon.currency || "CAD"}
          onClose={() => setQuickBookingOpen(false)}
          onCreated={(message) => {
            setQuickBookingOpen(false);
            window.dispatchEvent(new CustomEvent("salon:schedule-changed"));
            showNotice(message);
            loadDashboard()
              .then(setData)
              .catch((reason) =>
                showNotice(
                  reason instanceof Error
                    ? reason.message
                    : "Refresh the calendar to see the appointment.",
                ),
              );
          }}
        />
      )}
      {mobileToolsOpen && (
        <div
          className="modal-backdrop mobile-tools-backdrop"
          onMouseDown={(event) => {
            if (event.currentTarget === event.target) setMobileToolsOpen(false);
          }}
        >
          <section
            ref={mobileToolsDialog}
            className="business-modal mobile-tools-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="mobile-tools-title"
          >
            <header>
              <div>
                <span className="eyebrow">Workspace controls</span>
                <h2 id="mobile-tools-title">{data?.salon.name || "Salon"}</h2>
              </div>
              <button
                onClick={() => setMobileToolsOpen(false)}
                aria-label="Close workspace controls"
              >
                ×
              </button>
            </header>
            {data && data.organizations.length > 1 && (
              <label>
                Salon
                <select
                  value={
                    data.organizations.find(
                      (item) => item.organizationName === data.salon.name,
                    )?.organizationId
                  }
                  onChange={(event) =>
                    void switchOrganization(event.target.value)
                  }
                >
                  {data.organizations.map((item) => (
                    <option
                      key={item.organizationId}
                      value={item.organizationId}
                    >
                      {item.organizationName}
                    </option>
                  ))}
                </select>
              </label>
            )}
            {data && data.locations.length > 1 && (
              <label>
                Location
                <select
                  value={
                    data.locations.find(
                      (item) => item.locationName === data.salon.location,
                    )?.locationId
                  }
                  onChange={(event) => void switchLocation(event.target.value)}
                >
                  {data.locations.map((item) => (
                    <option key={item.locationId} value={item.locationId}>
                      {item.locationName} · {item.city}
                    </option>
                  ))}
                </select>
              </label>
            )}
            <div className="mobile-tools-actions">
              {hasAccess("settings") && (
                <button
                  onClick={() => {
                    setActiveView("settings");
                    setMobileToolsOpen(false);
                  }}
                >
                  ⚙ Settings
                </button>
              )}
              {data?.user.role === "owner" && (
                <button
                  onClick={() => {
                    setCreatingSalon(true);
                    setMobileToolsOpen(false);
                  }}
                >
                  ＋ Add another salon
                </button>
              )}
              <Link href={storefrontUrl}>View storefront</Link>
              <a href="/api/auth/salon/logout?return_to=%2F">Sign out</a>
            </div>
          </section>
        </div>
      )}
    </main>
  );
}

function TodayView({
  data,
  appointments,
  filter,
  setFilter,
  onOpen,
  onCreate,
  timezone,
}: {
  data: DashboardData | null;
  appointments: Appointment[];
  filter: string;
  setFilter: (value: string) => void;
  onOpen: (appointment: Appointment) => void;
  onCreate?: () => void;
  timezone: string;
}) {
  const staffOptions = useMemo(
    () =>
      Array.from(
        new Set(
          (data?.appointments || [])
            .map((item) => item.staffName)
            .filter((name): name is string => Boolean(name)),
        ),
      ).sort(),
    [data],
  );
  useEffect(() => {
    if (filter !== "All appointments" && !staffOptions.includes(filter))
      setFilter("All appointments");
  }, [filter, setFilter, staffOptions]);
  return (
    <>
      <div className="metric-grid">
        <div>
          <span>Upcoming revenue</span>
          <strong>
            {data
              ? formatMoney(data.metrics.revenueCents, data.salon.currency)
              : "—"}
          </strong>
          <small>Based on booked services</small>
        </div>
        <div>
          <span>Appointments</span>
          <strong>{data?.metrics.appointments ?? "—"}</strong>
          <small>Next 30 days</small>
        </div>
        <div>
          <span>Pets in salon</span>
          <strong>{data?.metrics.activePets ?? "—"}</strong>
          <small>Live workflow count</small>
        </div>
        <div>
          <span>Operations</span>
          <strong className="live-metric">Live</strong>
          <small className="up">✓ Every change audited</small>
        </div>
      </div>
      <div className="dashboard-grid">
        <section className="schedule-panel">
          <div className="panel-head">
            <div>
              <h2>Upcoming flow</h2>
              <p>Select a pet to run the appointment</p>
            </div>
            <select
              value={filter}
              onChange={(event) => setFilter(event.target.value)}
            >
              <option>All appointments</option>
              {staffOptions.map((name) => (
                <option key={name}>{name}</option>
              ))}
            </select>
          </div>
          {!data ? (
            <div className="dashboard-loading">
              <span />
              <span />
              <span />
            </div>
          ) : appointments.length ? (
            <div className="schedule-list">
              {appointments.map((item) => (
                <AppointmentRow
                  appointment={item}
                  key={item.id}
                  onOpen={onOpen}
                  timezone={timezone}
                />
              ))}
            </div>
          ) : (
            <div className="empty-schedule">
              <span>✦</span>
              <h3>Your calendar is ready.</h3>
              <p>
                Add a caller or walk-in here, or share your storefront for
                self-booking.
              </p>
              {onCreate && (
                <button className="primary-button" onClick={onCreate}>
                  Create the first booking
                </button>
              )}
            </div>
          )}
        </section>
        <aside className="right-rail">
          <section className="attention-card setup-card">
            <div className="panel-head">
              <div>
                <h2>Operational pulse</h2>
                <p>What needs attention now</p>
              </div>
              <span className="count-badge">
                {data?.appointments.filter(
                  (item) => item.safetyLevel !== "standard",
                ).length || 0}
              </span>
            </div>
            <div className="setup-item done">
              <span>✓</span>
              <div>
                <strong>Conflict-safe booking</strong>
                <small>Overlapping slots are blocked</small>
              </div>
            </div>
            <div className="setup-item done">
              <span>✓</span>
              <div>
                <strong>Controlled pet journey</strong>
                <small>Each stage follows salon workflow</small>
              </div>
            </div>
            <div className="setup-item done">
              <span>✓</span>
              <div>
                <strong>Safety records</strong>
                <small>Handling notes stay with every pet</small>
              </div>
            </div>
            <div className="setup-item done">
              <span>✓</span>
              <div>
                <strong>Audit trail</strong>
                <small>Staff actions are attributed</small>
              </div>
            </div>
          </section>
          <section className="pet-spotlight data-spotlight">
            <span className="eyebrow">Today’s rhythm</span>
            <h2>
              {data?.metrics.activePets
                ? `${data.metrics.activePets} pets moving through care.`
                : "A calm floor is a good floor."}
            </h2>
            <p>
              Open any appointment to check in, advance grooming stages, and
              update handling guidance.
            </p>
            <div className="data-pills">
              <span>Check-in</span>
              <span>Bath</span>
              <span>Dry</span>
              <span>Groom</span>
              <span>Ready</span>
            </div>
          </section>
        </aside>
      </div>
    </>
  );
}

function AppointmentRow({
  appointment,
  onOpen,
  timezone,
}: {
  appointment: Appointment;
  onOpen: (appointment: Appointment) => void;
  timezone: string;
}) {
  const tone = toneByStatus[appointment.status] || "lilac";
  return (
    <button
      className="appointment-row live-row"
      onClick={() => onOpen(appointment)}
    >
      <span className="appointment-date">
        <strong>{formatDay(appointment.startsAt, timezone)}</strong>
        <small>{formatTime(appointment.startsAt, timezone)}</small>
      </span>
      <span className={`pet-avatar ${tone}`}>
        {appointment.petName.slice(0, 1).toUpperCase()}
      </span>
      <span className="appointment-pet">
        <strong>{appointment.petName}</strong>
        <small>
          {appointment.breed} · {appointment.clientName}
        </small>
      </span>
      <span className="appointment-service">
        <strong>{appointment.serviceName}</strong>
        <small>with {appointment.staffName || "first available"}</small>
      </span>
      <span className={`status-pill ${tone}`}>
        {appointment.depositStatus === "pending"
          ? "Deposit pending"
          : statusLabel(appointment.status)}
      </span>
      <span className="row-arrow">›</span>
    </button>
  );
}

function CalendarView({
  data,
  days,
  onOpen,
  timezone,
}: {
  data: DashboardData | null;
  days: string[];
  onOpen: (appointment: Appointment) => void;
  timezone: string;
}) {
  return (
    <section className="calendar-panel">
      <div className="calendar-toolbar">
        <div>
          <strong>Next 7 days</strong>
          <span>{data?.appointments.length || 0} bookings on the books</span>
        </div>
        <div className="calendar-legend">
          <span>
            <i className="lilac" />
            Confirmed
          </span>
          <span>
            <i className="coral" />
            In service
          </span>
          <span>
            <i className="sage" />
            Ready
          </span>
        </div>
      </div>
      <div className="week-grid">
        {days.map((day, index) => {
          const dayAppointments =
            data?.appointments.filter((item) =>
              sameDay(item.startsAt, day, timezone),
            ) || [];
          const calendarDate = new Date(`${day}T12:00:00Z`);
          return (
            <section
              className={index === 0 ? "day-column today" : "day-column"}
              key={day}
            >
              <header>
                <span>
                  {new Intl.DateTimeFormat("en-CA", {
                    weekday: "short",
                    timeZone: "UTC",
                  }).format(calendarDate)}
                </span>
                <strong>{calendarDate.getUTCDate()}</strong>
              </header>
              <div className="day-bookings">
                {dayAppointments.length ? (
                  dayAppointments.map((appointment) => {
                    const tone = toneByStatus[appointment.status] || "lilac";
                    return (
                      <button
                        className={`calendar-card ${tone}`}
                        key={appointment.id}
                        onClick={() => onOpen(appointment)}
                      >
                        <time>
                          {formatTime(appointment.startsAt, timezone)}
                        </time>
                        <strong>{appointment.petName}</strong>
                        <small>{appointment.serviceName}</small>
                        <em>{appointment.staffName || "Open"}</em>
                      </button>
                    );
                  })
                ) : (
                  <span className="open-day">Open</span>
                )}
              </div>
            </section>
          );
        })}
      </div>
    </section>
  );
}

function ClientsView({
  clients,
  loading,
  query,
  setQuery,
  selectedClient,
  setSelectedClientId,
  canReviewVaccines,
  canSharePortal,
  onReviewVaccine,
  notify,
  timezone,
}: {
  clients: DirectoryClient[];
  loading: boolean;
  query: string;
  setQuery: (value: string) => void;
  selectedClient: DirectoryClient | null;
  setSelectedClientId: (value: string) => void;
  canReviewVaccines: boolean;
  canSharePortal: boolean;
  onReviewVaccine: (id: string, status: "verified" | "rejected") => void;
  notify: (message: string) => void;
  timezone: string;
}) {
  const [portalLinkBusy, setPortalLinkBusy] = useState("");
  async function copyFreshPortalLink(clientId: string) {
    setPortalLinkBusy(clientId);
    try {
      const response = await fetch("/api/clients", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ clientId }),
      });
      const result = (await response.json()) as {
        portalUrl?: string;
        error?: string;
      };
      if (!response.ok || !result.portalUrl)
        throw new Error(result.error || "Portal link could not be created.");
      await copyToClipboard(result.portalUrl);
      notify("Fresh 15-minute portal link copied");
    } catch (reason) {
      notify(
        reason instanceof Error
          ? reason.message
          : "Portal link could not be copied.",
      );
    } finally {
      setPortalLinkBusy("");
    }
  }
  return (
    <section className="directory-panel">
      <div className="directory-toolbar">
        <div>
          <h2>Client & pet directory</h2>
          <p>{clients.length} relationships in this salon</p>
        </div>
        <label>
          <span>⌕</span>
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search owner, pet, email or phone"
            aria-label="Search clients and pets"
          />
        </label>
      </div>
      <div className="directory-layout">
        <div className="client-list">
          {loading ? (
            <div className="dashboard-loading">
              <span />
              <span />
              <span />
            </div>
          ) : clients.length ? (
            clients.map((client) => (
              <button
                className={selectedClient?.id === client.id ? "selected" : ""}
                key={client.id}
                onClick={() => setSelectedClientId(client.id)}
              >
                <span className="client-avatar">
                  {client.fullName.slice(0, 2).toUpperCase()}
                </span>
                <span>
                  <strong>{client.fullName}</strong>
                  <small>
                    {client.pets.map((pet) => pet.name).join(", ") ||
                      "No pets yet"}
                  </small>
                </span>
                <em>{client.pets.length}</em>
              </button>
            ))
          ) : (
            <div className="directory-empty">No matching clients</div>
          )}
        </div>
        <div className="client-detail">
          {selectedClient ? (
            <>
              <header>
                <span className="client-avatar large">
                  {selectedClient.fullName.slice(0, 2).toUpperCase()}
                </span>
                <div>
                  <h2>{selectedClient.fullName}</h2>
                  <p>
                    {selectedClient.email} · {selectedClient.phone}
                  </p>
                </div>
                {canSharePortal && (
                  <button
                    className="secondary-button"
                    disabled={Boolean(portalLinkBusy)}
                    onClick={() => void copyFreshPortalLink(selectedClient.id)}
                  >
                    {portalLinkBusy === selectedClient.id
                      ? "Creating link…"
                      : "Copy fresh portal link"}
                  </button>
                )}
                <span
                  className={
                    selectedClient.marketingConsent ? "consent yes" : "consent"
                  }
                >
                  {selectedClient.marketingConsent
                    ? "Marketing opted in"
                    : "Transactional only"}
                </span>
              </header>
              <div className="pet-records">
                {selectedClient.pets.map((pet) => {
                  const futureVisits = pet.appointments
                    .filter((item) => new Date(item.startsAt) >= new Date())
                    .sort((a, b) => a.startsAt.localeCompare(b.startsAt));
                  return (
                    <article key={pet.id}>
                      <div className="pet-record-head">
                        <span
                          className={`pet-avatar ${pet.safetyLevel === "standard" ? "sage" : "gold"}`}
                        >
                          {pet.name.slice(0, 1)}
                        </span>
                        <div>
                          <strong>{pet.name}</strong>
                          <small>
                            {pet.breed} · {pet.species}
                          </small>
                        </div>
                        <span className={`safety-badge ${pet.safetyLevel}`}>
                          {pet.safetyLevel}
                        </span>
                      </div>
                      <p>
                        {pet.handlingNotes || "No special handling notes yet."}
                      </p>
                      {pet.vaccinations.length > 0 && (
                        <div className="staff-vaccines">
                          {pet.vaccinations.map((record) => (
                            <div key={record.id}>
                              <span className={record.status}>
                                {record.status === "verified" ? "✓" : "!"}
                              </span>
                              <div>
                                <strong>{record.vaccineName}</strong>
                                <small>
                                  Valid until {record.expiresOn} ·{" "}
                                  {statusLabel(record.status)}
                                </small>
                              </div>
                              {record.originalFilename && (
                                <a
                                  href={`/api/vaccinations/${record.id}`}
                                  target="_blank"
                                  rel="noreferrer"
                                >
                                  Proof
                                </a>
                              )}
                              {canReviewVaccines &&
                                record.status === "client_submitted" && (
                                  <>
                                    <button
                                      onClick={() =>
                                        onReviewVaccine(record.id, "verified")
                                      }
                                    >
                                      Verify
                                    </button>
                                    <button
                                      className="reject"
                                      onClick={() =>
                                        onReviewVaccine(record.id, "rejected")
                                      }
                                    >
                                      Reject
                                    </button>
                                  </>
                                )}
                            </div>
                          ))}
                        </div>
                      )}
                      <footer>
                        <span>
                          {pet.appointments.length} lifetime visit
                          {pet.appointments.length === 1 ? "" : "s"}
                        </span>
                        <strong>
                          {futureVisits[0]
                            ? `Next: ${formatDay(futureVisits[0].startsAt, timezone)} at ${formatTime(futureVisits[0].startsAt, timezone)}`
                            : "No upcoming visit"}
                        </strong>
                      </footer>
                    </article>
                  );
                })}
              </div>
            </>
          ) : (
            <div className="directory-empty detail">
              Choose a client to see their pets and history.
            </div>
          )}
        </div>
      </div>
    </section>
  );
}

function AppointmentDrawer({
  appointment,
  currency,
  timezone,
  busy,
  error,
  handlingNotes,
  safetyLevel,
  setHandlingNotes,
  setSafetyLevel,
  onClose,
  onStatus,
  onReschedule,
  onWaiveDeposit,
  onSaveSafety,
  onCheckout,
  onCare,
  canCheckout,
  canManageDeposit,
  canSchedule,
  canOperateStages,
}: {
  appointment: Appointment;
  currency: string;
  timezone: string;
  busy: boolean;
  error: string;
  handlingNotes: string;
  safetyLevel: string;
  setHandlingNotes: (value: string) => void;
  setSafetyLevel: (value: string) => void;
  onClose: () => void;
  onStatus: (status: string) => void;
  onReschedule: (startsAt: string, staffId: string) => Promise<boolean>;
  onWaiveDeposit: () => void;
  onSaveSafety: () => void;
  onCheckout: () => void;
  onCare: () => void;
  canCheckout: boolean;
  canManageDeposit: boolean;
  canSchedule: boolean;
  canOperateStages: boolean;
}) {
  const drawer = useRef<HTMLElement>(null);
  const close = useRef(onClose);
  useEffect(() => {
    close.current = onClose;
  }, [onClose]);
  useEffect(() => {
    const element = drawer.current;
    if (!element) return;
    const previousFocus =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const focusable = () =>
      Array.from(
        element.querySelectorAll<HTMLElement>(
          "button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), a[href]",
        ),
      );
    focusable()[0]?.focus();
    const keydown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        close.current();
        return;
      }
      if (event.key !== "Tab") return;
      const items = focusable();
      if (!items.length) return;
      const first = items[0],
        last = items[items.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", keydown);
    return () => {
      document.removeEventListener("keydown", keydown);
      document.body.style.overflow = previousOverflow;
      previousFocus?.focus();
    };
  }, [appointment.id]);
  const next = nextStage[appointment.status];
  const currentIndex = stages.indexOf(appointment.status);
  const canAdvance = Boolean(
    next &&
      (canSchedule || (canOperateStages && operationalStageTargets.has(next))),
  );
  return (
    <div
      className="drawer-backdrop"
      role="presentation"
      onMouseDown={(event) => {
        if (event.currentTarget === event.target) onClose();
      }}
    >
      <aside
        ref={drawer}
        className="appointment-drawer"
        role="dialog"
        aria-modal="true"
        aria-label={`${appointment.petName}'s appointment`}
      >
        <header className="drawer-head">
          <div>
            <span className="eyebrow">Pet journey</span>
            <h2>{appointment.petName}</h2>
            <p>
              {appointment.breed} · with{" "}
              {appointment.staffName || "first available"}
            </p>
          </div>
          <button onClick={onClose} aria-label="Close appointment">
            ×
          </button>
        </header>
        <div className="drawer-time">
          <div>
            <span>{formatDay(appointment.startsAt, timezone)}</span>
            <strong>
              {formatTime(appointment.startsAt, timezone)}–
              {formatTime(appointment.endsAt, timezone)}
            </strong>
          </div>
          <div>
            <span>Service</span>
            <strong>{appointment.serviceName}</strong>
          </div>
          <div>
            <span>Estimate</span>
            <strong>
              {formatMoney(appointment.priceEstimateCents, currency)}
            </strong>
          </div>
        </div>
        <div
          className="stage-rail"
          aria-label={`Current status: ${statusLabel(appointment.status)}`}
        >
          {stages.map((stage, index) => (
            <span
              key={stage}
              className={
                index < currentIndex
                  ? "complete"
                  : index === currentIndex
                    ? "current"
                    : ""
              }
            >
              <i>{index < currentIndex ? "✓" : index + 1}</i>
              <small>{statusLabel(stage)}</small>
            </span>
          ))}
        </div>
        {appointment.depositStatus === "pending" ? (
          <section className="deposit-hold-alert">
            <span>↗</span>
            <div>
              <strong>Awaiting required deposit</strong>
              <small>
                The opening is held until secure payment verifies or the
                checkout expires
                {appointment.depositDueAt
                  ? ` around ${formatTime(appointment.depositDueAt, timezone)}`
                  : ""}
                .
              </small>
            </div>
            {canManageDeposit && (
              <button disabled={busy} onClick={onWaiveDeposit}>
                Waive & confirm
              </button>
            )}
          </section>
        ) : (
          canAdvance &&
          next && (
            <button
              className="primary-button wide journey-action"
              disabled={busy}
              onClick={() => onStatus(next)}
            >
              {busy ? "Updating…" : `${stageAction[next]} →`}
            </button>
          )
        )}
        {error && (
          <p className="drawer-error" role="alert">
            {error}
          </p>
        )}
        {appointment.managedBySquare && (
          <p className="square-managed-note">Square manages this appointment’s time and booking status. Coat & Care will keep it synchronized while your team records the pet’s care journey here.</p>
        )}
        {canSchedule &&
          !appointment.managedBySquare &&
          ["requested", "confirmed"].includes(appointment.status) && (
            <StaffReschedulePanel
              appointment={appointment}
              timezone={timezone}
              busy={busy}
              onReschedule={onReschedule}
            />
          )}
        <button className="care-launch wide" onClick={onCare}>
          <span>✦</span>
          <div>
            <strong>Open care record</strong>
            <small>Assessment, warnings, photos, report card & approvals</small>
          </div>
          <em>›</em>
        </button>
        <section className="drawer-section">
          <div className="drawer-section-title">
            <div>
              <h3>Safety & handling</h3>
              <p>Visible on every future visit</p>
            </div>
            <select
              value={safetyLevel}
              onChange={(event) => setSafetyLevel(event.target.value)}
            >
              <option value="standard">Standard</option>
              <option value="attention">Needs attention</option>
              <option value="high">High priority</option>
            </select>
          </div>
          <textarea
            value={handlingNotes}
            onChange={(event) => setHandlingNotes(event.target.value)}
            placeholder="Temperament, allergies, dryer or kennel guidance…"
          />
          <button
            className="secondary-button wide"
            disabled={busy}
            onClick={onSaveSafety}
          >
            Save handling guidance
          </button>
        </section>
        <section className="drawer-section contact-card">
          <h3>Pet parent</h3>
          <strong>{appointment.clientName}</strong>
          <a href={`tel:${appointment.clientPhone}`}>
            {appointment.clientPhone}
          </a>
          <a href={`mailto:${appointment.clientEmail}`}>
            {appointment.clientEmail}
          </a>
        </section>
        {canCheckout &&
          !["cancelled", "no_show"].includes(appointment.status) && (
            <button className="checkout-launch wide" onClick={onCheckout}>
              <span>＄</span>
              <div>
                <strong>Checkout & receipt</strong>
                <small>Collect payment, add a tip, or record a refund</small>
              </div>
              <em>›</em>
            </button>
          )}
        {canSchedule &&
          !appointment.managedBySquare &&
          ["requested", "confirmed"].includes(appointment.status) && (
            <div className="exception-actions">
              {appointment.status === "confirmed" && (
                <button disabled={busy} onClick={() => onStatus("no_show")}>
                  Mark no-show
                </button>
              )}
              <button disabled={busy} onClick={() => onStatus("cancelled")}>
                Cancel appointment
              </button>
            </div>
          )}
      </aside>
    </div>
  );
}

type RescheduleSlot = {
  startsAt: string;
  endsAt: string;
  staff: Array<{ id: string; name: string }>;
};

function StaffReschedulePanel({
  appointment,
  timezone,
  busy,
  onReschedule,
}: {
  appointment: Appointment;
  timezone: string;
  busy: boolean;
  onReschedule: (startsAt: string, staffId: string) => Promise<boolean>;
}) {
  const requestId = useRef(0);
  const [open, setOpen] = useState(false);
  const [slots, setSlots] = useState<RescheduleSlot[]>([]);
  const [selectedDay, setSelectedDay] = useState("");
  const [startsAt, setStartsAt] = useState("");
  const [staffId, setStaffId] = useState("");
  const [nextFrom, setNextFrom] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState("");

  async function load(append: boolean, from?: string | null) {
    const currentRequest = requestId.current + 1;
    requestId.current = currentRequest;
    setLoading(true);
    setLoadError("");
    if (!append) {
      setSlots([]);
      setSelectedDay("");
      setStartsAt("");
      setStaffId("");
      setHasMore(false);
      setNextFrom(null);
    }
    try {
      const parameters = new URLSearchParams({
        serviceId: appointment.serviceId,
        excludeAppointmentId: appointment.id,
        days: "14",
      });
      if (from) parameters.set("from", from);
      const response = await fetch(`/api/appointments?${parameters}`);
      const result = (await response.json()) as {
        slots?: RescheduleSlot[];
        nextFrom?: string | null;
        hasMore?: boolean;
        error?: string;
      };
      if (!response.ok)
        throw new Error(result.error || "Openings could not be loaded.");
      if (requestId.current !== currentRequest) return;
      const openings = result.slots || [];
      setSlots((current) => {
        const combined = append ? [...current, ...openings] : openings;
        return [
          ...new Map(combined.map((slot) => [slot.startsAt, slot])).values(),
        ].sort((left, right) => left.startsAt.localeCompare(right.startsAt));
      });
      setNextFrom(result.nextFrom || null);
      setHasMore(result.hasMore === true);
      if (openings[0] && (!append || slots.length === 0))
        setSelectedDay(dateKeyInZone(openings[0].startsAt, timezone));
    } catch (reason) {
      if (requestId.current === currentRequest)
        setLoadError(
          reason instanceof Error
            ? reason.message
            : "Openings could not be loaded.",
        );
    } finally {
      if (requestId.current === currentRequest) setLoading(false);
    }
  }

  const days = useMemo(
    () =>
      Array.from(
        new Set(slots.map((slot) => dateKeyInZone(slot.startsAt, timezone))),
      ),
    [slots, timezone],
  );
  const daySlots = slots.filter(
    (slot) => dateKeyInZone(slot.startsAt, timezone) === selectedDay,
  );
  const selectedSlot = slots.find((slot) => slot.startsAt === startsAt);
  if (!open)
    return (
      <button
        className="secondary-button wide"
        disabled={busy}
        onClick={() => {
          setOpen(true);
          void load(false);
        }}
      >
        Reschedule appointment
      </button>
    );
  return (
    <section className="drawer-section">
      <div className="drawer-section-title">
        <div>
          <h3>Reschedule</h3>
          <p>The existing visit is excluded while live capacity is checked.</p>
        </div>
        <button
          disabled={busy}
          onClick={() => setOpen(false)}
          aria-label="Close rescheduling"
        >
          ×
        </button>
      </div>
      {loadError && (
        <p className="drawer-error" role="alert">
          {loadError}
        </p>
      )}
      {days.length > 0 && (
        <label>
          Date
          <select
            value={selectedDay}
            onChange={(event) => {
              setSelectedDay(event.target.value);
              setStartsAt("");
              setStaffId("");
            }}
          >
            {days.map((day) => {
              const example = slots.find(
                (slot) => dateKeyInZone(slot.startsAt, timezone) === day,
              )!;
              return (
                <option key={day} value={day}>
                  {formatDay(example.startsAt, timezone)}
                </option>
              );
            })}
          </select>
        </label>
      )}
      <div
        className="quick-time-grid"
        aria-busy={loading}
        aria-label="Reschedule openings"
      >
        {loading && !slots.length ? (
          <span className="quick-loading" role="status">
            Checking live openings…
          </span>
        ) : daySlots.length ? (
          daySlots.map((slot) => (
            <button
              type="button"
              className={startsAt === slot.startsAt ? "selected" : ""}
              aria-pressed={startsAt === slot.startsAt}
              key={slot.startsAt}
              onClick={() => {
                setStartsAt(slot.startsAt);
                setStaffId(slot.staff[0]?.id || "");
              }}
            >
              <strong>{formatTime(slot.startsAt, timezone)}</strong>
              <small>
                {slot.staff.map((person) => person.name).join(" or ")}
              </small>
            </button>
          ))
        ) : (
          <span className="quick-loading">No openings in these dates.</span>
        )}
      </div>
      {selectedSlot && selectedSlot.staff.length > 1 && (
        <label>
          Team member
          <select
            value={staffId}
            onChange={(event) => setStaffId(event.target.value)}
          >
            {selectedSlot.staff.map((person) => (
              <option value={person.id} key={person.id}>
                {person.name}
              </option>
            ))}
          </select>
        </label>
      )}
      {hasMore && nextFrom && (
        <button
          className="secondary-button wide"
          disabled={loading || busy}
          onClick={() => void load(true, nextFrom)}
        >
          {loading ? "Loading…" : "Load more dates"}
        </button>
      )}
      <button
        className="primary-button wide"
        disabled={!startsAt || !staffId || loading || busy}
        onClick={() =>
          void onReschedule(startsAt, staffId).then((saved) => {
            if (saved) setOpen(false);
          })
        }
      >
        {busy ? "Rescheduling…" : "Confirm new time"}
      </button>
    </section>
  );
}
