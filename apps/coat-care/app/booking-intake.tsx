"use client";
import { useRef, useState } from "react";
import { BookingHero, PhoneArt } from "./booking-hero";

// The questions below are the BOPOIL « Fiche d'informations » from the public
// website (apps/web/fiche-informations.html), kept identical field for field:
// tests/booking-intake-parity.test.mjs compares the two. Only the shell around
// them (banner, chips, typography) belongs to the booking flow.
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
    <BookingHero tone="teal" compact eyebrow="Bienvenue chez BOPOIL" art={<PhoneArt/>} title={<h3 data-booking-step-heading tabIndex={-1}>Fiche d’informations</h3>} text="Créez votre profil, puis choisissez les soins de votre animal."/>
    <p className="intake-required-note">Les champs marqués d’un <span className="req" aria-hidden="true">*</span> sont obligatoires.</p>
    <fieldset className="intake-questions" disabled={busy}><legend className="sr-only">Fiche d’informations</legend>
            <input className="intake-honeypot" type="text" name="website" tabIndex={-1} autoComplete="off" aria-hidden="true"/>
            <div className="form-field">
              <label className="form-label" htmlFor="fiche-proprietaire">Prénom et nom du propriétaire
                <span className="req" aria-hidden="true">*</span></label>
              <input className="field" id="fiche-proprietaire" name="proprietaire" type="text"
                     autoComplete="name" required/>
            </div>
            <div className="form-field">
              <label className="form-label" htmlFor="fiche-telephone">Numéro de téléphone
                <span className="req" aria-hidden="true">*</span></label>
              <input className="field" id="fiche-telephone" name="telephone" type="tel"
                     autoComplete="tel" required/>
            </div>
            <div className="form-field">
              <label className="form-label" htmlFor="fiche-courriel">Adresse courriel
                <span className="req" aria-hidden="true">*</span></label>
              <input className="field" id="fiche-courriel" name="email" type="email"
                     autoComplete="email" required/>
            </div>
            <div className="form-field">
              <label className="form-label" htmlFor="fiche-animal">Nom de l&#39;animal
                <span className="req" aria-hidden="true">*</span></label>
              <input className="field" id="fiche-animal" name="nom_animal" type="text" required/>
            </div>
            <div className="form-field">
              <label className="form-label" htmlFor="fiche-anniversaire">Date d&#39;anniversaire</label>
              <input className="field" id="fiche-anniversaire" name="anniversaire" type="date"/>
            </div>
          <fieldset className="field-group">
            <legend className="field-group__legend">Type d&#39;animal</legend>
            <label className="intake-choice"><input type="radio" name="espece" value="Chien"/><span>Chien</span></label><label className="intake-choice"><input type="radio" name="espece" value="Chat"/><span>Chat</span></label><label className="intake-choice"><input type="radio" name="espece" value="Petit animal"/><span>Petit animal</span></label>
          </fieldset>
            <div className="form-field">
              <label className="form-label" htmlFor="fiche-race">Race</label>
              <input className="field" id="fiche-race" name="race" type="text"/>
            </div>
          <fieldset className="field-group">
            <legend className="field-group__legend">Taille (poids)</legend>
            <label className="intake-choice"><input type="radio" name="taille" value="XXS/TTP (moins de 10 lbs)"/><span>XXS/TTP (moins de 10 lbs)</span></label><label className="intake-choice"><input type="radio" name="taille" value="XS/TP (11 à 20 lbs)"/><span>XS/TP (11 à 20 lbs)</span></label><label className="intake-choice"><input type="radio" name="taille" value="S/P (21 à 40 lbs)"/><span>S/P (21 à 40 lbs)</span></label><label className="intake-choice"><input type="radio" name="taille" value="M/M (41 à 60 lbs)"/><span>M/M (41 à 60 lbs)</span></label><label className="intake-choice"><input type="radio" name="taille" value="L/G (61 à 80 lbs)"/><span>L/G (61 à 80 lbs)</span></label><label className="intake-choice"><input type="radio" name="taille" value="XL/TG (81 à 100 lbs)"/><span>XL/TG (81 à 100 lbs)</span></label><label className="intake-choice"><input type="radio" name="taille" value="XXL/TTG (101 à 120 lbs)"/><span>XXL/TTG (101 à 120 lbs)</span></label><label className="intake-choice"><input type="radio" name="taille" value="Géant (plus de 121 lbs)"/><span>Géant (plus de 121 lbs)</span></label>
          </fieldset>
            <div className="form-field">
              <label className="form-label" htmlFor="fiche-sante">Informations sur la santé (troubles
                dermatologiques, vaccins, allergies, puces ou tiques, etc.)
                <span className="req" aria-hidden="true">*</span></label>
              <textarea className="field" id="fiche-sante" name="sante" rows={4}
                        required></textarea>
            </div>
            <div className="form-field">
              <label className="form-label" htmlFor="fiche-comportement">Informations sur les habitudes
                de vie ou le comportement (actif ou sédentaire, anxiété, agressivité,
                peurs)?</label>
              <textarea className="field" id="fiche-comportement" name="comportement"
                        rows={4}></textarea>
            </div>
          <div className="form-field">
            <label className="form-label" htmlFor="fiche-sterilise">Stérilisé(e)?</label>
            <select className="field" id="fiche-sterilise" name="sterilise">
              <option value="">— Choisir —</option><option value="Oui">Oui</option><option value="Non">Non</option>
            </select>
          </div>
          <div className="form-field">
            <label className="form-label" htmlFor="fiche-gateries">Autorisez-vous BOPOIL à offrir des gâteries?</label>
            <select className="field" id="fiche-gateries" name="gateries">
              <option value="">— Choisir —</option><option value="Oui, vous gagnerez son coeur!">Oui, vous gagnerez son coeur!</option><option value="Non, je ne préfère pas.">Non, je ne préfère pas.</option>
            </select>
          </div>
          <div className="form-field">
            <label className="form-label" htmlFor="fiche-photos">Autorisez-vous BOPOIL à photographier votre animal à des fins de marketing?</label>
            <select className="field" id="fiche-photos" name="photos">
              <option value="">— Choisir —</option><option value="Oui, j&#39;autorise BOPOIL.">Oui, j&#39;autorise BOPOIL.</option><option value="Non, je n&#39;autorise pas.">Non, je n&#39;autorise pas.</option>
            </select>
          </div>
            <label className="intake-choice">
              <input type="checkbox" name="marketing" value="oui"/>
              <span>J&#39;accepte de recevoir du contenu marketing et promotionnel</span>
            </label>
            <p className="form-note">Vos données ne servent qu&#39;à vous répondre. Consultez notre <a href="/politique.html">politique</a>.</p>
    </fieldset>
    {error && <p className="booking-error" role="alert">{error}</p>}
    <button className="primary-button wide" disabled={busy}>{busy ? "Enregistrement…" : "Créer mon profil et choisir les soins"}</button>
  </form>;
}
