function bytesFromBase64(value: string) {
  const binary = atob(value); return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

function bytesToBase64(value: ArrayBuffer) {
  const bytes = new Uint8Array(value); let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function constantTimeEqual(left: string, right: string) {
  const size = Math.max(left.length, right.length); let difference = left.length ^ right.length;
  for (let index = 0; index < size; index += 1) difference |= (left.charCodeAt(index) || 0) ^ (right.charCodeAt(index) || 0);
  return difference === 0;
}

export async function verifyResendWebhook(input: { payload: string; id: string; timestamp: string; signature: string; secret: string; now?: Date }) {
  const seconds = Number(input.timestamp), now = Math.floor((input.now || new Date()).getTime() / 1000);
  if (!input.id || !Number.isFinite(seconds) || Math.abs(now - seconds) > 300 || !input.signature || !input.secret) return false;
  try {
    const encoded = input.secret.startsWith("whsec_") ? input.secret.slice(6) : input.secret;
    const key = await crypto.subtle.importKey("raw", bytesFromBase64(encoded), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
    const digest = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(`${input.id}.${input.timestamp}.${input.payload}`));
    const expected = bytesToBase64(digest);
    return input.signature.split(" ").some((part) => part.startsWith("v1,") && constantTimeEqual(part.slice(3), expected));
  } catch { return false; }
}

export async function verifyTwilioWebhook(input: { url: string; params: URLSearchParams; signature: string; authToken: string }) {
  if (!input.signature || !input.authToken) return false;
  const compare = (left: string, right: string) => left < right ? -1 : left > right ? 1 : 0;
  const names = [...new Set(input.params.keys())].sort(compare);
  const content = names.reduce((value, name) => [...new Set(input.params.getAll(name))].sort(compare).reduce((current, item) => `${current}${name}${item}`, value), input.url);
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(input.authToken), { name: "HMAC", hash: "SHA-1" }, false, ["sign"]);
  const digest = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(content));
  return constantTimeEqual(bytesToBase64(digest), input.signature);
}
