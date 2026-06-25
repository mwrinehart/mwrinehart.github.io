// Runs once when the Next.js server boots (Node runtime only). Ensures the
// platform + module tables exist. Wrapped so the app still starts if the DB is
// unreachable in development — requests will surface the connection error.

export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  try {
    const { runMigrations } = await import("@/lib/platform/db");
    await runMigrations();
    console.log("[migrate] platform + module schema ready");
  } catch (err) {
    console.error("[migrate] skipped — database not ready:", err instanceof Error ? err.message : err);
  }
}
