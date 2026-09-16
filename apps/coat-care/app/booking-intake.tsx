"use client";
import { useEffect, useRef, useState } from "react";
import { sizeOptions } from "../lib/care-options";

const speciesChoices = [
  { value: "chien", label: "Chien", icon: "🐶" },
  { value: "chat", label: "Chat", icon: "🐱" },
  { value: "autre", label: "Petit animal", icon: "🐰" },
];

// Profile creation is split in two short screens so it stays comfortable on a
// phone: the person first, then their animal. Both fieldsets stay mounted so a
// single native submit still carries every field to /api/public/intake.
export function BookingIntake({ salonSlug, locationSlug, onCreated, onSignIn, onBack }: {
  salonSlug: string; locationSlug: string; onCreated: () => Promise<void>; onSignIn: (email: string) => void; onBack: () => void;
}) {
  const [panel, setPanel] = useState<1 | 2>(1);
  const [busy, setBusy] = useState(false); const [error, setError] = useState("");
  const submissionId = useRef("");
  const ownerFields = useRef<HTMLFieldSetElement>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const firstRender = useRef(true);

  useEffect(() => {
    if (firstRender.current) { firstRender.current = false; return; }
    heading.current?.focus();
  }, [panel]);

  function continueToPet() {
    const controls = Array.from(ownerFields.current?.querySelectorAll<HTMLInputElement>("input, select, textarea") || []);
    for (const control of controls) { if (!control.reportValidity()) return; }
    setPanel(2);
  }

  return <form className="guided-fields intake-form" onSubmit={async (event) => {
    event.preventDefault(); setBusy(true); setError("");
    const values = Object.fromEntries(new FormData(event.currentTarget));
    submissionId.current ||= crypto.randomUUID();
    try {
      const response = await fetch("/api/public/intake", { method: "POST", credentials: "same-origin", headers: { "content-type": "application/json" }, body: JSON.stringify({ ...values, salonSlug, locationSlug, submissionId: submissionId.current }) });
      const result = await response.json();
      if (result.intent === "secure_access_required") { onSignIn(String(values.email)); return; }
      if (!response.ok) throw new Error(result.error || "Impossible de créer le profil. Réessayez.");
      await onCreated();
    } catch (error) { setError(error instanceof Error ? error.message : "Impossible de créer le profil."); }
    finally { setBusy(false); }
  }}>
    <div className="intake-head">
      <button type="button" className="mini-link intake-back" disabled={busy} onClick={() => panel === 2 ? setPanel(1) : onBack()}><span aria-hidden="true">‹</span> Retour</button>
      <div className="intake-progress" aria-hidden="true"><span className="active"/><span className={panel === 2 ? "active" : ""}/></div>
      <small className="intake-step">Étape {panel} sur 2</small>
    </div>
    <h3 data-booking-step-heading tabIndex={-1} ref={heading}>{panel === 1 ? "Bienvenue chez BOPOIL" : "Parlez-nous de votre animal"}</h3>
    <p>{panel === 1 ? "Créez votre profil, puis choisissez les soins de votre animal." : "Ces détails nous aident à préparer un soin adapté et sécuritaire."}</p>
    <fieldset ref={ownerFields} hidden={panel !== 1} disabled={busy}><legend>Vos coordonnées</legend>
      <label>Nom complet<input name="proprietaire" autoComplete="name" minLength={2} maxLength={100} required/></label>
      <label>Courriel<input name="email" type="email" inputMode="email" autoComplete="email" maxLength={180} required/></label>
      <label>Téléphone<input name="telephone" type="tel" inputMode="tel" autoComplete="tel" required/></label>
    </fieldset>
    <fieldset hidden={panel !== 2} disabled={busy}><legend>Votre animal</legend>
      <label>Son nom<input name="nom_animal" maxLength={60} required/></label>
      <div className="chip-field"><span className="chip-label" id="intake-species-label">Espèce</span>
        <div className="chip-group" role="radiogroup" aria-labelledby="intake-species-label">{speciesChoices.map((choice) => <label className="chip" key={choice.value}><input type="radio" name="espece" value={choice.value} defaultChecked={choice.value === "chien"}/><span><i aria-hidden="true">{choice.icon}</i>{choice.label}</span></label>)}</div>
      </div>
      <label>Race ou croisement<input name="race" maxLength={80} placeholder="Ex. : caniche, labrador croisé…" required/></label>
      <label>Poids<select name="taille" required defaultValue=""><option value="">Choisir</option>{sizeOptions.map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label>
      <label>Santé et précautions<textarea name="sante" required maxLength={2500} placeholder="Allergies, problèmes de santé, ou « Aucun »"/></label>
      <label>Comportement (facultatif)<textarea name="comportement" maxLength={2500} placeholder="Ce qui nous aidera à prendre soin de lui"/></label>
    </fieldset>
    {error && <p className="booking-error" role="alert">{error}</p>}
    {panel === 1
      // Distinct keys keep React from reusing the same DOM node for both buttons:
      // otherwise the click that switches panels would land on the submit button.
      ? <button key="continue" type="button" className="primary-button wide" disabled={busy} onClick={(event) => { event.preventDefault(); continueToPet(); }}>Continuer<span aria-hidden="true"> ›</span></button>
      : <button key="submit" type="submit" className="primary-button wide" disabled={busy}>{busy ? "Enregistrement…" : "Créer mon profil et choisir les soins"}</button>}
    <small className="intake-privacy">Vos renseignements restent privés et servent uniquement à préparer les soins de votre animal.</small>
  </form>;
}
