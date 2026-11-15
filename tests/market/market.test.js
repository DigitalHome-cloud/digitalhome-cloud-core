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

describe("marketplace: editing one article from the Portal", async () => {
  const { applyEdit, articles, parse, write } = await import("../../amplify/functions/market-shared/articles.ts");
  const seller = "maker-a";
  const base = parse(HEAD + RCD);
  const read = () => articles(base)[0];

  it("reads an article as JSON", () => {
    const a = read();
    expect(a).toMatchObject({ reference: "TEST-RCD-40", brand: "Maker", voltageV: 230, usableIn: ["EU", "FR"],
      approvedFor: ["Norm_NFC15100"], capability: ["actor"] });
    expect(a.label).toBe(undefined);                            // only language-tagged labels in the fixture
  });

  it("applies a change to the current catalogue, keeping what others changed meanwhile", async () => {
    const before = read();
    const theirs = applyEdit(seller, base, "TEST-RCD-40", before, { ...before, conformsTo: [...before.conformsTo, "EN 61543"] });
    const mine = applyEdit(seller, theirs.quads, "TEST-RCD-40", before, { ...before, brand: "Maker Pro", usableIn: ["FR"] });
    expect(mine.status).toBe("ok");
    expect(mine.article).toMatchObject({ brand: "Maker Pro", usableIn: ["FR"], conformsTo: ["EN 61008-1", "EN 61543"] });
    const ttl = await write(mine.quads);
    expect(ttl).toContain("Interrupteur différentiel");          // the French label was kept
    expect((await validateListing(ttl, seller)).problems).toEqual([]);
  });

  it("calls two values for one fact a conflict", () => {
    const before = read();
    const theirs = applyEdit(seller, base, "TEST-RCD-40", before, { ...before, brand: "Maker Inc" });
    const mine = applyEdit(seller, theirs.quads, "TEST-RCD-40", before, { ...before, brand: "Maker Pro" });
    expect(mine).toEqual({ status: "conflict", conflicts: [{ property: "brand", mine: ["Maker Pro"], theirs: ["Maker Inc"] }] });
  });

  it("creates, refuses a duplicate, and removes", () => {
    const made = applyEdit(seller, base, "NEW 1", null, { reference: "NEW 1", brand: "B", deviceType: "T" });
    expect(made.status).toBe("ok");
    expect(articles(made.quads).map((a) => a.reference)).toContain("NEW 1");
    expect(applyEdit(seller, made.quads, "NEW 1", null, { reference: "NEW 1" }).message).toMatch(/already/);
    const gone = applyEdit(seller, made.quads, "NEW 1", articles(made.quads).find((a) => a.reference === "NEW 1"), null);
    expect(articles(gone.quads).map((a) => a.reference)).toEqual(["TEST-RCD-40"]);
    expect(applyEdit(seller, gone.quads, "NEW 1", { reference: "NEW 1" }, { reference: "NEW 1" }).message).toMatch(/removed meanwhile/);
  });
});
