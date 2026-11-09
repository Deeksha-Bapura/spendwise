import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

/**
 * AES-256-GCM encryption for secrets at rest (Plaid access tokens).
 *
 * Format: "v1.<iv>.<authTag>.<ciphertext>" (base64url parts). The version
 * prefix lets us rotate keys later without guessing which key encrypted what.
 *
 * `context` is bound in as additional authenticated data (AAD): a token
 * encrypted for item A fails to decrypt if it's copied onto item B's row.
 */

const VERSION = "v1";
const IV_BYTES = 12; // GCM standard nonce size

export class DecryptionError extends Error {
  constructor(message = "Could not decrypt secret") {
    super(message);
    this.name = "DecryptionError";
  }
}

function loadKey(keyBase64 = process.env.TOKEN_ENCRYPTION_KEY): Buffer {
  if (!keyBase64) throw new Error("TOKEN_ENCRYPTION_KEY is not set");
  const key = Buffer.from(keyBase64, "base64");
  if (key.length !== 32) throw new Error("TOKEN_ENCRYPTION_KEY must be 32 bytes, base64-encoded");
  return key;
}

export function encryptSecret(plaintext: string, context: string, keyBase64?: string): string {
  const key = loadKey(keyBase64);
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  cipher.setAAD(Buffer.from(context, "utf8"));
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [VERSION, iv, tag, ciphertext].map((p) => (typeof p === "string" ? p : p.toString("base64url"))).join(".");
}

export function decryptSecret(payload: string, context: string, keyBase64?: string): string {
  const parts = payload.split(".");
  if (parts.length !== 4 || parts[0] !== VERSION) throw new DecryptionError("Unknown secret format");
  const [, ivPart, tagPart, ctPart] = parts as [string, string, string, string];
  try {
    const decipher = createDecipheriv("aes-256-gcm", loadKey(keyBase64), Buffer.from(ivPart, "base64url"));
    decipher.setAAD(Buffer.from(context, "utf8"));
    decipher.setAuthTag(Buffer.from(tagPart, "base64url"));
    return Buffer.concat([decipher.update(Buffer.from(ctPart, "base64url")), decipher.final()]).toString("utf8");
  } catch {
    // Wrong key, wrong context, or tampered data. Never say which.
    throw new DecryptionError();
  }
}
