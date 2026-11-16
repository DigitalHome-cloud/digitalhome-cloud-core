/**
 * The marketplace's rules, without AWS (ADR: the catalogue is a marketplace of
 * seller graphs). A seller is a manufacturer, distributor or wholesaler — or
 * `digitalhome-cloud`, the platform's own curated catalogue. Its catalogue is
 * one Turtle graph, versioned; its editors are the Cognito group `market-<id>`.
 */

import { TOTP } from "../adminMfaGate/gate";

export const SELLER_ID = /^[a-z][a-z0-9-]{1,39}$/;
export const KINDS = ["platform", "manufacturer", "distributor", "wholesaler"] as const;
export const ADMIN_GROUP = "dhc-admins";
export const GROUP_PREFIX = "market-";
export const ID_BASE = "https://digitalhome.cloud/id/market/";
export const HEX64 = /^[0-9a-f]{64}$/;
export const FILE_EXT: Record<string, string> = {
  jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png", webp: "image/webp", pdf: "application/pdf",
};
export const MAX_FILE_BYTES = 25 * 1024 * 1024;
export const MAX_FILES = 50;
export const MAX_GRAPH_BYTES = 20 * 1024 * 1024;

// One class for "the request was wrong" across the stores, so a handler's
// instanceof check catches what graph-store throws too.
export { BadRequest } from "../graph-store/errors";
import { BadRequest } from "../graph-store/errors";

export function sellerId(v: unknown): string {
  const id = String(v ?? "");
  if (!SELLER_ID.test(id)) throw new BadRequest("a seller id is 2 to 40 lowercase letters, digits and -, starting with a letter");
  return id;
}

export const groupOf = (seller: string) => GROUP_PREFIX + seller;
export const articlePrefix = (seller: string) => `${ID_BASE}${seller}/`;

/** RFC 3986 unreserved characters stay; everything else is %-encoded — the
 *  same as Python's urllib.parse.quote(ref, safe=""), so an article has the
 *  same IRI on the edge and in the cloud. */
export const encodeRef = (ref: string) =>
  encodeURIComponent(ref.trim()).replace(/[!'()*]/g, (c) => "%" + c.charCodeAt(0).toString(16).toUpperCase());
export const articleIri = (seller: string, reference: string) => articlePrefix(seller) + encodeRef(reference);

/**
 * May someone with these groups write this seller's catalogue? Its editors
 * and the platform's admins — in both cases only with an authenticator app.
 * `mfa` is AdminGetUser's UserMFASettingList (edges: asked of Cognito on each
 * call), or "token" when the groups come from a token, which the pre-token
 * gate (adminMfaGate) only fills with protected groups after TOTP.
 */
export function mayEdit(groups: string[] | null, mfa: string[] | "token" | null, seller: string): boolean {
  if (!groups) return false;
  const held = groups.filter((g) => g === ADMIN_GROUP || g === groupOf(seller));
  if (!held.length) return false;
  if (mfa === "token") return true;
  return mfa !== null && mfa.includes(TOTP);
}

/** Storage keys. Graphs are private (Lambdas only); files are world-readable. */
export const graphKey = (seller: string, version: number) => `market/graphs/${seller}/v${version}.ttl`;
export const stagingKey = (seller: string, token: string) => `market/staging/${seller}/${token}.ttl`;
export const STAGING = /^market\/staging\/([a-z][a-z0-9-]{1,39})\/[0-9a-f]{32}\.ttl$/;
export const fileKey = (seller: string, sha256: string, ext: string) => `public/market/${seller}/sha256/${sha256}.${ext}`;

export interface FileSpec { sha256: string; ext: string; size: number }

export function cleanFiles(input: unknown): FileSpec[] {
  if (!Array.isArray(input) || input.length === 0 || input.length > MAX_FILES) {
    throw new BadRequest(`send 1 to ${MAX_FILES} files`);
  }
  return input.map((f: any, i) => {
    const sha256 = String(f?.sha256 ?? "").toLowerCase();
    const ext = String(f?.ext ?? "").toLowerCase();
    const size = Number(f?.size);
    if (!HEX64.test(sha256)) throw new BadRequest(`file ${i}: sha256 is 64 lowercase hex digits`);
    if (!FILE_EXT[ext]) throw new BadRequest(`file ${i}: ext is one of ${Object.keys(FILE_EXT).join(", ")}`);
    if (!(Number.isInteger(size) && size > 0 && size <= MAX_FILE_BYTES)) throw new BadRequest(`file ${i}: size 1 byte to 25 MB`);
    return { sha256, ext, size };
  });
}

export const b64OfHex = (hex: string) => Buffer.from(hex, "hex").toString("base64");
