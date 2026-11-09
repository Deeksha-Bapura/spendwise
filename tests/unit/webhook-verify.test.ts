import { exportJWK, generateKeyPair, SignJWT } from "jose";
import type { VerificationJwk } from "@/modules/banking/gateway";
import { clearWebhookKeyCache, sha256Hex, verifyPlaidWebhook, WebhookVerificationError } from "@/modules/banking/verify";

// Plaid's webhook bodies are JSON with 2-space indentation; the hash covers those exact bytes.
const BODY = JSON.stringify(
  { webhook_type: "TRANSACTIONS", webhook_code: "SYNC_UPDATES_AVAILABLE", item_id: "item_1" },
  null,
  2,
);
const NOW = new Date("2026-11-09T12:00:00Z");
const nowSec = Math.floor(NOW.getTime() / 1000);

let privateKey: CryptoKey;
let jwk: VerificationJwk;
let fetchKey: jest.Mock<Promise<VerificationJwk>, [string]>;

beforeAll(async () => {
  const pair = await generateKeyPair("ES256", { extractable: true });
  privateKey = pair.privateKey;
  const pub = await exportJWK(pair.publicKey);
  jwk = { kid: "kid-1", kty: pub.kty!, crv: pub.crv!, alg: "ES256", x: pub.x!, y: pub.y!, expiredAt: null };
});

beforeEach(() => {
  clearWebhookKeyCache();
  fetchKey = jest.fn((kid: string) => Promise.resolve({ ...jwk, kid }));
});

function sign(claims: Record<string, unknown>, opts: { kid?: string; alg?: string; key?: CryptoKey } = {}) {
  return new SignJWT(claims)
    .setProtectedHeader({ alg: opts.alg ?? "ES256", kid: opts.kid ?? "kid-1", typ: "JWT" })
    .sign(opts.key ?? privateKey);
}

const verify = (header: string | null, rawBody = BODY, now = NOW) =>
  verifyPlaidWebhook({ rawBody, verificationHeader: header, fetchKey, now });

describe("verifyPlaidWebhook", () => {
  it("accepts a correctly signed, fresh webhook", async () => {
    const jwt = await sign({ iat: nowSec - 10, request_body_sha256: sha256Hex(BODY) });
    await expect(verify(jwt)).resolves.toBeUndefined();
    expect(fetchKey).toHaveBeenCalledWith("kid-1");
  });

  it("caches the verification key by kid", async () => {
    const jwt = await sign({ iat: nowSec, request_body_sha256: sha256Hex(BODY) });
    await verify(jwt);
    await verify(jwt);
    expect(fetchKey).toHaveBeenCalledTimes(1);
  });

  it("rejects a missing header", async () => {
    await expect(verify(null)).rejects.toThrow(/missing Plaid-Verification/);
  });

  it("rejects garbage", async () => {
    await expect(verify("not-a-jwt")).rejects.toThrow(WebhookVerificationError);
  });

  it("rejects a body that was changed after signing", async () => {
    const jwt = await sign({ iat: nowSec, request_body_sha256: sha256Hex(BODY) });
    const tampered = BODY.replace("item_1", "item_2");
    await expect(verify(jwt, tampered)).rejects.toThrow(/body hash mismatch/);
  });

  it("is whitespace-sensitive: re-serialized JSON doesn't match", async () => {
    const jwt = await sign({ iat: nowSec, request_body_sha256: sha256Hex(BODY) });
    const reserialized = JSON.stringify(JSON.parse(BODY)); // no indentation
    await expect(verify(jwt, reserialized)).rejects.toThrow(/body hash mismatch/);
  });

  it("rejects webhooks older than 5 minutes (replay protection)", async () => {
    const jwt = await sign({ iat: nowSec - 6 * 60, request_body_sha256: sha256Hex(BODY) });
    await expect(verify(jwt)).rejects.toThrow(WebhookVerificationError);
  });

  it("rejects a signature from a different key", async () => {
    const attacker = await generateKeyPair("ES256");
    const jwt = await sign({ iat: nowSec, request_body_sha256: sha256Hex(BODY) }, { key: attacker.privateKey });
    await expect(verify(jwt)).rejects.toThrow(WebhookVerificationError);
  });

  it("rejects algorithms other than ES256", async () => {
    const { privateKey: hsKey } = await generateKeyPair("ES384");
    const jwt = await sign({ iat: nowSec, request_body_sha256: sha256Hex(BODY) }, { alg: "ES384", key: hsKey });
    await expect(verify(jwt)).rejects.toThrow(/unexpected alg/);
  });

  it("rejects a key Plaid has marked expired", async () => {
    fetchKey.mockResolvedValueOnce({ ...jwk, expiredAt: nowSec - 1 });
    const jwt = await sign({ iat: nowSec, request_body_sha256: sha256Hex(BODY) });
    await expect(verify(jwt)).rejects.toThrow(/expired/);
  });
});
