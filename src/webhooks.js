// Docs: docs/sending-events-bulk-plan.md. Standard Webhooks HMAC-SHA256 wire contract.
import { validate } from "./validation.js";
const bytes = (value) => new TextEncoder().encode(value);
export function webhookKey(secret) {
  if (typeof secret !== "string" || !/^whsec_[A-Za-z0-9+/]{43}=$/.test(secret))
    throw new Error("Invalid webhook signing secret.");
  return Uint8Array.from(globalThis.atob(secret.slice(6)), (c) =>
    c.charCodeAt(0),
  );
}
export async function signWebhook(secret, id, timestamp, body) {
  const key = await globalThis.crypto.subtle.importKey(
    "raw",
    webhookKey(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = new Uint8Array(
    await globalThis.crypto.subtle.sign(
      "HMAC",
      key,
      bytes(`${id}.${timestamp}.${body}`),
    ),
  );
  return "v1," + globalThis.btoa(String.fromCharCode(...signature));
}
export async function verifyWebhook(rawBody, headers, secret) {
  const get = (name) =>
    typeof headers?.get === "function"
      ? headers.get(name)
      : Object.entries(headers ?? {}).find(
          ([k]) => k.toLowerCase() === name,
        )?.[1];
  const id = get("webhook-id"),
    timestamp = get("webhook-timestamp"),
    signatures = get("webhook-signature");
  if (
    typeof rawBody !== "string" ||
    bytes(rawBody).length > 65536 ||
    typeof id !== "string" ||
    !/^evt_[a-f0-9]{64}$/.test(id) ||
    typeof timestamp !== "string" ||
    !/^\d{1,12}$/.test(timestamp) ||
    Math.abs(Date.now() / 1000 - Number(timestamp)) > 300 ||
    typeof signatures !== "string" ||
    signatures.length > 2048
  )
    throw new Error("Invalid webhook signature or timestamp.");
  const key = await globalThis.crypto.subtle.importKey(
    "raw",
    webhookKey(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["verify"],
  );
  let verified = false;
  for (const candidate of signatures.split(" ").slice(0, 10)) {
    if (!/^v1,[A-Za-z0-9+/]{43}=$/.test(candidate)) continue;
    const signature = Uint8Array.from(
      globalThis.atob(candidate.slice(3)),
      (c) => c.charCodeAt(0),
    );
    if (
      await globalThis.crypto.subtle.verify(
        "HMAC",
        key,
        signature,
        bytes(`${id}.${timestamp}.${rawBody}`),
      )
    )
      verified = true;
  }
  if (!verified) throw new Error("Invalid webhook signature or timestamp.");
  const event = JSON.parse(rawBody);
  validate("EmailEvent", event);
  if (event.id !== id) throw new Error("Webhook event ID mismatch.");
  return event;
}
