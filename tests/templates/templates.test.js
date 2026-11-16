// Board templates in the cloud (darkfactory ADR-0017): one graph per norm
// edition, checked against the template shapes AND the edition's own norm
// shapes; verification only through the verify call.
import fs from "node:fs";
import { beforeEach, describe, expect, it } from "vitest";
import { editionIdOf, editionIri, mayEditTemplates, templateIri } from "../../amplify/functions/templates-shared/rules.ts";
import { editions, validateTemplates } from "../../amplify/functions/templates-shared/validate.ts";
import { keepVerification, summary, verify } from "../../amplify/functions/templates-shared/verification.ts";
import { NORM_SHAPES, TBOX, TEMPLATE_SHAPES } from "../../amplify/functions/templates-shared/templates.generated.ts";
import * as templates from "../../amplify/functions/templates-shared/store.ts";
import { fakeClients } from "../graph-store/fakes.js";

process.env.NORM_TEMPLATES_TABLE_NAME = "NormTemplates";
process.env.STORAGE_BUCKET_NAME = "bucket";

const SEED = fs.readFileSync(new URL("../../schema/templates/seed/nfc15100-2024.ttl", import.meta.url), "utf8");
const BASE = "https://digitalhome.cloud/id/templates/nfc15100-2024/";
const T1 = `${BASE}t1`;
const TOTP = "SOFTWARE_TOKEN_MFA";
const as2015 = (ttl) => ttl.replaceAll("nfc15100-2024", "nfc15100-2015").replaceAll("NormEdition_NFC15100_2024", "NormEdition_NFC15100_2015");

// One more circuit on t1: EV charging, 32 A single-phase, on 10 mm² behind
// the type A RCD. 2015 allows it; the (illustrative) 2024 delta wants 16 mm².
const withIrve = (ttl, base = BASE) => ttl.replace(
  `dht:hasCircuit <${base}t1/c-1>`,
  `dht:hasCircuit <${base}t1/c-irve> , <${base}t1/c-1>`,
) + `
<${base}t1/c-irve> a dhc:Circuit ;
    rdfs:label "EV charging"@en ;
    dhc:hasCircuitType dhc:CircuitType_IRVE ; dhc:ratedCurrent 32.0 ; dhc:crossSection 10.0 ;
    dhc:phase 1 ; dhc:dedicated true ;
    dhc:hasProtection <${base}t1/rcd-1> ; dhc:governedBy dhc:Norm_NFC15100 ; dht:position 99 .
`;

// The kitchen sockets of t1 (c-4) on 1.5 mm²: NF C 15-100 wants 2.5.
const thinKitchen = (ttl) => ttl.replace(
  /(<[^>]+\/t1\/c-4> a dhc:Circuit ;\n[^\n]*\n[^\n]*dhc:crossSection )2\.5/,
  "$11.5",
);

describe("templates: editions and who may write", () => {
  it("maps edition ids to the T-Box editions and back", () => {
    expect(editionIri("nfc15100-2024")).toBe("https://digitalhome.cloud/ontology#NormEdition_NFC15100_2024");
    expect(editionIdOf(editionIri("nfc15100-2015"))).toBe("nfc15100-2015");
    expect(() => editionIri("NFC15100_2024")).toThrow();
    expect(() => templateIri("nfc15100-2024", "T1/../x")).toThrow();
  });

  it("offers the editions that have norm shapes, with the chain and the latest", () => {
    const byId = Object.fromEntries(editions().map((e) => [e.id, e]));
    expect(Object.keys(byId)).toEqual(expect.arrayContaining(["nfc15100-2015", "nfc15100-2024"]));
    expect(byId["nfc15100-2024"]).toMatchObject({ latest: true, supersedes: "nfc15100-2015", norm: "https://digitalhome.cloud/ontology#Norm_NFC15100" });
    expect(byId["nfc15100-2002"]).toBeUndefined();         // no shapes: nothing could check a template
  });

  it("lets template editors and platform admins write, only with an authenticator app", () => {
    expect(mayEditTemplates(["dhc-template-editors"], [TOTP])).toBe(true);
    expect(mayEditTemplates(["dhc-admins"], "token")).toBe(true);
    expect(mayEditTemplates(["dhc-template-editors"], [])).toBe(false);
    expect(mayEditTemplates(["dhc-modelers"], [TOTP])).toBe(false);
    expect(mayEditTemplates(["market-maker-a"], "token")).toBe(false);
    expect(mayEditTemplates(null, "token")).toBe(false);
  });
});

