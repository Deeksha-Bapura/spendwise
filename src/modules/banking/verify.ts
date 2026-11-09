import { createHash, timingSafeEqual } from "node:crypto";
import { decodeProtectedHeader, importJWK, jwtVerify } from "jose";
import { getPlaidGateway, type VerificationJwk } from "./gateway";

export class WebhookVerificationError extends Error {
  constructor(reason: string) {
    super(`Webhook verification failed: ${reason}`);
    this.name = "WebhookVerificationError";
  }
}

const MAX_AGE_SECONDS = 5 * 60; // Plaid: reject webhooks older than 5 minutes
const KEY_CACHE_TTL_MS = 24 * 60 * 60 * 1000;
const keyCache = new Map<string, { jwk: VerificationJwk; fetchedAt: number }>();

export function sha256Hex(input: string): string {
  return createHash("sha256").update(input, "utf8").digest("hex");
}

function safeEqualHex(a: string, b: string): boolean {
  const ab = Buffer.from(a, "utf8");
  const bb = Buffer.from(b, "utf8");
  return ab.length === bb.length && timingSafeEqual(ab, bb);
}

async function getKey(kid: string, fetchKey: (kid: string) => Promise<VerificationJwk>, nowMs: number) {
  const cached = keyCache.get(kid);
  if (cached && nowMs - cached.fetchedAt < KEY_CACHE_TTL_MS) return cached.jwk;
  const jwk = await fetchKey(kid);
  keyCache.set(kid, { jwk, fetchedAt: nowMs });
  return jwk;
}

export function clearWebhookKeyCache() {
  keyCache.clear();
}

/**
 * Verify a Plaid webhook, following Plaid's documented steps:
 *  1. the Plaid-Verification header is an ES256 JWT whose `kid` names a Plaid key;
 *  2. the signature verifies with that key, and the key hasn't expired;
 *  3. `iat` is at most 5 minutes old (replay protection);
 *  4. `request_body_sha256` equals the SHA-256 of the raw body, byte for byte.
 */
export async function verifyPlaidWebhook(input: {
  rawBody: string;
  verificationHeader: string | null;
  fetchKey?: (kid: string) => Promise<VerificationJwk>;
  now?: Date;
}): Promise<void> {
  const { rawBody, verificationHeader } = input;
  const now = input.now ?? new Date();
  const nowSeconds = Math.floor(now.getTime() / 1000);
  const fetchKey = input.fetchKey ?? ((kid: string) => getPlaidGateway().getVerificationKey(kid));

  if (!verificationHeader) throw new WebhookVerificationError("missing Plaid-Verification header");

  let header;
  try {
    header = decodeProtectedHeader(verificationHeader);
  } catch {
    throw new WebhookVerificationError("malformed JWT");
  }
  if (header.alg !== "ES256") throw new WebhookVerificationError(`unexpected alg ${String(header.alg)}`);
  if (!header.kid) throw new WebhookVerificationError("missing kid");

  const jwk = await getKey(header.kid, fetchKey, now.getTime());
  if (jwk.expiredAt !== null && jwk.expiredAt < nowSeconds) {
    throw new WebhookVerificationError("signing key has expired");
  }

  let payload;
  try {
    const key = await importJWK({ kty: jwk.kty, crv: jwk.crv, x: jwk.x, y: jwk.y }, "ES256");
    ({ payload } = await jwtVerify(verificationHeader, key, {
      algorithms: ["ES256"],
      currentDate: now,
      maxTokenAge: MAX_AGE_SECONDS,
    }));
  } catch (err) {
    throw new WebhookVerificationError(err instanceof Error ? err.message : "invalid signature");
  }

  const claimed = payload.request_body_sha256;
  if (typeof claimed !== "string" || !safeEqualHex(sha256Hex(rawBody), claimed)) {
    throw new WebhookVerificationError("body hash mismatch");
  }
}

