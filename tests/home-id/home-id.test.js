// The home's permanent, meaningless id (ADR 0018).
import { describe, expect, it } from "vitest";
import { ConditionalCheckFailedException } from "@aws-sdk/client-dynamodb";
import { marshall, unmarshall } from "@aws-sdk/util-dynamodb";
import { ALPHABET, HOME_ID, ensureHomeId, findByHomeId, mayUse, mintHomeId } from "../../amplify/functions/home-id/home-id.ts";

// A DigitalHome table keyed on smartHomeId, honouring the one condition
// ensureHomeId sends.
function homesTable(rows) {
  const byId = new Map(rows.map((r) => [r.smartHomeId, { ...r }]));
  return {
    byId,
    async send(cmd) {
      const name = cmd.constructor.name, input = cmd.input;
      if (name === "GetItemCommand") {
        const r = byId.get(unmarshall(input.Key).smartHomeId);
        return r ? { Item: marshall(r) } : {};
      }
      if (name === "UpdateItemCommand") {
        const r = byId.get(unmarshall(input.Key).smartHomeId);
        if (!r || r.homeId) throw new ConditionalCheckFailedException({ message: "condition", $metadata: {} });
        r.homeId = unmarshall(input.ExpressionAttributeValues)[":h"];
        return {};
      }
      if (name === "ScanCommand") {
        const want = unmarshall(input.ExpressionAttributeValues)[":h"];
        return { Items: [...byId.values()].filter((r) => r.homeId === want).map((r) => marshall(r)) };
      }
      throw new Error(`fake ddb: ${name}`);
    },
  };
}

describe("home-id: minted, meaningless, permanent", () => {
  it("is h- and ten readable characters, and does not repeat", () => {
    const seen = new Set();
    for (let i = 0; i < 5000; i++) {
      const id = mintHomeId();
      expect(id).toMatch(HOME_ID);
      seen.add(id);
    }
    expect(seen.size).toBe(5000);
    expect(ALPHABET).not.toMatch(/[01loi]/);
  });

  it("is minted once for a home that has none, and kept after", async () => {
    const t = homesTable([{ smartHomeId: "FR-00000-ABC1-01", owners: ["sub-a"] }]);
    const row = { smartHomeId: "FR-00000-ABC1-01" };
    const id = await ensureHomeId(t, "DigitalHome", row);
    expect(id).toMatch(HOME_ID);
    expect(t.byId.get("FR-00000-ABC1-01").homeId).toBe(id);
    expect(await ensureHomeId(t, "DigitalHome", { smartHomeId: "FR-00000-ABC1-01" })).toBe(id);
  });

  it("takes the id another function minted first", async () => {
    const t = homesTable([{ smartHomeId: "FR-00000-ABC1-01", homeId: "h-abcdefghjk" }]);
    expect(await ensureHomeId(t, "DigitalHome", { smartHomeId: "FR-00000-ABC1-01" })).toBe("h-abcdefghjk");
    await expect(ensureHomeId(t, "DigitalHome", { smartHomeId: "FR-NOPE" })).rejects.toThrow(/not found/);
  });

  it("finds a home by its id, and says who may use it", async () => {
    const t = homesTable([{ smartHomeId: "FR-00000-ABC1-01", homeId: "h-abcdefghjk", owners: ["sub-a"] }]);
    const home = await findByHomeId(t, "DigitalHome", "h-abcdefghjk");
    expect(home.smartHomeId).toBe("FR-00000-ABC1-01");
    expect(await findByHomeId(t, "DigitalHome", "FR-00000-ABC1-01")).toBeNull();
    expect(mayUse(home, { sub: "sub-a" })).toBe(true);
    expect(mayUse(home, { sub: "sub-b" })).toBe(false);
    expect(mayUse(home, { sub: "sub-b", groups: ["dhc-admins"] })).toBe(true);
  });
});
