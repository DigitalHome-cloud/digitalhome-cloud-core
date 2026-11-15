// The marketplace's rules and catalogue validation (amplify/functions/market-shared), without AWS.
import fs from "node:fs";
import { describe, expect, it } from "vitest";
import { cleanFiles, fileKey, groupOf, mayEdit, sellerId, STAGING, stagingKey } from "../../amplify/functions/market-shared/rules.ts";
import { validateListing } from "../../amplify/functions/market-shared/validate.ts";
import { SHAPES } from "../../amplify/functions/market-shared/market.generated.ts";

const TOTP = "SOFTWARE_TOKEN_MFA";
const HEAD = `@prefix dhp: <https://digitalhome.cloud/pro#> .
@prefix rdfs: <http://www.w3.org/2000/01/rdf-schema#> .
@prefix xsd: <http://www.w3.org/2001/XMLSchema#> .
@prefix a: <https://digitalhome.cloud/id/market/maker-a/> .
`;
const RCD = `a:TEST-RCD-40 a dhp:Article ; dhp:partner "maker-a" ; dhp:reference "TEST-RCD-40" ;
  rdfs:label "RCD 40 A 30 mA"@en , "Interrupteur différentiel 40 A"@fr ; dhp:brand "Maker" ; dhp:deviceType "RCD" ;
  dhp:category "FACILITIES_APPLIANCES" ; dhp:powerSource "FIXED" ; dhp:voltageV 230 ; dhp:currentA 40.0 ;
  dhp:capability "actor" ; dhp:usableIn "FR" , "EU" ; dhp:conformsTo "EN 61008-1" ;
  dhp:approvedFor <https://digitalhome.cloud/ontology#Norm_NFC15100> ;
  dhp:image "${"ab".repeat(32)}.webp" ; dhp:datasheet "${"cd".repeat(32)}.pdf" ; dhp:ean "0000000000017" .
`;

describe("marketplace: sellers and editors", () => {
  it("names sellers, their editor group and their keys", () => {
    expect(sellerId("maker-a")).toBe("maker-a");
    for (const bad of ["A", "1abc", "a", "a_b", "x".repeat(41), "", null]) expect(() => sellerId(bad)).toThrow(/seller id/);
    expect(groupOf("maker-a")).toBe("market-maker-a");
    expect(STAGING.exec(stagingKey("maker-a", "0".repeat(32)))[1]).toBe("maker-a");
    expect(STAGING.test("market/staging/maker-a/../x.ttl")).toBe(false);
    expect(fileKey("maker-a", "ab".repeat(32), "pdf")).toBe(`public/market/maker-a/sha256/${"ab".repeat(32)}.pdf`);
  });
  it("lets a seller's editors and platform admins write, only with an authenticator app", () => {
    expect(mayEdit(["market-maker-a"], [TOTP], "maker-a")).toBe(true);
    expect(mayEdit(["dhc-admins"], [TOTP], "maker-a")).toBe(true);
    expect(mayEdit(["market-maker-a"], [], "maker-a")).toBe(false);
    expect(mayEdit(["market-maker-b"], [TOTP], "maker-a")).toBe(false);
    expect(mayEdit(["dhc-welcome"], [TOTP], "maker-a")).toBe(false);
    expect(mayEdit(null, null, "maker-a")).toBe(false);
    expect(mayEdit(["market-maker-a"], null, "maker-a")).toBe(false);       // Cognito could not be asked
    expect(mayEdit(["market-maker-a"], "token", "maker-a")).toBe(true);    // the gate already required TOTP
  });
  it("checks the files offered for upload", () => {
    const sha = "ab".repeat(32);
    expect(cleanFiles([{ sha256: sha.toUpperCase(), ext: "PNG", size: 10 }])).toEqual([{ sha256: sha, ext: "png", size: 10 }]);
    expect(() => cleanFiles([])).toThrow(/1 to/);
    expect(() => cleanFiles([{ sha256: "x", ext: "png", size: 1 }])).toThrow(/sha256/);
    expect(() => cleanFiles([{ sha256: sha, ext: "html", size: 1 }])).toThrow(/ext/);
    expect(() => cleanFiles([{ sha256: sha, ext: "pdf", size: 26 * 1024 * 1024 }])).toThrow(/size/);
  });
});

