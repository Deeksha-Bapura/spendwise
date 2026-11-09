import { headers } from "next/headers";

export const REQUEST_ID_HEADER = "x-request-id";

export type RequestContext = { requestId: string; ip: string | null };

/** Read the request id (set by src/proxy.ts) and client IP from the current request. */
export async function getRequestContext(): Promise<RequestContext> {
  const h = await headers();
  return fromHeaders(h);
}

export function fromHeaders(h: Headers): RequestContext {
  const forwarded = h.get("x-forwarded-for");
  return {
    requestId: h.get(REQUEST_ID_HEADER) ?? crypto.randomUUID(),
    ip: forwarded ? forwarded.split(",")[0]!.trim() : h.get("x-real-ip"),
  };
}
