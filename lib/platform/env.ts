// Small typed accessors for environment configuration. Centralised so feature
// flags (dev login, SSO selection, admin emails) read consistently everywhere.

export function str(name: string): string | null {
  const v = process.env[name];
  if (typeof v !== "string") return null;
  const t = v.trim();
  return t || null;
}

export function bool(name: string): boolean {
  return str(name) === "1" || str(name)?.toLowerCase() === "true";
}

export function list(name: string): string[] {
  return (str(name) ?? "")
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
}

export const isProd = process.env.NODE_ENV === "production";
