"use client";

import { FormEvent, useState } from "react";
import Link from "next/link";
import { CrmLanguageSwitch } from "../crm-language-boundary";

export function SalonOnboarding({ signedInName, onCancel }: { signedInName: string; onCancel?: () => void }) {
  const [country, setCountry] = useState<"CA" | "US">("CA");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy(true); setError("");
    const body = Object.fromEntries(new FormData(event.currentTarget));
    try {
      const response = await fetch("/api/onboarding", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
      const result = await response.json() as { error?: string };
      if (!response.ok) throw new Error(result.error || "Your salon could not be created.");
      window.location.reload();
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Your salon could not be created."); setBusy(false); }
  }

  return <main className="onboarding-page">
    <section className="onboarding-story">
      <div className="onboarding-brand-row"><Link className="brand" href="/"><span>CC</span><strong>Coat &amp; Care</strong></Link><CrmLanguageSwitch /></div>
      <div><span className="eyebrow">Your salon operating system</span><h1>Let’s open the doors, {signedInName.split(" ")[0]}.</h1><p>Create the home for your bookings, care records, team, payments, and client relationships. You can fine-tune every detail after setup.</p></div>
      <ul><li><span>01</span>Salon and location created</li><li><span>02</span>Starter services added</li><li><span>03</span>Booking workspace ready</li></ul>
    </section>
    <section className="onboarding-form-shell">
      <form onSubmit={submit}>
        <header><span>Salon setup</span><h2>Tell us about your first location</h2><p>This takes about two minutes.</p>{onCancel && <button className="onboarding-cancel" type="button" onClick={onCancel}>Back to workspace</button>}</header>
        {error && <div className="settings-error">{error}</div>}
        <div className="onboarding-fields">
          <label className="wide">Salon name<input name="salonName" placeholder="The Good Dog Groomery" required maxLength={80} /></label>
          <label>Location name<input name="locationName" defaultValue="Main salon" required maxLength={80} /></label>
          <label>Country<select name="country" value={country} onChange={(event) => setCountry(event.target.value as "CA" | "US")}><option value="CA">Canada</option><option value="US">United States</option></select></label>
          <label className="wide">Street address<input name="addressLine1" placeholder="123 Main Street" required /></label>
          <label>City<input name="city" placeholder="Toronto" required /></label>
          <label>{country === "US" ? "State" : "Province"}<input name="region" placeholder={country === "US" ? "NY" : "ON"} required /></label>
          <label>{country === "US" ? "ZIP code" : "Postal code"}<input name="postalCode" placeholder={country === "US" ? "10001" : "M5V 2T6"} required /></label>
          <label>Salon phone<input name="contactPhone" type="tel" placeholder="+1 416 555 0100" /></label>
          <label className="wide">Timezone<select name="timezone" defaultValue={country === "US" ? "America/New_York" : "America/Toronto"} key={country}><option value="America/Toronto">Eastern</option><option value="America/Chicago">Central</option><option value="America/Denver">Mountain</option><option value="America/Vancouver">Pacific</option><option value="America/Halifax">Atlantic</option></select></label>
        </div>
        <button className="primary-button onboarding-submit" disabled={busy}>{busy ? "Creating your salon…" : "Create my salon →"}</button>
        <small>Your workspace stays private. You’ll invite your team when you’re ready.</small>
      </form>
    </section>
  </main>;
}
