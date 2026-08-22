import type { DeliveryConfig } from "./message-provider-payloads.ts";
import { resendRequest } from "./message-provider-payloads.ts";

type Fetcher = typeof fetch;

export type EmployeeInvitationDelivery =
  | { state: "sent"; recipient: string; provider: "resend"; providerMessageId: string }
  | { state: "manual_required"; recipient: string | null; reason: "missing_recipient" | "provider_unconfigured" }
  | { state: "failed"; recipient: string; reason: "provider_rejected" | "delivery_error"; error: string };

type EmployeeInvitation = {
  invitationId: string;
  recipient: string;
  displayName: string;
  organizationName: string;
  employeeInvitationUrl: string;
  crmUrl: string | null;
  expiresAt: string;
};

function responseError(value: string, status: number) {
  try {
    const parsed = JSON.parse(value) as { message?: string; error?: { message?: string } | string };
    if (typeof parsed.error === "string") return parsed.error.slice(0, 300);
    return (parsed.message || parsed.error?.message || `Email provider returned ${status}.`).slice(0, 300);
  } catch {
    return value.slice(0, 300) || `Email provider returned ${status}.`;
  }
}

export function employeeInvitationEmail(input: Omit<EmployeeInvitation, "invitationId" | "recipient">) {
  const expiry = new Intl.DateTimeFormat("en-CA", {
    timeZone: "UTC",
    year: "numeric",
    month: "short",
    day: "numeric",
  }).format(new Date(input.expiresAt));
  const crmInstructions = input.crmUrl
    ? `\n\nCRM access:\n${input.crmUrl}\nSign in with the email address that received this invitation.`
    : "";
  return {
    subject: `${input.organizationName}: finish your employee setup`,
    body: `Hi ${input.displayName},

You have been invited to join ${input.organizationName}.

Create your private employee code and PIN:
${input.employeeInvitationUrl}

This one-time link expires ${expiry}.${crmInstructions}

If you were not expecting this invitation, you can ignore this email.`,
  };
}

export async function deliverEmployeeInvitation(
  input: EmployeeInvitation,
  config: DeliveryConfig,
  fetcher: Fetcher = fetch,
): Promise<EmployeeInvitationDelivery> {
  const recipient = input.recipient.trim().toLowerCase();
  if (!recipient) return { state: "manual_required", recipient: null, reason: "missing_recipient" };
  if (!config.email.configured) return { state: "manual_required", recipient, reason: "provider_unconfigured" };

  const email = employeeInvitationEmail(input);
  const request = resendRequest({
    id: `employee-invitation-${input.invitationId}`,
    recipientAddress: recipient,
    subject: email.subject,
    body: email.body,
    scheduledFor: new Date().toISOString(),
    deliveryAttempts: 0,
  }, config);
  if (!request) return { state: "failed", recipient, reason: "delivery_error", error: "The invitation email could not be prepared." };

  try {
    const response = await fetcher(request.url, request.init);
    const raw = await response.text();
    if (!response.ok) return { state: "failed", recipient, reason: "provider_rejected", error: responseError(raw, response.status) };
    let providerMessageId = "";
    try { providerMessageId = String((JSON.parse(raw) as { id?: string }).id || ""); } catch { /* handled below */ }
    if (!providerMessageId) return { state: "failed", recipient, reason: "provider_rejected", error: "The email provider did not return a message identifier." };
    return { state: "sent", recipient, provider: "resend", providerMessageId };
  } catch (error) {
    return {
      state: "failed",
      recipient,
      reason: "delivery_error",
      error: error instanceof Error ? error.message.slice(0, 300) : "The email provider could not be reached.",
    };
  }
}
