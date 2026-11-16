// A home's configurations (darkfactory ADR 0018): one live version, legacy
// versions, planning options; majors by promote, minors by additions only.
// Every home and label here is invented.
import { beforeEach, describe, expect, it } from "vitest";
import {
  BadRequest, minorProblems, parse, parseVersion, splitOptionId, splitVersionId,
} from "../../amplify/functions/configurations-shared/rules.ts";
import { HomeConfigs } from "../../amplify/functions/configurations-shared/store.ts";
import { fakeAws } from "./fakes.js";

process.env.HOME_CONFIG_VERSIONS_TABLE_NAME = "HomeConfigVersions";
process.env.HOME_CONFIG_OPTIONS_TABLE_NAME = "HomeConfigOptions";
process.env.STORAGE_BUCKET_NAME = "bucket";

const H = "h-abcdefghjk";
const P = "@prefix dhc: <https://digitalhome.cloud/ontology#> . @prefix rdfs: <http://www.w3.org/2000/01/rdf-schema#> . @prefix i: <https://digitalhome.cloud/instance/x/> .\n";
const AS_IS = P + `
i:board a dhc:DistributionBoard ; rdfs:label "Fuse board" .
i:c1 a dhc:Circuit ; rdfs:label "Hob" ; dhc:hasProtection i:f1 .
i:f1 a dhc:ProtectionDevice ; rdfs:label "Hob fuse" .
`;
const SENSOR = `i:s1 a dhc:Sensor ; rdfs:label "Hall motion" ; dhc:onCircuit i:c1 .\n`;

describe("configurations: ids and the minor rule", () => {
  it("parses version and option ids, and refuses anything else", () => {
    expect(splitVersionId(`${H}-0002-0001`)).toEqual({ homeId: H, version: "0002-0001" });
    expect(splitOptionId(`${H}-p03`)).toEqual({ homeId: H, n: 3 });
    expect(parseVersion("0010-0002")).toEqual({ major: 10, minor: 2 });
    expect(() => splitVersionId("FR-00000-ABC1-01-0001-0000")).toThrow(BadRequest);
  });

  it("lets a minor add a component on the structure, and nothing else", () => {
    const live = parse(AS_IS);
    expect(minorProblems(live, parse(AS_IS + SENSOR))).toEqual([]);
    const rated = parse(AS_IS.replace('rdfs:label "Hob fuse"', 'rdfs:label "Hob fuse 20 A"'));
    expect(minorProblems(live, rated).join(" ")).toMatch(/removed or changed.*planning option/);
    const circuit = parse(AS_IS + `i:c2 a dhc:Circuit ; rdfs:label "Oven" ; dhc:hasProtection i:f1 .\n`);
    expect(minorProblems(live, circuit).join(" ")).toMatch(/new board, protection, circuit.*planning option/);
    expect(minorProblems(live, live)).toEqual(["nothing was added"]);
  });
});

