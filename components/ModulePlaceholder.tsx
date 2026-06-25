import { PageHeader, Panel } from "@/components/ui";
import { getModule } from "@/lib/platform/modules";

// Renders a consistent "planned module" page: what it is, the source app it's
// rebuilt from, and the concrete capabilities to be ported. Keeps the platform
// navigable and honest while modules land one phase at a time.
export function ModulePlaceholder({ moduleId, capabilities }: { moduleId: string; capabilities: string[] }) {
  const m = getModule(moduleId);
  if (!m) return null;
  return (
    <>
      <PageHeader title={m.label} subtitle={m.blurb} />
      <Panel>
        <div className="flex items-center gap-2 text-sm">
          <span className="text-xl" aria-hidden>
            {m.icon}
          </span>
          <span className="text-jericho-muted">
            Rebuilt from <span className="text-jericho-text">{m.sourceApp}</span> · status:{" "}
            <span className="uppercase tracking-wide">{m.status}</span>
          </span>
        </div>
        <hr className="my-4 border-jericho-border" />
        <h3 className="font-medium mb-2">Capabilities to port</h3>
        <ul className="space-y-1.5 text-sm text-jericho-muted list-disc pl-5">
          {capabilities.map((c) => (
            <li key={c}>{c}</li>
          ))}
        </ul>
        <p className="text-xs text-jericho-muted mt-4">
          This module reuses the platform spine (auth, orgs, RBAC, encrypted secrets, notifications, feed engine, AI
          client) — only its domain logic and UI are net-new work.
        </p>
      </Panel>
    </>
  );
}
