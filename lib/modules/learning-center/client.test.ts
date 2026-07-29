import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { LiveLitmosSource, buildUserRecord, extractArray, litmosErrorMessage } from "./client";
import { LitmosError } from "./types";

const CREDS = { base: "https://api.litmos.com/v1.svc", apiKey: "test-key", source: "jericho-test" };

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

describe("extractArray", () => {
  it("passes bare arrays through", () => {
    expect(extractArray([{ Id: "1" }])).toEqual([{ Id: "1" }]);
  });

  it("unwraps known envelope keys", () => {
    expect(extractArray({ Items: [{ Id: "1" }] })).toEqual([{ Id: "1" }]);
    expect(extractArray({ Users: [{ Id: "2" }] })).toEqual([{ Id: "2" }]);
    expect(extractArray({ value: [{ Id: "3" }] })).toEqual([{ Id: "3" }]);
  });

  it("returns [] for non-arrays", () => {
    expect(extractArray(null)).toEqual([]);
    expect(extractArray("x")).toEqual([]);
    expect(extractArray({ nope: 1 })).toEqual([]);
  });
});

describe("litmosErrorMessage", () => {
  it("prefers Litmos Message fields", () => {
    expect(litmosErrorMessage(409, { Message: "User exists" })).toBe("User exists");
    expect(litmosErrorMessage(400, { error: "bad" })).toBe("bad");
  });

  it("labels 503 as the rate limit", () => {
    expect(litmosErrorMessage(503, null)).toMatch(/rate limit/i);
  });
});

describe("buildUserRecord", () => {
  it("keeps the spec's field order (Litmos User schema)", () => {
    const record = buildUserRecord({ UserName: "a@b.co", FirstName: "A", LastName: "B", Email: "a@b.co" });
    const keys = Object.keys(record);
    expect(keys.slice(0, 12)).toEqual([
      "Id",
      "UserName",
      "FirstName",
      "LastName",
      "FullName",
      "Email",
      "AccessLevel",
      "DisableMessages",
      "Active",
      "Skype",
      "PhoneWork",
      "PhoneMobile",
    ]);
    expect(record.AccessLevel).toBe("Learner");
    expect(record.Active).toBe(true);
  });

  it("preserves existing profile fields on update instead of blanking them", () => {
    // Simulates updateUser's read-modify-write: a full record patched with one field.
    const current = {
      Id: "u1",
      UserName: "d@x.co",
      FirstName: "Dana",
      LastName: "K",
      Email: "d@x.co",
      Active: true,
      AccessLevel: "Learner",
      Street1: "1 Main St",
      City: "Boston",
      PhoneMobile: "555-1212",
      CustomField3: "dept-42",
      ExternalEmployeeId: "E-9",
    };
    const record = buildUserRecord({ ...current, Active: false });
    expect(record.Active).toBe(false);
    expect(record.Street1).toBe("1 Main St");
    expect(record.City).toBe("Boston");
    expect(record.PhoneMobile).toBe("555-1212");
    expect(record.CustomField3).toBe("dept-42");
    expect(record.ExternalEmployeeId).toBe("E-9");
  });
});

describe("LiveLitmosSource", () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it("sends apikey header plus source and format=json on every call", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse([]));
    const source = new LiveLitmosSource(CREDS);
    await source.listTeams();
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toContain("https://api.litmos.com/v1.svc/teams?");
    expect(url).toContain("source=jericho-test");
    expect(url).toContain("format=json");
    expect((init.headers as Record<string, string>).apikey).toBe("test-key");
  });

  it("pages with limit/start and stops on a short page", async () => {
    const page1 = Array.from({ length: 200 }, (_, i) => ({ Id: `u${i}` }));
    fetchMock.mockResolvedValueOnce(jsonResponse(page1)).mockResolvedValueOnce(jsonResponse([{ Id: "u200" }]));
    const source = new LiveLitmosSource(CREDS);
    const users = await source.listUsers();
    expect(users).toHaveLength(201);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(String(fetchMock.mock.calls[0][0])).toContain("start=0");
    expect(String(fetchMock.mock.calls[1][0])).toContain("start=200");
  });

  it("retries 503 (rate limit) with backoff and then succeeds", async () => {
    vi.useFakeTimers();
    fetchMock.mockResolvedValueOnce(jsonResponse({ Message: "rate" }, 503)).mockResolvedValueOnce(jsonResponse([{ Id: "t1", Name: "T" }]));
    const source = new LiveLitmosSource(CREDS);
    const promise = source.listTeams();
    await vi.advanceTimersByTimeAsync(1_100);
    await expect(promise).resolves.toEqual([{ Id: "t1", Name: "T" }]);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("does not retry non-503 errors and surfaces the Litmos message", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ Message: "User already exists" }, 409));
    const source = new LiveLitmosSource(CREDS);
    await expect(source.createUser({ FirstName: "A", LastName: "B", Email: "a@b.co" })).rejects.toThrowError("User already exists");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("updateUser reads the full record, merges the patch, and PUTs in order", async () => {
    fetchMock
      .mockResolvedValueOnce(
        jsonResponse({ Id: "u1", UserName: "old@x.co", FirstName: "Old", LastName: "Name", Email: "old@x.co", Active: true, AccessLevel: "Learner" }),
      )
      .mockResolvedValueOnce(new Response("", { status: 200 }));
    const source = new LiveLitmosSource(CREDS);
    await source.updateUser("u1", { FirstName: "New", Active: false });
    const [url, init] = fetchMock.mock.calls[1] as [string, RequestInit];
    expect(url).toContain("/users/u1?");
    expect(init.method).toBe("PUT");
    const body = JSON.parse(String(init.body)) as Record<string, unknown>;
    expect(body.FirstName).toBe("New");
    expect(body.LastName).toBe("Name");
    expect(body.Active).toBe(false);
    expect(Object.keys(body)[0]).toBe("Id");
  });

  it("returns null for 404 user lookups", async () => {
    fetchMock.mockResolvedValueOnce(new Response("", { status: 404 }));
    const source = new LiveLitmosSource(CREDS);
    await expect(source.getUser("missing")).resolves.toBeNull();
  });

  it("suppresses assignment email by default via sendmessage=false", async () => {
    fetchMock.mockResolvedValueOnce(new Response("", { status: 200 }));
    const source = new LiveLitmosSource(CREDS);
    await source.assignCoursesToUser("u1", ["c1"], false);
    expect(String(fetchMock.mock.calls[0][0])).toContain("sendmessage=false");
  });

  it("throws LitmosError with status for callers that branch on 403", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ Message: "Gamification not enabled" }, 403));
    const source = new LiveLitmosSource(CREDS);
    const err = await source.getUserGamificationSummary("u1").catch((e: unknown) => e);
    expect(err).toBeInstanceOf(LitmosError);
    expect((err as LitmosError).status).toBe(403);
  });
});
