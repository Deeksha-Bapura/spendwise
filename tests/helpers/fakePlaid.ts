import type { GatewayTransaction, PlaidGateway, SyncPage } from "@/modules/banking";
import { PlaidApiError } from "@/modules/banking";

export const ACCOUNT = { plaidAccountId: "acct_1", name: "Plaid Checking", mask: "0000", type: "depository/checking" };

export function txn(id: string, overrides: Partial<GatewayTransaction> = {}): GatewayTransaction {
  return {
    plaidTransactionId: id,
    plaidAccountId: ACCOUNT.plaidAccountId,
    amount: 12.34,
    isoCurrencyCode: "USD",
    unofficialCurrencyCode: null,
    merchantName: "Uber",
    name: "UBER TRIP",
    date: "2026-11-01",
    pending: false,
    category: "TRANSPORTATION",
    ...overrides,
  };
}

export function page(p: Partial<SyncPage> & { nextCursor: string }): SyncPage {
  return { accounts: [ACCOUNT], added: [], modified: [], removed: [], hasMore: false, ...p };
}

/**
 * In-memory Plaid. `pages` maps the cursor a request sends ("" = first call)
 * to the page Plaid would return. Records every call so tests can assert on them.
 */
let instances = 0;

export class FakePlaid implements PlaidGateway {
  /** Like real Plaid, every bank gets its own account id. Pages written with
   *  the shared ACCOUNT placeholder are rewritten to this id. */
  readonly accountId = `acct_${++instances}_${Math.random().toString(36).slice(2, 8)}`;
  pages = new Map<string, SyncPage>();
  calls: { method: string; arg: unknown }[] = [];
  failNextSyncWith: PlaidApiError | null = null;
  syncDelayMs = 0;
  exchangeMap = new Map<string, { accessToken: string; itemId: string }>();
  usedPublicTokens = new Set<string>();

  async createLinkToken() {
    this.calls.push({ method: "createLinkToken", arg: null });
    return "link-sandbox-fake";
  }

  async exchangePublicToken(publicToken: string) {
    this.calls.push({ method: "exchangePublicToken", arg: publicToken });
    // Like Plaid: a public token can be exchanged once.
    if (this.usedPublicTokens.has(publicToken)) throw new PlaidApiError("used", "INVALID_PUBLIC_TOKEN", 400);
    this.usedPublicTokens.add(publicToken);
    const result = this.exchangeMap.get(publicToken);
    if (!result) throw new PlaidApiError("bad token", "INVALID_PUBLIC_TOKEN", 400);
    return result;
  }

  async syncTransactions({ cursor }: { accessToken: string; cursor: string | null }) {
    this.calls.push({ method: "syncTransactions", arg: cursor });
    if (this.syncDelayMs) await new Promise((r) => setTimeout(r, this.syncDelayMs));
    if (this.failNextSyncWith) {
      const err = this.failNextSyncWith;
      this.failNextSyncWith = null;
      throw err;
    }
    const p = this.pages.get(cursor ?? "") ?? page({ nextCursor: cursor ?? "" }); // nothing new
    const own = (id: string) => (id === ACCOUNT.plaidAccountId ? this.accountId : id);
    return {
      ...p,
      accounts: p.accounts.map((a) => ({ ...a, plaidAccountId: own(a.plaidAccountId) })),
      added: p.added.map((t) => ({ ...t, plaidAccountId: own(t.plaidAccountId) })),
      modified: p.modified.map((t) => ({ ...t, plaidAccountId: own(t.plaidAccountId) })),
    };
  }

  async getVerificationKey(): Promise<never> {
    throw new Error("not used in these tests");
  }

  syncCalls() {
    return this.calls.filter((c) => c.method === "syncTransactions").map((c) => c.arg);
  }
}
