// The configuration operations, the same for the Portal (AppSync,
// configurations) and for edges (edgeConfigurations). The caller has already
// been allowed for the home; `by` says who for the history.

import { store } from "./store";
import { homeVault } from "../home-vault-shared/store";
import { BadRequest, splitOptionId, splitVersionId, versionId } from "./rules";

type Args = Record<string, unknown>;

/** Everything about a home's configurations: live, every version, the options. */
export async function overview(home: string) {
  const c = store();
  const head = await c.head(home);
  const versions = await c.versions(home);
  const options = await c.listOptions(home);
  return {
    homeId: home,
    live: head ? versionId(home, head.live) : null,
    versions: versions.map((v) => ({
      id: v.id, version: v.version, status: v.status, kind: v.kind, basedOn: v.basedOn ?? null,
      fromOption: v.fromOption ?? null, triples: v.triples, summary: v.summary, at: v.at, by: v.by,
    })),
    options: options
      .sort((a, b) => a.id.localeCompare(b.id))
      .map((o) => ({
        id: o.id, label: o.label ?? "", basedOn: o.basedOn ?? null, status: o.status ?? "open",
        promotedTo: o.promotedTo ?? null, version: o.version, updatedAt: o.updatedAt ?? null, updatedBy: o.updatedBy ?? null,
      })),
  };
}

/** A version or an option, by id: its Turtle as a 15-minute link. */
export async function get(home: string, id: unknown) {
  const c = store();
  const text = String(id ?? "");
  if (/-p[0-9]+$/.test(text)) {
    if (splitOptionId(text).homeId !== home) throw new BadRequest(`${text} is not of this home`);
    const o = await c.option(text);
    return { id: o.id, kind: "option", version: String(o.version), url: await c.options.url(o) };
  }
  if (splitVersionId(text).homeId !== home) throw new BadRequest(`${text} is not of this home`);
  const v = await c.versionById(text);
  return { id: v.id, kind: v.kind, version: v.version, url: await c.url(v.s3Key) };
}

export async function createOption(home: string, a: Args, by: string) {
  const o = await store().createOption(home, String(a.basedOn ?? ""), String(a.label ?? ""), by);
  return { id: o.id, label: o.label, basedOn: o.basedOn, status: o.status, version: o.version };
}

/** Step 1 without `key`: where to PUT the option's new Turtle. Step 2 with it: keep it. */
export async function saveOption(home: string, a: Args, by: string) {
  const c = store();
  const id = String(a.option ?? a.optionId ?? "");
  if (splitOptionId(id).homeId !== home) throw new BadRequest(`${id} is not of this home`);
  const row = await c.option(id);
  const base = Number(a.baseVersion);
  if (!a.key) {
    if (row.status !== "open") throw new BadRequest(`${id} was promoted to ${row.promotedTo}; it is closed`);
    if (base !== row.version) return { status: "conflict", currentVersion: row.version, currentUrl: await c.options.url(row), problems: [] };
    const up = await c.options.stageUpload(id);
    return { status: "ready", key: up.key, url: up.url, headers: up.headers, problems: [] };
  }
  const r = await c.saveOption(id, String(a.key), base, by);
  if (r.status === "conflict") return { status: "conflict", currentVersion: r.current.version, currentUrl: r.current.url, problems: [] };
  if (r.status === "invalid") return { status: "invalid", problems: r.problems };
  return { status: "ok", version: r.version, triples: r.triples, problems: [] };
}

const change = (r: Awaited<ReturnType<ReturnType<typeof store>["promote"]>>) =>
  r.status === "ok"
    ? { status: "ok", id: r.id, version: r.version, summary: r.summary, problems: [] as string[] }
    : r.status === "conflict"
      ? { status: "conflict", live: r.live, problems: [] as string[] }
      : { status: "invalid", problems: r.problems };

export async function promote(home: string, a: Args, by: string) {
  const id = String(a.option ?? a.optionId ?? "");
  if (splitOptionId(id).homeId !== home) throw new BadRequest(`${id} is not of this home`);
  const r = await store().promote(id, by);
  if (r.status === "ok") {
    // photos taken while the plan was worked on now document the new version (ADR 0019)
    await homeVault().regroup(home, id, r.id).catch((err) => console.warn(`[configurations] regroup ${id} → ${r.id}`, err));
  }
  return change(r);
}

/** A live major that changed nothing goes back to the version before it. */
export async function withdraw(home: string, a: Args, by: string) {
  const id = String(a.id ?? a.version ?? "");
  if (splitVersionId(id).homeId !== home) throw new BadRequest(`${id} is not of this home`);
  const tagged = (await homeVault().items(home)).filter((i) => (i.tags ?? []).includes(id)).length;
  return change(await store().withdraw(id, by, tagged));
}

const turtle = (a: Args) => {
  if (typeof a.ttl !== "string" || !a.ttl) throw new BadRequest("ttl is the configuration as Turtle");
  return a.ttl;
};

export const seed = async (home: string, a: Args, by: string) => change(await store().seedFirstLive(home, turtle(a), by));

export const minor = async (home: string, a: Args, by: string) =>
  change(await store().addMinor(home, turtle(a), by, a.expectedLive ? String(a.expectedLive) : undefined));
