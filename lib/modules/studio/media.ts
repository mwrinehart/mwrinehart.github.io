// Media library (rebuilt from Make's media assets). Generation (image/video/voice
// via ElevenLabs/fal/Synthesia/HeyGen) is gated behind provider keys that aren't
// wired here, so a generation request is recorded as `requested` with a note
// rather than silently doing nothing. Listing + the library work today.

import { randomUUID } from "crypto";
import { and, desc, eq } from "drizzle-orm";
import { db } from "@/lib/platform/db";
import { mediaAssets } from "./schema";

export function listAssets(orgId: string) {
  return db.select().from(mediaAssets).where(eq(mediaAssets.orgId, orgId)).orderBy(desc(mediaAssets.createdAt));
}

export async function requestAsset(
  orgId: string,
  userId: string,
  input: { kind: string; prompt: string },
): Promise<void> {
  await db.insert(mediaAssets).values({
    id: randomUUID(),
    orgId,
    kind: input.kind,
    prompt: input.prompt.trim(),
    status: "requested",
    note: "Generation pending — configure a media provider (ElevenLabs / fal / Synthesia / HeyGen) to fulfil this request.",
    createdByUserId: userId,
    createdAt: Date.now(),
  });
}

export async function deleteAsset(orgId: string, id: string): Promise<void> {
  await db.delete(mediaAssets).where(and(eq(mediaAssets.orgId, orgId), eq(mediaAssets.id, id)));
}
