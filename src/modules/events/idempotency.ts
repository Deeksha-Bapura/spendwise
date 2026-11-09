import "server-only";
import { createHash } from "node:crypto";
import { db } from "@/lib/db";
import { HttpError } from "@/lib/http";

const TTL_MS = 24 * 60 * 60 * 1000;
const KEY_RE = /^[A-Za-z0-9_-]{8,128}$/;

export type IdempotentResult = { status: number; body: unknown };

function hashRequest(route: string, body: unknown) {
  return createHash("sha256").update(route).update("\n").update(JSON.stringify(body ?? null)).digest("hex");
}

/** 64-bit advisory lock id derived from (user, key). */
function lockId(userId: string, key: string): bigint {
  return createHash("sha256").update(`${userId}:${key}`).digest().readBigInt64BE(0);
}

/**
 * Run `handler` at most once per (user, Idempotency-Key).
 *
 *  - First request: run it and store the response.
 *  - Retry with the same key and body: return the stored response without re-running.
 *  - Same key, different body: 422. A key may name exactly one request.
 *  - Concurrent duplicates: a Postgres advisory lock serializes them, so the
 *    second waits and then gets the first one's stored response.
 *
 * Only successful (2xx) responses are stored, so a failed request can be retried.
 */
export async function withIdempotency(
  params: { userId: string; key: string | null; route: string; requestBody: unknown },
  handler: () => Promise<IdempotentResult>,
): Promise<IdempotentResult & { replayed: boolean }> {
  const { userId, key, route, requestBody } = params;
  if (!key || !KEY_RE.test(key)) {
    throw new HttpError(400, "Idempotency-Key header is required (8-128 chars: letters, digits, - or _)");
  }
  const requestHash = hashRequest(route, requestBody);

  return db.$transaction(
    async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(${lockId(userId, key)})`;

      const existing = await tx.idempotencyKey.findUnique({ where: { userId_key: { userId, key } } });
      if (existing && existing.expiresAt > new Date()) {
        if (existing.requestHash !== requestHash || existing.route !== route) {
          throw new HttpError(422, "Idempotency-Key was already used for a different request");
        }
        return { status: existing.responseStatus, body: existing.responseBody, replayed: true };
      }

      const result = await handler();
      if (result.status >= 200 && result.status < 300) {
        const data = {
          route,
          requestHash,
          responseStatus: result.status,
          responseBody: JSON.parse(JSON.stringify(result.body ?? null)),
          expiresAt: new Date(Date.now() + TTL_MS),
        };
        await tx.idempotencyKey.upsert({
          where: { userId_key: { userId, key } },
          update: data,
          create: { userId, key, ...data },
        });
      }
      return { ...result, replayed: false };
    },
    // Holds the lock while the handler calls Plaid, so allow time for that.
    { timeout: 60_000, maxWait: 30_000 },
  );
}
