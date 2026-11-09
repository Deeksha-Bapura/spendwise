import { toErrorResponse } from "@/lib/http";
import { listTransactions } from "@/modules/banking";
import { requireApiUser, requirePermission } from "@/modules/auth/server";

/** GET /api/transactions?cursor=…&limit=… — newest first, scoped to what the caller may see. */
export async function GET(request: Request) {
  try {
    const user = await requireApiUser();
    await requirePermission(user, "transaction:read");
    const url = new URL(request.url);
    const limit = Number(url.searchParams.get("limit") ?? 25);
    const page = await listTransactions(user, {
      cursor: url.searchParams.get("cursor"),
      limit: Number.isFinite(limit) ? limit : 25,
    });
    return Response.json(page);
  } catch (err) {
    return toErrorResponse(err);
  }
}
