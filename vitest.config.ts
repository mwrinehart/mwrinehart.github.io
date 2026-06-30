import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

// Tests run in plain Node — they exercise pure/critical logic (classifiers,
// crypto, gates, the block-repair gate) without a database. The `@` alias mirrors
// tsconfig's path mapping so modules that internally import `@/lib/...` resolve.
export default defineConfig({
  resolve: {
    alias: { "@": fileURLToPath(new URL(".", import.meta.url)) },
  },
  test: {
    environment: "node",
    include: ["**/*.test.ts"],
    exclude: ["node_modules/**", ".next/**"],
  },
});
