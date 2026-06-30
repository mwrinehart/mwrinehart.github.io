import { afterEach, describe, expect, it } from "vitest";
import { authorizeCron } from "./cron";

const original = process.env.CRON_SECRET;
afterEach(() => {
  if (original === undefined) delete process.env.CRON_SECRET;
  else process.env.CRON_SECRET = original;
});

describe("authorizeCron", () => {
  it("is closed by default when CRON_SECRET is unset", () => {
    delete process.env.CRON_SECRET;
    expect(authorizeCron("anything")).toBe(false);
  });

  it("accepts the exact secret and rejects everything else", () => {
    process.env.CRON_SECRET = "s3cr3t-value";
    expect(authorizeCron("s3cr3t-value")).toBe(true);
    expect(authorizeCron("s3cr3t-valuE")).toBe(false);
    expect(authorizeCron("s3cr3t")).toBe(false); // shorter — no length-based throw/short-circuit
    expect(authorizeCron("s3cr3t-value-with-extra")).toBe(false);
    expect(authorizeCron(null)).toBe(false);
    expect(authorizeCron("")).toBe(false);
  });
});
