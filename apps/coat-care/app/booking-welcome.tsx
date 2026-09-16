"use client";
import { KeyboardEvent, ReactNode, useCallback, useEffect, useRef, useState } from "react";

// The welcome tour is shown once per browser. Visitors who already have a
// profile on this device, or who arrive through a deep link, never see it.
const WELCOME_STORAGE_KEY = "bopoil-booking-welcome-v1";

export function welcomeAlreadySeen() {
  try { return window.localStorage.getItem(WELCOME_STORAGE_KEY) === "1"; }
  catch { return false; }
}

export function rememberWelcomeSeen() {
  try { window.localStorage.setItem(WELCOME_STORAGE_KEY, "1"); }
  catch { /* Private browsing or blocked storage: the tour simply shows again next time. */ }
}

type Slide = { tone: "plum" | "teal" | "peach"; eyebrow: string; title: ReactNode; text: string; art: ReactNode };

function DogArt() {
  return <svg viewBox="0 0 240 240" role="img" aria-hidden="true" focusable="false">
    <ellipse cx="120" cy="216" rx="72" ry="10" fill="rgba(20,10,20,.22)"/>
    <path d="M58 214 C58 158 182 158 182 214 Z" fill="#f7f0e6"/>
    <path d="M62 90 C36 108 40 164 70 170 C86 172 92 152 86 130 C82 112 78 94 62 90Z" fill="#c78a5c"/>
    <path d="M178 90 C204 108 200 164 170 170 C154 172 148 152 154 130 C158 112 162 94 178 90Z" fill="#c78a5c"/>
    <circle cx="120" cy="120" r="64" fill="#f7f0e6"/>
    <path d="M120 58 C144 58 160 84 156 108 C144 100 128 96 120 96 C112 96 96 100 84 108 C80 84 96 58 120 58Z" fill="#c78a5c"/>
    <circle cx="99" cy="120" r="7" fill="#2b211c"/><circle cx="141" cy="120" r="7" fill="#2b211c"/>
    <circle cx="101.5" cy="117.5" r="2.4" fill="#fff"/><circle cx="143.5" cy="117.5" r="2.4" fill="#fff"/>
    <ellipse cx="120" cy="148" rx="27" ry="20" fill="#fff"/>
    <path d="M109 141 C109 132 131 132 131 141 C131 148 120 152 120 152 C120 152 109 148 109 141Z" fill="#2b211c"/>
    <path d="M111 158 Q120 166 129 158" stroke="#2b211c" strokeWidth="3" fill="none" strokeLinecap="round"/>
    <path d="M115 161 C115 174 125 174 125 161Z" fill="#e8756f"/>
    <path d="M72 180 C90 194 150 194 168 180 L166 194 C150 208 90 208 74 194Z" fill="var(--welcome-accent)"/>
    <circle cx="120" cy="200" r="9" fill="#f7d774"/><circle cx="120" cy="200" r="3.5" fill="#d9a83a"/>
    <g fill="rgba(255,255,255,.35)" stroke="rgba(255,255,255,.85)" strokeWidth="2.5">
      <circle cx="46" cy="58" r="15"/><circle cx="194" cy="46" r="11"/><circle cx="206" cy="124" r="7"/><circle cx="32" cy="146" r="8"/>
    </g>
    <g fill="#fff"><circle cx="41" cy="52" r="3.5"/><circle cx="190" cy="42" r="2.6"/></g>
  </svg>;
}

