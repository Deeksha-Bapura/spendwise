import { z } from "zod";
import { HttpError, toErrorResponse } from "@/lib/http";
import { getRequestContext } from "@/lib/request-context";
import { requireApiUser } from "@/modules/auth/server";
import { submitExpense } from "@/modules/expenses/server";

const Body = z.object({ version: z.number().int().nonnegative() });

export async function POST(request: Request, ctx: RouteContext<"/api/expenses/[id]/submit">) {
  try {
    const user = await requireApiUser();
    const parsed = Body.safeParse(await request.json().catch(() => null));
    if (!parsed.success) throw new HttpError(422, "version is required");
    const expense = await submitExpense(user, (await ctx.params).id, parsed.data.version, await getRequestContext());
    return Response.json(expense);
  } catch (err) {
    return toErrorResponse(err);
  }
}
