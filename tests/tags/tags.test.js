// Blank tags (ADR 0018 point 10): minted per home, bound on site, rebound.
import { describe, expect, it } from "vitest";
import { marshall, unmarshall } from "@aws-sdk/util-dynamodb";
import { ConditionalCheckFailedException } from "@aws-sdk/client-dynamodb";
import { TAG_ID, bindTag, getTag, mintTagId, mintTags, publicTag, useTagDdb } from "../../amplify/functions/configurations-shared/tags.ts";
import { BadRequest } from "../../amplify/functions/configurations-shared/rules.ts";

process.env.HOME_TAGS_TABLE_NAME = "HomeTags";
const rows = new Map();
let collide = 0;
useTagDdb({
  async send(cmd) {
    const i = cmd.input, name = cmd.constructor.name;
    if (name === "PutItemCommand") {
      const item = unmarshall(i.Item);
      if (collide > 0) { collide--; throw new ConditionalCheckFailedException({ message: "taken", $metadata: {} }); }
      if (rows.has(item.tagId)) throw new ConditionalCheckFailedException({ message: "taken", $metadata: {} });
      rows.set(item.tagId, item);
      return {};
    }
    if (name === "GetItemCommand") {
      const r = rows.get(unmarshall(i.Key).tagId);
      return r ? { Item: marshall(r, { removeUndefinedValues: true }) } : {};
    }
    if (name === "UpdateItemCommand") {
      const k = unmarshall(i.Key).tagId, v = unmarshall(i.ExpressionAttributeValues);
      const r = rows.get(k);
      if (!r || r.homeId !== v[":home"]) throw new ConditionalCheckFailedException({ message: "no", $metadata: {} });
      Object.assign(r, { item: v[":i"], boundAt: v[":at"], boundBy: v[":by"], history: v[":h"] });
      return {};
    }
    throw new Error(`fake: ${name}`);
  },
});

describe("blank tags", () => {
  it("mints well-formed, distinct ids for one home, drawing again on a collision", async () => {
    expect(TAG_ID.test(mintTagId())).toBe(true);
    collide = 2;
    const { tags } = await mintTags("h-abcdefghjk", 5, "user:a");
    expect(tags).toHaveLength(5);
    expect(new Set(tags).size).toBe(5);
    expect((await getTag(tags[0])).homeId).toBe("h-abcdefghjk");
    await expect(mintTags("h-abcdefghjk", 0, "user:a")).rejects.toThrow(BadRequest);
    await expect(mintTags("h-abcdefghjk", 201, "user:a")).rejects.toThrow(BadRequest);
  });

  it("binds, rebinds and unbinds, keeping what it was", async () => {
    const { tags: [t] } = await mintTags("h-abcdefghjk", 1, "edge:e-1");
    expect((await getTag(t)).item).toBe(null);
    await bindTag(await getTag(t), "pt-kitchen1", "user:a");
    expect(publicTag(await getTag(t))).toMatchObject({ tagId: t, homeId: "h-abcdefghjk", item: "pt-kitchen1" });
    await bindTag(await getTag(t), "circuit-abcdefgh", "user:a");
    await bindTag(await getTag(t), "", "user:a");
    const row = await getTag(t);
    expect(row.item).toBe(null);
    expect(row.history.map((h) => h.item)).toEqual([null, "pt-kitchen1", "circuit-abcdefgh"]);
    expect(publicTag(row)).not.toHaveProperty("history");
    await expect(bindTag(row, "Not An Id", "user:a")).rejects.toThrow(BadRequest);
  });

  it("refuses ids that are not tags, and answers null for an unknown one", async () => {
    await expect(getTag("h-abcdefghjk")).rejects.toThrow(BadRequest);
    expect(await getTag("t-zzzzzzzzzz")).toBe(null);
  });
});
