import { z } from "zod";

const boolString = z
  .enum(["true", "false"])
  .default("false")
  .transform((v) => v === "true");

const schema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  DATABASE_URL: z.string().url(),
  BETTER_AUTH_SECRET: z.string().min(32, "BETTER_AUTH_SECRET must be at least 32 characters"),
  BETTER_AUTH_URL: z.string().url(),
  DEMO_MODE: boolString,
  /** Better Auth rate limiting (3 sign-ins / 10s per IP). Only disable for e2e runs. */
  AUTH_RATE_LIMIT: z.enum(["true", "false"]).default("true").transform((v) => v === "true"),
  DEFAULT_ORG_SLUG: z.string().min(1).default("acme"),
  GITHUB_CLIENT_ID: z.string().optional(),
  GITHUB_CLIENT_SECRET: z.string().optional(),
  // Plaid. Keys are optional so the app (and CI) run without them; bank
  // connection is disabled until they're set.
  PLAID_CLIENT_ID: z.string().optional(),
  PLAID_SECRET: z.string().optional(),
  PLAID_ENV: z.enum(["sandbox", "production"]).default("sandbox"),
  /** Public URL Plaid sends webhooks to, e.g. https://<tunnel>/api/webhooks/plaid */
  PLAID_WEBHOOK_URL: z.string().url().optional(),
  /** 32 random bytes, base64. Encrypts Plaid access tokens at rest. */
  TOKEN_ENCRYPTION_KEY: z
    .string()
    .refine((v) => Buffer.from(v, "base64").length === 32, "must be 32 bytes, base64-encoded"),
  /** Shared secret for the webhook retry endpoint (Vercel Cron sends it as a Bearer token). */
  CRON_SECRET: z.string().min(16).optional(),
  LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace", "silent"]).default("info"),
});

export type Env = z.infer<typeof schema>;

let cached: Env | undefined;

// Empty strings in .env (e.g. PLAID_WEBHOOK_URL="") mean "not set".
function withoutEmpty(source: NodeJS.ProcessEnv) {
  return Object.fromEntries(Object.entries(source).filter(([, v]) => v !== ""));
}

/** Validated env. Throws one readable error listing every bad variable. */
export function env(): Env {
  if (cached) return cached;
  const parsed = schema.safeParse(withoutEmpty(process.env));
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((i) => `  - ${i.path.join(".")}: ${i.message}`)
      .join("\n");
    throw new Error(`Invalid environment variables:\n${issues}\nSee .env.example.`);
  }
  cached = parsed.data;
  return cached;
}

export function plaidConfigured(e: Env = env()): boolean {
  return Boolean(e.PLAID_CLIENT_ID && e.PLAID_SECRET);
}
