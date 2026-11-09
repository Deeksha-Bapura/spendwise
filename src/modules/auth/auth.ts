import "server-only";
import { betterAuth } from "better-auth";
import { prismaAdapter } from "better-auth/adapters/prisma";
import { nextCookies } from "better-auth/next-js";
import { db } from "@/lib/db";
import { env } from "@/lib/env";
import { logger } from "@/lib/logger";
import { fromHeaders } from "@/lib/request-context";
import { recordAudit } from "@/modules/audit";

const e = env();

type HookCtx = { headers?: Headers; request?: Request } | null;

function requestMeta(ctx: HookCtx) {
  const h = ctx?.headers ?? ctx?.request?.headers;
  return h ? fromHeaders(h) : { requestId: null, ip: null };
}

async function auditSession(
  action: "auth.login" | "auth.logout",
  session: { id: string; userId: string },
  ctx: HookCtx,
) {
  const user = await db.user.findUnique({
    where: { id: session.userId },
    select: { orgId: true },
  });
  if (!user) return;
  const { requestId, ip } = requestMeta(ctx);
  await recordAudit(db, {
    orgId: user.orgId,
    actorId: session.userId,
    action,
    entity: { type: "Session", id: session.id },
    requestId,
    ip,
  });
}

export const auth = betterAuth({
  baseURL: e.BETTER_AUTH_URL,
  secret: e.BETTER_AUTH_SECRET,
  database: prismaAdapter(db, { provider: "postgresql" }),

  // Accounts are provisioned by finance admins (seeded for now), not self sign-up.
  emailAndPassword: { enabled: true, disableSignUp: true, minPasswordLength: 8 },

  socialProviders:
    e.GITHUB_CLIENT_ID && e.GITHUB_CLIENT_SECRET
      ? { github: { clientId: e.GITHUB_CLIENT_ID, clientSecret: e.GITHUB_CLIENT_SECRET } }
      : undefined,

  user: {
    // input: false → clients can never set these through the auth API.
    additionalFields: {
      role: { type: "string", input: false, defaultValue: "EMPLOYEE" },
      orgId: { type: "string", input: false, required: false },
      teamId: { type: "string", input: false, required: false },
    },
  },

  session: {
    expiresIn: 60 * 60 * 8, // 8 hours: a workday, sensible for finance data
    updateAge: 60 * 60, // refresh at most hourly
  },

  databaseHooks: {
    user: {
      create: {
        // OAuth sign-ins create users; put them in the default org as employees.
        before: async (user) => {
          const org = await db.organization.findUnique({
            where: { slug: e.DEFAULT_ORG_SLUG },
            select: { id: true },
          });
          if (!org) {
            logger.error({ slug: e.DEFAULT_ORG_SLUG }, "default org missing; refusing sign-up");
            return false;
          }
          return { data: { ...user, orgId: org.id, role: "EMPLOYEE" } };
        },
      },
    },
    session: {
      create: { after: async (session, ctx) => auditSession("auth.login", session, ctx) },
      delete: { before: async (session, ctx) => void (await auditSession("auth.logout", session, ctx)) },
    },
  },

  // Brute-force protection on sign-in. Better Auth stores counters in memory by default;
  // move to the database or Redis when running more than one instance.
  rateLimit: { enabled: e.AUTH_RATE_LIMIT },

  trustedOrigins: [e.BETTER_AUTH_URL],
  plugins: [nextCookies()], // must be last
});

export type AuthSession = typeof auth.$Infer.Session;
