import { describe, expect, it } from "vitest";
import { LITMOS_DEFAULT_BASE, extractLitmosArray, normalizeLitmosBase } from "./litmos";

describe("normalizeLitmosBase", () => {
  it("falls back to the default base for empty/null/whitespace", () => {
    expect(normalizeLitmosBase(null)).toBe(LITMOS_DEFAULT_BASE);
    expect(normalizeLitmosBase(undefined)).toBe(LITMOS_DEFAULT_BASE);
    expect(normalizeLitmosBase("")).toBe(LITMOS_DEFAULT_BASE);
    expect(normalizeLitmosBase("   ")).toBe(LITMOS_DEFAULT_BASE);
  });

  it("leaves a base already containing /v1.svc untouched apart from trailing slashes", () => {
    expect(normalizeLitmosBase("https://api.litmos.com/v1.svc")).toBe("https://api.litmos.com/v1.svc");
    expect(normalizeLitmosBase("https://api.litmos.com/v1.svc/")).toBe("https://api.litmos.com/v1.svc");
    expect(normalizeLitmosBase("https://api.litmos.com/v1.svc///")).toBe("https://api.litmos.com/v1.svc");
  });

  it("appends /v1.svc to a bare regional host", () => {
    expect(normalizeLitmosBase("https://api-eu.litmos.com")).toBe("https://api-eu.litmos.com/v1.svc");
    expect(normalizeLitmosBase("https://api-eu.litmos.com/")).toBe("https://api-eu.litmos.com/v1.svc");
    expect(normalizeLitmosBase("https://api.litmos.com.au//")).toBe("https://api.litmos.com.au/v1.svc");
  });
});

describe("extractLitmosArray", () => {
  const rows = [{ Id: "1" }, { Id: "2" }];

  it("passes a bare array through", () => {
    expect(extractLitmosArray(rows)).toEqual(rows);
    expect(extractLitmosArray([])).toEqual([]);
  });

  it("unwraps known envelope keys", () => {
    expect(extractLitmosArray({ Items: rows })).toEqual(rows);
    expect(extractLitmosArray({ Users: rows })).toEqual(rows);
    expect(extractLitmosArray({ data: rows })).toEqual(rows);
  });

  it("returns [] for junk and null-ish input", () => {
    expect(extractLitmosArray(null)).toEqual([]);
    expect(extractLitmosArray(undefined)).toEqual([]);
    expect(extractLitmosArray("not an array")).toEqual([]);
    expect(extractLitmosArray(42)).toEqual([]);
    expect(extractLitmosArray({ foo: "bar" })).toEqual([]);
    expect(extractLitmosArray({ Items: "still not an array" })).toEqual([]);
  });
});
