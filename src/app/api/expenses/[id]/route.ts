import { z } from "zod";
import { HttpError, toErrorResponse } from "@/lib/http";
import { getRequestContext } from "@/lib/request-context";
import { requireApiUser } from "@/modules/auth/server";
import { discardExpense, getExpenseDetail, updateExpense } from "@/modules/expenses/server";

const Patch = z.object({
  version: z.number().int().nonnegative(),
  category: z.string().optional(),
  description: z.string().max(500).optional(),
  amount: z.string().max(20).optional(),
  spentAt: z.string().optional(),
});

export async function GET(_request: Request, ctx: RouteContext<"/api/expenses/[id]">) {
  try {
    const user = await requireApiUser();
    const detail = await getExpenseDetail(user, (await ctx.params).id);
    if (!detail) throw new HttpError(404, "Expense not found");
    return Response.json(detail);
  } catch (err) {
    return toErrorResponse(err);
  }
}

/** Edit a draft or rejected expense. `version` must match, or you get 409. */
export async function PATCH(request: Request, ctx: RouteContext<"/api/expenses/[id]">) {
  try {
    const user = await requireApiUser();
    const parsed = Patch.safeParse(await request.json().catch(() => null));
    if (!parsed.success) throw new HttpError(422, "Invalid request body");
    const { version, ...changes } = parsed.data;
    const expense = await updateExpense(user, (await ctx.params).id, { version, ...changes }, await getRequestContext());
    return Response.json(expense);
  } catch (err) {
    return toErrorResponse(err);
  }
}

/** Discard a draft. DELETE /api/expenses/:id?version=N */
export async function DELETE(request: Request, ctx: RouteContext<"/api/expenses/[id]">) {
  try {
    const user = await requireApiUser();
    const version = Number(new URL(request.url).searchParams.get("version"));
    if (!Number.isInteger(version) || version < 0) throw new HttpError(422, "version query parameter is required");
    await discardExpense(user, (await ctx.params).id, version, await getRequestContext());
    return new Response(null, { status: 204 });
  } catch (err) {
    return toErrorResponse(err);
  }
}