describe("templates: a graph is checked against its own edition", () => {
  it("accepts the unverified 2024 drafts", async () => {
    const v = await validateTemplates(SEED, "nfc15100-2024");
    expect(v.problems).toEqual([]);
    expect(v.counts.templates).toBe(10);
  });

  it("refuses a template that breaks a 2015 rule, naming the rule", async () => {
    const v = await validateTemplates(thinKitchen(SEED), "nfc15100-2024");
    expect(v.ok).toBe(false);
    expect(v.problems.join("\n")).toMatch(/t1\/c-4: nfc15100-2024: .*KitchenSocketCircuitShape/);
  });

  it("judges each edition by its own chain: 32 A EV charging on 10 mm² passes 2015, not 2024", async () => {
    expect((await validateTemplates(withIrve(as2015(SEED), BASE.replace("2024", "2015")), "nfc15100-2015")).problems).toEqual([]);
    const v = await validateTemplates(withIrve(SEED), "nfc15100-2024");
    expect(v.ok).toBe(false);
    expect(v.problems.join("\n")).toMatch(/t1\/c-irve: nfc15100-2024: breaks IRVE32AMono2024Shape/);
  });

  it("refuses unknown properties, other editions' templates and strays", async () => {
    const price = await validateTemplates(SEED.replace('dht:dwelling "T1" ;', 'dht:dwelling "T1" ; dht:price 120 ;'), "nfc15100-2024");
    expect(price.ok).toBe(false);
    expect((await validateTemplates(as2015(SEED), "nfc15100-2024")).ok).toBe(false);
    const stray = await validateTemplates(`${SEED}\n<https://example.org/x> a <https://digitalhome.cloud/ontology#Circuit> .\n`, "nfc15100-2024");
    expect(stray.problems.join("\n")).toMatch(/only describes/);
    const orphan = SEED.replace(`dht:hasCircuit <${T1}/c-1> , `, "dht:hasCircuit ");
    expect((await validateTemplates(orphan, "nfc15100-2024")).problems.join("\n")).toMatch(/t1\/c-1: not listed by its template/);
    const across = SEED.replace(`dhc:hasProtection <${T1}/rcd-2>`, `dhc:hasProtection <${BASE}t2/rcd-1>`);
    expect((await validateTemplates(across, "nfc15100-2024")).problems.join("\n")).toMatch(/outside its own template/);
    expect((await validateTemplates(SEED, "nfc15100-2002")).problems.join("\n")).toMatch(/not an edition with norm shapes/);
    expect((await validateTemplates("not turtle <", "nfc15100-2024")).problems[0]).toMatch(/not valid Turtle/);
  });

  it("carries schema/ unchanged (run scripts/sync-template-shapes.mjs)", () => {
    const schema = new URL("../../schema/", import.meta.url);
    expect(TEMPLATE_SHAPES).toBe(fs.readFileSync(new URL("templates/templates.shapes.ttl", schema), "utf8"));
    expect(TBOX).toBe(fs.readFileSync(new URL("tbox/dhc-core.ttl", schema), "utf8"));
    for (const [rel, ttl] of Object.entries(NORM_SHAPES)) expect(ttl).toBe(fs.readFileSync(new URL(rel, schema), "utf8"));
    const claimed = [...TBOX.matchAll(/dhc:shapesFile "([^"]+)"/g)].map((m) => m[1]);
    expect(Object.keys(NORM_SHAPES).sort()).toEqual([...new Set(claimed)].sort());
  });
});

