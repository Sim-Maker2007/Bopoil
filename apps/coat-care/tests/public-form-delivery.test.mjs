import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const source = (path) => readFile(new URL(path, import.meta.url), "utf8");
const { intakeFicheEmail, salonInboxAddress, salonInboxRequest, sendToSalonInbox } = await import("../lib/public-form-email.ts");

const emailConfig = { configured: true, webhookConfigured: false, provider: "resend", apiKey: "re_test", from: "BOPOIL <info@bopoil.ca>", replyTo: "" };
const fiche = {
  ownerName: "Julie Tremblay", phone: "819 555-0142", email: "julie@example.com", petName: "Moka",
  species: "Chien", breed: "", birthday: "2021-04-02", size: "S/P (21 à 40 lbs)", sterilized: "Oui",
  health: "Allergie au poulet", behavior: "", treats: "Oui, vous gagnerez son coeur!", photos: "", marketing: false,
};

function withConsoleErrors(run) {
  const logged = [];
  const original = console.error;
  console.error = (...args) => { logged.push(args.map(String).join(" ")); };
  return Promise.resolve(run(logged)).finally(() => { console.error = original; });
}

test("website forms go to the salon contact inbox, then the owner's address", () => {
  assert.equal(salonInboxAddress({ contactEmail: "info@bopoil.ca" }, { SALON_OWNER_EMAIL: "owner@example.com" }), "info@bopoil.ca");
  assert.equal(salonInboxAddress({ contactEmail: " " }, { SALON_OWNER_EMAIL: " owner@example.com " }), "owner@example.com");
  assert.equal(salonInboxAddress({ contactEmail: "" }, {}), "");
});

