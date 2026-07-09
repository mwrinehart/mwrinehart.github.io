import { describe, expect, it } from "vitest";
import { createHash, generateKeyPairSync, verify as cryptoVerify } from "crypto";
import {
  buildDeviceAuthPayloadV3,
  classifyConnectFailure,
  defaultSessionKey,
  extractMessageText,
  normalizeDeviceMetadataForAuth,
  parseChatEventPayload,
  parseFrame,
} from "./protocol";
import { signDevicePayload } from "./identity";
import { normalizeGatewayUrl } from "./client";

describe("buildDeviceAuthPayloadV3", () => {
  // The gateway compares this payload byte-for-byte before checking the
  // signature — the field order and separators are the wire contract.
  it("joins fields with pipes in the openclaw field order", () => {
    expect(
      buildDeviceAuthPayloadV3({
        deviceId: "dev1",
        clientId: "cli",
        clientMode: "cli",
        role: "operator",
        scopes: ["operator.read", "operator.write"],
        signedAtMs: 1737264000000,
        token: "tok",
        nonce: "n0nce",
        platform: "Linux",
        deviceFamily: "Server",
      }),
    ).toBe("v3|dev1|cli|cli|operator|operator.read,operator.write|1737264000000|tok|n0nce|linux|server");
  });

  it("renders a missing token as an empty field and omitted metadata as empty", () => {
    expect(
      buildDeviceAuthPayloadV3({
        deviceId: "d",
        clientId: "cli",
        clientMode: "cli",
        role: "operator",
        scopes: [],
        signedAtMs: 1,
        token: null,
        nonce: "n",
      }),
    ).toBe("v3|d|cli|cli|operator||1||n||");
  });
});

describe("normalizeDeviceMetadataForAuth", () => {
  it("trims and lowercases ASCII only", () => {
    expect(normalizeDeviceMetadataForAuth("  MacOS ")).toBe("macos");
    expect(normalizeDeviceMetadataForAuth(undefined)).toBe("");
    expect(normalizeDeviceMetadataForAuth("   ")).toBe("");
  });
});

describe("signDevicePayload", () => {
  it("produces a base64url Ed25519 signature Node can verify", () => {
    const { privateKey, publicKey } = generateKeyPairSync("ed25519");
    const privateKeyPem = privateKey.export({ type: "pkcs8", format: "pem" }).toString();
    const payload = buildDeviceAuthPayloadV3({
      deviceId: "d",
      clientId: "cli",
      clientMode: "cli",
      role: "operator",
      scopes: ["operator.read"],
      signedAtMs: 42,
      token: "t",
      nonce: "n",
      platform: "linux",
    });
    const sig = signDevicePayload(privateKeyPem, payload);
    expect(sig).not.toMatch(/[+/=]/); // base64url, unpadded
    const raw = Buffer.from(sig.replace(/-/g, "+").replace(/_/g, "/"), "base64");
    expect(cryptoVerify(null, Buffer.from(payload, "utf8"), publicKey, raw)).toBe(true);
  });

  it("derives the deviceId as sha256 hex of the raw public key", () => {
    const { publicKey } = generateKeyPairSync("ed25519");
    const der = publicKey.export({ type: "spki", format: "der" });
    const fingerprint = createHash("sha256").update(der.subarray(der.length - 32)).digest("hex");
    expect(fingerprint).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe("parseFrame", () => {
  it("parses response and event frames and rejects junk", () => {
    expect(parseFrame(JSON.stringify({ type: "res", id: "1", ok: true, payload: { a: 1 } }))).toMatchObject({
      type: "res",
      id: "1",
      ok: true,
    });
    expect(parseFrame(JSON.stringify({ type: "event", event: "tick" }))).toMatchObject({ type: "event", event: "tick" });
    expect(parseFrame("not json")).toBeNull();
    expect(parseFrame(JSON.stringify({ type: "req", id: "1", method: "x" }))).toBeNull();
    expect(parseFrame(123 as unknown as string)).toBeNull();
  });
});

describe("parseChatEventPayload", () => {
  it("accepts delta/final/error payloads", () => {
    expect(
      parseChatEventPayload({ runId: "r", sessionKey: "agent:main:main", state: "delta", deltaText: "hi" }),
    ).toMatchObject({ runId: "r", state: "delta", deltaText: "hi" });
    expect(parseChatEventPayload({ runId: "r", sessionKey: "s", state: "final" })).toMatchObject({ state: "final" });
    expect(parseChatEventPayload({ runId: "r", sessionKey: "s", state: "bogus" })).toBeNull();
    expect(parseChatEventPayload(null)).toBeNull();
    expect(parseChatEventPayload({ sessionKey: "s", state: "final" })).toBeNull();
  });
});

describe("extractMessageText", () => {
  it("handles string content, text field, and part arrays", () => {
    expect(extractMessageText({ content: "plain" })).toBe("plain");
    expect(extractMessageText({ text: "t" })).toBe("t");
    expect(
      extractMessageText({ content: [{ type: "text", text: "a" }, { type: "image" }, { type: "text", text: "b" }] }),
    ).toBe("a\nb");
    expect(extractMessageText(null)).toBe("");
    expect(extractMessageText("nope")).toBe("");
  });
});

describe("classifyConnectFailure", () => {
  it("maps gateway refusals to actionable statuses", () => {
    expect(classifyConnectFailure("gateway refused connection: pairing required (request abc)")).toBe("pairing_pending");
    expect(classifyConnectFailure("invalid token")).toBe("unauthorized");
    expect(classifyConnectFailure("Unauthorized")).toBe("unauthorized");
    expect(classifyConnectFailure("could not reach gateway at ws://x")).toBe("unreachable");
  });
});

describe("defaultSessionKey", () => {
  it("uses the gateway-reported main key for the default agent", () => {
    expect(defaultSessionKey("main", "main", "agent:main:main")).toBe("agent:main:main");
  });
  it("builds agent:<id>:main for other agents", () => {
    expect(defaultSessionKey("research", "main", "agent:main:main")).toBe("agent:research:main");
    expect(defaultSessionKey("main")).toBe("agent:main:main");
  });
});

describe("normalizeGatewayUrl", () => {
  it("normalizes bare hosts and http(s) schemes to ws(s)", () => {
    expect(normalizeGatewayUrl("myhost:18789")).toBe("ws://myhost:18789");
    expect(normalizeGatewayUrl("ws://myhost:18789/")).toBe("ws://myhost:18789");
    expect(normalizeGatewayUrl("https://gw.example.com")).toBe("wss://gw.example.com");
    expect(normalizeGatewayUrl("http://gw.example.com")).toBe("ws://gw.example.com");
    expect(normalizeGatewayUrl("  wss://gw.example.com  ")).toBe("wss://gw.example.com");
  });
});
