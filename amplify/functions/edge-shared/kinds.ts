// Two kinds of edge (darkfactory ADR 0020).
//
//   pro     works for its person's homes: one workspace per home, attached on
//           the edge; it is never linked to a home in the Portal.
//   devops  dedicated to one home: linked to it in the Portal.
//
// What an edge may reach is unchanged (configurations-shared/access.ts): the
// home it is linked to, and every home of the person who linked it. The kind
// only says how the Portal shows it, and a pro edge reports the homes its
// workspaces are attached to (their meaningless homeIds), so the Portal can
// list them. The Portal shows only those of the homes the viewer may use.

import { HOME_ID } from "../home-id/home-id";

export const EDGE_KINDS = ["pro", "devops"] as const;
export type EdgeKind = (typeof EDGE_KINDS)[number];

export const MAX_WORK_HOMES = 50;

/** The kind an edge reported, or one read from its tool name (edges linked
 *  before they reported a kind), or null. */
export function kindOf(reported: unknown, version?: unknown): EdgeKind | null {
  if (typeof reported === "string" && (EDGE_KINDS as readonly string[]).includes(reported)) return reported as EdgeKind;
  const v = typeof version === "string" ? version.toLowerCase() : "";
  if (v.startsWith("digitalhome-pro-edge")) return "pro";
  if (v.startsWith("digitalhome-devops-edge") || v.startsWith("digitalhome-edge") || v.startsWith("dhe ")) return "devops";
  return null;
}

/** The homeIds an edge reported: well-formed, each once, at most 50; null
 *  when the report carries none (then the stored list stays as it is). */
export function cleanWorkHomes(x: unknown): string[] | null {
  if (!Array.isArray(x)) return null;
  const out: string[] = [];
  for (const h of x) {
    if (typeof h === "string" && HOME_ID.test(h) && !out.includes(h)) out.push(h);
    if (out.length >= MAX_WORK_HOMES) break;
  }
  return out;
}

interface Home {
  smartHomeId: string;
  homeId?: string;
  owners?: string[];
}

/** The SmartHome IDs of the reported homes that this viewer may use, in the
 *  edge's order. An edge can report any homeId; only the viewer's own homes
 *  (or every home, for dhc-admins) are named back. */
export function workHomesFor(
  reported: unknown,
  homes: Home[],
  who: { sub?: string; username?: string; admin?: boolean },
): string[] {
  const ids = cleanWorkHomes(reported) || [];
  const byId = new Map(homes.filter((h) => h.homeId).map((h) => [h.homeId as string, h]));
  const out: string[] = [];
  for (const id of ids) {
    const h = byId.get(id);
    if (!h) continue;
    const owners = h.owners || [];
    if (who.admin || (who.sub && owners.includes(who.sub)) || (who.username && owners.includes(who.username)))
      out.push(h.smartHomeId);
  }
  return out;
}
