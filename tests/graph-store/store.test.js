// graph-store: the versioned Turtle graphs behind the marketplace and the
// board templates, against in-memory DynamoDB and S3.
import { beforeEach, describe, expect, it } from "vitest";
import { BadRequest, GraphStore } from "../../amplify/functions/graph-store/store.ts";
import { BadRequest as MarketBadRequest } from "../../amplify/functions/market-shared/rules.ts";
import * as market from "../../amplify/functions/market-shared/store.ts";
import { fakeClients } from "./fakes.js";

process.env.MARKET_SELLER_TABLE_NAME = "MarketSeller";
process.env.STORAGE_BUCKET_NAME = "bucket";

const okVerdict = async (ttl) => ({ ok: true, problems: [], triples: ttl.split("\n").filter(Boolean).length, counts: { things: 2 } });
const badVerdict = async () => ({ ok: false, problems: ["no good"], triples: 0 });

describe("graph-store: a versioned graph per id", () => {
  let f, store;
  beforeEach(() => {
    f = fakeClients();
    f.rows.set("set-a", { id: "set-a", version: 0 });
    store = new GraphStore({ area: "templates", table: () => "T", bucket: () => "bucket", validate: okVerdict, clients: f.clients });
  });

  it("saves in two steps, keeps each version as its own object, and removes the staged one", async () => {
    const up = await store.stageUpload("set-a");
    expect(up.key).toMatch(/^templates\/staging\/set-a\/[0-9a-f]{32}\.ttl$/);
    f.objects.set(up.key, "a\nb\n");
    const r = await store.commit(await store.get("set-a"), up.key, 0, "user:x");
    expect(r).toEqual({ status: "ok", version: 1, triples: 2, counts: { things: 2 } });
    const row = f.rows.get("set-a");
    expect(row).toMatchObject({ version: 1, triples: 2, things: 2, updatedBy: "user:x" });
    expect(row.s3Key).toMatch(/^templates\/graphs\/set-a\/v1-[0-9a-f]{32}\.ttl$/);
    expect(f.objects.has(up.key)).toBe(false);
    expect(await store.read(row)).toBe("a\nb\n");
    const second = await store.write(row, "c\n", "user:x");
    expect(second.status).toBe("ok");
    expect(f.objects.has(row.s3Key)).toBe(true);                 // v1 stays as history
  });

  it("answers a stale version with the current one, and writes nothing", async () => {
    await store.write(await store.get("set-a"), "a\n", "user:x");
    const before = f.objects.size;
    const up = await store.stageUpload("set-a");
    f.objects.set(up.key, "b\n");
    const r = await store.commit(await store.get("set-a"), up.key, 0, "user:y");
    expect(r.status).toBe("conflict");
    expect(r.current.version).toBe(1);
    expect(f.objects.size).toBe(before);
  });

  it("loses a race cleanly: the conditional update fails, its object is removed", async () => {
    const stale = await store.get("set-a");
    await store.write(await store.get("set-a"), "a\n", "user:x");    // someone else wins
    const objects = f.objects.size;
    const r = await store.write(stale, "b\n", "user:y");             // still thinks version 0
    expect(r.status).toBe("conflict");
    expect(f.objects.size).toBe(objects);
  });

  it("refuses what the validator refuses", async () => {
    const strict = new GraphStore({ area: "templates", table: () => "T", bucket: () => "bucket", validate: badVerdict, clients: f.clients });
    const r = await strict.write(await strict.get("set-a"), "x\n", "user:x");
    expect(r).toEqual({ status: "invalid", problems: ["no good"] });
    expect(f.rows.get("set-a").version).toBe(0);
  });

  it("refuses a key that is not this graph's staging key, and bad ids", async () => {
    const row = await store.get("set-a");
    await expect(store.commit(row, "templates/staging/set-b/" + "0".repeat(32) + ".ttl", 0, "u")).rejects.toThrow(BadRequest);
    await expect(store.commit(row, "market/staging/set-a/" + "0".repeat(32) + ".ttl", 0, "u")).rejects.toThrow(BadRequest);
    await expect(store.commit(row, "templates/staging/set-a/" + "0".repeat(32) + ".ttl", 0, "u")).rejects.toThrow(/nothing was uploaded/);
    expect(() => store.id("Bad_Id")).toThrow(BadRequest);
  });

  it("throws the same BadRequest the market handlers catch", () => {
    expect(BadRequest).toBe(MarketBadRequest);
  });
});

describe("the marketplace on graph-store", () => {
  let f;
  beforeEach(() => {
    f = fakeClients();
    market.useClients(f.clients);
    f.rows.set("maker-a", { id: "maker-a", name: "Maker A", kind: "manufacturer", version: 0, articles: 0 });
  });

  const ARTICLE = `@prefix dhp: <https://digitalhome.cloud/pro#> .
<https://digitalhome.cloud/id/market/maker-a/RCD-1> a dhp:Article ; dhp:reference "RCD-1" .
`;

  it("keeps its save result: version and article count", async () => {
    const s = await market.getSeller("maker-a");
    const r = await market.writeGraph(s, ARTICLE, "user:x");
    expect(r).toEqual({ status: "ok", version: 1, triples: 2, articles: 1 });
    expect(f.rows.get("maker-a")).toMatchObject({ version: 1, articles: 1 });
    expect(f.rows.get("maker-a").s3Key).toMatch(/^market\/graphs\/maker-a\/v1-/);
    expect(await market.readGraph(f.rows.get("maker-a"))).toBe(ARTICLE);
  });

  it("keeps its two-step save and conflict", async () => {
    const s = await market.getSeller("maker-a");
    const up = await market.stageUpload(s);
    expect(up.key).toMatch(/^market\/staging\/maker-a\//);
    f.objects.set(up.key, ARTICLE);
    expect((await market.commit(s, up.key, 0, "user:x")).status).toBe("ok");
    const again = await market.stageUpload(s);
    f.objects.set(again.key, ARTICLE);
    const r = await market.commit(await market.getSeller("maker-a"), again.key, 0, "user:y");
    expect(r.status).toBe("conflict");
    expect(r.current.version).toBe(1);
  });

  it("still refuses a catalogue with a price", async () => {
    const r = await market.writeGraph(await market.getSeller("maker-a"),
      ARTICLE.replace(' .\n', ' ; dhp:price "12" .\n'), "user:x");
    expect(r.status).toBe("invalid");
  });

  it("lists sellers sorted", async () => {
    f.rows.set("aaa-first", { id: "aaa-first", name: "A", kind: "platform", version: 0 });
    expect((await market.listSellers()).map((s) => s.id)).toEqual(["aaa-first", "maker-a"]);
  });
});
