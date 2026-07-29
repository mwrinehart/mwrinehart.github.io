"use client";

// Scoped-team selector used by every team-centric admin page. Navigates via
// ?team=<id> so pages stay server-rendered; indentation mirrors the sub-team
// hierarchy.

import { usePathname, useRouter, useSearchParams } from "next/navigation";

export interface TeamOption {
  id: string;
  name: string;
  depth: number;
}

export function TeamPicker({ teams, selectedId }: { teams: TeamOption[]; selectedId: string }) {
  const router = useRouter();
  const pathname = usePathname();
  const search = useSearchParams();

  return (
    <label className="flex items-center gap-2 text-sm">
      <span className="font-semibold text-lc-muted">Team</span>
      <select
        className="rounded-lg border border-lc-line bg-white px-3 py-2 text-sm font-medium text-lc-ink outline-none focus:border-lc-purple cursor-pointer max-w-72"
        value={selectedId}
        onChange={(e) => {
          const params = new URLSearchParams(search.toString());
          params.set("team", e.target.value);
          // Flash params belong to the previous action, not the new team.
          params.delete("ok");
          params.delete("error");
          router.push(`${pathname}?${params.toString()}`);
        }}
      >
        {teams.map((t) => (
          <option key={t.id} value={t.id}>
            {`${"— ".repeat(t.depth)}${t.name}`}
          </option>
        ))}
      </select>
    </label>
  );
}
