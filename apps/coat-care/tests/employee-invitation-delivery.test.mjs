import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  deliverEmployeeInvitation,
  employeeInvitationEmail,
} from "../lib/employee-invitation-delivery.ts";

const configured = {
  email: {
    configured: true,
    webhookConfigured: false,
    provider: "resend",
    apiKey: "resend-test",
    from: "team@example.com",
    replyTo: "desk@example.com",
  },
  sms: {
    configured: false,
    webhookConfigured: false,
    provider: "twilio",
    accountSid: "",
    authToken: "",
    messagingServiceSid: "",
    callbackUrl: "",
  },
};
const invitation = {
  invitationId: "invite-1",
  recipient: "Employee@Example.com",
  displayName: "Maya",
  organizationName: "Coat Care",
  employeeInvitationUrl: "https://coat.example/employee/setup/private-token",
  crmUrl: "https://coat.example/salon",
  expiresAt: "2026-08-02T12:00:00.000Z",
};

test("employee invitation email contains both setup surfaces without exposing tokens to audit state", async () => {
  const email = employeeInvitationEmail(invitation);
  assert.match(email.subject, /Coat Care/);
  assert.match(email.body, /employee\/setup\/private-token/);
  assert.match(email.body, /https:\/\/coat\.example\/salon/);

  let request;
  const result = await deliverEmployeeInvitation(
    invitation,
    configured,
    async (url, init) => {
      request = { url, init };
      return new Response(JSON.stringify({ id: "resend-message-1" }), {
        status: 200,
      });
    },
  );
  assert.deepEqual(result, {
    state: "sent",
    recipient: "employee@example.com",
    provider: "resend",
    providerMessageId: "resend-message-1",
  });
  assert.equal(request.url, "https://api.resend.com/emails");
  assert.equal(
    request.init.headers["idempotency-key"],
    "coat-care:employee-invitation-invite-1",
  );
  const payload = JSON.parse(request.init.body);
  assert.deepEqual(payload.to, ["employee@example.com"]);
  assert.equal(
    payload.reply_to,
    "desk+cc-employee-invitation-invite-1@example.com",
  );
});

test("employee invitations return an explicit manual fallback without provider credentials", async () => {
  const noEmail = await deliverEmployeeInvitation(
    { ...invitation, recipient: "" },
    configured,
  );
  assert.deepEqual(noEmail, {
    state: "manual_required",
    recipient: null,
    reason: "missing_recipient",
  });

  const unconfigured = await deliverEmployeeInvitation(invitation, {
    ...configured,
    email: { ...configured.email, configured: false, apiKey: "", from: "" },
  });
  assert.deepEqual(unconfigured, {
    state: "manual_required",
    recipient: "employee@example.com",
    reason: "provider_unconfigured",
  });
});

test("Team owns creation and reports automatic delivery while Settings no longer creates invitations", async () => {
  const [
    teamApi,
    teamView,
    workforceApi,
    workforceView,
    settingsApi,
    settingsView,
  ] = await Promise.all([
    readFile(new URL("../app/api/team/route.ts", import.meta.url), "utf8"),
    readFile(
      new URL("../app/salon/business-views.tsx", import.meta.url),
      "utf8",
    ),
    readFile(
      new URL("../app/api/timesheets/route.ts", import.meta.url),
      "utf8",
    ),
    readFile(
      new URL("../app/salon/weekly-timesheets-admin.tsx", import.meta.url),
      "utf8",
    ),
    readFile(new URL("../app/api/settings/route.ts", import.meta.url), "utf8"),
    readFile(
      new URL("../app/salon/settings-view.tsx", import.meta.url),
      "utf8",
    ),
  ]);
  assert.match(teamApi, /deliverEmployeeInvitation/);
  assert.match(teamApi, /employee_invitation\.email_sent/);
  assert.match(teamApi, /process\.env\.DELIVERY_PUBLIC_URL/);
  assert.match(teamApi, /\["manager", "receptionist", "groomer", "bather", "accountant"\]/);
  assert.match(teamView, /Invitation emailed/);
  assert.match(teamView, /Receptionist/);
  assert.match(teamView, /Bather/);
  assert.match(teamView, /Automatic email is not configured/);
  assert.match(workforceApi, /deliverEmployeeInvitation/);
  assert.match(
    workforceApi,
    /safePublicOrigin\(process\.env\.DELIVERY_PUBLIC_URL\)/,
  );
  assert.match(workforceApi, /eq\(staff\.email, email\)/);
  assert.match(workforceApi, /employee_invitation\.email_sent/);
  assert.match(workforceView, /create private setup links from Team/);
  assert.match(workforceView, /Timesheets\s+stay focused on weekly corrections and payroll approval/);
  assert.match(settingsApi, /Add and invite teammates from Team/);
  assert.doesNotMatch(settingsView, /Send invitation/);
  assert.match(settingsView, /Team is the single place/);
});
