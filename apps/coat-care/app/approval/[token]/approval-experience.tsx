"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

type Approval = {
  id: string; title: string; explanation: string; amountCents: number; currency: string;
  status: string; expiresAt: string; respondedAt: string | null; responseName: string;
  appointmentStartsAt: string; clientFirstName: string; petName: string; serviceName: string;
};

export function ApprovalExperience({ token }: { token: string }) {
  const [approval, setApproval] = useState<Approval | null>(null);
  const [name, setName] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    fetch(`/api/approvals/${encodeURIComponent(token)}`)
      .then(async (response) => {
        const data = await response.json() as { approval?: Approval; error?: string };
        if (!response.ok) throw new Error(data.error || "Request unavailable");
        setApproval(data.approval || null);
      })
      .catch((reason) => setError(reason.message))
      .finally(() => setLoading(false));
  }, [token]);

  async function respond(decision: "approved" | "declined") {
    setBusy(true); setError("");
    try {
      const response = await fetch(`/api/approvals/${encodeURIComponent(token)}`, {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ decision, responseName: name }),
      });
      const data = await response.json() as { approval?: Approval; error?: string };
      if (!response.ok) throw new Error(data.error || "Response could not be saved");
      setApproval(data.approval || null);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Response could not be saved");
    } finally { setBusy(false); }
  }

  const money = approval ? new Intl.NumberFormat("en-CA", { style: "currency", currency: approval.currency }).format(approval.amountCents / 100) : "";

  return <main className="approval-page">
    <header><Link href="/" className="brand" aria-label="Return to salon booking"><span aria-hidden="true">♡</span><span><strong>Your salon</strong><small>Pet care request</small></span></Link><span>Secure approval</span></header>
    <section className="approval-card">
      {loading ? <div className="approval-loading" role="status" aria-label="Loading approval request"><span /><span /><span /></div> : error && !approval ? (
        <div className="approval-result declined" role="alert"><span aria-hidden="true">!</span><h1>We couldn’t open this request.</h1><p>{error}</p><Link href="/">Return to salon booking</Link></div>
      ) : approval?.status === "pending" ? <>
        <span className="eyebrow">A quick decision for {approval.petName}</span>
        <h1>May we add this care?</h1>
        <p className="approval-intro">Hi {approval.clientFirstName}—your groomer has found something that changes today’s service.</p>
        <div className="approval-request"><div><span>Recommended care</span><h2>{approval.title}</h2><p>{approval.explanation}</p></div><strong>+{money}</strong></div>
        <div className="approval-context"><span>Today’s visit</span><strong>{approval.petName} · {approval.serviceName}</strong></div>
        <label>Your name<input value={name} onChange={(event) => setName(event.target.value)} placeholder="Type your full name" autoComplete="name" required /></label>
        {error && <p className="inline-error" role="alert">{error}</p>}
        <div className="approval-actions"><button className="primary-button" disabled={busy || name.trim().length < 2} onClick={() => respond("approved")}>{busy ? "Saving…" : `Approve +${money}`}</button><button className="secondary-button" disabled={busy || name.trim().length < 2} onClick={() => respond("declined")}>Decline additional care</button></div>
        <small className="approval-note">Your response is timestamped and added to {approval.petName}’s appointment record. No payment is taken here.</small>
      </> : approval ? <ApprovalResult approval={approval} /> : null}
    </section>
    <footer><span>🔒 Token-protected response</span><span>No card information requested</span></footer>
  </main>;
}

function ApprovalResult({ approval }: { approval: Approval }) {
  const content = approval.status === "approved"
    ? { icon: "✓", title: "Approved—thank you.", message: `${approval.title} has been added to ${approval.petName}’s care plan.` }
    : approval.status === "declined"
      ? { icon: "×", title: "Request declined.", message: `We’ll continue without ${approval.title}.` }
      : approval.status === "cancelled"
        ? { icon: "×", title: "This request was cancelled.", message: "The appointment changed, so no response is needed." }
        : { icon: "⌛", title: "This request has expired.", message: "Please call the salon if you’d still like to discuss the recommended care." };
  return <div className={`approval-result ${approval.status}`} role="status"><span aria-hidden="true">{content.icon}</span><h1>{content.title}</h1><p>{content.message}</p><Link href="/">Return to salon booking</Link></div>;
}
