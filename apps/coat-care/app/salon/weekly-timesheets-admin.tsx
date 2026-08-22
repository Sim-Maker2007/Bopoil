"use client";
import {
  useCallback,
  useEffect,
  useMemo,
  useState,
} from "react";

type Team = {
  id: string;
  displayName: string;
  portal: null | { employeeCode: string; active: boolean };
};
type LocationOption = { id: string; name: string; label?: string };
type Shift = {
  id: string;
  workDate: string;
  locationId?: string | null;
  locationName: string;
  startTime: string;
  endTime: string;
  tips: number;
  paidMinutes: number;
};
type Week = {
  id: string;
  staffName: string;
  weekStartsOn: string;
  status: "draft" | "submitted" | "approved";
  revision: number;
  shifts: Shift[];
};
type Data = {
  locations: string[];
  locationOptions?: LocationOption[];
  team: Team[];
  weeks: Week[];
};
function addDays(value: string, amount: number) {
  const date = new Date(`${value}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + amount);
  return date.toISOString().slice(0, 10);
}
function monday(value = new Date().toISOString().slice(0, 10)) {
  const date = new Date(`${value}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() - ((date.getUTCDay() + 6) % 7));
  return date.toISOString().slice(0, 10);
}
function mins(shift: Shift) {
  const [sh, sm] = shift.startTime.split(":").map(Number);
  const [eh, em] = shift.endTime.split(":").map(Number);
  return Math.max(0, eh * 60 + em - sh * 60 - sm);
}
function hourLabel(value: number) {
  return `${Math.floor(value / 60)} h ${String(value % 60).padStart(2, "0")}`;
}

