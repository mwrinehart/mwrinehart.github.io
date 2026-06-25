// The module registry — the single source of truth for what products live in the
// platform, their navigation, and which source app each was rebuilt from. This is
// client-safe (no server imports) so it can drive the sidebar, the dashboard, and
// per-org module entitlements.
//
// To add/port a module: add an entry here, create lib/modules/<id>/ (schema +
// migrate + logic), and add a route group under app/(app)/<id>/.

export type ModuleStatus = "live" | "scaffold" | "planned";

export interface ModuleDef {
  id: string;
  label: string;
  /** One-line description shown on the dashboard. */
  blurb: string;
  /** Emoji used as a lightweight icon in the nav (swapped for real icons later). */
  icon: string;
  /** Route base under the (app) group. */
  href: string;
  /** Which source app this module is rebuilt from. */
  sourceApp: string;
  status: ModuleStatus;
}

export const MODULES: ModuleDef[] = [
  {
    id: "behavior",
    label: "Behavior",
    blurb: "Human-risk management: risk scoring, behaviors, training nudges, and threat pulse.",
    icon: "🛡️",
    href: "/behavior",
    sourceApp: "CBM-Next",
    status: "live",
  },
  {
    id: "compliance",
    label: "Compliance",
    blurb: "Regulatory & threat-feed scanning with policy mapping and alerting.",
    icon: "📡",
    href: "/compliance",
    sourceApp: "Horizon Scanner",
    status: "live",
  },
  {
    id: "studio",
    label: "Studio",
    blurb: "AI media generation and eLearning authoring (video, voice, avatars, SCORM/xAPI).",
    icon: "🎬",
    href: "/studio",
    sourceApp: "Make (Content Studio)",
    status: "planned",
  },
  {
    id: "campaigns",
    label: "Campaigns",
    blurb: "Narrative campaign simulation with personas, approval gates, and audit trails.",
    icon: "🎭",
    href: "/campaigns",
    sourceApp: "Mirage",
    status: "planned",
  },
];

export function getModule(id: string): ModuleDef | undefined {
  return MODULES.find((m) => m.id === id);
}
