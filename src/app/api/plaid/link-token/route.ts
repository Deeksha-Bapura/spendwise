import { env, plaidConfigured } from "@/lib/env";
import { toErrorResponse, HttpError } from "@/lib/http";
import { getPlaidGateway, PlaidApiError } from "@/modules/banking";
import { requireApiUser, requirePermission } from "@/modules/auth/server";

/** Create a Plaid Link token so the browser can open Plaid Link. */
export async function POST() {
  try {
    const user = await requireApiUser();
    await requirePermission(user, "bank:connect");
    const e = env();
    if (!plaidConfigured(e)) throw new HttpError(503, "Plaid is not configured on this server");

    const linkToken = await getPlaidGateway().createLinkToken({
      userId: user.id,
      webhookUrl: e.PLAID_WEBHOOK_URL,
    });
    return Response.json({ linkToken });
  } catch (err) {
    if (err instanceof PlaidApiError) {
      return Response.json({ error: "Plaid request failed", code: err.code }, { status: 502 });
    }
    return toErrorResponse(err);
  }
}