describe("templates: verification is never taken from an upload", () => {
  it("sets verified, checked by and when, only through verify", async () => {
    const claimed = SEED.replace(`<${T1}> a dht:BoardTemplate ;`, `<${T1}> a dht:BoardTemplate ; dht:checkedBy "me@example.org" ;`)
      .replace("dht:verified false ;", "dht:verified true ;");
    const kept = summary(await keepVerification(claimed, ""));
    expect(kept.every((t) => !t.verified && !t.checkedBy)).toBe(true);

    const checked = await verify(SEED, T1, "checker@example.org", "2026-11-16T10:00:00.000Z");
    expect(summary(checked).find((t) => t.iri === T1)).toEqual({
      iri: T1, verified: true, checkedBy: "checker@example.org", checkedAt: "2026-11-16T10:00:00.000Z",
    });
    expect((await validateTemplates(checked, "nfc15100-2024")).ok).toBe(true);
  });

  it("keeps a verification while the template is unchanged, drops it on any change", async () => {
    const checked = await verify(SEED, T1, "checker@example.org", "2026-11-16T10:00:00.000Z");
    expect(summary(await keepVerification(SEED, checked)).find((t) => t.iri === T1).verified).toBe(true);
    const changed = SEED.replace(`<${T1}/c-1> a dhc:Circuit ;\n    rdfs:label "Lighting"@en`, `<${T1}/c-1> a dhc:Circuit ;\n    rdfs:label "Lights"@en`);
    const after = summary(await keepVerification(changed, checked)).find((t) => t.iri === T1);
    expect(after).toMatchObject({ verified: false, checkedBy: null });
  });
});

describe("templates: the store", () => {
  let f;
  beforeEach(() => {
    f = fakeClients();
    templates.useClients(f.clients);
  });

  it("lists every edition at version 0 before its first save, makes the row on first use", async () => {
    const all = await templates.listEditions();
    expect(all.find((e) => e.id === "nfc15100-2024")).toMatchObject({ version: 0, templates: 0, latest: true });
    const row = await templates.rowOf("nfc15100-2024", "user:x");
    expect(row).toMatchObject({ id: "nfc15100-2024", version: 0 });
    expect(() => templates.edition("nfc15100-2002")).toThrow(/kept for/);
  });

  it("saves the drafts, refuses a stale save, and verifies one template", async () => {
    const row = await templates.rowOf("nfc15100-2024", "user:x");
    const r = await templates.store().write(row, SEED, "user:x");
    expect(r).toMatchObject({ status: "ok", version: 1, counts: { templates: 10 } });
    expect(f.rows.get("nfc15100-2024").s3Key).toMatch(/^templates\/graphs\/nfc15100-2024\/v1-/);

    const stale = await templates.store().write(row, SEED, "user:y");     // still at version 0
    expect(stale.status).toBe("conflict");

    const v = await templates.verifyTemplate("nfc15100-2024", T1, "checker@example.org", "user:x");
    expect(v).toMatchObject({ status: "ok", version: 2 });
    const now = await templates.store().read(f.rows.get("nfc15100-2024"));
    expect(summary(now).find((t) => t.iri === T1)).toMatchObject({ verified: true, checkedBy: "checker@example.org" });

    // a re-upload of the same content keeps it; the uploader cannot clear or forge it
    const again = await templates.store().write(f.rows.get("nfc15100-2024"), SEED, "user:y");
    expect(again.status).toBe("ok");
    expect(summary(await templates.store().read(f.rows.get("nfc15100-2024"))).find((t) => t.iri === T1).verified).toBe(true);
    await expect(templates.verifyTemplate("nfc15100-2024", `${BASE}t9`, "c@example.org", "user:x")).rejects.toThrow(/no template/);
  });

  it("refuses a save that breaks the edition, and keeps the version", async () => {
    const row = await templates.rowOf("nfc15100-2024", "user:x");
    const r = await templates.store().write(row, thinKitchen(SEED), "user:x");
    expect(r.status).toBe("invalid");
    expect(f.rows.get("nfc15100-2024").version).toBe(0);
  });
});
