// Litmos completion webhook (public — verified by HMAC, not a session).
// Litmos posts completion events here; the org is identified by ?org_id= and the
// payload is signed with HMAC-SHA256 over `${org_id}:${rawBody}` keyed by the
// org's Litmos API key (header X-Litmos-Signature, or Authorization: Bearer <sig>).

import type { NextRequest } from "next/server";
import { handleCompletion, verifyCompletionSignature, type CompletionPayload } from "@/lib/modules/behavior/litmos";

export async function POST(req: NextRequest) {
  const orgId = req.nextUrl.searchParams.get("org_id");
  if (!orgId) return Response.json({ error: "org_id required" }, { status: 400 });

  const rawBody = await req.text();
  const sig = req.headers.get("x-litmos-signature") ?? req.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ?? null;
  if (!(await verifyCompletionSignature(orgId, rawBody, sig))) {
    return Response.json({ error: "invalid signature" }, { status: 401 });
  }

  let payload: CompletionPayload;
  try {
    payload = JSON.parse(rawBody) as CompletionPayload;
  } catch {
    return Response.json({ error: "invalid json" }, { status: 400 });
  }

  const updated = await handleCompletion(orgId, payload);
  return Response.json({ ok: true, updated });
}
