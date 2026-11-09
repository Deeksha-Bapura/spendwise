import { z } from "zod";
import { HttpError, toErrorResponse } from "@/lib/http";
import { getRequestContext } from "@/lib/request-context";
import { connectItem, PlaidApiError } from "@/modules/banking";
import { requireApiUser, requirePermission } from "@/modules/auth/server";
import { withIdempotency } from "@/modules/events";

const Body = z.object({
  publicToken: z.string().min(1),
  institutionName: z.string().max(200).nullable().optional(),
});

/**
 * Finish connecting a bank after Plaid Link succeeds.
 * Requires an Idempotency-Key header: Plaid public tokens are single-use, so a
 * retried request must get the first response back instead of re-exchanging.
 */
export async function POST(request: Request) {
  try {
    const user = await requireApiUser();
    await requirePermission(user, "bank:connect");
    const parsed = Body.safeParse(await request.json().catch(() => null));
    if (!parsed.success) throw new HttpError(400, "Invalid request body");
    const { requestId } = await getRequestContext();

    const result = await withIdempotency(
      {
        userId: user.id,
        key: request.headers.get("idempotency-key"),
        route: "POST /api/plaid/exchange",
        requestBody: parsed.data,
      },
      async () => {
        const connected = await connectItem({
          user,
          publicToken: parsed.data.publicToken,
          institutionName: parsed.data.institutionName ?? null,
          requestId,
        });
        return { status: 201, body: connected };
      },
    );

    return Response.json(result.body, {
      status: result.status,
      headers: result.replayed ? { "Idempotent-Replayed": "true" } : {},
    });
  } catch (err) {
    if (err instanceof PlaidApiError) {
      return Response.json({ error: "Plaid request failed", code: err.code }, { status: 502 });
    }
    return toErrorResponse(err);
  }
}
