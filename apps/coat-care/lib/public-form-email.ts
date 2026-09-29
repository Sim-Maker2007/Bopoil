import { emailHtml, type DeliveryConfig } from "./message-provider-payloads.ts";

type Env = Record<string, string | undefined>;
type EmailConfig = DeliveryConfig["email"];

export type SalonInboxEmail = {
  to: string;
  replyTo: string;
  subject: string;
  text: string;
  idempotencyKey: string;
};

// The website forms land in the salon's contact inbox, or in the owner's
// sign-in address while no contact address is set.
export function salonInboxAddress(organization: { contactEmail: string }, env: Env = process.env) {
  return organization.contactEmail.trim() || env.SALON_OWNER_EMAIL?.trim() || "";
}

// One Resend request per form, with the visitor as reply-to so the salon can
// answer straight from its inbox.
export function salonInboxRequest(email: SalonInboxEmail, config: EmailConfig) {
  const payload: Record<string, unknown> = {
    from: config.from,
    to: [email.to],
    subject: email.subject.replace(/\s+/g, " ").trim().slice(0, 200),
    text: email.text,
    html: emailHtml(email.text),
  };
  if (email.replyTo) payload.reply_to = email.replyTo;
  return {
    url: "https://api.resend.com/emails",
    init: {
      method: "POST",
      headers: { authorization: `Bearer ${config.apiKey}`, "content-type": "application/json", "idempotency-key": email.idempotencyKey },
      body: JSON.stringify(payload),
    },
  };
}

// Reports whether Resend accepted the email. A refusal is logged with Resend's
// reason, never the form content, so a sender problem shows in the Vercel logs
// instead of vanishing. The visitor waits on this call, so it is time-boxed.
export async function sendToSalonInbox(email: SalonInboxEmail, config: EmailConfig, fetcher: typeof fetch = fetch) {
  if (!config.configured || !email.to) return false;
  const { url, init } = salonInboxRequest(email, config);
  try {
    const response = await fetcher(url, { ...init, signal: AbortSignal.timeout(10_000) });
    if (response.ok) return true;
    const reason = await response.text().catch(() => "");
    console.error(`Resend refused a website form email (HTTP ${response.status}): ${reason.slice(0, 300)}`);
  } catch (error) {
    console.error("Resend could not be reached for a website form email.", error);
  }
  return false;
}

export type IntakeFiche = {
  ownerName: string;
  phone: string;
  email: string;
  petName: string;
  species: string;
  breed: string;
  birthday: string;
  size: string;
  sterilized: string;
  health: string;
  behavior: string;
  treats: string;
  photos: string;
  marketing: boolean;
};

// created: a new client and pet were saved in the CRM. updated: a signed-in
// client changed their pet's fiche. review: the contact details match a
// profile the visitor could not prove is theirs, so nothing was changed.
export type IntakeFicheOutcome = "created" | "updated" | "review";

const FICHE_HEADINGS: Record<IntakeFicheOutcome, { subject: string; intro: string }> = {
  created: {
    subject: "Nouvelle fiche d'informations",
    intro: "Un nouveau client a rempli la fiche d'informations sur bopoil.ca. Son dossier et celui de son animal ont été créés dans le CRM.",
  },
  updated: {
    subject: "Fiche d'informations mise à jour",
    intro: "Un client a mis à jour la fiche de son animal depuis son profil sécurisé. Le CRM a été mis à jour.",
  },
  review: {
    subject: "Fiche d'informations à réviser",
    intro: "Ces coordonnées correspondent à un dossier client existant. Par sécurité, le site n'a rien modifié : vérifiez les réponses ci-dessous et mettez le dossier à jour dans le CRM au besoin.",
  },
};

// The fiche as the salon reads it, with the website form's own labels.
export function intakeFicheEmail(fiche: IntakeFiche, outcome: IntakeFicheOutcome, options: { contactMismatch?: boolean } = {}) {
  const lines = (...entries: Array<[string, string]>) => entries
    .filter(([, value]) => value)
    .map(([label, value]) => `${label} : ${value}`)
    .join("\n");
  const block = (label: string, value: string) => (value ? `${label} :\n${value}` : "");
  const heading = FICHE_HEADINGS[outcome];
  const text = [
    heading.intro,
    options.contactMismatch ? "Attention : le nom, le courriel ou le téléphone soumis diffère du dossier. Ces coordonnées n'ont pas été appliquées." : "",
    lines(["Propriétaire", fiche.ownerName], ["Téléphone", fiche.phone], ["Courriel", fiche.email]),
    lines(
      ["Animal", fiche.petName],
      ["Type d'animal", fiche.species],
      ["Race", fiche.breed],
      ["Date d'anniversaire", fiche.birthday],
      ["Taille (poids)", fiche.size],
      ["Stérilisé(e)", fiche.sterilized],
    ),
    block("Santé", fiche.health),
    block("Habitudes de vie et comportement", fiche.behavior),
    lines(
      ["Gâteries", fiche.treats],
      ["Photos à des fins de marketing", fiche.photos],
      ["Contenu marketing et promotionnel", fiche.marketing ? "Oui" : "Non"],
    ),
    "— Fiche d'informations, bopoil.ca",
  ].filter(Boolean).join("\n\n");
  return { subject: `${heading.subject} — ${fiche.petName} (${fiche.ownerName})`, text };
}
