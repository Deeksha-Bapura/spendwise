import "server-only";
import { PlaidClient, PlaidEnvironment, PlaidError } from "plaid";
import { env, plaidConfigured } from "@/lib/env";

/**
 * Everything Spendwise needs from Plaid, behind one small interface.
 * The real implementation wraps the Plaid SDK; tests inject a fake.
 * Plaid's own types stay in this file, so the rest of the app depends
 * only on these shapes.
 */

export type GatewayAccount = {
  plaidAccountId: string;
  name: string;
  mask: string | null;
  type: string;
};

export type GatewayTransaction = {
  plaidTransactionId: string;
  plaidAccountId: string;
  amount: number; // Plaid's sign convention: positive = money leaving the account
  isoCurrencyCode: string | null;
  unofficialCurrencyCode: string | null;
  merchantName: string | null;
  name: string;
  date: string; // YYYY-MM-DD
  pending: boolean;
  category: string | null; // personal_finance_category.primary
};

export type SyncPage = {
  accounts: GatewayAccount[];
  added: GatewayTransaction[];
  modified: GatewayTransaction[];
  removed: string[]; // plaid transaction ids
  nextCursor: string;
  hasMore: boolean;
};

export type VerificationJwk = {
  kid: string;
  kty: string;
  crv: string;
  alg: string;
  x: string;
  y: string;
  expiredAt: number | null; // unix seconds, null while the key is active
};

export interface PlaidGateway {
  createLinkToken(input: { userId: string; webhookUrl?: string }): Promise<string>;
  exchangePublicToken(publicToken: string): Promise<{ accessToken: string; itemId: string }>;
  syncTransactions(input: { accessToken: string; cursor: string | null }): Promise<SyncPage>;
  getVerificationKey(kid: string): Promise<VerificationJwk>;
}

/** A Plaid API failure, with Plaid's error_code when there is one. */
export class PlaidApiError extends Error {
  constructor(
    message: string,
    public readonly code: string | null,
    public readonly status: number | null,
  ) {
    super(message);
    this.name = "PlaidApiError";
  }
}

function toPlaidApiError(err: unknown): unknown {
  if (err instanceof PlaidError) {
    const body = (err.body ?? {}) as { error_code?: string; error_message?: string };
    // Never include err.rawResponse: its request headers contain the secret.
    return new PlaidApiError(body.error_message ?? err.message, body.error_code ?? null, err.statusCode ?? null);
  }
  return err;
}

async function call<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (err) {
    throw toPlaidApiError(err);
  }
}

export function createPlaidGateway(): PlaidGateway {
  const e = env();
  if (!plaidConfigured(e)) {
    throw new PlaidApiError("Plaid is not configured: set PLAID_CLIENT_ID and PLAID_SECRET", null, null);
  }
  const client = new PlaidClient({
    environment: e.PLAID_ENV === "production" ? PlaidEnvironment.Production : PlaidEnvironment.Sandbox,
    clientId: e.PLAID_CLIENT_ID,
    secret: e.PLAID_SECRET,
    timeoutInSeconds: 30,
    maxRetries: 2,
  });

  return {
    createLinkToken: ({ userId, webhookUrl }) =>
      call(async () => {
        const res = await client.link.createToken({
          client_name: "Spendwise",
          language: "en",
          country_codes: ["US"],
          user: { client_user_id: userId },
          products: ["transactions"],
          transactions: { days_requested: 90 },
          ...(webhookUrl ? { webhook: webhookUrl } : {}),
        });
        return res.link_token;
      }),

    exchangePublicToken: (publicToken) =>
      call(async () => {
        const res = await client.item.exchangePublicToken({ public_token: publicToken });
        return { accessToken: res.access_token, itemId: res.item_id };
      }),

    syncTransactions: ({ accessToken, cursor }) =>
      call(async () => {
        const res = await client.transactions.sync({
          access_token: accessToken,
          ...(cursor ? { cursor } : {}),
          count: 500,
        });
        const mapTxn = (t: (typeof res.added)[number]): GatewayTransaction => ({
          plaidTransactionId: t.transaction_id,
          plaidAccountId: t.account_id,
          amount: t.amount,
          isoCurrencyCode: t.iso_currency_code,
          unofficialCurrencyCode: t.unofficial_currency_code,
          merchantName: t.merchant_name ?? null,
          name: t.name,
          date: t.date,
          pending: t.pending,
          category: t.personal_finance_category?.primary ?? null,
        });
        return {
          accounts: (res.accounts ?? []).map((a) => ({
            plaidAccountId: a.account_id,
            name: a.official_name ?? a.name,
            mask: a.mask,
            type: a.subtype ? `${a.type}/${a.subtype}` : String(a.type),
          })),
          added: res.added.map(mapTxn),
          modified: res.modified.map(mapTxn),
          removed: res.removed.map((r) => r.transaction_id),
          nextCursor: res.next_cursor,
          hasMore: res.has_more,
        };
      }),

    getVerificationKey: (kid) =>
      call(async () => {
        const { key } = await client.webhook.getVerificationKey({ key_id: kid });
        return {
          kid: key.kid,
          kty: key.kty,
          crv: key.crv,
          alg: key.alg,
          x: key.x,
          y: key.y,
          expiredAt: key.expired_at ?? null,
        };
      }),
  };
}

// One gateway per process. Tests replace it with setPlaidGateway(fake).
let current: PlaidGateway | undefined;

export function getPlaidGateway(): PlaidGateway {
  current ??= createPlaidGateway();
  return current;
}

export function setPlaidGateway(gateway: PlaidGateway | undefined) {
  current = gateway;
}