export function WeeklyTimesheetsAdmin({
  notify,
  organizationName = "Salon",
  currency = "CAD",
}: {
  notify: (message: string) => void;
  organizationName?: string;
  currency?: string;
}) {
  const [weekStart, setWeekStart] = useState(monday());
  const [data, setData] = useState<Data | null>(null);
  const [selectedId, setSelectedId] = useState("");
  const [editing, setEditing] = useState<Shift[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    setError("");
    const response = await fetch(`/api/timesheets?week=${weekStart}`, {
      cache: "no-store",
    });
    const body = (await response.json()) as Data & { error?: string };
    if (!response.ok)
      throw new Error(body.error || "Timesheets could not be loaded.");
    const next = body.weeks[0] || null;
    setData(body);
    setSelectedId(next?.id || "");
    setEditing(next?.shifts || []);
  }, [weekStart]);
  useEffect(() => {
    const timer = window.setTimeout(
      () =>
        void load().catch((reason: Error) => {
          setError(reason.message);
          notify(reason.message);
        }),
      0,
    );
    return () => window.clearTimeout(timer);
  }, [load, notify]);

  const selected = data?.weeks.find((week) => week.id === selectedId) || null;
  const locationOptions: LocationOption[] = data?.locationOptions?.length
    ? data.locationOptions
    : (data?.locations || []).map((name) => ({ id: "", name }));
  const usesStableLocationIds = Boolean(data?.locationOptions?.length);
  const totalMinutes = useMemo(
    () => editing.reduce((sum, shift) => sum + mins(shift), 0),
    [editing],
  );
  const tips = useMemo(
    () => editing.reduce((sum, shift) => sum + Number(shift.tips || 0), 0),
    [editing],
  );

  async function save() {
    if (!selected) return;
    setBusy(true);
    setError("");
    try {
      const response = await fetch("/api/timesheets", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          action: "save",
          weekId: selected.id,
          revision: selected.revision,
          shifts: editing,
        }),
      });
      const body = (await response.json()) as { error?: string };
      if (!response.ok)
        throw new Error(body.error || "Correction could not be saved.");
      await load();
      notify("Timesheet corrected; audit history preserved");
    } catch (reason) {
      const message =
        reason instanceof Error
          ? reason.message
          : "Correction could not be saved.";
      setError(message);
      notify(message);
    } finally {
      setBusy(false);
    }
  }
  async function reopen() {
    if (!selected) return;
    setBusy(true);
    setError("");
    try {
      const response = await fetch("/api/timesheets", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          action: "reopen",
          weekId: selected.id,
          revision: selected.revision,
        }),
      });
      const body = (await response.json()) as { error?: string };
      if (!response.ok)
        throw new Error(body.error || "Timesheet could not be reopened.");
      await load();
      notify("Timesheet reopened for the employee");
    } catch (reason) {
      const message =
        reason instanceof Error
          ? reason.message
          : "Timesheet could not be reopened.";
      setError(message);
      notify(message);
    } finally {
      setBusy(false);
    }
  }
  async function approve() {
    if (!selected) return;
    setBusy(true);
    setError("");
    try {
      const response = await fetch("/api/timesheets", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          action: "approve",
          weekId: selected.id,
          revision: selected.revision,
        }),
      });
      const body = (await response.json()) as {
        materializedCount?: number;
        reusedCount?: number;
        error?: string;
      };
      if (!response.ok) throw new Error(body.error || "Approval failed.");
      await load();
      notify(
        `Week approved · ${body.materializedCount || 0} shift${body.materializedCount === 1 ? "" : "s"} added to payroll time`,
      );
    } catch (reason) {
      const message =
        reason instanceof Error ? reason.message : "Approval failed.";
      setError(message);
      notify(message);
    } finally {
      setBusy(false);
    }
  }
  function update(id: string, values: Partial<Shift>) {
    setEditing((rows) =>
      rows.map((row) => (row.id === id ? { ...row, ...values } : row)),
    );
  }

  if (!data)
    return (
      <div className="report-empty" role={error ? "alert" : "status"}>
        {error ? (
          <span>
            {error} <button onClick={() => void load()}>Try again</button>
          </span>
        ) : (
          "Loading weekly timesheets…"
        )}
      </div>
    );
  return (
    <section className="weekly-admin" lang="en-CA">
      <div className="weekly-admin-top">
        <div>
          <span className="eyebrow">{organizationName} · Timesheets</span>
          <h2>Employee weeks</h2>
          <p>
            Mobile setup links, manager corrections, payroll approval, and
            exports.
          </p>
        </div>
        <div className="weekly-admin-nav">
          <button
            aria-label="Previous week"
            onClick={() => setWeekStart(addDays(weekStart, -7))}
          >
            ‹
          </button>
          <strong>
            {weekStart} to {addDays(weekStart, 6)}
          </strong>
          <button
            aria-label="Next week"
            onClick={() => setWeekStart(addDays(weekStart, 7))}
          >
            ›
          </button>
        </div>
      </div>
      {error && (
        <p className="inline-error" role="alert">
          {error}
        </p>
      )}
      <div className="weekly-admin-layout">
        <aside>
          <h3>Employee portal</h3>
          <p className="modal-help">
            Add employees and create private setup links from Team. Timesheets
            stay focused on weekly corrections and payroll approval.
          </p>
          {data.team.map((person) => (
            <div className="weekly-person" key={person.id}>
              <span>{person.displayName.slice(0, 2).toUpperCase()}</span>
              <div>
                <strong>{person.displayName}</strong>
                <small>
                  {person.portal?.active
                    ? `Code ${person.portal.employeeCode}`
                    : "Not activated yet"}
                </small>
              </div>
            </div>
          ))}
        </aside>
        <div className="weekly-review">
          <div className="weekly-list">
            <h3>Weekly sheets</h3>
            {data.weeks.map((week) => (
              <button
                className={week.id === selectedId ? "active" : ""}
                aria-pressed={week.id === selectedId}
                key={week.id}
                onClick={() => {
                  setSelectedId(week.id);
                  setEditing(week.shifts);
                }}
              >
                <span>
                  <strong>{week.staffName}</strong>
                  <small>
                    {week.shifts.length} shift
                    {week.shifts.length !== 1 ? "s" : ""}
                  </small>
                </span>
                <em className={week.status}>
                  {week.status === "approved"
                    ? "Approved"
                    : week.status === "submitted"
                      ? "Submitted"
                      : "Draft"}
                </em>
              </button>
            ))}
            {!data.weeks.length && <p>No timesheets started this week.</p>}
          </div>
          {selected ? (
            <div className="weekly-editor">
              <header>
                <div>
                  <h3>{selected.staffName}</h3>
                  <p>
                    {selected.weekStartsOn} ·{" "}
                    {selected.status === "approved"
                      ? "Approved and added to the payroll time ledger"
                      : selected.status === "submitted"
                        ? "Submitted and awaiting approval"
                        : "Employee draft"}
                  </p>
                </div>
                <div>
                  <a
                    href={`/api/timesheets/export?weekId=${selected.id}&format=csv`}
                  >
                    CSV
                  </a>
                  <a
                    href={`/api/timesheets/export?weekId=${selected.id}&format=pdf`}
                  >
                    PDF
                  </a>
                  {selected.status === "submitted" && (
                    <button
                      className="primary-button"
                      disabled={busy}
                      onClick={() => void approve()}
                    >
                      Approve for payroll
                    </button>
                  )}
                  {selected.status !== "draft" && (
                    <button disabled={busy} onClick={() => void reopen()}>
                      Reopen
                    </button>
                  )}
                </div>
              </header>
              {editing.map((shift) => (
                <div className="weekly-edit-row" key={shift.id}>
                  <input
                    disabled={selected.status === "approved"}
                    type="date"
                    value={shift.workDate}
                    onChange={(event) =>
                      update(shift.id, { workDate: event.target.value })
                    }
                  />
                  <select
                    disabled={selected.status === "approved"}
                    value={
                      usesStableLocationIds
                        ? shift.locationId || ""
                        : shift.locationName
                    }
                    onChange={(event) => {
                      const location = usesStableLocationIds
                        ? locationOptions.find(
                            (option) => option.id === event.target.value,
                          )
                        : locationOptions.find(
                            (option) => option.name === event.target.value,
                          );
                      if (location)
                        update(shift.id, {
                          locationId: usesStableLocationIds
                            ? location.id
                            : null,
                          locationName: location.name,
                        });
                    }}
                  >
                    {usesStableLocationIds && !shift.locationId && (
                      <option value="">Choose a location</option>
                    )}
                    {locationOptions.map((location) => (
                      <option
                        value={
                          usesStableLocationIds ? location.id : location.name
                        }
                        key={location.id || location.name}
                      >
                        {location.label || location.name}
                      </option>
                    ))}
                  </select>
                  <input
                    disabled={selected.status === "approved"}
                    type="time"
                    value={shift.startTime}
                    onChange={(event) =>
                      update(shift.id, { startTime: event.target.value })
                    }
                  />
                  <span>to</span>
                  <input
                    disabled={selected.status === "approved"}
                    type="time"
                    value={shift.endTime}
                    onChange={(event) =>
                      update(shift.id, { endTime: event.target.value })
                    }
                  />
                  <input
                    disabled={selected.status === "approved"}
                    aria-label="Tips"
                    type="number"
                    min="0"
                    step="0.01"
                    value={shift.tips}
                    onChange={(event) =>
                      update(shift.id, { tips: Number(event.target.value) })
                    }
                  />
                  <b>{hourLabel(mins(shift))}</b>
                  {selected.status !== "approved" && (
                    <button
                      onClick={() =>
                        setEditing((rows) =>
                          rows.filter((row) => row.id !== shift.id),
                        )
                      }
                    >
                      ×
                    </button>
                  )}
                </div>
              ))}
              {selected.status !== "approved" && (
                <button
                  className="weekly-add"
                  disabled={!locationOptions.length}
                  onClick={() => {
                    const location = locationOptions[0];
                    if (location)
                      setEditing((rows) => [
                        ...rows,
                        {
                          id: crypto.randomUUID(),
                          workDate: selected.weekStartsOn,
                          locationId: location.id || null,
                          locationName: location.name,
                          startTime: "09:00",
                          endTime: "17:00",
                          tips: 0,
                          paidMinutes: 480,
                        },
                      ]);
                  }}
                >
                  ＋ Add shift
                </button>
              )}
              <footer>
                <span>
                  <small>Total</small>
                  <strong>
                    {hourLabel(totalMinutes)} ·{" "}
                    {new Intl.NumberFormat("en-CA", {
                      style: "currency",
                      currency,
                    }).format(tips)}
                  </strong>
                </span>
                {selected.status !== "approved" && (
                  <button
                    className="primary-button"
                    disabled={busy}
                    onClick={() => void save()}
                  >
                    Save correction
                  </button>
                )}
              </footer>
            </div>
          ) : (
            <div className="report-empty">Choose a timesheet to review.</div>
          )}
        </div>
      </div>
    </section>
  );
}
