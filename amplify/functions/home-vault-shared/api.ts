// The vault operations, the same for the Portal (homeVault) and for edges
// (edgeVault). The caller has already been allowed for the home.

import { homeVault } from "./store";

type Args = Record<string, unknown>;

const view = (i: Awaited<ReturnType<ReturnType<typeof homeVault>["items"]>>[number]) => ({
  sha256: i.sha256, kind: i.kind, name: i.name, size: i.size, contentType: i.contentType,
  takenAt: i.takenAt ?? null, caption: i.caption ?? null, configVersion: i.tags[0] ?? null, tags: i.tags,
  thumbUrl: i.thumbUrl, uploadedAt: i.uploadedAt, uploadedBy: i.uploadedBy,
});

export async function items(home: string, a: Args) {
  const tag = a.tag ?? a.configVersion;
  return { homeId: home, items: (await homeVault().items(home, tag ? String(tag) : undefined)).map(view) };
}

export const upload = (home: string, a: Args) =>
  homeVault().upload(home, a.files as any, a.dryRun === true || a.dryRun === "true");

export async function commit(home: string, a: Args, by: string) {
  const r = await homeVault().commit(home, a as any, by);
  return { status: r.status, sha256: r.item.sha256, configVersion: r.item.tags?.[0] ?? r.item.configVersion ?? null };
}

export async function url(home: string, a: Args) {
  return { sha256: String(a.sha256 ?? ""), url: await homeVault().url(home, String(a.sha256 ?? "")) };
}

export async function group(home: string, a: Args) {
  const it = await homeVault().setGroup(home, String(a.sha256 ?? ""), a.configVersion);
  return { status: "ok", sha256: it.sha256, configVersion: it.tags[0] ?? null };
}

/** { sha256s: [...], add: [...], remove: [...] } → { status, items: [{ sha256, tags }] } */
export async function tag(home: string, a: Args) {
  return { status: "ok", items: await homeVault().tag(home, a.sha256s, a.add, a.remove) };
}
