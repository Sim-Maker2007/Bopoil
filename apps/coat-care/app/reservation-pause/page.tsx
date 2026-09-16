import type { Metadata } from "next";
import { BookingHero, DogArt } from "../booking-hero";

export const metadata: Metadata = {
  title: "Réservation en ligne — bientôt de retour",
  description: "La réservation en ligne BOPOIL fait une courte pause. Joignez-nous par téléphone, texto ou courriel.",
  robots: { index: false, follow: false },
};

// Shown in place of every /book page while ONLINE_BOOKING_ENABLED is not true
// (see lib/booking-gate.ts and proxy.ts).
export default function ReservationPause() {
  return <main className="app-shell guided-booking booking-pause" lang="fr">
    <section className="booking-pause-card">
      <BookingHero tone="plum" eyebrow="BOPOIL Toilettage & Boutique" art={<DogArt/>} title={<h1>La réservation en ligne fait une <em>petite pause</em></h1>} text="Nous peaufinons votre nouvelle expérience de réservation. Elle sera de retour très bientôt. En attendant, nous prenons vos rendez-vous avec plaisir :"/>
      <div className="booking-pause-actions">
        <a className="primary-button" href="tel:+18199682827">Appeler le (819) 968-2827</a>
        <a className="secondary-button" href="sms:+18199682827">Envoyer un texto</a>
        <a className="secondary-button" href="mailto:info@bopoil.ca">info@bopoil.ca</a>
      </div>
      <p className="booking-pause-hours">Du mardi au vendredi, de 9 h à 16 h.</p>
      {/* The public BOPOIL site is static HTML served through a rewrite, not a Next.js page, so a plain link is right here. */}
      {/* eslint-disable-next-line @next/next/no-html-link-for-pages */}
      <a className="booking-pause-home" href="/">‹ Retour au site BOPOIL</a>
    </section>
  </main>;
}
