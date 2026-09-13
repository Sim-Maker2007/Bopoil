"use client";

import Link from "next/link";
import { FormEvent, useState } from "react";
import { CrmLanguageSwitch } from "../../crm-language-boundary";

export function SalonLoginForm({ demoEnabled, expired, returnTo }: { demoEnabled: boolean; expired: boolean; returnTo: string }) {
  const [email, setEmail] = useState("");
  const [state, setState] = useState<"idle" | "sending" | "opening" | "sent" | "error">("idle");
  async function submit(event: FormEvent) {
    event.preventDefault();
    setState("sending");
    const response = await fetch("/api/auth/salon/request", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email, returnTo }) });
    setState(response.ok ? "sent" : "error");
  }
  async function openDemo() {
    setState("opening");
    const response = await fetch("/api/auth/salon/demo", { method: "POST" });
    if (!response.ok) { setState("error"); return; }
    const destination = returnTo.startsWith("/") && !returnTo.startsWith("//") ? returnTo : "/salon";
    window.location.assign(destination);
  }
  return <main style={{ minHeight: "100vh", display: "grid", placeItems: "center", padding: 24, background: "#f5f1eb", color: "#171717" }}>
    <section style={{ width: "min(440px, 100%)", background: "white", borderRadius: 24, padding: 36, boxShadow: "0 24px 80px rgba(0,0,0,.1)" }}>
      <div style={{ display: "flex", justifyContent: "flex-end" }}><CrmLanguageSwitch /></div>
      <p style={{ letterSpacing: ".14em", textTransform: "uppercase", fontSize: 12, fontWeight: 700 }}>BOPOIL</p>
      <h1 style={{ margin: "10px 0", fontSize: 34 }}>Coat & Care</h1>
      <p style={{ color: "#666", lineHeight: 1.6 }}>Enter your authorized salon email. We’ll send you a private, one-time sign-in link.</p>
      {expired && <p role="alert" style={{ color: "#9d2d20" }}>That link has expired or was already used. Request a new one below.</p>}
      <form onSubmit={submit} style={{ display: "grid", gap: 14, marginTop: 24 }}>
        <label htmlFor="salon-email" style={{ fontWeight: 650 }}>Email address</label>
        <input id="salon-email" type="email" required autoComplete="email" value={email} onChange={(event) => setEmail(event.target.value)} style={{ padding: "14px 16px", border: "1px solid #cfc8bd", borderRadius: 12, font: "inherit" }}/>
        <button disabled={state === "sending" || state === "sent"} style={{ border: 0, borderRadius: 999, padding: "14px 18px", background: "#171717", color: "white", font: "inherit", fontWeight: 700, cursor: "pointer" }}>{state === "sending" ? "Sending…" : state === "sent" ? "Email sent" : "Send secure link"}</button>
      </form>
      {state === "sent" && <p role="status" style={{ color: "#28623c" }}>Check your inbox. For privacy, we show this same message for every address.</p>}
      {state === "error" && <p role="alert" style={{ color: "#9d2d20" }}>The email could not be sent. Please try again.</p>}
      {demoEnabled && <div style={{ marginTop: 24, paddingTop: 24, borderTop: "1px solid #e5dfd6" }}>
        <p style={{ margin: "0 0 12px", color: "#666", lineHeight: 1.5 }}>Local preview only—open the complete owner workspace without sending an email.</p>
        <button type="button" disabled={state === "opening"} onClick={openDemo} style={{ width: "100%", border: "1px solid #171717", borderRadius: 999, padding: "13px 18px", background: "white", color: "#171717", font: "inherit", fontWeight: 700, cursor: "pointer" }}>{state === "opening" ? "Opening workspace…" : "Open demo owner workspace"}</button>
      </div>}
      <Link href="/" style={{ display: "inline-block", marginTop: 22, color: "inherit" }}>← Back to BOPOIL</Link>
    </section>
  </main>;
}
