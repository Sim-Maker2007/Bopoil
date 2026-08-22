import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

function callIndexes(source, needle) {
  const indexes = [];
  for (let index = source.indexOf(needle); index >= 0; index = source.indexOf(needle, index + needle.length)) indexes.push(index);
  return indexes;
}

function assertPortalPreparationIsBestEffort(source, expectedCalls) {
  const calls = callIndexes(source, "await issuePortalEmailSession");
  assert.equal(calls.length, expectedCalls);
  for (const call of calls) {
    const tryStart = source.lastIndexOf("try {", call);
    const catchStart = source.indexOf("catch (communicationError)", call);
    const responseStart = source.indexOf("return Response.json", call);
    assert.ok(tryStart >= 0 && tryStart < call, "portal session issuance must be inside a try block");
    assert.ok(catchStart > call && catchStart - call < 1_200, "portal session and message preparation must share a bounded catch");
    assert.ok(responseStart < 0 || catchStart < responseStart, "the committed mutation response must follow the best-effort catch");
  }
}

test("staff appointment mutations do not fail after portal-link or message preparation errors", async () => {
  const source = await readFile(new URL("../app/api/appointments/route.ts", import.meta.url), "utf8");
  assertPortalPreparationIsBestEffort(source, 4);
  assert.match(source, /Staff booking saved, but its private link or confirmation could not be prepared/);
  assert.match(source, /Deposit waived, but its private link or confirmation could not be prepared/);
  assert.match(source, /Booking confirmed, but its private link or communications could not be prepared/);
  assert.doesNotMatch(source, /await issuePortalEmailSession[\s\S]{0,500}queueBookingCommunications[\s\S]{0,100}\.catch\(/);
});

test("waitlist conversion returns its committed appointment when follow-up delivery fails", async () => {
  const source = await readFile(new URL("../app/api/waitlist/manage/route.ts", import.meta.url), "utf8");
  assertPortalPreparationIsBestEffort(source, 1);
  const commit = source.indexOf("await db.batch([");
  const portal = source.indexOf("await issuePortalEmailSession");
  const response = source.indexOf("return Response.json", portal);
  assert.ok(commit >= 0 && commit < portal);
  assert.ok(portal < response);
  assert.match(source, /Waitlist booking saved, but its private link or messages could not be prepared/);
});

test("public booking already treats post-commit session and email preparation as best effort", async () => {
  const source = await readFile(new URL("../app/api/bookings/route.ts", import.meta.url), "utf8");
  assert.match(source, /Booking saved, but the trusted client session could not be issued/);
  assert.match(source, /Booking saved, but its private link or communications could not be prepared/);
  assert.doesNotMatch(source, /const portalSession = await issuePortalEmailSession[\s\S]{0,300}queueBookingCommunications[\s\S]{0,100}\.catch\(/);
});

test("client portal mutations commit their audit trail before best-effort follow-up delivery", async () => {
  const source = await readFile(new URL("../app/api/portal/[token]/route.ts", import.meta.url), "utf8");
  const cancelAction = source.indexOf('action === "cancel"');
  const rescheduleAction = source.indexOf('action === "reschedule"');
  assert.ok(cancelAction >= 0 && rescheduleAction > cancelAction);

  const cancelBlock = source.slice(cancelAction, rescheduleAction);
  assert.match(cancelBlock, /db\.batch\(\[[\s\S]*appointment\.cancelled_by_client[\s\S]*\]\)/);
  assert.match(cancelBlock, /cancelPendingAppointmentMessages[\s\S]*\.catch\(/);

  const rescheduleBlock = source.slice(rescheduleAction);
  assert.match(rescheduleBlock, /db\.batch\(\[[\s\S]*appointment\.rescheduled_by_client[\s\S]*\]\)/);
  assert.match(rescheduleBlock, /cancelPendingAppointmentMessages[\s\S]*\.catch\(/);
  assert.match(rescheduleBlock, /try \{[\s\S]*issuePortalEmailSession[\s\S]*queueBookingCommunications[\s\S]*\} catch \(error\)/);
  assert.match(rescheduleBlock, /Appointment was rescheduled, but its updated confirmation could not be prepared/);
});

test("secure portal links are refreshed at provider delivery and manual handoff", async () => {
  const [delivery, messageApi, communicationsView, communications, portalLinks] = await Promise.all([
    readFile(new URL("../lib/message-delivery.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/api/messages/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/salon/communications-view.tsx", import.meta.url), "utf8"),
    readFile(new URL("../db/communications.ts", import.meta.url), "utf8"),
    readFile(new URL("../lib/portal-links.ts", import.meta.url), "utf8"),
  ]);

  const deferred = delivery.indexOf("new Date(message.scheduledFor).getTime() > nowDate.getTime() + 60_000");
  const refresh = delivery.indexOf("const refreshed = await refreshPortalLinkBody");
  assert.ok(deferred >= 0 && deferred < refresh, "future provider schedules must wait until delivery time before minting a short-lived link");
  assert.match(delivery, /message\.secure_link_refreshed/);
  assert.match(messageApi, /action === "refresh_secure_link"/);
  assert.match(messageApi, /new URL\(request\.url\)\.origin/);
  assert.match(communicationsView, /Copy with fresh link/);
  assert.match(communications, /templateKey: "appointment_reminder"[\s\S]{0,220}variables/);
  assert.match(portalLinks, /safePortalReturnTo/);
  assert.match(portalLinks, /candidate\.startsWith\("\/\/"\)/);
  assert.match(portalLinks, /parsed\.pathname !== "\/portal" && !parsed\.pathname\.startsWith\("\/book\/"\)/);
});

test("critical SMS lifecycle messages fall back to configured email delivery", async () => {
  const delivery = await readFile(new URL("../lib/message-delivery.ts", import.meta.url), "utf8");
  assert.match(delivery, /!config\.sms\.configured[\s\S]{0,120}config\.email\.configured/);
  assert.match(delivery, /\["approval_request", "ready_pickup"\]/);
  assert.match(delivery, /message\.channel_fallback/);
  assert.match(delivery, /recipientAddress: row\.clientEmail/);
});

test("the seeded reminder upgrade preserves staff-customized templates", async () => {
  const [pilot, onboarding] = await Promise.all([
    readFile(new URL("../db/pilot.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/api/onboarding/route.ts", import.meta.url), "utf8"),
  ]);

  assert.match(pilot, /legacyAppointmentReminderBody/);
  assert.match(pilot, /eq\(communicationTemplates\.body, legacyAppointmentReminderBody\)/);
  assert.match(pilot, /body: appointmentReminderBody/);
  assert.match(onboarding, /key: "appointment_reminder"[\s\S]{0,500}\{\{portal_url\}\}/);
  assert.match(onboarding, /key: "booking_deposit_expired"/);
});

test("verified Twilio replies enter the actionable communications queue", async () => {
  const [twilio, messages, view] = await Promise.all([
    readFile(new URL("../app/api/webhooks/twilio/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/api/messages/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/salon/communications-view.tsx", import.meta.url), "utf8"),
  ]);

  assert.match(twilio, /verifyTwilioWebhook[\s\S]*captureInboundReply/);
  assert.match(twilio, /direction: "inbound"/);
  assert.match(twilio, /status: "action_required"/);
  assert.match(twilio, /type: "message\.inbound_received"/);
  assert.match(messages, /action === "mark_handled" && existing\.direction === "inbound"/);
  assert.match(view, /Reply received/);
  assert.match(view, /act\("mark_handled"\)/);
});

test("verified Resend replies use per-message reply addresses and enter the same actionable queue", async () => {
  const [payloads, resend, view] = await Promise.all([
    readFile(new URL("../lib/message-provider-payloads.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/api/webhooks/resend/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/salon/communications-view.tsx", import.meta.url), "utf8"),
  ]);
  assert.match(payloads, /replyAddressForMessage/);
  assert.match(payloads, /\+cc-\$\{tag\}/);
  assert.match(resend, /eventType === "email\.received"/);
  assert.match(resend, /emails\/receiving\/\$\{encodeURIComponent\(input\.providerEmailId\)\}/);
  assert.match(resend, /eq\(messages\.id, conversationId\)/);
  assert.match(resend, /direction: "inbound"/);
  assert.match(resend, /status: "action_required"/);
  assert.match(view, /selected\.channel === "email" \? "email" : "text"/);
});

test("scheduled automation releases expired deposits before matching live waitlist openings", async () => {
  const [outreach, operationsCron, bookingHolds, pilot, portalLinks] = await Promise.all([
    readFile(new URL("../lib/waitlist-outreach.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/api/cron/operations/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../db/booking-holds.ts", import.meta.url), "utf8"),
    readFile(new URL("../db/pilot.ts", import.meta.url), "utf8"),
    readFile(new URL("../lib/portal-links.ts", import.meta.url), "utf8"),
  ]);
  assert.match(outreach, /loadAvailability/);
  assert.match(outreach, /matchesWaitlistTime/);
  assert.match(outreach, /eq\(waitlistEntries\.status, "waiting"\)/);
  assert.match(outreach, /eq\(waitlistEntries\.updatedAt, entry\.updatedAt\)/);
  assert.match(outreach, /templateKey: "waitlist_opening_available"/);
  assert.match(outreach, /issuePortalEmailSession/);
  assert.match(bookingHolds, /sweepExpiredBookingHolds/);
  assert.match(bookingHolds, /groupBy\(appointments\.locationId\)/);
  assert.match(operationsCron, /await sweepExpiredBookingHolds\(db, now\)/);
  assert.match(operationsCron, /sweepWaitlistOpenings/);
  assert.ok(operationsCron.indexOf("await sweepExpiredBookingHolds") < operationsCron.lastIndexOf("sweepWaitlistOpenings"));
  assert.match(pilot, /This opening is not held and goes to the first client/);
  assert.match(portalLinks, /"waitlist_opening_available"/);
});

test("pending care approvals expose a locally generated private QR handoff", async () => {
  const [care, manifest] = await Promise.all([
    readFile(new URL("../app/salon/care-workspace.tsx", import.meta.url), "utf8"),
    readFile(new URL("../package.json", import.meta.url), "utf8"),
  ]);
  assert.match(care, /await import\("qrcode"\)/);
  assert.match(care, /`\$\{window\.location\.origin\}\/approval\/\$\{approval\.token\}`/);
  assert.match(care, /approval\.status === "pending"/);
  assert.match(care, /Show QR/);
  assert.match(care, /role="dialog"/);
  assert.match(manifest, /"qrcode": "\^1\.5\.4"/);
});
