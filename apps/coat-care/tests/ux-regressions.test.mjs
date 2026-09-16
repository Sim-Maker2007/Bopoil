import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const source = (path) => readFile(new URL(path, import.meta.url), "utf8");

test("public booking never submits stale availability or overpromises delivery", async () => {
  const booking = await source("../app/booking-experience.tsx");

  assert.match(booking, /const requestId = \+\+availabilityRequest\.current/);
  assert.match(booking, /setAvailability\(null\);\s*setSelectedStartsAt\(""\);[\s\S]{0,100}setAvailabilityLoading\(true\)/);
  assert.match(booking, /if \(requestId !== availabilityRequest\.current\) return/);
  assert.match(booking, /selectedDateRef\.current = date/);
  assert.match(booking, /allowOnlineBooking !== false/);
  assert.match(booking, /disabled=\{bookingBusy \|\| availabilityLoading \|\| !selectedSlot\}/);
  assert.match(booking, /function chooseService\(id: string\) \{ if \(!bookingContext\)/);
  assert.match(booking, /requireOnlineDeposit && service && service\.depositCents > 0/);
  assert.match(booking, /Aucun acompte en ligne pour ce soin/);
  assert.match(booking, /delivery\?: \{ email\?: \{ configured\?: boolean \}; sms\?: \{ configured\?: boolean \} \}/);
  assert.match(booking, /Automatic email delivery is not available yet/);
  assert.doesNotMatch(booking, /Salon OS/);
  assert.doesNotMatch(booking, /window\.location\.assign\("\/salon"\)/);
});

test("returning clients can rebook from a minimal private context without retyping contact details", async () => {
  const [booking, context, portal, styles, demo] = await Promise.all([
    source("../app/booking-experience.tsx"),
    source("../app/api/booking-context/route.ts"),
    source("../app/portal/[token]/portal-experience.tsx"),
    source("../app/globals.css"),
    source("../app/api/auth/client/demo/route.ts"),
  ]);

  assert.doesNotMatch(booking, /useState\("Mochi"\)|useState\("Mini Poodle"\)/);
  assert.match(booking, /fetch\(`\/api\/booking-context/);
  assert.match(booking, /onClick=\{\(\) => openClientAuth\("signin"\)\}/);
  assert.match(booking, /autoComplete="one-time-code"/);
  assert.match(booking, /Send another code in \$\{authRetryAfter\}s/);
  assert.match(booking, /disabled=\{authBusy \|\| authRetryAfter > 0\}/);
  assert.match(booking, /disabled=\{authBusy \|\| authCode\.length !== 6\}/);
  assert.match(booking, /\/api\/client-auth\/start/);
  assert.match(booking, /\/api\/client-auth\/verify/);
  assert.match(booking, /Use email instead/);
  assert.match(booking, /Continue as guest/);
  assert.match(booking, /authenticatedBooking[\s\S]*?\{ petId: selectedOwnedPet!\.id \}/);
  assert.match(booking, /fastPhoneSignInEnabled === false/);
  assert.match(booking, /const smsDeliveryConfigured = catalog\?\.delivery\?\.sms\?\.configured === true/);
  assert.match(booking, /catalog\?\.delivery\?\.sms\?\.configured !== true/);
  assert.doesNotMatch(booking, /setSelectedStartsAt\(first\?\.slots\[0\]\?\.startsAt/);
  assert.match(booking, /function chooseDate\(date: string\)[^{]*\{[^}]*setSelectedStartsAt\(""\)/);
  assert.match(booking, /role="group" aria-label="Available dates"/);
  assert.match(booking, /id="time-selection-status"/);
  assert.match(booking, /data-booking-step-heading tabIndex=\{-1\}/);
  assert.match(booking, /ref=\{bookingErrorAlert\}[\s\S]*?role="alert" tabIndex=\{-1\}/);
  assert.match(styles, /\.time-grid,\s*\.time-grid\.live-times \{ grid-template-columns: 1fr 1fr; \}/);
  assert.match(styles, /\.auth-resend:disabled/);
  assert.match(booking, /Preview returning client \(local only\)/);
  assert.match(demo, /process\.env\.NODE_ENV !== "development"/);
  assert.match(demo, /\["localhost", "127\.0\.0\.1"\]\.includes\(hostname\)/);
  assert.match(demo, /issuePortalSession\(db, DEMO_CLIENT_ID, 30\)/);

  assert.match(context, /resolvePortalSession\(portalTokenFromRequest\(request\)\)/);
  assert.match(context, /hasVerifiedPhoneIdentity/);
  assert.match(context, /eq\(pets\.clientId, client\.id\)/);
  assert.match(context, /eq\(appointments\.clientId, client\.id\)/);
  assert.match(context, /"cache-control": "private, no-store"/);
  assert.doesNotMatch(context, /client\.email|client\.phone|handlingNotes|safetyLevel/);

  assert.match(portal, /organizationSlug/);
  assert.match(portal, /locationSlug/);
  assert.match(portal, /new URLSearchParams\(\{ pet: appointment\.petId, service: appointment\.serviceId \}\)/);
  assert.match(portal, /form action="\/portal\/signout" method="post"/);
});

test("failed mutations keep user input and failed workforce writes keep dialogs open", async () => {
  const [settings, workforce] = await Promise.all([
    source("../app/salon/settings-view.tsx"),
    source("../app/salon/workforce-view.tsx"),
  ]);

  assert.match(settings, /catch \(reason\) \{ setError/);
  assert.match(settings, /return true/);
  assert.match(settings, /return false/);
  assert.match(workforce, /Promise<boolean>/);
  assert.match(workforce, /if \(await save\(/);
  assert.match(workforce, /loadError && !data/);
  assert.match(workforce, /role="alert"/);
  assert.match(workforce, /role="dialog"/);
});

test("calendar, finance, and timesheets respect salon context", async () => {
  const [workspace, finance, employee, manager] = await Promise.all([
    source("../app/salon/salon-workspace.tsx"),
    source("../app/salon/financial-views.tsx"),
    source("../app/employee/employee-portal.tsx"),
    source("../app/salon/weekly-timesheets-admin.tsx"),
  ]);

  assert.match(workspace, /data\?\.salon\.timezone/);
  assert.match(workspace, /permissions\.includes\("checkout"\)/);
  assert.match(finance, /timeInZone\(event\.occurredAt, timezone\)/);
  assert.match(finance, /dateKeyInZone\(new Date\(\), timezone\)/);
  assert.match(finance, /\{data\.location\.currency\}/);
  assert.match(employee, /"Dimanche"/);
  assert.match(employee, /dateAdd\(weekStart, 6\)/);
  assert.match(manager, /addDays\(weekStart, 6\)/);
  assert.match(manager, /revision: selected\.revision/);
});

test("operational navigation and dialogs expose accessible state", async () => {
  const [workspace, portal, quickBooking, finance, styles] = await Promise.all([
    source("../app/salon/salon-workspace.tsx"),
    source("../app/portal/[token]/portal-experience.tsx"),
    source("../app/salon/quick-booking-modal.tsx"),
    source("../app/salon/financial-views.tsx"),
    source("../app/globals.css"),
  ]);

  assert.match(workspace, /aria-haspopup="dialog"/);
  assert.match(workspace, /mobileToolsDialog/);
  assert.match(portal, /aria-current=\{tab === key \? "page"/);
  assert.match(portal, /rel="noreferrer"/);
  assert.doesNotMatch(portal, /Appointment messages are always sent/);
  assert.match(quickBooking, /aria-modal="true"/);
  assert.match(quickBooking, /event\.key === "Escape"/);
  assert.match(finance, /role="tablist"/);
  assert.match(finance, /aria-pressed=\{method === value\}/);
  assert.match(styles, /grid-template-columns:\s*repeat\(9,\s*1fr\)/);
  assert.match(styles, /@media \(prefers-reduced-motion: reduce\)/);
  assert.match(styles, /\.sidebar-more-button/);
});

test("the booking flow keeps its steps and carries the public information form's exact questions", async () => {
  const [booking, intake, hero, careChoices, careOptions, publicForm, styles, layout] = await Promise.all([
    source("../app/booking-experience.tsx"),
    source("../app/booking-intake.tsx"),
    source("../app/booking-hero.tsx"),
    source("../app/care-choices.tsx"),
    source("../lib/care-options.ts"),
    source("../../web/fiche-informations.html"),
    source("../app/globals.css"),
    source("../app/layout.tsx"),
  ]);

  // Same flow as before: the illustrated banner only dresses the profile choice, it never adds a step.
  assert.doesNotMatch(booking, /BookingWelcome|welcomeAlreadySeen|welcome-active/);
  assert.match(booking, /<BookingHero tone="plum"[\s\S]{0,200}?title=\{<h3 data-booking-step-heading tabIndex=\{-1\}>/);
  assert.match(booking, /<p className="profile-choice-question">On se connaît déjà \?<\/p>/);
  assert.match(hero, /export function BookingHero/);
  assert.match(styles, /\.guided-progress-label \{ display: flex/);
  assert.match(layout, /viewportFit: "cover"/);

  // The in-app profile form is the website « Fiche d'informations »: same fields, values and required flags.
  const publicFormMarkup = publicForm.slice(publicForm.indexOf('data-formspree="intake"'), publicForm.indexOf("</form>"));
  for (const name of ["proprietaire", "telephone", "email", "nom_animal", "anniversaire", "espece", "race", "taille", "sante", "comportement", "sterilise", "gateries", "photos", "marketing"]) {
    assert.match(publicFormMarkup, new RegExp(`name="${name}"`));
    assert.match(intake, new RegExp(`name="${name}"`));
  }
  for (const name of ["proprietaire", "telephone", "email", "nom_animal"]) assert.match(intake, new RegExp(`name="${name}"[^>]*required`));
  assert.match(intake, /name="sante" rows=\{4\} required/);
  for (const name of ["anniversaire", "race", "comportement", "sterilise", "gateries", "photos", "marketing"]) assert.doesNotMatch(intake, new RegExp(`name="${name}"[^>]*required`));
  for (const value of publicFormMarkup.matchAll(/<option value="([^"]+)"|name="(?:espece|taille)" value="([^"]+)"/g)) { const choice = (value[1] || value[2]).replace(/\u00a0/g, "\\u00a0"); assert.ok(intake.includes(`"${choice}"`), `${choice} missing from the booking form`); }
  assert.match(intake, /const speciesChoices = \["Chien", "Chat", "Petit animal"\]/);
  assert.match(intake, /name="marketing" value="oui"/);
  assert.doesNotMatch(intake, /name="website"/);
  assert.match(intake, /fetch\("\/api\/public\/intake"/);
  assert.doesNotMatch(intake, /hidden=\{panel/);

  // Website size labels and short size keys both pre-select the care size.
  assert.match(careOptions, /export function sizeKeyFromLabel/);
  assert.match(careChoices, /useState\(sizeKeyFromLabel\(pet\.sizeLabel\)\)/);
  assert.match(styles, /\.guided-fields fieldset\[hidden\] \{ display: none; \}/);
});
