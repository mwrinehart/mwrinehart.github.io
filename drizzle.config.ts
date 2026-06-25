import type { Config } from "drizzle-kit";

// Drizzle Kit reads every module's schema plus the platform schema. As modules
// are ported they add their tables to lib/modules/<name>/schema.ts, which the
// aggregate at lib/platform/db/schema.ts re-exports.
export default {
  schema: "./lib/platform/db/schema.ts",
  out: "./drizzle",
  dialect: "postgresql",
  dbCredentials: {
    url: process.env.DATABASE_URL || "postgres://postgres:postgres@localhost:5432/jericho",
  },
} satisfies Config;