test("the salon receives each fiche in French, labelled by what the website did with it", () => {
  const created = intakeFicheEmail(fiche, "created");
  assert.equal(created.subject, "Nouvelle fiche d'informations — Moka (Julie Tremblay)");
  assert.match(created.text, /^Un nouveau client a rempli la fiche d'informations/);
  assert.match(created.text, /Propriétaire : Julie Tremblay\nTéléphone : 819 555-0142\nCourriel : julie@example\.com/);
  assert.match(created.text, /Santé :\nAllergie au poulet/);
  assert.match(created.text, /Contenu marketing et promotionnel : Non/);
  // Unanswered questions are left out rather than shown empty.
  assert.doesNotMatch(created.text, /Race :|Habitudes de vie|Photos à des fins/);
  assert.doesNotMatch(created.text, /Attention/);

  const review = intakeFicheEmail(fiche, "review");
  assert.equal(review.subject, "Fiche d'informations à réviser — Moka (Julie Tremblay)");
  assert.match(review.text, /le site n'a rien modifié/);

  const updated = intakeFicheEmail(fiche, "updated", { contactMismatch: true });
  assert.equal(updated.subject, "Fiche d'informations mise à jour — Moka (Julie Tremblay)");
  assert.match(updated.text, /Attention : le nom, le courriel ou le téléphone soumis diffère du dossier/);
});

test("the salon email replies to the visitor, keeps its subject on one line and escapes the HTML copy", () => {
  const request = salonInboxRequest({
    to: "info@bopoil.ca", replyTo: "julie@example.com", subject: "Message du site\r\nBcc: x@example.com",
    text: "<b>Bonjour</b>", idempotencyKey: "bopoil:contact:abc",
  }, emailConfig);
  assert.equal(request.url, "https://api.resend.com/emails");
  assert.equal(request.init.headers.authorization, "Bearer re_test");
  assert.equal(request.init.headers["idempotency-key"], "bopoil:contact:abc");
  const body = JSON.parse(request.init.body);
  assert.deepEqual(body.to, ["info@bopoil.ca"]);
  assert.equal(body.from, "BOPOIL <info@bopoil.ca>");
  assert.equal(body.reply_to, "julie@example.com");
  assert.equal(body.subject, "Message du site Bcc: x@example.com");
  assert.equal(body.text, "<b>Bonjour</b>");
  assert.match(body.html, /&lt;b&gt;Bonjour&lt;\/b&gt;/);
});

test("a Resend refusal is reported and logged with Resend's reason, never the form content", async () => {
  const email = { to: "info@bopoil.ca", replyTo: "julie@example.com", subject: "Sujet", text: "Contenu privé du formulaire", idempotencyKey: "k" };
  await withConsoleErrors(async (logged) => {
    const calls = [];
    const accepted = await sendToSalonInbox(email, emailConfig, async (url, init) => { calls.push([url, init]); return new Response("{}", { status: 200 }); });
    assert.equal(accepted, true);
    assert.equal(calls.length, 1);
    assert.equal(logged.length, 0);

    const refused = await sendToSalonInbox(email, emailConfig, async () => new Response('{"message":"The bopoil.ca domain is not verified."}', { status: 403 }));
    assert.equal(refused, false);
    assert.equal(logged.length, 1);
    assert.match(logged[0], /HTTP 403/);
    assert.match(logged[0], /domain is not verified/);
    assert.doesNotMatch(logged[0], /Contenu privé/);

    const unreachable = await sendToSalonInbox(email, emailConfig, async () => { throw new TypeError("fetch failed"); });
    assert.equal(unreachable, false);
    assert.equal(logged.length, 2);
  });
  let fetched = false;
  const fetcher = async () => { fetched = true; return new Response("{}"); };
  assert.equal(await sendToSalonInbox(email, { ...emailConfig, configured: false }, fetcher), false);
  assert.equal(await sendToSalonInbox({ ...email, to: "" }, emailConfig, fetcher), false);
  assert.equal(fetched, false);
});

test("every accepted website fiche reaches the salon inbox, and returning clients are forwarded instead of refused", async () => {
  const [intake, website] = await Promise.all([
    source("../app/api/public/intake/route.ts"),
    source("../../web/js/main.js"),
  ]);
  // The public site identifies itself; the booking app keeps its secure sign-in.
  assert.match(website, /values\.source = 'website';/);
  assert.match(intake, /const fromWebsite = clean\(payload\.source, 20\) === "website";/);
  assert.match(intake, /if \(uniqueMatches\.length > 1\) \{\s*if \(fromWebsite\) return forwardForReview\(null\);/);
  assert.match(intake, /if \(access\.client\?\.id !== existingClient\.id\) \{\s*if \(fromWebsite\) return forwardForReview\(existingClient\.id\);\s*return response\(origin, \{\s*intent: "secure_access_required"/);

  // Forwarding only emails the salon and records the ledger row: the stored
  // profile, pets and consents stay untouched.
  const forward = intake.slice(intake.indexOf("const forwardForReview"), intake.indexOf("if (uniqueMatches.length > 1)"));
  assert.match(forward, /if \(!await emailSalon\("review"\)\) return response\(origin, \{ error: [^}]+\}, 502\);/);
  assert.match(forward, /status: "review"/);
  assert.doesNotMatch(forward, /db\.update\(|insert\((clients|pets|petCareProfiles|consentRecords)\)/);

  // A saved fiche is announced once it is committed, and a delivery failure does not undo it.
  const commit = intake.indexOf("await db.batch(statements as [DbBatchItem, ...DbBatchItem[]]);");
  const notice = intake.indexOf('await emailSalon(existingClient ? "updated" : "created", { contactMismatch: needsReview });');
  assert.ok(commit > 0 && notice > commit, "the salon is emailed after the fiche is saved");
  assert.match(intake, /idempotencyKey: `bopoil:intake:\$\{submissionKey\}`/);

  // No redirect to the pause notice while online booking is closed.
  assert.match(intake, /\.\.\.\(onlineBookingEnabled\(\) \? \{ bookingUrl \} : \{\}\)/);
});

test("the contact form uses the shared salon inbox delivery", async () => {
  const contact = await source("../app/api/public/contact/route.ts");
  assert.match(contact, /const to = salonInboxAddress\(organization\);/);
  assert.match(contact, /const sent = await sendToSalonInbox\(\{[\s\S]*idempotencyKey: `bopoil:\$\{submissionKey\}`,[\s\S]*\}, delivery\.email\);/);
  assert.match(contact, /if \(!sent\) return publicFormResponse\(origin, \{ error: [^}]+\}, 502\);/);
  assert.doesNotMatch(contact, /api\.resend\.com/);
});