function PhoneArt() {
  const columns = [86, 102, 118, 134, 150]; const rows = [82, 98, 114, 130];
  return <svg viewBox="0 0 240 240" role="img" aria-hidden="true" focusable="false">
    <ellipse cx="120" cy="222" rx="66" ry="9" fill="rgba(20,10,20,.22)"/>
    <rect x="66" y="22" width="108" height="196" rx="24" fill="#1f1b1a"/>
    <rect x="73" y="30" width="94" height="180" rx="17" fill="#fff"/>
    <rect x="102" y="35" width="36" height="6" rx="3" fill="#1f1b1a"/>
    <rect x="84" y="50" width="54" height="8" rx="4" fill="#2b211c"/>
    <rect x="84" y="64" width="34" height="6" rx="3" fill="#cfc7bd"/>
    {rows.map((y) => columns.map((x) => <rect key={`${x}-${y}`} x={x} y={y} width="12" height="12" rx="4" fill={x === 134 && y === 98 ? "var(--welcome-accent)" : "#efe9e1"}/>))}
    <circle cx="120" cy="172" r="21" fill="var(--welcome-accent)"/>
    <ellipse cx="120" cy="177" rx="8" ry="6.5" fill="#fff"/>
    <g fill="#fff"><circle cx="109" cy="169" r="3.4"/><circle cx="115.5" cy="163" r="3.4"/><circle cx="124.5" cy="163" r="3.4"/><circle cx="131" cy="169" r="3.4"/></g>
    <rect x="86" y="198" width="68" height="9" rx="4.5" fill="#2b211c"/>
    <circle cx="192" cy="64" r="26" fill="#fff"/>
    <circle cx="192" cy="64" r="19" fill="none" stroke="#2b211c" strokeWidth="3"/>
    <path d="M192 52 V64 L200 70" stroke="#2b211c" strokeWidth="3" fill="none" strokeLinecap="round" strokeLinejoin="round"/>
    <path d="M44 150 C44 141 56 138 60 146 C64 138 76 141 76 150 C76 160 60 170 60 170 C60 170 44 160 44 150Z" fill="#fff"/>
    <g fill="rgba(255,255,255,.35)" stroke="rgba(255,255,255,.85)" strokeWidth="2.5"><circle cx="40" cy="70" r="9"/><circle cx="204" cy="150" r="7"/></g>
  </svg>;
}

function CalendarArt() {
  const columns = [66, 93, 120, 147, 174]; const rows = [118, 144, 170];
  return <svg viewBox="0 0 240 240" role="img" aria-hidden="true" focusable="false">
    <ellipse cx="120" cy="218" rx="78" ry="10" fill="rgba(20,10,20,.22)"/>
    <rect x="44" y="52" width="152" height="150" rx="22" fill="#fff"/>
    <path d="M44 74 C44 62 54 52 66 52 H174 C186 52 196 62 196 74 V98 H44Z" fill="var(--welcome-accent)"/>
    <rect x="74" y="36" width="12" height="32" rx="6" fill="#2b211c"/><rect x="154" y="36" width="12" height="32" rx="6" fill="#2b211c"/>
    {rows.map((y) => columns.map((x) => <circle key={`${x}-${y}`} cx={x} cy={y} r="7" fill={x === 93 && y === 118 ? "#2b211c" : "#efe9e1"}/>))}
    <circle cx="152" cy="162" r="32" fill="#3b8e54"/>
    <path d="M137 162 L147 172 L168 149" stroke="#fff" strokeWidth="7" fill="none" strokeLinecap="round" strokeLinejoin="round"/>
    <path d="M196 22 C196 14 206 12 210 19 C214 12 224 14 224 22 C224 31 210 40 210 40 C210 40 196 31 196 22Z" fill="#fff"/>
    <g fill="#fff"><path d="M28 62 l4 10 10 4 -10 4 -4 10 -4 -10 -10 -4 10 -4Z"/><path d="M214 118 l3 7 7 3 -7 3 -3 7 -3 -7 -7 -3 7 -3Z"/></g>
  </svg>;
}

