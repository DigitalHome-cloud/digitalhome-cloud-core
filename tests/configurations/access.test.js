// Who may use a home's configurations (ADR 0018): owners and admins in the
// Portal; through an edge, its linked home or the linking person's homes.
import { describe, expect, it } from "vitest";
import { marshall, unmarshall } from "@aws-sdk/util-dynamodb";
import { Forbidden, homeForEdge, homeForPerson, useDdb } from "../../amplify/functions/configurations-shared/access.ts";
import { BadRequest } from "../../amplify/functions/configurations-shared/rules.ts";

process.env.DIGITALHOME_TABLE_NAME = "DigitalHome";
const homes = [
  { smartHomeId: "FR-00000-ABC1-01", homeId: "h-abcdefghjk", owners: ["sub-a"] },
  { smartHomeId: "FR-00000-XYZ2-01", homeId: "h-bbbbbbbbbb", owners: ["sub-b"] },
];
useDdb({
  async send(cmd) {
    const want = unmarshall(cmd.input.ExpressionAttributeValues)[":h"];
    return { Items: homes.filter((h) => h.homeId === want).map((h) => marshall(h)) };
  },
});

describe("configurations: access", () => {
  it("lets owners and admins in, and nobody else", async () => {
    expect((await homeForPerson("h-abcdefghjk", { sub: "sub-a" })).smartHomeId).toBe("FR-00000-ABC1-01");
    await expect(homeForPerson("h-abcdefghjk", { sub: "sub-b" })).rejects.toThrow(Forbidden);
    expect((await homeForPerson("h-abcdefghjk", { sub: "sub-x", groups: ["dhc-admins"] })).homeId).toBe("h-abcdefghjk");
    await expect(homeForPerson("FR-00000-ABC1-01", { sub: "sub-a" })).rejects.toThrow(BadRequest);
    await expect(homeForPerson("h-cccccccccc", { sub: "sub-a" })).rejects.toThrow(/no home/);
  });

  it("lets an edge use its linked home and its person's homes", async () => {
    expect((await homeForEdge("h-bbbbbbbbbb", { home_id: "FR-00000-XYZ2-01", linked_by_cognito_sub: "sub-a" })).homeId).toBe("h-bbbbbbbbbb");
    expect((await homeForEdge("h-abcdefghjk", { home_id: "FR-00000-XYZ2-01", linked_by_cognito_sub: "sub-a" })).homeId).toBe("h-abcdefghjk");
    await expect(homeForEdge("h-abcdefghjk", { home_id: "FR-00000-XYZ2-01", linked_by_cognito_sub: "sub-b" })).rejects.toThrow(Forbidden);
  });
});
