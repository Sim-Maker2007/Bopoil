function constantTimeEqual(left: string, right: string) {
  if (left.length !== right.length) return false;
  let difference = 0;
  for (let index = 0; index < left.length; index += 1) difference |= left.charCodeAt(index) ^ right.charCodeAt(index);
  return difference === 0;
}
export async function squareWebhookSignature(payload: string, notificationUrl: string, signatureKey: string) {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(signatureKey),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const digest = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(`${notificationUrl}${payload}`));
  const bytes = new Uint8Array(digest);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

export async function verifySquareWebhookSignature(payload: string, signature: string, notificationUrl: string, signatureKey: string) {
  if (!signature || !notificationUrl || !signatureKey) return false;
  return constantTimeEqual(signature, await squareWebhookSignature(payload, notificationUrl, signatureKey));
}
