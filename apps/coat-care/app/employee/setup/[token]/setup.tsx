"use client";

import { FormEvent, useEffect, useState } from "react";
import { CRM_LOCALE_STORAGE_KEY } from "../../../crm-language";

type Locale = "en" | "fr";

const text = {
  en: {
    mismatch: "The two PINs do not match.", failed: "Activation failed.", employee: "Employee", activated: "Access activated",
    welcome: "Welcome", keepCode: "Keep your employee code. You will use it to sign in on this or another device.",
    code: "Your employee code", open: "Open employee space", team: "Coat & Care · Team", title: "Create your personal PIN",
    guidance: "Choose six digits you can remember but others cannot guess. Never share your PIN.", pin: "Six-digit PIN",
    confirm: "Confirm PIN", activating: "Activating…", activate: "Activate my access", secure: "One-time setup link · Secure session",
  },
  fr: {
    mismatch: "Les deux NIP ne correspondent pas.", failed: "Activation impossible.", employee: "Employé", activated: "Accès activé",
    welcome: "Bienvenue", keepCode: "Conserve ton code employé. Tu l’utiliseras pour te connecter sur cet appareil ou un autre.",
    code: "Ton code employé", open: "Ouvrir mon espace employé", team: "Coat & Care · Équipe", title: "Crée ton NIP personnel",
    guidance: "Choisis six chiffres faciles à retenir, mais difficiles à deviner. Ne partage jamais ton NIP.", pin: "NIP à six chiffres",
    confirm: "Confirmer le NIP", activating: "Activation…", activate: "Activer mon accès", secure: "Lien à usage unique · Session sécurisée",
  },
} as const;

export function EmployeeSetup({ token }: { token: string }) {
  const [locale, setLocale] = useState<Locale>("en");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState<{ employeeCode: string; displayName: string } | null>(null);
  const t = text[locale];
  useEffect(() => {
    const timer = window.setTimeout(() => {
      const saved = window.localStorage.getItem(CRM_LOCALE_STORAGE_KEY) || window.localStorage.getItem("employee-locale");
      setLocale(saved === "fr" || (!saved && navigator.language.toLowerCase().startsWith("fr")) ? "fr" : "en");
    }, 0);
    return () => window.clearTimeout(timer);
  }, []);
  function choose(next: Locale) { setLocale(next); window.localStorage.setItem(CRM_LOCALE_STORAGE_KEY, next); }
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const pin = String(data.get("pin") || "");
    const confirmation = String(data.get("confirm") || "");
    if (pin !== confirmation) return setError(t.mismatch);
    setBusy(true); setError("");
    try {
      const response = await fetch("/api/employee/session", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "setup", token, pin }) });
      const body = await response.json() as { employeeCode?: string; displayName?: string; error?: string };
      if (!response.ok || !body.employeeCode) throw new Error(body.error || t.failed);
      setResult({ employeeCode: body.employeeCode, displayName: body.displayName || t.employee });
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : t.failed);
    } finally {
      setBusy(false);
    }
  }
  return <main className="employee-auth-shell" lang={locale === "fr" ? "fr-CA" : "en-CA"}><section className="employee-auth-card"><div className="employee-auth-language"><div className="employee-language" aria-label="Language / Langue"><button aria-pressed={locale === "en"} onClick={() => choose("en")}>EN</button><button aria-pressed={locale === "fr"} onClick={() => choose("fr")}>FR</button></div></div><div className="employee-mark">C<span>&</span>C</div>{result ? <><span className="employee-kicker">{t.activated}</span><h1>{t.welcome}, {result.displayName}.</h1><p>{t.keepCode}</p><div className="employee-code"><small>{t.code}</small><strong>{result.employeeCode}</strong></div><a className="employee-primary-link" href="/employee">{t.open}</a></> : <><span className="employee-kicker">{t.team}</span><h1>{t.title}</h1><p>{t.guidance}</p>{error && <div className="employee-error" role="alert">{error}</div>}<form onSubmit={submit}><label>{t.pin}<input name="pin" type="password" inputMode="numeric" pattern="[0-9]{6}" minLength={6} maxLength={6} autoComplete="new-password" required /></label><label>{t.confirm}<input name="confirm" type="password" inputMode="numeric" pattern="[0-9]{6}" minLength={6} maxLength={6} autoComplete="new-password" required /></label><button disabled={busy}>{busy ? t.activating : t.activate}</button></form><small className="employee-security">{t.secure}</small></>}</section></main>;
}
