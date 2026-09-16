"use client";
import { useRef, useState } from "react";
import { BookingHero, PhoneArt } from "./booking-hero";

// This is the BOPOIL « Fiche d'informations » from the public website
// (apps/web/fiche-informations.html): same questions, same choices, same
// required fields and the same values, so the profile is identical whether it
// was created from the website or from the booking flow. Both post to
// /api/public/intake.
const speciesChoices = ["Chien", "Chat", "Petit animal"];
// The website writes a non-breaking space before « lbs »; keep the bytes identical.
const sizeChoices = [
  "XXS/TTP (moins de 10\u00a0lbs)", "XS/TP (11 à 20\u00a0lbs)", "S/P (21 à 40\u00a0lbs)", "M/M (41 à 60\u00a0lbs)",
  "L/G (61 à 80\u00a0lbs)", "XL/TG (81 à 100\u00a0lbs)", "XXL/TTG (101 à 120\u00a0lbs)", "Géant (plus de 121\u00a0lbs)",
];

function Required() { return <span className="req" aria-hidden="true">*</span>; }

export function BookingIntake({ salonSlug, locationSlug, onCreated, onSignIn, onBack }: {
  salonSlug: string; locationSlug: string; onCreated: () => Promise<void>; onSignIn: (email: string) => void; onBack: () => void;
}) {
  const [busy, setBusy] = useState(false); const [error, setError] = useState("");
  const submissionId = useRef("");
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
    <button type="button" className="mini-link intake-back" disabled={busy} onClick={onBack}><span aria-hidden="true">‹</span> Retour</button>
    <BookingHero tone="teal" compact eyebrow="Bienvenue chez BOPOIL" art={<PhoneArt/>} title={<h3 data-booking-step-heading tabIndex={-1}>Fiche d’informations</h3>} text="Afin de mieux planifier votre premier rendez-vous, complétez cette fiche. Le tout nous permettra d’adapter les soins offerts selon les besoins de votre animal."/>
    <fieldset disabled={busy}><legend>Le propriétaire</legend>
      <label><span className="field-label">Prénom et nom du propriétaire <Required/></span><input name="proprietaire" type="text" autoComplete="name" required/></label>
      <label><span className="field-label">Numéro de téléphone <Required/></span><input name="telephone" type="tel" inputMode="tel" autoComplete="tel" required/></label>
      <label><span className="field-label">Adresse courriel <Required/></span><input name="email" type="email" inputMode="email" autoComplete="email" required/></label>
    </fieldset>
    <fieldset disabled={busy}><legend>L’animal</legend>
      <label><span className="field-label">Nom de l’animal <Required/></span><input name="nom_animal" type="text" required/></label>
      <label>Date d’anniversaire<input name="anniversaire" type="date"/></label>
      <div className="chip-field" role="radiogroup" aria-labelledby="intake-species-label"><span className="chip-label" id="intake-species-label">Type d’animal</span>
        <div className="chip-group">{speciesChoices.map((choice) => <label className="chip" key={choice}><input type="radio" name="espece" value={choice}/><span>{choice}</span></label>)}</div>
      </div>
      <label>Race<input name="race" type="text"/></label>
      <div className="chip-field" role="radiogroup" aria-labelledby="intake-size-label"><span className="chip-label" id="intake-size-label">Taille (poids)</span>
        <div className="chip-group sizes">{sizeChoices.map((choice) => <label className="chip" key={choice}><input type="radio" name="taille" value={choice}/><span>{choice}</span></label>)}</div>
      </div>
      <label><span className="field-label">Informations sur la santé (troubles dermatologiques, vaccins, allergies, puces ou tiques, etc.) <Required/></span><textarea name="sante" rows={4} required/></label>
      <label>Informations sur les habitudes de vie ou le comportement (actif ou sédentaire, anxiété, agressivité, peurs)?<textarea name="comportement" rows={4}/></label>
      <label>Stérilisé(e)?<select name="sterilise" defaultValue=""><option value="">— Choisir —</option><option value="Oui">Oui</option><option value="Non">Non</option></select></label>
    </fieldset>
    <fieldset disabled={busy}><legend>Vos autorisations</legend>
      <label>Autorisez-vous BOPOIL à offrir des gâteries?<select name="gateries" defaultValue=""><option value="">— Choisir —</option><option value="Oui, vous gagnerez son coeur!">Oui, vous gagnerez son coeur!</option><option value="Non, je ne préfère pas.">Non, je ne préfère pas.</option></select></label>
      <label>Autorisez-vous BOPOIL à photographier votre animal à des fins de marketing?<select name="photos" defaultValue=""><option value="">— Choisir —</option><option value="Oui, j'autorise BOPOIL.">Oui, j’autorise BOPOIL.</option><option value="Non, je n'autorise pas.">Non, je n’autorise pas.</option></select></label>
      <label className="check-row"><input type="checkbox" name="marketing" value="oui"/><span>J’accepte de recevoir du contenu marketing et promotionnel</span></label>
    </fieldset>
    {error && <p className="booking-error" role="alert">{error}</p>}
    <button className="primary-button wide" disabled={busy}>{busy ? "Enregistrement…" : "Soumettre et choisir les soins"}</button>
    <small className="intake-privacy">Vos données ne servent qu’à vous répondre. Consultez notre <a href="/politique.html" target="_blank" rel="noreferrer">politique</a>.</small>
  </form>;
}
