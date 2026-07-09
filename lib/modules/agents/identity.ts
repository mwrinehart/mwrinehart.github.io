// ─── Agents module — org device identity ──────────────────────────────────────
//
// Each org gets ONE Ed25519 device identity, stored in the platform's encrypted
// org-secrets blob. Every OpenClaw gateway the org adds sees the same device, so
// the owner approves "Jericho Platform" once per gateway (pairing survives token
// edits and new gateways reuse the identity).
//
// Wire encodings mirror openclaw/src/infra/device-identity.ts:
//   deviceId  = sha256 hex of the raw 32-byte public key
//   publicKey = raw key bytes, base64url
//   signature = Ed25519 over the UTF-8 payload string, base64url

import { createHash, createPrivateKey, createPublicKey, generateKeyPairSync, sign as cryptoSign } from "crypto";
import { getOrgSecrets, setOrgSecrets } from "@/lib/platform/secrets";

const PRIVATE_KEY_SECRET = "openclaw.device.privateKeyPem";

export interface OrgDeviceIdentity {
  deviceId: string;
  publicKeyRawB64u: string;
  privateKeyPem: string;
}

function base64Url(buf: Buffer): string {
  return buf.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

// The SPKI DER for an Ed25519 key is a fixed 12-byte prefix + 32 raw key bytes.
function rawPublicKeyFromPem(publicKeyPem: string): Buffer {
  const der = createPublicKey(publicKeyPem).export({ type: "spki", format: "der" });
  return Buffer.from(der.subarray(der.length - 32));
}

function identityFromPrivateKeyPem(privateKeyPem: string): OrgDeviceIdentity {
  const publicKeyPem = createPublicKey(createPrivateKey(privateKeyPem))
    .export({ type: "spki", format: "pem" })
    .toString();
  const raw = rawPublicKeyFromPem(publicKeyPem);
  return {
    deviceId: createHash("sha256").update(raw).digest("hex"),
    publicKeyRawB64u: base64Url(raw),
    privateKeyPem,
  };
}

export async function getOrCreateDeviceIdentity(orgId: string): Promise<OrgDeviceIdentity> {
  const secrets = await getOrgSecrets(orgId);
  const existing = secrets[PRIVATE_KEY_SECRET];
  if (existing?.includes("BEGIN")) {
    try {
      return identityFromPrivateKeyPem(existing);
    } catch {
      // Corrupt key material: fall through and mint a fresh identity. The old
      // device simply stays unused on any gateway that approved it.
    }
  }
  const { privateKey } = generateKeyPairSync("ed25519");
  const privateKeyPem = privateKey.export({ type: "pkcs8", format: "pem" }).toString();
  await setOrgSecrets(orgId, { [PRIVATE_KEY_SECRET]: privateKeyPem });
  return identityFromPrivateKeyPem(privateKeyPem);
}

export function signDevicePayload(privateKeyPem: string, payload: string): string {
  const signature = cryptoSign(null, Buffer.from(payload, "utf8"), createPrivateKey(privateKeyPem));
  return base64Url(signature);
}
