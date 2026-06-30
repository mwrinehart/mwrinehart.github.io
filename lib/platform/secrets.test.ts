import { beforeAll, describe, expect, it } from "vitest";
import { decryptJson, encryptJson } from "./secrets";

// masterKey() requires a key outside local dev; provide one before exercising.
beforeAll(() => {
  process.env.PLATFORM_MASTER_KEY = "test-master-key-for-unit-tests";
});

describe("encryptJson / decryptJson", () => {
  it("round-trips an object", () => {
    const secret = { slackBotToken: "xoxb-123", smtpUrl: "smtp://user:pass@host" };
    const blob = encryptJson(secret);
    expect(blob).not.toContain("xoxb-123"); // ciphertext, not plaintext
    expect(decryptJson(blob)).toEqual(secret);
  });

  it("uses a fresh IV so the same value encrypts differently each time", () => {
    expect(encryptJson({ a: 1 })).not.toBe(encryptJson({ a: 1 }));
  });

  it("returns {} for null/empty input", () => {
    expect(decryptJson(null)).toEqual({});
    expect(decryptJson(undefined)).toEqual({});
    expect(decryptJson("")).toEqual({});
  });

  it("returns {} (does not throw) when the auth tag is tampered with", () => {
    const buf = Buffer.from(encryptJson({ a: 1 }), "base64");
    buf[13] ^= 0xff; // flip a byte inside the GCM auth tag (bytes 12..28)
    expect(decryptJson(buf.toString("base64"))).toEqual({});
  });

  it("returns {} when decrypted under the wrong key", () => {
    const blob = encryptJson({ secret: "value" });
    process.env.PLATFORM_MASTER_KEY = "a-different-key";
    try {
      expect(decryptJson(blob)).toEqual({});
    } finally {
      process.env.PLATFORM_MASTER_KEY = "test-master-key-for-unit-tests";
    }
  });
});
