import { randomBytes } from "node:crypto";
import { decryptSecret, DecryptionError, encryptSecret } from "@/lib/crypto";

const KEY = randomBytes(32).toString("base64");
const OTHER_KEY = randomBytes(32).toString("base64");

describe("encryptSecret / decryptSecret (AES-256-GCM)", () => {
  it("round-trips", () => {
    const enc = encryptSecret("access-sandbox-123", "item_1", KEY);
    expect(decryptSecret(enc, "item_1", KEY)).toBe("access-sandbox-123");
  });

  it("never stores the plaintext, and uses a fresh IV every time", () => {
    const a = encryptSecret("access-sandbox-123", "item_1", KEY);
    const b = encryptSecret("access-sandbox-123", "item_1", KEY);
    expect(a).not.toContain("access-sandbox");
    expect(a).not.toBe(b);
    expect(a.startsWith("v1.")).toBe(true);
  });

  it("fails with the wrong key", () => {
    const enc = encryptSecret("secret", "item_1", KEY);
    expect(() => decryptSecret(enc, "item_1", OTHER_KEY)).toThrow(DecryptionError);
  });

  it("fails when the ciphertext is moved to another item (context is authenticated)", () => {
    const enc = encryptSecret("secret", "item_1", KEY);
    expect(() => decryptSecret(enc, "item_2", KEY)).toThrow(DecryptionError);
  });

  it("detects tampering", () => {
    const enc = encryptSecret("secret", "item_1", KEY);
    const parts = enc.split(".");
    const ct = Buffer.from(parts[3]!, "base64url");
    ct[0] = ct[0]! ^ 0xff;
    parts[3] = ct.toString("base64url");
    expect(() => decryptSecret(parts.join("."), "item_1", KEY)).toThrow(DecryptionError);
  });

  it("rejects unknown formats and bad keys", () => {
    expect(() => decryptSecret("v2.a.b.c", "x", KEY)).toThrow(/Unknown secret format/);
    expect(() => encryptSecret("s", "x", Buffer.alloc(16).toString("base64"))).toThrow(/32 bytes/);
  });
});
