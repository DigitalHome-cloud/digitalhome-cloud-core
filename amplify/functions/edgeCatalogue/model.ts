/**
 * The edge catalogue's rules, without AWS: what an edge sees of a DeviceModel,
 * what it may send for one, and who may send it.
 */

import { groupsForToken } from "../adminMfaGate/gate";

export const CATEGORIES = [
  "COMPUTING_IT",
  "CONTROLLERS_AUTOMATION",
  "FACILITIES_APPLIANCES",
  "MEDIA_COMMUNICATION",
  "SECURITY_MONITORING",
] as const;
export const POWER_SOURCES = ["FIXED", "SOCKET", "BATTERY", "ACCU"] as const;

/** The fields an edge reads. Not the S3 paths or the thumbnail: they are the Portal's. */
export const VISIBLE = [
  "modelNumber", "brand", "deviceType", "category", "description", "region",
  "standards", "compatibleClasses", "hasActorCapability", "hasSensorCapability",
  "hasControllerCapability", "hasIOTCapability", "powerSource", "voltageV",
  "currentA", "powerW", "createdAt", "updatedAt",
] as const;

export type Model = Record<string, unknown>;

export function view(item: Model): Model {
  const out: Model = {};
  for (const k of VISIBLE) if (item[k] !== undefined && item[k] !== null) out[k] = item[k];
  return out;
}

const TEXT = /^[^\u0000-\u001f]*$/;
const MODEL_NUMBER = /^[A-Za-z0-9][A-Za-z0-9 ._\-/+]{0,79}$/;

function text(v: unknown, max: number, name: string): string {
  if (typeof v !== "string") throw new Error(`${name} must be text`);
  const s = v.trim();
  if (!s || s.length > max || !TEXT.test(s)) throw new Error(`${name}: 1 to ${max} characters, one line`);
  return s;
}

function list(v: unknown, max: number, each: number, name: string): string[] {
  if (!Array.isArray(v)) throw new Error(`${name} must be a list`);
  if (v.length > max) throw new Error(`${name}: at most ${max}`);
  return [...new Set(v.map((x) => text(x, each, name)))];
}

function rating(v: unknown, name: string): number {
  if (typeof v !== "number" || !Number.isFinite(v) || v < 0 || v > 1e6) throw new Error(`${name} must be a number ≥ 0`);
  return v;
}

/**
 * An edge's model, checked. modelNumber, brand and deviceType are required;
 * every other field is optional and only what is sent changes. Unknown fields
 * are refused rather than ignored, so a typo does not silently do nothing.
 */
export function clean(input: unknown): Model {
  if (!input || typeof input !== "object" || Array.isArray(input)) throw new Error("send { model: { … } }");
  const m = input as Record<string, unknown>;
  const allowed = new Set<string>(VISIBLE.filter((k) => k !== "createdAt" && k !== "updatedAt"));
  const unknown = Object.keys(m).filter((k) => !allowed.has(k));
  if (unknown.length) throw new Error(`not a catalogue field: ${unknown.join(", ")}`);

  const out: Model = {};
  const id = text(m.modelNumber, 80, "modelNumber");
  if (!MODEL_NUMBER.test(id)) throw new Error("modelNumber: letters, digits, space . _ - / +");
  out.modelNumber = id;
  out.brand = text(m.brand, 80, "brand");
  out.deviceType = text(m.deviceType, 80, "deviceType");
  if (m.description !== undefined) out.description = text(m.description, 1000, "description");
  if (m.region !== undefined) out.region = text(m.region, 20, "region");
  if (m.standards !== undefined) out.standards = list(m.standards, 20, 80, "standards");
  if (m.compatibleClasses !== undefined) out.compatibleClasses = list(m.compatibleClasses, 20, 120, "compatibleClasses");
  for (const b of ["hasActorCapability", "hasSensorCapability", "hasControllerCapability", "hasIOTCapability"]) {
    if (m[b] !== undefined) {
      if (typeof m[b] !== "boolean") throw new Error(`${b} must be true or false`);
      out[b] = m[b];
    }
  }
  if (m.category !== undefined) {
    if (!CATEGORIES.includes(m.category as never)) throw new Error(`category: one of ${CATEGORIES.join(", ")}`);
    out.category = m.category;
  }
  if (m.powerSource !== undefined) {
    if (!POWER_SOURCES.includes(m.powerSource as never)) throw new Error(`powerSource: one of ${POWER_SOURCES.join(", ")}`);
    out.powerSource = m.powerSource;
  }
  for (const r of ["voltageV", "currentA", "powerW"]) if (m[r] !== undefined) out[r] = rating(m[r], r);
  return out;
}

/**
 * May the person who linked this edge write the catalogue? Exactly when the
 * Portal would let them: in dhc-admins, with an authenticator app (the same
 * rule as adminMfaGate). groups/mfa null: Cognito could not be asked → no.
 */
export function mayWrite(groups: string[] | null, mfa: string[] | null): boolean {
  if (!groups || !groups.includes("dhc-admins")) return false;
  return groupsForToken(groups, ["dhc-admins"], mfa) === null;
}

/** An opaque page cursor from DynamoDB's LastEvaluatedKey, and back. */
export const toCursor = (key: Record<string, unknown> | undefined): string | null =>
  key ? Buffer.from(JSON.stringify(key)).toString("base64url") : null;

export function fromCursor(c: unknown): Record<string, unknown> | undefined {
  if (c === undefined || c === null || c === "") return undefined;
  if (typeof c !== "string" || c.length > 2000) throw new Error("bad cursor");
  try {
    const k = JSON.parse(Buffer.from(c, "base64url").toString("utf8"));
    if (!k || typeof k !== "object" || Array.isArray(k)) throw new Error();
    return k;
  } catch {
    throw new Error("bad cursor");
  }
}

export function since(v: unknown): string | undefined {
  if (v === undefined || v === null || v === "") return undefined;
  if (typeof v !== "string" || Number.isNaN(Date.parse(v))) throw new Error("since must be an ISO date");
  return new Date(v).toISOString();
}
