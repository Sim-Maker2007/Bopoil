"use client";
/* eslint-disable @next/next/no-img-element -- protected R2 photos require the viewer's authenticated request */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

type CareRecord = {
  coatCondition: string;
  styleNotes: string;
  productsUsed: string;
  internalNotes: string;
  clientReport: string;
  reportPublished: boolean;
};
type Warning = {
  id: string;
  category: string;
  severity: string;
  title: string;
  details: string;
  createdAt: string;
};
type MediaAsset = {
  id: string;
  kind: string;
  caption: string;
  originalFilename: string;
  sizeBytes: number;
  url: string;
  createdAt: string;
};
type ApprovalDelivery = {
  id: string;
  channel: string;
  status: string;
  provider: string;
  deliveryAttempts: number;
  lastError: string;
  sentAt?: string | null;
  deliveredAt?: string | null;
  updatedAt?: string;
};
type Approval = {
  id: string;
  token: string;
  title: string;
  explanation: string;
  amountCents: number;
  currency: string;
  status: string;
  expiresAt: string;
  requestedAt: string;
  delivery: ApprovalDelivery | null;
  deliverySummary?: string;
};
type CareData = {
  care: CareRecord | null;
  warnings: Warning[];
  media: MediaAsset[];
  approvals: Approval[];
};

