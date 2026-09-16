"use client";
import { useState } from "react";
import { careLabel, coatOptions, matchingCare, sizeOptions, savedSizeChoice, suggestedCoat } from "../lib/care-options";

type Service = { id: string; name: string; durationMinutes: number; priceFromCents: number };
export function CareChoices({ pet, services, currency, contactPhone, onChoose, onBack }: {
  pet: { name: string; breed: string; species?: string; sizeLabel?: string | null };
  services: Service[]; currency: string; contactPhone: string; onChoose: (id: string) => void; onBack: () => void;
}) {
  const [coat, setCoat] = useState(suggestedCoat(pet.breed));
  const [size, setSize] = useState(savedSizeChoice(pet.sizeLabel));
  const [confirmed, setConfirmed] = useState(false);
  const dog = !pet.species || pet.species === "dog";
  const choices = matchingCare(services, pet, coat, size);
  const ready = !dog || confirmed;
  return <div className="guided-care">
    <button className="mini-link" onClick={onBack}>← Changer d’animal</button>
    <h3 data-booking-step-heading tabIndex={-1}>Les soins de {pet.name}</h3>
    <p>{pet.breed}</p>
    {dog && <form className="guided-fields" onSubmit={(e) => { e.preventDefault(); setConfirmed(true); }}>
      <p>Confirmez son pelage et son poids pour voir les soins adaptés.{suggestedCoat(pet.breed) ? " Le pelage proposé d’après sa race reste à confirmer." : " Pour une race croisée, choisissez son pelage actuel."}</p>
      <label>Son pelage<select required value={coat} onChange={(e) => { setCoat(e.target.value); setConfirmed(false); }}><option value="">Choisir le pelage</option>{coatOptions.map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label>
      <label>Son poids<select required value={size} onChange={(e) => { setSize(e.target.value); setConfirmed(false); }}><option value="">Choisir le poids</option>{sizeOptions.map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label>
      {!confirmed && <button className="primary-button wide">Voir les soins adaptés</button>}
    </form>}
    {ready && <div className="option-list" aria-live="polite">{choices.map((item) => <button key={item.id} onClick={() => onChoose(item.id)}><span><strong>{careLabel(item.name)}</strong><small>{item.durationMinutes} min</small></span><span><b>{new Intl.NumberFormat("fr-CA", { style: "currency", currency }).format(item.priceFromCents / 100)}</b><em aria-hidden="true">→</em></span></button>)}
      {(!choices.length || coat === "F" || size === "OTHER") && <div className="booking-paused"><strong>Un conseil personnalisé</strong><p>Appelez-nous pour choisir le bon soin et sa durée. Vous pouvez aussi réserver les petits soins affichés ici.</p><a className="primary-button" href={`tel:${contactPhone.replace(/[^+\d]/g, "")}`}>Appeler le salon</a></div>}
    </div>}
  </div>;
}
