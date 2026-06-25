// Public widget data feed — returns an org's active device nudges, scoped by the
// opaque widget key (no session). CORS-open so it can be embedded cross-origin on
// a customer intranet. Content is org-authored, non-sensitive reminder text.

import type { NextRequest } from "next/server";
import { resolveOrgIdByWidgetKey } from "@/lib/platform/orgs";
import { listActiveDeviceNudges } from "@/lib/modules/behavior/nudges";

const CORS: Record<string, string> = {
  "access-control-allow-origin": "*",
  "cache-control": "public, max-age=60",
};

export async function GET(_req: NextRequest, ctx: { params: Promise<{ key: string }> }) {
  const { key } = await ctx.params;
  const orgId = await resolveOrgIdByWidgetKey(key);
  if (!orgId) return Response.json({ nudges: [] }, { status: 404, headers: CORS });
  const nudges = await listActiveDeviceNudges(orgId);
  return Response.json({ nudges }, { headers: CORS });
}
