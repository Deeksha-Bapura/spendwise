import { toErrorResponse } from "@/lib/http";
import { requireApiUser, requirePermission } from "@/modules/auth/server";

/** Finance-admin-only endpoint. Proves the server, not the UI, enforces roles. */
export async function GET() {
  try {
    const user = await requireApiUser();
    await requirePermission(user, "admin:access");
    return Response.json({ ok: true, orgId: user.orgId });
  } catch (err) {
    return toErrorResponse(err);
  }
}
