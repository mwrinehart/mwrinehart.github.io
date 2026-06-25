import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Self-contained server bundle for the Droplet Docker image (.next/standalone).
  output: "standalone",
  // Keep native / heavy server-only packages out of the bundle so they load
  // from node_modules at runtime. `pg` is native; more will be added here as
  // modules port their heavy server deps (doc parsers, saml-jackson, etc.).
  serverExternalPackages: ["pg"],
  outputFileTracingIncludes: {
    "/*": ["./node_modules/jose/**/*", "./node_modules/openid-client/**/*"],
  },
};

export default nextConfig;
