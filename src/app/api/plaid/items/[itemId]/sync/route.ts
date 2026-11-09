import { HttpError, toErrorResponse } from "@/lib/http";
import { getRequestContext } from "@/lib/request-context";
import { getItemOwner, PlaidApiError, syncItem } from "@/modules/banking";
import { requireApiUser, requirePermission } from "@/modules/auth/server";

/** "Sync now": pull the latest transactions for one of your bank connections. */
export async function POST(_request: Request, ctx: RouteContext<"/api/plaid/items/[itemId]/sync">) {
  try {
    const user = await requireApiUser();
    const { itemId } = await ctx.params;
    const item = await getItemOwner(itemId);
    // Unknown item and someone else's item look the same: 404, so ids can't be probed.
    if (!item || item.orgId !== user.orgId) throw new HttpError(404, "Not found");
    await requirePermission(user, "bank:sync", { orgId: item.orgId, ownerId: item.userId, teamId: item.user.teamId });

    const { requestId } = await getRequestContext();
    const result = await syncItem(item.id, { actorId: user.id, requestId });
    return Response.json(result);
  } catch (err) {
    if (err instanceof PlaidApiError) {
      return Response.json({ error: "Plaid request failed", code: err.code }, { status: 502 });
    }
    return toErrorResponse(err);
  }
}
