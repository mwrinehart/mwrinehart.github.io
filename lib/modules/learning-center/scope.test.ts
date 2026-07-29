import { describe, expect, it } from "vitest";
import { buildTeamTree, descendantTeamIds, flattenTeamTree, scopedTeamIds } from "./scope";
import type { LitmosTeam } from "./types";

const TEAMS: LitmosTeam[] = [
  { Id: "a", Name: "Acme", ParentTeamId: null },
  { Id: "a1", Name: "Engineering", ParentTeamId: "a" },
  { Id: "a1x", Name: "Platform", ParentTeamId: "a1" },
  { Id: "a2", Name: "Sales", ParentTeamId: "a" },
  { Id: "b", Name: "Beta Corp", ParentTeamId: null },
  { Id: "b1", Name: "Ops", ParentTeamId: "b" },
];

describe("descendantTeamIds", () => {
  it("walks the whole subtree", () => {
    expect(descendantTeamIds(TEAMS, ["a"]).sort()).toEqual(["a1", "a1x", "a2"]);
  });

  it("excludes the roots themselves and unrelated trees", () => {
    const ids = descendantTeamIds(TEAMS, ["a1"]);
    expect(ids).toEqual(["a1x"]);
    expect(ids).not.toContain("b1");
  });

  it("survives parent cycles without hanging", () => {
    const cyclic: LitmosTeam[] = [
      { Id: "x", Name: "X", ParentTeamId: "y" },
      { Id: "y", Name: "Y", ParentTeamId: "x" },
    ];
    expect(descendantTeamIds(cyclic, ["x"])).toEqual(["y"]);
  });
});

describe("scopedTeamIds", () => {
  it("returns admin teams plus descendants, deduped", () => {
    expect(scopedTeamIds(TEAMS, ["a1", "a1x"]).sort()).toEqual(["a1", "a1x"]);
    expect(scopedTeamIds(TEAMS, ["a"]).sort()).toEqual(["a", "a1", "a1x", "a2"]);
  });

  it("ignores team ids that no longer exist in Litmos", () => {
    expect(scopedTeamIds(TEAMS, ["ghost"])).toEqual([]);
  });
});

describe("buildTeamTree / flattenTeamTree", () => {
  it("roots scope teams whose parent is outside the scope", () => {
    const tree = buildTeamTree(TEAMS, ["a1", "a1x"]);
    expect(tree).toHaveLength(1);
    expect(tree[0].team.Id).toBe("a1");
    expect(tree[0].children[0].team.Id).toBe("a1x");
    const flat = flattenTeamTree(tree);
    expect(flat).toEqual([
      { id: "a1", name: "Engineering", depth: 0 },
      { id: "a1x", name: "Platform", depth: 1 },
    ]);
  });

  it("sorts siblings by name", () => {
    const tree = buildTeamTree(TEAMS, ["a", "a1", "a2", "a1x"]);
    expect(tree[0].children.map((c) => c.team.Name)).toEqual(["Engineering", "Sales"]);
  });
});