const blankCare: CareRecord = {
  coatCondition: "not_assessed",
  styleNotes: "",
  productsUsed: "",
  internalNotes: "",
  clientReport: "",
  reportPublished: false,
};
async function json<T>(response: Response) {
  const value = (await response.json()) as T & { error?: string };
  if (!response.ok) throw new Error(value.error || "Something went wrong.");
  return value;
}
function label(value: string) {
  return value
    .replaceAll("_", " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}
function deliveryLabel(delivery: ApprovalDelivery | null) {
  if (!delivery) return "No automatic message";
  if (delivery.status === "delivered")
    return `Delivered by ${delivery.channel.toUpperCase()}`;
  if (delivery.status === "sent")
    return `Sent by ${delivery.channel.toUpperCase()}`;
  if (
    delivery.status === "failed" ||
    delivery.status === "action_required" ||
    delivery.provider === "unconnected"
  )
    return "Automatic delivery unavailable — Copy link";
  if (delivery.status === "scheduled") return "Delivery scheduled";
  return "Sending";
}

export function CareWorkspace({
  appointment,
  onClose,
  notify,
  organizationName = "Your salon",
  currency = "CAD",
  timezone = "America/Toronto",
}: {
  appointment: {
    id: string;
    petName: string;
    breed: string;
    safetyLevel: string;
  };
  onClose: () => void;
  notify: (message: string) => void;
  organizationName?: string;
  currency?: string;
  timezone?: string;
}) {
  const [tab, setTab] = useState<
    "assessment" | "photos" | "report" | "approvals"
  >("assessment");
  const [data, setData] = useState<CareData | null>(null);
  const [care, setCare] = useState(blankCare);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [revision, setRevision] = useState(0);
  const [warningForm, setWarningForm] = useState({
    category: "behavior",
    severity: "attention",
    title: "",
    details: "",
  });
  const [showWarningForm, setShowWarningForm] = useState(false);
  const [photoKind, setPhotoKind] = useState("before");
  const [photoCaption, setPhotoCaption] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);
  const workspaceRef = useRef<HTMLElement>(null);
  const closeRef = useRef(onClose);
  const busyRef = useRef(busy);
  const [approvalForm, setApprovalForm] = useState({
    title: "Additional de-matting",
    explanation:
      "Extra time is needed to remove matting safely and comfortably.",
    amount: 25,
  });
  const [showApprovalForm, setShowApprovalForm] = useState(false);
  const [approvalQr, setApprovalQr] = useState<{
    id: string;
    title: string;
    dataUrl: string;
  } | null>(null);
  useEffect(() => {
    fetch(`/api/care?appointmentId=${encodeURIComponent(appointment.id)}`)
      .then((response) => json<CareData>(response))
      .then((value) => {
        setData(value);
        setCare(value.care || blankCare);
      })
      .catch((reason) => setError(reason.message));
  }, [appointment.id, revision]);
  const pollApprovals = useCallback(
    () =>
      fetch(`/api/care?appointmentId=${encodeURIComponent(appointment.id)}`, {
        cache: "no-store",
      })
        .then((response) => json<CareData>(response))
        .then(setData)
        .catch((reason) =>
          setError(
            reason instanceof Error
              ? reason.message
              : "Approval status could not be refreshed.",
          ),
        ),
    [appointment.id],
  );
  const hasPendingApproval = Boolean(
    data?.approvals.some((approval) => approval.status === "pending"),
  );
  useEffect(() => {
    if (!hasPendingApproval) return;
    const timer = window.setInterval(() => void pollApprovals(), 8000);
    const refreshVisible = () => {
      if (document.visibilityState === "visible") void pollApprovals();
    };
    document.addEventListener("visibilitychange", refreshVisible);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", refreshVisible);
    };
  }, [hasPendingApproval, pollApprovals]);
  useEffect(() => {
    closeRef.current = onClose;
    busyRef.current = busy;
  }, [onClose, busy]);
  useEffect(() => {
    const element = workspaceRef.current;
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
      if (event.key === "Escape" && !busyRef.current) {
        closeRef.current();
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
  const activeCritical = useMemo(
    () =>
      data?.warnings.filter((warning) =>
        ["high", "critical"].includes(warning.severity),
      ).length || 0,
    [data],
  );
  async function saveCare(publish = care.reportPublished) {
    setBusy(true);
    setError("");
    try {
      const value = await json<{ care: CareRecord }>(
        await fetch("/api/care", {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            appointmentId: appointment.id,
            ...care,
            reportPublished: publish,
          }),
        }),
      );
      setCare(value.care);
      setData((current) =>
        current ? { ...current, care: value.care } : current,
      );
      notify(
        publish
          ? "Report card published to the client portal"
          : "Care record saved",
      );
    } catch (reason) {
      setError(
        reason instanceof Error
          ? reason.message
          : "Care record could not be saved.",
      );
    } finally {
      setBusy(false);
    }
  }
  async function createWarning() {
    setBusy(true);
    setError("");
    try {
      await json(
        await fetch("/api/care", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            action: "create_warning",
            appointmentId: appointment.id,
            ...warningForm,
          }),
        }),
      );
      setShowWarningForm(false);
      setWarningForm({
        category: "behavior",
        severity: "attention",
        title: "",
        details: "",
      });
      setRevision((value) => value + 1);
      notify("Safety warning added to every future visit");
    } catch (reason) {
      setError(
        reason instanceof Error
          ? reason.message
          : "Warning could not be created.",
      );
    } finally {
      setBusy(false);
    }
  }
  async function resolveWarning(warningId: string) {
    try {
      await json(
        await fetch("/api/care", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            action: "resolve_warning",
            appointmentId: appointment.id,
            warningId,
          }),
        }),
      );
      setRevision((value) => value + 1);
      notify("Warning resolved");
    } catch (reason) {
      setError(
        reason instanceof Error
          ? reason.message
          : "Warning could not be resolved.",
      );
    }
  }
  async function upload(file: File) {
    setBusy(true);
    setError("");
    try {
      const form = new FormData();
      form.set("file", file);
      form.set("appointmentId", appointment.id);
      form.set("kind", photoKind);
      form.set("caption", photoCaption);
      await json(await fetch("/api/media", { method: "POST", body: form }));
      setPhotoCaption("");
      if (fileRef.current) fileRef.current.value = "";
      setRevision((value) => value + 1);
      notify("Photo added to the care record");
    } catch (reason) {
      setError(
        reason instanceof Error
          ? reason.message
          : "Photo could not be uploaded.",
      );
    } finally {
      setBusy(false);
    }
  }
  async function deletePhoto(id: string) {
    try {
      await json(await fetch(`/api/media/${id}`, { method: "DELETE" }));
      setRevision((value) => value + 1);
      notify("Photo removed");
    } catch (reason) {
      setError(
        reason instanceof Error
          ? reason.message
          : "Photo could not be removed.",
      );
    }
  }
  async function requestApproval() {
    setBusy(true);
    setError("");
    try {
      const result = await json<{
        approval: Approval & { deliveryError?: string };
      }>(
        await fetch("/api/care", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            action: "request_approval",
            appointmentId: appointment.id,
            title: approvalForm.title,
            explanation: approvalForm.explanation,
            amountCents: Math.round(approvalForm.amount * 100),
          }),
        }),
      );
      setShowApprovalForm(false);
      setRevision((value) => value + 1);
      const deliveryUnavailable =
        result.approval.deliveryError ||
        !result.approval.delivery ||
        result.approval.delivery.status === "action_required" ||
        result.approval.delivery.status === "failed" ||
        result.approval.delivery.provider === "unconnected";
      notify(
        deliveryUnavailable
          ? "Approval created. Automatic delivery is unavailable; Copy link and share it with the client."
          : `Approval created. ${deliveryLabel(result.approval.delivery)}; delivery is being tracked.`,
      );
    } catch (reason) {
      setError(
        reason instanceof Error
          ? reason.message
          : "Approval could not be requested.",
      );
    } finally {
      setBusy(false);
    }
  }
  async function copyApproval(token: string) {
    await navigator.clipboard.writeText(
      `${window.location.origin}/approval/${token}`,
    );
    notify("Approval link copied");
  }
  async function showApprovalQr(approval: Approval) {
    setBusy(true);
    setError("");
    try {
      const qr = await import("qrcode");
      const dataUrl = await qr.toDataURL(
        `${window.location.origin}/approval/${approval.token}`,
        {
          errorCorrectionLevel: "M",
          margin: 2,
          width: 240,
          color: { dark: "#29241f", light: "#ffffff" },
        },
      );
      setApprovalQr({ id: approval.id, title: approval.title, dataUrl });
    } catch (reason) {
      setError(
        reason instanceof Error
          ? reason.message
          : "Approval QR could not be generated.",
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <div
      className="modal-backdrop care-backdrop"
      onMouseDown={(event) => {
        if (event.currentTarget === event.target && !busy) onClose();
      }}
    >
      <section
        ref={workspaceRef}
        className="care-workspace"
        role="dialog"
        aria-modal="true"
        aria-label={`${appointment.petName}'s care record`}
      >
        <header className="care-head">
          <div className="care-pet">
            <span>{appointment.petName.slice(0, 1)}</span>
            <div>
              <span className="eyebrow">Live care record</span>
              <h2>{appointment.petName}</h2>
              <p>
                {appointment.breed} ·{" "}
                {activeCritical
                  ? `${activeCritical} high-priority warning${activeCritical === 1 ? "" : "s"}`
                  : "No high-priority warnings"}
              </p>
            </div>
          </div>
          <button
            className="close-round"
            disabled={busy}
            onClick={onClose}
            aria-label="Close care record"
          >
            ×
          </button>
        </header>
        <nav className="care-tabs" aria-label="Care record sections">
          {(["assessment", "photos", "report", "approvals"] as const).map(
            (item) => (
              <button
                key={item}
                aria-current={tab === item ? "page" : undefined}
                className={tab === item ? "selected" : ""}
                onClick={() => setTab(item)}
              >
                {item === "report" ? "Report card" : label(item)}{" "}
                {item === "assessment" ? (
                  <span>{data?.warnings.length || 0}</span>
                ) : item === "photos" ? (
                  <span>{data?.media.length || 0}</span>
                ) : item === "approvals" ? (
                  <span>
                    {data?.approvals.filter(
                      (approval) => approval.status === "pending",
                    ).length || 0}
                  </span>
                ) : null}
              </button>
            ),
          )}
        </nav>
        {error && (
          <p className="inline-error care-error" role="alert">
            {error}
          </p>
        )}
        {!data ? (
          <div
            className="dashboard-loading"
            role="status"
            aria-label="Loading care record"
          >
            <span />
            <span />
            <span />
          </div>
        ) : (
          <div className="care-body">
            {tab === "assessment" ? (
              <div className="assessment-layout">
                <section className="care-form">
                  <div className="care-section-title">
                    <div>
                      <h3>Visit assessment</h3>
                      <p>
                        Document the coat, requested finish, and products used
                        today.
                      </p>
                    </div>
                    <span
                      className={`record-state ${care.coatCondition === "not_assessed" ? "" : "ready"}`}
                    >
                      {care.coatCondition === "not_assessed"
                        ? "Not assessed"
                        : "In progress"}
                    </span>
                  </div>
                  <label>
                    Coat condition
                    <select
                      value={care.coatCondition}
                      onChange={(event) =>
                        setCare({ ...care, coatCondition: event.target.value })
                      }
                    >
                      <option value="not_assessed">Not assessed</option>
                      <option value="healthy">Healthy</option>
                      <option value="tangled">Tangled</option>
                      <option value="matted">Matted</option>
                      <option value="severely_matted">Severely matted</option>
                      <option value="skin_concern">Skin concern</option>
                    </select>
                  </label>
                  <label>
                    Style & finish notes
                    <textarea
                      value={care.styleNotes}
                      onChange={(event) =>
                        setCare({ ...care, styleNotes: event.target.value })
                      }
                      placeholder="Length, face shape, feet, tail, owner preferences…"
                    />
                  </label>
                  <label>
                    Products used
                    <textarea
                      value={care.productsUsed}
                      onChange={(event) =>
                        setCare({ ...care, productsUsed: event.target.value })
                      }
                      placeholder="Shampoo, conditioner, treatments…"
                    />
                  </label>
                  <label>
                    Internal groomer notes
                    <textarea
                      value={care.internalNotes}
                      onChange={(event) =>
                        setCare({ ...care, internalNotes: event.target.value })
                      }
                      placeholder="Private observations for the salon team…"
                    />
                  </label>
                  <button
                    className="primary-button"
                    disabled={busy}
                    onClick={() => saveCare(false)}
                  >
                    {busy ? "Saving…" : "Save visit assessment"}
                  </button>
                </section>
                <aside className="warning-panel">
                  <div className="care-section-title">
                    <div>
                      <h3>Safety warnings</h3>
                      <p>Persistent across every future visit.</p>
                    </div>
                    <button onClick={() => setShowWarningForm(true)}>
                      ＋ Add
                    </button>
                  </div>
                  {data.warnings.length ? (
                    <div className="warning-list">
                      {data.warnings.map((warning) => (
                        <article className={warning.severity} key={warning.id}>
                          <header>
                            <span>
                              {warning.severity === "critical" ? "!" : "⚑"}
                            </span>
                            <div>
                              <strong>{warning.title}</strong>
                              <small>
                                {label(warning.category)} ·{" "}
                                {label(warning.severity)}
                              </small>
                            </div>
                          </header>
                          <p>{warning.details}</p>
                          <button onClick={() => resolveWarning(warning.id)}>
                            Resolve warning
                          </button>
                        </article>
                      ))}
                    </div>
                  ) : (
                    <div className="care-empty">
                      <span>✓</span>
                      <strong>No structured warnings</strong>
                      <p>
                        Add allergies, behavior, mobility, dryer, kennel, or
                        emergency guidance here.
                      </p>
                    </div>
                  )}
                </aside>
                {showWarningForm && (
                  <div className="care-inline-modal">
                    <div className="care-section-title">
                      <h3>New safety warning</h3>
                      <button
                        onClick={() => setShowWarningForm(false)}
                        aria-label="Close warning form"
                      >
                        ×
                      </button>
                    </div>
                    <div className="field-pair">
                      <label>
                        Category
                        <select
                          value={warningForm.category}
                          onChange={(event) =>
                            setWarningForm({
                              ...warningForm,
                              category: event.target.value,
                            })
                          }
                        >
                          {[
                            "allergy",
                            "medical",
                            "behavior",
                            "mobility",
                            "bite_risk",
                            "dryer_restriction",
                            "kennel_restriction",
                            "emergency",
                            "other",
                          ].map((item) => (
                            <option value={item} key={item}>
                              {label(item)}
                            </option>
                          ))}
                        </select>
                      </label>
                      <label>
                        Severity
                        <select
                          value={warningForm.severity}
                          onChange={(event) =>
                            setWarningForm({
                              ...warningForm,
                              severity: event.target.value,
                            })
                          }
                        >
                          <option value="attention">Attention</option>
                          <option value="high">High</option>
                          <option value="critical">Critical</option>
                        </select>
                      </label>
                    </div>
                    <label>
                      Short title
                      <input
                        value={warningForm.title}
                        onChange={(event) =>
                          setWarningForm({
                            ...warningForm,
                            title: event.target.value,
                          })
                        }
                        placeholder="Sensitive left hip"
                      />
                    </label>
                    <label>
                      Staff guidance
                      <textarea
                        value={warningForm.details}
                        onChange={(event) =>
                          setWarningForm({
                            ...warningForm,
                            details: event.target.value,
                          })
                        }
                        placeholder="What must the team know or do?"
                      />
                    </label>
                    <button
                      className="primary-button wide"
                      disabled={
                        busy || !warningForm.title || !warningForm.details
                      }
                      onClick={createWarning}
                    >
                      Add safety warning
                    </button>
                  </div>
                )}
              </div>
            ) : tab === "photos" ? (
              <div className="photo-workspace">
                <section className="photo-upload">
                  <span>◎</span>
                  <h3>Capture the care story</h3>
                  <p>
                    Add before, after, coat issue, or incident photos. Images
                    are private to this salon.
                  </p>
                  <div className="field-pair">
                    <label>
                      Photo type
                      <select
                        value={photoKind}
                        onChange={(event) => setPhotoKind(event.target.value)}
                      >
                        <option value="before">Before</option>
                        <option value="after">After</option>
                        <option value="coat_issue">Coat issue</option>
                        <option value="incident">Incident</option>
                      </select>
                    </label>
                    <label>
                      Caption
                      <input
                        value={photoCaption}
                        onChange={(event) =>
                          setPhotoCaption(event.target.value)
                        }
                        placeholder="Optional context"
                      />
                    </label>
                  </div>
                  <label className="photo-picker">
                    {busy ? "Uploading…" : "Choose or take a photo"}
                    <input
                      ref={fileRef}
                      disabled={busy}
                      type="file"
                      accept="image/jpeg,image/png,image/webp"
                      capture="environment"
                      onChange={(event) => {
                        const file = event.target.files?.[0];
                        if (file) void upload(file);
                      }}
                    />
                  </label>
                  <small>JPEG, PNG, or WebP · up to 4 MB</small>
                </section>
                <div className="photo-gallery">
                  {data.media.length ? (
                    data.media.map((asset) => (
                      <article key={asset.id}>
                        <img
                          src={asset.url}
                          alt={
                            asset.caption ||
                            `${label(asset.kind)} photo of ${appointment.petName}`
                          }
                          loading="lazy"
                        />
                        <div>
                          <span className={`photo-kind ${asset.kind}`}>
                            {label(asset.kind)}
                          </span>
                          <strong>
                            {asset.caption || asset.originalFilename}
                          </strong>
                          <small>
                            {new Intl.DateTimeFormat("en-CA", {
                              timeZone: timezone,
                              month: "short",
                              day: "numeric",
                              hour: "numeric",
                              minute: "2-digit",
                            }).format(new Date(asset.createdAt))}{" "}
                            · {(asset.sizeBytes / 1024 / 1024).toFixed(1)} MB
                          </small>
                          <button onClick={() => deletePhoto(asset.id)}>
                            Remove
                          </button>
                        </div>
                      </article>
                    ))
                  ) : (
                    <div className="care-empty gallery">
                      <span>◎</span>
                      <strong>No photos yet</strong>
                      <p>Start with a before photo at check-in.</p>
                    </div>
                  )}
                </div>
              </div>
            ) : tab === "report" ? (
              <div className="report-card-workspace">
                <section>
                  <span className="eyebrow">Take-home care</span>
                  <h3>{appointment.petName}’s report card</h3>
                  <p>
                    Write a warm client-facing summary. Internal notes never
                    appear here.
                  </p>
                  <textarea
                    value={care.clientReport}
                    onChange={(event) =>
                      setCare({
                        ...care,
                        clientReport: event.target.value,
                        reportPublished: false,
                      })
                    }
                    placeholder={`${appointment.petName} did beautifully today! We noticed…`}
                  />
                  <div className="report-actions">
                    <button
                      className="secondary-button"
                      disabled={busy}
                      onClick={() => saveCare(false)}
                    >
                      Save draft
                    </button>
                    <button
                      className="primary-button"
                      disabled={busy || !care.clientReport}
                      onClick={() => saveCare(true)}
                    >
                      {busy ? "Publishing…" : "Publish report card"}
                    </button>
                  </div>
                </section>
                <aside className="report-preview">
                  <header>
                    <span>
                      {organizationName
                        .split(/\s+/)
                        .map((word) => word[0])
                        .join("")
                        .slice(0, 2)
                        .toUpperCase()}
                    </span>
                    <div>
                      <strong>{organizationName}</strong>
                      <small>Grooming report card</small>
                    </div>
                  </header>
                  <div className="report-pet-mark">
                    {appointment.petName.slice(0, 1)}
                  </div>
                  <h2>{appointment.petName}’s fresh look</h2>
                  <p>
                    {care.clientReport ||
                      "Your groomer’s take-home note will appear here."}
                  </p>
                  <div>
                    <span>Coat assessment</span>
                    <strong>{label(care.coatCondition)}</strong>
                  </div>
                  <footer>
                    {care.reportPublished
                      ? "✓ Published to client portal"
                      : "Draft · not shared yet"}
                  </footer>
                </aside>
              </div>
            ) : (
              <div className="approval-workspace">
                <div className="care-section-title">
                  <div>
                    <h3>Client price approvals</h3>
                    <p>
                      Request explicit consent before adding unexpected care.
                    </p>
                  </div>
                  <button onClick={() => setShowApprovalForm(true)}>
                    ＋ New request
                  </button>
                </div>
                {data.approvals.length ? (
                  <div className="approval-list">
                    {data.approvals.map((approval) => (
                      <article key={approval.id}>
                        <span className={`approval-state ${approval.status}`}>
                          {label(approval.status)}
                        </span>
                        <div>
                          <strong>{approval.title}</strong>
                          <p>{approval.explanation}</p>
                          <small
                            className={`approval-delivery ${approval.delivery?.status || "unavailable"}`}
                          >
                            {approval.deliverySummary ||
                              deliveryLabel(approval.delivery)}
                          </small>
                          <small>
                            {new Intl.NumberFormat("en-CA", {
                              style: "currency",
                              currency: approval.currency,
                            }).format(approval.amountCents / 100)}{" "}
                            · requested{" "}
                            {new Intl.DateTimeFormat("en-CA", {
                              timeZone: timezone,
                              month: "short",
                              day: "numeric",
                              hour: "numeric",
                              minute: "2-digit",
                            }).format(new Date(approval.requestedAt))}
                          </small>
                        </div>
                        <div className="approval-share-actions">
                          <button onClick={() => copyApproval(approval.token)}>
                            Copy link
                          </button>
                          {approval.status === "pending" && (
                            <button
                              disabled={busy}
                              onClick={() => void showApprovalQr(approval)}
                            >
                              Show QR
                            </button>
                          )}
                        </div>
                      </article>
                    ))}
                  </div>
                ) : (
                  <div className="care-empty approvals">
                    <span>✓</span>
                    <strong>No price changes requested</strong>
                    <p>
                      If the coat condition changes scope, send a timestamped
                      approval before proceeding.
                    </p>
                  </div>
                )}
                {showApprovalForm && (
                  <div className="care-inline-modal approval-form">
                    <div className="care-section-title">
                      <h3>Request client approval</h3>
                      <button
                        onClick={() => setShowApprovalForm(false)}
                        aria-label="Close approval form"
                      >
                        ×
                      </button>
                    </div>
                    <label>
                      Additional care
                      <input
                        value={approvalForm.title}
                        onChange={(event) =>
                          setApprovalForm({
                            ...approvalForm,
                            title: event.target.value,
                          })
                        }
                      />
                    </label>
                    <label>
                      Why it’s needed
                      <textarea
                        value={approvalForm.explanation}
                        onChange={(event) =>
                          setApprovalForm({
                            ...approvalForm,
                            explanation: event.target.value,
                          })
                        }
                      />
                    </label>
                    <label>
                      Added price ({currency})
                      <input
                        type="number"
                        min="1"
                        step="1"
                        value={approvalForm.amount}
                        onChange={(event) =>
                          setApprovalForm({
                            ...approvalForm,
                            amount: Number(event.target.value),
                          })
                        }
                      />
                    </label>
                    <button
                      className="primary-button wide"
                      disabled={
                        busy ||
                        !approvalForm.title ||
                        !approvalForm.explanation ||
                        approvalForm.amount <= 0
                      }
                      onClick={requestApproval}
                    >
                      {busy ? "Creating…" : "Create approval request"}
                    </button>
                    <small>
                      No payment is taken. The approved amount updates the
                      appointment estimate.
                    </small>
                  </div>
                )}
              </div>
            )}
          </div>
        )}
      </section>
      {approvalQr && (
        <div
          className="approval-qr-backdrop"
          role="presentation"
          onMouseDown={(event) => {
            if (event.currentTarget === event.target) setApprovalQr(null);
          }}
        >
          <section
            className="approval-qr-card"
            role="dialog"
            aria-modal="true"
            aria-labelledby={`approval-qr-${approvalQr.id}`}
          >
            <button
              className="close-round"
              onClick={() => setApprovalQr(null)}
              aria-label="Close approval QR"
            >
              ×
            </button>
            <span className="eyebrow">Scan on the client’s phone</span>
            <h3 id={`approval-qr-${approvalQr.id}`}>{approvalQr.title}</h3>
            <img
              src={approvalQr.dataUrl}
              alt={`QR code for ${approvalQr.title} approval`}
            />
            <p>
              The private approval opens directly on their device. It records
              consent only after they review and confirm.
            </p>
          </section>
        </div>
      )}
    </div>
  );
}
