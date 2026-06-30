import { describe, expect, it } from "vitest";
import { hashPassword, verifyPassword } from "./password";

describe("password hashing", () => {
  it("verifies a correct password and rejects a wrong one", () => {
    const stored = hashPassword("correct horse battery staple");
    expect(verifyPassword("correct horse battery staple", stored)).toBe(true);
    expect(verifyPassword("wrong password", stored)).toBe(false);
  });

  it("salts: the same password hashes to different strings", () => {
    expect(hashPassword("pw")).not.toBe(hashPassword("pw"));
  });

  it("rejects null/empty/malformed stored hashes without throwing", () => {
    expect(verifyPassword("x", null)).toBe(false);
    expect(verifyPassword("x", undefined)).toBe(false);
    expect(verifyPassword("x", "")).toBe(false);
    expect(verifyPassword("x", "notscrypt$aa$bb")).toBe(false);
    expect(verifyPassword("x", "scrypt$onlytwo")).toBe(false);
  });
});
