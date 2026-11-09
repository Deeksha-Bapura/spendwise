import { after } from "next/server";
import { logger } from "@/lib/logger";
import {
  processWebhookEvent,
  recordWebhook,
  verifyPlaidWebhook,
  WebhookVerificationError,
} from "@/modules/banking";

const MAX_BODY_BYTES = 1_000_000;

/**
 * Plaid webhook receiver: verify → store in the inbox → reply 200 fast →
 * process after the response is sent. Plaid retries anything that isn't a
 * quick 200, so the slow work (calling Plaid back, writing transactions)
 * happens in after(), and the cron endpoint retries anything that fails.
 */
export async function POST(request: Request) {
  // Verify against the exact bytes Plaid signed, so read the raw text, never re-serialized JSON.
  const rawBody = await request.text();
  if (rawBody.length > MAX_BODY_BYTES) return Response.json({ error: "Payload too large" }, { status: 413 });

  try {
    await verifyPlaidWebhook({ rawBody, verificationHeader: request.headers.get("plaid-verification") });
  } catch (err) {
    if (err instanceof WebhookVerificationError) {
      logger.warn({ reason: err.message }, "rejected Plaid webhook");
      return Response.json({ error: "Invalid signature" }, { status: 401 });
    }
    logger.error({ err: err instanceof Error ? err.message : err }, "could not verify Plaid webhook");
    return Response.json({ error: "Verification unavailable" }, { status: 503 }); // Plaid will retry
  }

  let event;
  try {
    event = await recordWebhook(rawBody);
  } catch {
    return Response.json({ error: "Invalid payload" }, { status: 400 });
  }

  if (!event.duplicate) {
    after(async () => {
      await processWebhookEvent(event.id);
    });
  }
  return Response.json({ received: true, duplicate: event.duplicate });
}
