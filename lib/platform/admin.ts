// Platform-admin helpers. Admin status is driven entirely by the
// PLATFORM_ADMIN_EMAILS env list, re-checked on every call (so revoking an
// email immediately removes access). Mirrors Make's lib/admin.ts contract.

import { eq } from "drizzle-orm";
import { db } from "./db";
import { users, type UserRow } from "./db/schema";
import { list } from "./env";

export function isPlatformAdmin(email: string | null | undefined): boolean {
  if (!email) return false;
  return list("PLATFORM_ADMIN_EMAILS").includes(email.toLowerCase());
}

export async function getUserById(id: string): Promise<UserRow | null> {
  const rows = await db.select().from(users).where(eq(users.id, id));
  return rows[0] ?? null;
}
