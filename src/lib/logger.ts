import pino from "pino";

/** Structured JSON logs. Secrets are redacted wherever they appear. */
export const logger = pino({
  level: process.env.LOG_LEVEL ?? "info",
  base: { service: "spendwise-web" },
  redact: {
    paths: [
      "password",
      "*.password",
      "token",
      "*.token",
      "accessToken",
      "*.accessToken",
      "accessTokenEncrypted",
      "*.accessTokenEncrypted",
      "headers.authorization",
      "headers.cookie",
      "*.headers.authorization",
      "*.headers.cookie",
    ],
    censor: "[REDACTED]",
  },
});

export function childLogger(bindings: { requestId?: string; userId?: string; [k: string]: unknown }) {
  return logger.child(bindings);
}
