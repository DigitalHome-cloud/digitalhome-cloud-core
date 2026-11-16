// The board templates store: one versioned Turtle graph per norm edition in
// NormTemplates (graph-store, as the marketplace), under
// templates/graphs/<edition>/v<n>-<token>.ttl. An edition has no row until
// its first save; it is listed at version 0 from the T-Box until then.

import { GraphStore, type Clients, type GraphRow, type SaveResult } from "../graph-store/store";
import { BadRequest } from "./rules";
import { editionOf, editions, validateTemplates, type Edition } from "./validate";
import { keepVerification, verify } from "./verification";

const TABLE = () => process.env.NORM_TEMPLATES_TABLE_NAME!;
const BUCKET = () => process.env.STORAGE_BUCKET_NAME!;

export interface TemplateRow extends GraphRow { templates?: number }

export const templateGraphs = (clients?: Clients) => new GraphStore({
  area: "templates", table: TABLE, bucket: BUCKET, noun: "template graph", clients,
  validate: validateTemplates,
  prepare: (ttl, current) => keepVerification(ttl, current),
});
let graphs = templateGraphs();
/** Tests only: run the store against fake clients. */
export const useClients = (clients?: Clients) => { graphs = templateGraphs(clients); };
export const store = () => graphs;

/** An edition that can hold templates (it has norm shapes), or a 400. */
export function edition(id: unknown): Edition {
  const e = editionOf(String(id ?? ""));
  if (!e) throw new BadRequest(`templates are kept for ${editions().map((x) => x.id).join(", ")}`);
  return e;
}

/** Every edition with its graph's version (0 before its first save). */
export async function listEditions(): Promise<Array<Edition & { version: number; templates: number; updatedAt: string | null }>> {
  const rows = new Map((await graphs.list<TemplateRow>()).map((r) => [r.id, r]));
  return editions().map((e) => {
    const r = rows.get(e.id);
    return { ...e, version: r?.version ?? 0, templates: r?.templates ?? 0, updatedAt: r?.updatedAt ?? null };
  });
}

/** The edition's row, made at version 0 on first use. */
export const rowOf = (id: string, by: string) => graphs.ensure<TemplateRow>(edition(id).id, by);

/** Mark one template verified by `email`, now; retried when someone saves meanwhile. */
export async function verifyTemplate(id: string, template: string, email: string, by: string): Promise<SaveResult> {
  for (let attempt = 0; attempt < 3; attempt++) {
    const row = await rowOf(id, by);
    const ttl = await verify(await graphs.read(row), template, email, new Date().toISOString());
    const r = await graphs.write(row, ttl, by, { trusted: true });
    if (r.status !== "conflict") return r;
  }
  return { status: "conflict", current: { version: (await rowOf(id, by)).version, url: null } };
}
