import { timingSafeEqual } from "node:crypto";
import { env } from "@/lib/env";
import { processPendingWebhooks } from "@/modules/banking";

function authorized(header: string | null, secret: string | undefined) {
  if (!secret || !header) return false;
  const expected = Buffer.from(`Bearer ${secret}`);
  const got = Buffer.from(header);
  return got.length === expected.length && timingSafeEqual(got, expected);
}

/** Retry webhook inbox events that failed or never ran. Vercel Cron calls this with GET. */
export async function GET(request: Request) {
  if (!authorized(request.headers.get("authorization"), env().CRON_SECRET)) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }
  return Response.json(await processPendingWebhooks());
}