export function BookingWelcome({ salonName, onStart, onSignIn }: { salonName: string; onStart: () => void; onSignIn: () => void }) {
  const welcomeEyebrow = salonName.length <= 18 ? `Bienvenue chez ${salonName}` : "Bienvenue";
  const slides: Slide[] = [
    { tone: "plum", eyebrow: welcomeEyebrow, title: <>Un soin pensé pour <em>votre</em> animal</>, text: "Chiens, chats et petits animaux : chaque toilettage s’adapte à son pelage, à son poids et à son tempérament.", art: <DogArt/> },
    { tone: "teal", eyebrow: "Simple, depuis votre téléphone", title: <>Réservez en <em>deux minutes</em></>, text: "Créez votre profil une seule fois. Ensuite, retrouvez vos animaux et leurs soins en un geste.", art: <PhoneArt/> },
    { tone: "peach", eyebrow: "Entre bonnes mains", title: <>Le moment qui <em>vous</em> convient</>, text: "Choisissez la date et l’heure. Nous confirmons votre rendez-vous et prenons soin du reste.", art: <CalendarArt/> },
  ];
  const last = slides.length - 1;
  const [index, setIndex] = useState(0);
  const track = useRef<HTMLDivElement>(null);

  const go = useCallback((next: number) => {
    const target = Math.max(0, Math.min(last, next));
    const node = track.current;
    if (node) {
      const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      node.scrollTo({ left: target * node.clientWidth, behavior: reduceMotion ? "auto" : "smooth" });
    }
    setIndex(target);
  }, [last]);

  useEffect(() => {
    // Keep the active screen aligned when the phone rotates or the window resizes.
    const realign = () => { const node = track.current; if (node) node.scrollTo({ left: index * node.clientWidth, behavior: "auto" }); };
    window.addEventListener("resize", realign);
    return () => window.removeEventListener("resize", realign);
  }, [index]);

  function handleScroll() {
    const node = track.current; if (!node || !node.clientWidth) return;
    const next = Math.max(0, Math.min(last, Math.round(node.scrollLeft / node.clientWidth)));
    setIndex((current) => (current === next ? current : next));
  }
  function handleKeyDown(event: KeyboardEvent<HTMLElement>) {
    if (event.key === "ArrowRight") { event.preventDefault(); go(index + 1); }
    if (event.key === "ArrowLeft") { event.preventDefault(); go(index - 1); }
  }
  function finish() { rememberWelcomeSeen(); onStart(); }
  function signIn() { rememberWelcomeSeen(); onSignIn(); }

  return <section className="booking-welcome" aria-roledescription="carrousel" aria-label={`Bienvenue chez ${salonName}`} onKeyDown={handleKeyDown}>
    {slides.map((slide, position) => <span key={slide.tone} className={`welcome-backdrop tone-${slide.tone}${position === index ? " active" : ""}`} aria-hidden="true"/>)}
    <div className="welcome-topbar">
      <button type="button" className="welcome-back" onClick={() => go(index - 1)} disabled={index === 0} aria-label="Écran précédent"><span aria-hidden="true">‹</span></button>
      <button type="button" className="welcome-skip" onClick={finish}>Passer</button>
    </div>
    <div className="welcome-track" ref={track} onScroll={handleScroll}>
      {slides.map((slide, position) => <article key={slide.tone} className={`welcome-slide tone-${slide.tone}`} role="group" aria-roledescription="écran" aria-label={`${position + 1} sur ${slides.length}`} aria-hidden={position !== index}>
        <div className="welcome-art" aria-hidden="true"><span className="welcome-shape a"/><span className="welcome-shape b"/><span className="welcome-shape c"/>{slide.art}</div>
        <div className="welcome-copy"><span className="welcome-eyebrow">{slide.eyebrow}</span><h3>{slide.title}</h3><p>{slide.text}</p></div>
      </article>)}
    </div>
    <div className="welcome-footer">
      <div className="welcome-dots" aria-hidden="true">{slides.map((slide, position) => <span key={slide.tone} className={position === index ? "active" : ""}/>)}</div>
      <p className="visually-hidden" aria-live="polite">Écran {index + 1} sur {slides.length}</p>
      <button type="button" className="welcome-next" onClick={() => index === last ? finish() : go(index + 1)}>{index === last ? "Commencer" : "Suivant"}<span aria-hidden="true">›</span></button>
    </div>
    <button type="button" className="welcome-signin" onClick={signIn}>Déjà client ? Retrouver mon profil</button>
  </section>;
}
