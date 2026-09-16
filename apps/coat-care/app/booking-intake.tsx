"use client";
import { useRef, useState } from "react";
import { sizeOptions } from "../lib/care-options";
export function BookingIntake({ salonSlug, locationSlug, onCreated, onSignIn, onBack }: {
  salonSlug: string; locationSlug: string; onCreated: () => Promise<void>; onSignIn: (email: string) => void; onBack: () => void;
}) {
  const [busy, setBusy] = useState(false); const [error, setError] = useState("");
  const submissionId = useRef("");
  return <form className="guided-fields" onSubmit={async (event) => {
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
    <button type="button" className="mini-link" disabled={busy} onClick={onBack}>← Retour</button>
    <h3 data-booking-step-heading tabIndex={-1}>Bienvenue chez BOPOIL</h3>
    <p>Créez votre profil, puis choisissez les soins de votre animal.</p>
    <fieldset disabled={busy}><legend>Vos coordonnées</legend>
      <label>Nom complet<input name="proprietaire" autoComplete="name" minLength={2} maxLength={100} required/></label>
      <label>Courriel<input name="email" type="email" autoComplete="email" maxLength={180} required/></label>
      <label>Téléphone<input name="telephone" type="tel" autoComplete="tel" required/></label>
    </fieldset>
    <fieldset disabled={busy}><legend>Votre animal</legend>
      <label>Son nom<input name="nom_animal" maxLength={60} required/></label>
      <label>Espèce<select name="espece" defaultValue="chien"><option value="chien">Chien</option><option value="chat">Chat</option><option value="autre">Petit animal</option></select></label>
      <label>Race ou croisement<input name="race" maxLength={80} placeholder="Ex. : caniche, labrador croisé…" required/></label>
      <label>Poids<select name="taille" required defaultValue=""><option value="">Choisir</option>{sizeOptions.map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label>
      <label>Santé et précautions<textarea name="sante" required maxLength={2500} placeholder="Allergies, problèmes de santé, ou « Aucun »"/></label>
      <label>Comportement (facultatif)<textarea name="comportement" maxLength={2500} placeholder="Ce qui nous aidera à prendre soin de lui"/></label>
    </fieldset>
    {error && <p className="booking-error" role="alert">{error}</p>}
    <button className="primary-button wide" disabled={busy}>{busy ? "Enregistrement…" : "Créer mon profil et choisir les soins"}</button>
  </form>;
}