describe("configurations: live, legacy and planning options", () => {
  let f, c;
  beforeEach(() => {
    f = fakeAws();
    c = new HomeConfigs(f.clients);
  });

  const stage = async (id, ttl) => {
    const up = await c.options.stageUpload(id);
    f.objects.set(up.key, ttl);
    return up.key;
  };

  it("seeds the first live configuration once", async () => {
    const r = await c.seedFirstLive(H, AS_IS, "user:a");
    expect(r).toMatchObject({ status: "ok", id: `${H}-0001-0000`, version: "0001-0000" });
    expect((await c.seedFirstLive(H, AS_IS, "user:a")).status).toBe("conflict");
    const [v] = await c.versions(H);
    expect(v).toMatchObject({ version: "0001-0000", status: "live", kind: "first", by: "user:a" });
    expect(await c.text(v.s3Key)).toBe(AS_IS);
    expect((await c.seedFirstLive("h-bbbbbbbbbb", "not turtle {", "user:a")).status).toBe("invalid");
  });

  it("adds a minor for an added component, and refuses a change as a minor", async () => {
    await c.seedFirstLive(H, AS_IS, "user:a");
    const r = await c.addMinor(H, AS_IS + SENSOR, "edge:e1");
    expect(r).toMatchObject({ status: "ok", version: "0001-0001", summary: "+1 node" });
    const bad = await c.addMinor(H, AS_IS.replace("Fuse board", "Board"), "edge:e1");
    expect(bad.status).toBe("invalid");
    expect(bad.problems.join(" ")).toMatch(/planning option/);
    expect((await c.addMinor(H, AS_IS + SENSOR, "edge:e1", "0001-0000")).status).toBe("conflict");
    expect((await c.versions(H)).map((v) => [v.version, v.status])).toEqual([["0001-0001", "live"], ["0001-0000", "superseded"]]);
  });

  it("promotes an option to the next major, merges the minors, and makes the old live legacy", async () => {
    await c.seedFirstLive(H, AS_IS, "user:a");
    const opt = await c.createOption(H, `${H}-0001-0000`, "Modernisation", "user:a");
    expect(opt).toMatchObject({ id: `${H}-p01`, status: "open", version: 1, basedOn: `${H}-0001-0000` });
    const rcd = AS_IS + `i:r1 a dhc:RCD ; rdfs:label "RCD 30 mA" .\n`;
    expect((await c.saveOption(opt.id, await stage(opt.id, rcd), 1, "user:a")).status).toBe("ok");
    expect((await c.saveOption(opt.id, await stage(opt.id, rcd), 1, "user:a")).status).toBe("conflict");

    await c.addMinor(H, AS_IS + SENSOR, "edge:e1");           // discovered while the plan was worked on
    const r = await c.promote(opt.id, "user:a");
    expect(r).toMatchObject({ status: "ok", id: `${H}-0002-0000`, version: "0002-0000" });
    const live = (await c.versions(H)).find((v) => v.status === "live");
    const text = await c.text(live.s3Key);
    expect(text).toMatch(/RCD 30 mA/);
    expect(text).toMatch(/Hall motion/);                     // the minor came along
    expect((await c.versions(H)).map((v) => [v.version, v.status])).toEqual([
      ["0002-0000", "live"], ["0001-0001", "legacy"], ["0001-0000", "legacy"],
    ]);
    expect(live).toMatchObject({ kind: "major", fromOption: opt.id, basedOn: `${H}-0001-0000` });

    expect((await c.promote(opt.id, "user:a")).status).toBe("invalid");      // closed
    await expect(c.saveOption(opt.id, await stage(opt.id, rcd), 2, "user:a")).rejects.toThrow(/closed/);
  });

  it("refuses to promote an option based on a legacy major", async () => {
    await c.seedFirstLive(H, AS_IS, "user:a");
    const a = await c.createOption(H, `${H}-0001-0000`, "Plan A", "user:a");
    const b = await c.createOption(H, `${H}-0001-0000`, "Plan B", "user:a");
    expect(b.id).toBe(`${H}-p02`);
    expect((await c.promote(a.id, "user:a")).status).toBe("ok");
    const r = await c.promote(b.id, "user:a");
    expect(r.status).toBe("invalid");
    expect(r.problems[0]).toMatch(/rebase/);
    expect((await c.listOptions(H)).map((o) => [o.id, o.status])).toEqual([[a.id, "promoted"], [b.id, "open"]]);
  });

  it("loses a race cleanly: the version and HEAD move together or not at all", async () => {
    await c.seedFirstLive(H, AS_IS, "user:a");
    const head = await c.head(H);
    await c.addMinor(H, AS_IS + SENSOR, "edge:e1");
    // a second writer that read the old HEAD
    const stale = new HomeConfigs(f.clients);
    const real = stale.head.bind(stale);
    let first = true;
    stale.head = async (h) => (first ? ((first = false), head) : real(h));
    const r = await stale.addMinor(H, AS_IS + SENSOR + `i:s2 a dhc:Sensor ; rdfs:label "Door" .\n`, "edge:e2");
    expect(r).toEqual({ status: "conflict", live: "0001-0001" });
    expect((await c.versions(H)).map((v) => v.version)).toEqual(["0001-0001", "0001-0000"]);
  });
});
