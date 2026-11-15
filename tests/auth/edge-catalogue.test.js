// The edge catalogue's rules (amplify/functions/edgeCatalogue/model.ts), without AWS.
import { describe, expect, it } from "vitest";
import { clean, fromCursor, mayWrite, since, toCursor, view } from "../../amplify/functions/edgeCatalogue/model.ts";

const TOTP = "SOFTWARE_TOKEN_MFA";
const base = { modelNumber: "HmIP-BSM", brand: "Homematic IP", deviceType: "Switch actuator" };

describe("edge catalogue: who may write", () => {
  it("lets a catalogue admin with an authenticator app write", () => {
    expect(mayWrite(["dhc-admins", "dhc-welcome"], [TOTP])).toBe(true);
  });
  it("refuses an admin without TOTP, as the Portal does", () => {
    expect(mayWrite(["dhc-admins"], [])).toBe(false);
    expect(mayWrite(["dhc-admins"], ["SMS_MFA"])).toBe(false);
  });
  it("refuses everyone else, and when Cognito could not be asked", () => {
    expect(mayWrite(["dhc-welcome", "dhc-professional"], [TOTP])).toBe(false);
    expect(mayWrite(null, null)).toBe(false);
    expect(mayWrite(["dhc-admins"], null)).toBe(false);
  });
});

describe("edge catalogue: what an edge may send", () => {
  it("takes the three required fields and only what else is sent", () => {
    expect(clean(base)).toEqual(base);
    expect(clean({ ...base, standards: ["EN 60669", "EN 60669"], voltageV: 230, hasActorCapability: true, category: "CONTROLLERS_AUTOMATION" }))
      .toEqual({ ...base, standards: ["EN 60669"], voltageV: 230, hasActorCapability: true, category: "CONTROLLERS_AUTOMATION" });
  });
  it("refuses a missing or malformed required field", () => {
    expect(() => clean({ brand: "x", deviceType: "y" })).toThrow(/modelNumber/);
    expect(() => clean({ ...base, modelNumber: "a\nb" })).toThrow(/modelNumber/);
    expect(() => clean({ ...base, brand: "" })).toThrow(/brand/);
  });
  it("refuses unknown fields, the Portal's own fields and bad values", () => {
    expect(() => clean({ ...base, price: 12 })).toThrow(/not a catalogue field: price/);
    expect(() => clean({ ...base, s3ImgPath: "public/x" })).toThrow(/s3ImgPath/);
    expect(() => clean({ ...base, thumbnail: "data:" })).toThrow(/thumbnail/);
    expect(() => clean({ ...base, category: "TOASTERS" })).toThrow(/category/);
    expect(() => clean({ ...base, powerSource: "SOLAR" })).toThrow(/powerSource/);
    expect(() => clean({ ...base, currentA: -1 })).toThrow(/currentA/);
    expect(() => clean({ ...base, hasIOTCapability: "yes" })).toThrow(/hasIOTCapability/);
    expect(() => clean({ ...base, standards: "EN 1" })).toThrow(/standards/);
    expect(() => clean([base])).toThrow();
  });
});

describe("edge catalogue: what an edge reads", () => {
  it("leaves out S3 paths, the thumbnail and empty fields", () => {
    const v = view({ ...base, s3ImgPath: "public/x", thumbnail: "data:…", description: null, updatedAt: "2026-11-15T10:00:00.000Z", __typename: "DeviceModel" });
    expect(v).toEqual({ ...base, updatedAt: "2026-11-15T10:00:00.000Z" });
  });
  it("pages with an opaque cursor and reads `since` as a date", () => {
    const key = { modelNumber: { S: "HmIP-BSM" } };
    expect(fromCursor(toCursor(key))).toEqual(key);
    expect(toCursor(undefined)).toBeNull();
    expect(fromCursor(undefined)).toBeUndefined();
    expect(() => fromCursor("not base64 json")).toThrow(/cursor/);
    expect(since("2026-11-15T10:00:00Z")).toBe("2026-11-15T10:00:00.000Z");
    expect(since(undefined)).toBeUndefined();
    expect(() => since("yesterday")).toThrow(/since/);
  });
});