describe("marketplace: a seller's catalogue", () => {
  it("accepts a well-formed article", async () => {
    const v = await validateListing(HEAD + RCD, "maker-a");
    expect(v.problems).toEqual([]);
    expect(v).toMatchObject({ ok: true, articles: 1 });
  });
  it("accepts an empty catalogue", async () => {
    expect((await validateListing("", "maker-a")).ok).toBe(true);
  });
  it("refuses a price, or any property the vocabulary does not have", async () => {
    const v = await validateListing(HEAD + RCD.replace(' dhp:ean "0000000000017" .', ' dhp:price "61.50" .'), "maker-a");
    expect(v.ok).toBe(false);
    expect(v.problems.join(" ")).toMatch(/price/);
  });
  it("refuses another seller's articles and things that are not articles", async () => {
    expect((await validateListing(HEAD + RCD, "maker-b")).problems[0]).toMatch(/only describes/);
    const thing = HEAD + `<https://digitalhome.cloud/id/market/maker-a/x> rdfs:label "x" .`;
    expect((await validateListing(thing, "maker-a")).problems[0]).toMatch(/not a dhp:Article/);
    const blank = HEAD + `[] a dhp:Article ; dhp:reference "x" .`;
    expect((await validateListing(blank, "maker-a")).ok).toBe(false);
  });
  it("refuses wrong values", async () => {
    const bad = async (from, to) => (await validateListing(HEAD + RCD.replace(from, to), "maker-a")).problems.join(" ");
    expect(await bad('"FACILITIES_APPLIANCES"', '"TOASTERS"')).toMatch(/category/);
    expect(await bad("dhp:voltageV 230", 'dhp:voltageV "230"')).toMatch(/voltage/);
    expect(await bad('dhp:usableIn "FR"', 'dhp:usableIn "France"')).toMatch(/market/);
    expect(await bad('.webp"', '.gif"')).toMatch(/image/);
    expect(await bad('dhp:reference "TEST-RCD-40" ;', "")).toMatch(/reference/);
    expect(await bad("<https://digitalhome.cloud/ontology#Norm_NFC15100>", "<https://example.org/norm>")).toMatch(/norm/);
    expect((await validateListing("this is not turtle", "maker-a")).problems[0]).toMatch(/Turtle/);
  });
  it("carries the shapes of schema/market unchanged (run scripts/sync-market-shapes.mjs)", () => {
    expect(SHAPES).toBe(fs.readFileSync(new URL("../../schema/market/market.shapes.ttl", import.meta.url), "utf8"));
  });
});

describe("marketplace: the old DeviceModel rows as articles", async () => {
  const { modelQuads } = await import("../../amplify/functions/market/importDeviceModels.ts");
  const N3 = (await import("n3")).default;
  const ttl = (quads) => new Promise((ok) => { const w = new N3.Writer(); w.addQuads(quads); w.end((_, out) => ok(out)); });

  it("maps a full row, and the result passes the shapes", async () => {
    const notes = [];
    const q = modelQuads({
      modelNumber: "HmIP-BSM (v2)", brand: "Homematic IP", deviceType: "Switch actuator", description: "Brand switch",
      category: "CONTROLLERS_AUTOMATION", powerSource: "FIXED", voltageV: 230, currentA: 5, powerW: null,
      hasActorCapability: true, hasIOTCapability: true, hasSensorCapability: false,
      region: "EU, de;Europe", standards: ["EN 60669"], compatibleClasses: ["brick:Switch"],
      s3ImgPath: "public/catalogue/devices/x", thumbnail: "data:…", __typename: "DeviceModel",
    }, "digitalhome-cloud", notes);
    expect(q[0].subject.value).toBe("https://digitalhome.cloud/id/market/digitalhome-cloud/HmIP-BSM%20%28v2%29");
    const v = await validateListing(await ttl(q), "digitalhome-cloud");
    expect(v.problems).toEqual([]);
    expect(notes).toEqual([]);
    const objs = (pred) => q.filter((x) => x.predicate.value.endsWith(pred)).map((x) => x.object.value).sort();
    expect(objs("#capability")).toEqual(["actor", "iot"]);
    expect([...new Set(objs("#usableIn"))]).toEqual(["DE", "EU"]);           // "Europe" → EU, case and separators normalised
    expect(objs("#powerW")).toEqual([]);
  });

  it("leaves out what the shapes would refuse, and says so", async () => {
    const notes = [];
    const q = modelQuads({ modelNumber: "X1", brand: "B", deviceType: "T", category: "TOASTERS", powerSource: "SOLAR",
      region: "Worldwide", voltageV: -3 }, "digitalhome-cloud", notes);
    expect((await validateListing(await ttl(q), "digitalhome-cloud")).ok).toBe(true);
    expect(notes).toEqual(["X1: category TOASTERS left out", "X1: power source SOLAR left out", "X1: region “WORLDWIDE” left out"]);
  });
});
