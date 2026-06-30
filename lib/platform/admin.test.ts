import { afterEach, describe, expect, it } from "vitest";
import { isPlatformAdmin } from "./admin";

const original = process.env.PLATFORM_ADMIN_EMAILS;
afterEach(() => {
  if (original === undefined) delete process.env.PLATFORM_ADMIN_EMAILS;
  else process.env.PLATFORM_ADMIN_EMAILS = original;
});

describe("isPlatformAdmin", () => {
  it("is false for a missing/empty email", () => {
    process.env.PLATFORM_ADMIN_EMAILS = "admin@jericho.com";
    expect(isPlatformAdmin(null)).toBe(false);
    expect(isPlatformAdmin(undefined)).toBe(false);
    expect(isPlatformAdmin("")).toBe(false);
  });

  it("matches the env list case-insensitively, ignoring surrounding space", () => {
    process.env.PLATFORM_ADMIN_EMAILS = "Admin@Jericho.com, ops@example.io";
    expect(isPlatformAdmin("admin@jericho.com")).toBe(true);
    expect(isPlatformAdmin("ADMIN@JERICHO.COM")).toBe(true);
    expect(isPlatformAdmin("ops@example.io")).toBe(true);
    expect(isPlatformAdmin("intruder@example.io")).toBe(false);
  });

  it("is false (closed) when the list is unset", () => {
    delete process.env.PLATFORM_ADMIN_EMAILS;
    expect(isPlatformAdmin("admin@jericho.com")).toBe(false);
  });
});
