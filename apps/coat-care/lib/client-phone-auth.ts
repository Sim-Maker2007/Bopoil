export const CLIENT_PHONE_CHALLENGE_COOKIE = "__Host-client_phone_challenge";
export const CLIENT_PORTAL_COOKIE = "__Host-pet_portal";
export const PHONE_OTP_DIGITS = 6;
export const PHONE_OTP_TTL_SECONDS = 10 * 60;
export const PHONE_PROOF_TTL_SECONDS = 10 * 60;
export const PHONE_OTP_MAX_ATTEMPTS = 5;
export const PHONE_OTP_RESEND_SECONDS = 30;
export const PHONE_OTP_RATE_WINDOW_SECONDS = 10 * 60;
export const PHONE_OTP_DESTINATION_LIMIT = 3;
export const PHONE_OTP_SOURCE_LIMIT = 10;

const encoder = new TextEncoder();

function bytesToBase64Url(bytes: Uint8Array) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/g, "");
}

function bytesToHex(bytes: Uint8Array) {
  return [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

export function normalizeClientPhone(value: unknown) {
  const digits = String(value || "").replace(/\D/g, "");
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith("1")) return `+${digits}`;
  return null;
}

export function clientPhoneChanged(currentValue: unknown, nextValue: unknown) {
  const current = normalizeClientPhone(currentValue);
  const next = normalizeClientPhone(nextValue);
  if (current && next) return current !== next;
  return String(currentValue || "").trim() !== String(nextValue || "").trim();
}

export function randomChallengeToken() {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return bytesToBase64Url(bytes);
}

export function randomSixDigitCode() {
  const values = new Uint32Array(1);
  const range = 1_000_000;
  const unbiasedCeiling = Math.floor(0x1_0000_0000 / range) * range;
  do crypto.getRandomValues(values); while (values[0] >= unbiasedCeiling);
  return String(values[0] % range).padStart(PHONE_OTP_DIGITS, "0");
}

export async function sha256Hex(value: string) {
  const digest = await crypto.subtle.digest("SHA-256", encoder.encode(value));
  return bytesToHex(new Uint8Array(digest));
}

export async function hmacSha256Hex(secret: string, value: string) {
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const digest = await crypto.subtle.sign("HMAC", key, encoder.encode(value));
  return bytesToHex(new Uint8Array(digest));
}

export async function phoneOtpCodeHash(challengeToken: string, organizationId: string, code: string) {
  return hmacSha256Hex(challengeToken, `phone-otp:${organizationId}:${code}`);
}

export function constantTimeHexEqual(left: string, right: string) {
  const size = Math.max(left.length, right.length);
  let difference = left.length ^ right.length;
  for (let index = 0; index < size; index += 1) {
    difference |= (left.charCodeAt(index) || 0) ^ (right.charCodeAt(index) || 0);
  }
  return difference === 0;
}

export async function phoneRateLimitHashes(input: {
  organizationId: string;
  phoneE164: string;
  source: string;
  pepper: string;
}) {
  const [destinationHash, sourceHash] = await Promise.all([
    hmacSha256Hex(input.pepper, `phone-destination:${input.organizationId}:${input.phoneE164}`),
    hmacSha256Hex(input.pepper, `phone-source:${input.organizationId}:${input.source}`),
  ]);
  return { destinationHash, sourceHash };
}

export function challengeCookie(token: string, maxAge = PHONE_OTP_TTL_SECONDS) {
  return `${CLIENT_PHONE_CHALLENGE_COOKIE}=${encodeURIComponent(token)}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${Math.max(0, Math.floor(maxAge))}`;
}

export function portalCookie(token: string, maxAge = 30 * 86400) {
  return `${CLIENT_PORTAL_COOKIE}=${encodeURIComponent(token)}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${Math.max(0, Math.floor(maxAge))}`;
}

export function cookieValue(request: Request, name: string) {
  const header = request.headers.get("cookie") || "";
  for (const part of header.split(";")) {
    const separator = part.indexOf("=");
    if (separator < 0 || part.slice(0, separator).trim() !== name) continue;
    try { return decodeURIComponent(part.slice(separator + 1).trim()); }
    catch { return ""; }
  }
  return "";
}

export function requestSource(request: Request) {
  // Vercel sets x-forwarded-for from the connecting address. Client-supplied
  // headers such as cf-connecting-ip are ignored so a caller cannot pick its
  // own rate-limit bucket.
  return (
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim()
    || request.headers.get("x-real-ip")?.trim()
    || "unknown"
  ).slice(0, 200);
}

export function genericPhoneAuthStartResponse() {
  return {
    ok: true,
    expiresInSeconds: PHONE_OTP_TTL_SECONDS,
    retryAfterSeconds: PHONE_OTP_RESEND_SECONDS,
  } as const;
}

export function buildTwilioPhoneOtpRequest(input: {
  accountSid: string;
  authToken: string;
  messagingServiceSid: string;
  phoneE164: string;
  code: string;
}) {
  const form = new URLSearchParams({
    To: input.phoneE164,
    MessagingServiceSid: input.messagingServiceSid,
    Body: `Your Coat & Care verification code is ${input.code}. It expires in 10 minutes. Never share this code.`,
  });
  return {
    url: `https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(input.accountSid)}/Messages.json`,
    init: {
      method: "POST",
      headers: {
        authorization: `Basic ${btoa(`${input.accountSid}:${input.authToken}`)}`,
        "content-type": "application/x-www-form-urlencoded",
      },
      body: form.toString(),
    } satisfies RequestInit,
  };
}
