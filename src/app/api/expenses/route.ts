import { z } from "zod";
import { HttpError, toErrorResponse } from "@/lib/http";
import { getRequestContext } from "@/lib/request-context";
import { requireApiUser } from "@/modules/auth/server";
import { withIdempotency } from "@/modules/events";
import { createExpense, listMyExpenses } from "@/modules/expenses/server";

const Body = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("transaction"),
    transactionId: z.string().min(1),
    category: z.string().optional(),
    description: z.string().max(500).optional(),
  }),
  z.object({
    kind: z.literal("manual"),
    amount: z.string().min(1).max(20), // a decimal string, never a JSON number
    currency: z.string().regex(/^[A-Z]{3}$/).optional(),
    category: z.string(),
    description: z.string().trim().min(1, "Description is required").max(500),
    spentAt: z.string().min(1),
  }),
]);

export async function GET() {
  try {
    const user = await requireApiUser();
    return Response.json({ expenses: await listMyExpenses(user) });
  } catch (err) {
    return toErrorResponse(err);
  }
}

/** Create an expense. Idempotency-Key required, so a double-submitted form creates one expense. */
export async function POST(request: Request) {
  try {
    const user = await requireApiUser();
    const parsed = Body.safeParse(await request.json().catch(() => null));
    if (!parsed.success) throw new HttpError(422, parsed.error.issues[0]?.message ?? "Invalid request body");
    const meta = await getRequestContext();

    const result = await withIdempotency(
      { userId: user.id, key: request.headers.get("idempotency-key"), route: "POST /api/expenses", requestBody: parsed.data },
      async () => ({ status: 201, body: await createExpense(user, parsed.data, meta) }),
    );
    return Response.json(result.body, {
      status: result.status,
      headers: result.replayed ? { "Idempotent-Replayed": "true" } : {},
    });
  } catch (err) {
    return toErrorResponse(err);
  }
}
