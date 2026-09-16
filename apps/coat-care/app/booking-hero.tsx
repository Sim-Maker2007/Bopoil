"use client";
import { ReactNode } from "react";

// Illustrated gradient banners for the booking flow. They only dress the
// existing screens: no extra step is added between the client and the booking.

export function DogArt() {
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
    <path d="M72 180 C90 194 150 194 168 180 L166 194 C150 208 90 208 74 194Z" fill="var(--hero-accent)"/>
    <circle cx="120" cy="200" r="9" fill="#f7d774"/><circle cx="120" cy="200" r="3.5" fill="#d9a83a"/>
    <g fill="rgba(255,255,255,.35)" stroke="rgba(255,255,255,.85)" strokeWidth="2.5">
      <circle cx="46" cy="58" r="15"/><circle cx="194" cy="46" r="11"/><circle cx="206" cy="124" r="7"/><circle cx="32" cy="146" r="8"/>
    </g>
    <g fill="#fff"><circle cx="41" cy="52" r="3.5"/><circle cx="190" cy="42" r="2.6"/></g>
  </svg>;
}

export function PhoneArt() {
  const columns = [86, 102, 118, 134, 150]; const rows = [82, 98, 114, 130];
  return <svg viewBox="0 0 240 240" role="img" aria-hidden="true" focusable="false">
    <ellipse cx="120" cy="222" rx="66" ry="9" fill="rgba(20,10,20,.22)"/>
    <rect x="66" y="22" width="108" height="196" rx="24" fill="#1f1b1a"/>
    <rect x="73" y="30" width="94" height="180" rx="17" fill="#fff"/>
    <rect x="102" y="35" width="36" height="6" rx="3" fill="#1f1b1a"/>
    <rect x="84" y="50" width="54" height="8" rx="4" fill="#2b211c"/>
    <rect x="84" y="64" width="34" height="6" rx="3" fill="#cfc7bd"/>
    {rows.map((y) => columns.map((x) => <rect key={`${x}-${y}`} x={x} y={y} width="12" height="12" rx="4" fill={x === 134 && y === 98 ? "var(--hero-accent)" : "#efe9e1"}/>))}
    <circle cx="120" cy="172" r="21" fill="var(--hero-accent)"/>
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

export function BookingHero({ tone, eyebrow, title, text, art, compact = false, children }: {
  tone: "plum" | "teal" | "peach"; eyebrow: string; title: ReactNode; text?: string; art: ReactNode; compact?: boolean; children?: ReactNode;
}) {
  return <div className={`booking-hero tone-${tone}${compact ? " compact" : ""}`}>
    <div className="hero-art" aria-hidden="true"><span className="hero-shape a"/><span className="hero-shape b"/><span className="hero-shape c"/>{art}</div>
    <div className="hero-copy"><span className="hero-eyebrow">{eyebrow}</span>{title}{text && <p>{text}</p>}{children}</div>
  </div>;
}
