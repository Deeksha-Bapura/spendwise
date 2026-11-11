import { z } from "zod";
import { HttpError, toErrorResponse } from "@/lib/http";
import { getRequestContext } from "@/lib/request-context";
import { requireApiUser } from "@/modules/auth/server";
import { decideExpense } from "@/modules/expenses/server";

const Body = z.object({
  decision: z.enum(["approve", "reject"]),
  version: z.number().int().nonnegative(),
  comment: z.string().max(1000).nullable().optional(),
});

/** Approve or reject a submitted expense. Two approvers racing: one wins, the other gets 409. */
export async function POST(request: Request, ctx: RouteContext<"/api/expenses/[id]/decision">) {
  try {
    const user = await requireApiUser();
    const parsed = Body.safeParse(await request.json().catch(() => null));
    if (!parsed.success) throw new HttpError(422, "Invalid request body");
    const expense = await decideExpense(user, (await ctx.params).id, parsed.data, await getRequestContext());
    return Response.json(expense);
  } catch (err) {
    return toErrorResponse(err);
  }
}
