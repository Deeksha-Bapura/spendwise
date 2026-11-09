import { getSessionCookie } from "better-auth/cookies";
import { NextResponse, type NextRequest } from "next/server";

// Webhooks and cron authenticate themselves (signature / bearer secret), not with a session.
const PUBLIC_PATHS = ["/login", "/api/auth", "/api/webhooks", "/api/cron"];

/**
 * Optimistic check only: redirects when there's no session cookie at all.
 * It does NOT validate the session. Real authorization happens on the server
 * in every page, route handler and server action (requireUser / requirePermission).
 */
export function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // Tag every request with an id so logs and audit rows can be correlated.
  const requestId = request.headers.get("x-request-id") ?? crypto.randomUUID();
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("x-request-id", requestId);

  const isPublic = PUBLIC_PATHS.some((p) => pathname === p || pathname.startsWith(`${p}/`));
  const isApi = pathname.startsWith("/api/");

  if (!isPublic && !getSessionCookie(request)) {
    if (isApi) {
      return NextResponse.json({ error: "Not signed in" }, { status: 401, headers: { "x-request-id": requestId } });
    }
    const url = new URL("/login", request.url);
    if (pathname !== "/") url.searchParams.set("next", pathname);
    return NextResponse.redirect(url);
  }

  const response = NextResponse.next({ request: { headers: requestHeaders } });
  response.headers.set("x-request-id", requestId);
  return response;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
