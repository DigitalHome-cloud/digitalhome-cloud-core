// Two kinds of edge (ADR 0020): the kind, the homes a pro edge reports.
import { describe, expect, it } from "vitest";
import { cleanWorkHomes, kindOf, workHomesFor } from "../../amplify/functions/edge-shared/kinds.ts";

const A = "h-abcdefghjk";
const B = "h-mnpqrstuvw";
const C = "h-xyz2345678";

describe("edge kinds", () => {
  it("takes the reported kind, else reads the tool name, else none", () => {
    expect(kindOf("pro")).toBe("pro");
    expect(kindOf("devops", "digitalhome-pro-edge 1.0")).toBe("devops");
    expect(kindOf("robot")).toBe(null);
    expect(kindOf(undefined, "digitalhome-pro-edge 0.9.1")).toBe("pro");
    expect(kindOf(undefined, "digitalhome-devops-edge 2.1")).toBe("devops");
    expect(kindOf(undefined, "something-else 1")).toBe(null);
  });

  it("keeps well-formed homeIds once, at most fifty, and nothing when none is reported", () => {
    expect(cleanWorkHomes(undefined)).toBe(null);
    expect(cleanWorkHomes([A, A, "DE-80331-MAR12-01", 7, B])).toEqual([A, B]);
    expect(cleanWorkHomes([])).toEqual([]);
    const many = Array.from({ length: 60 }, (_, i) => `h-${"abcdefghjk".slice(0, 8)}${"23456789ab"[i % 10]}${"cdefghjkmn"[Math.floor(i / 10)]}`);
    expect(cleanWorkHomes(many).length).toBe(50);
  });

  it("names back only the viewer's own homes, in the edge's order", () => {
    const homes = [
      { smartHomeId: "XX-1", homeId: A, owners: ["me"] },
      { smartHomeId: "XX-2", homeId: B, owners: ["someone"] },
      { smartHomeId: "XX-3", homeId: C, owners: ["me", "someone"] },
    ];
    expect(workHomesFor([C, B, A], homes, { sub: "me" })).toEqual(["XX-3", "XX-1"]);
    expect(workHomesFor([C, B, A], homes, { sub: "nobody", admin: true })).toEqual(["XX-3", "XX-2", "XX-1"]);
    expect(workHomesFor(undefined, homes, { sub: "me" })).toEqual([]);
  });
});
