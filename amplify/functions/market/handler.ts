// market — the digitalhome.cloud marketplace for the Portal (AppSync).
//
//   listSellers                                   every signed-in user (mayEdit per seller)
//   marketGraph(seller)                           every signed-in user: { version, url }
//   requestMarketSave(seller, baseVersion)        editors: where to PUT the new Turtle
//   commitMarketSave(seller, key, baseVersion)    editors: { status: ok | conflict | invalid, … }
//   marketUploads(seller, files)                  editors: hash-bound PUTs for images/datasheets
//   createSeller(id, name, kind)                  dhc-admins
//   sellerEditors(seller)                         dhc-admins: the editors' e-mail addresses
//   addSellerEditor / removeSellerEditor(seller, email)   dhc-admins
//   marketArticles(seller?, query?)               every signed-in user: articles as JSON
//   editMarketArticle(seller, reference, before, after)
//                                                 editors: one article, merged into the current catalogue
//   importDeviceCatalogue                         dhc-admins, once per environment: the old
//                                                 DeviceModel table → seller digitalhome-cloud
//
// Editors are the Cognito group market-<seller>. Rights come from the token's
// groups: adminMfaGate puts dhc-admins and market-* groups into a token only
// for people with an authenticator app, so a group in the token is enough.

import {
  AdminAddUserToGroupCommand,
  AdminRemoveUserFromGroupCommand,
  CognitoIdentityProviderClient,
  CreateGroupCommand,
  ListUsersCommand,
  ListUsersInGroupCommand,
} from "@aws-sdk/client-cognito-identity-provider";
import type { AppSyncIdentityCognito, AppSyncResolverEvent } from "aws-lambda";
import { ADMIN_GROUP, BadRequest, cleanFiles, groupOf, mayEdit, sellerId } from "../market-shared/rules";
import { importDeviceModels } from "./importDeviceModels";
import { applyEdit, articles, parse, write, type Article } from "../market-shared/articles";
import {
  commit, createSeller, getSeller, graphUrl, listSellers, readGraph, stageUpload, uploads, writeGraph, type Seller,
} from "../market-shared/store";

const cognito = new CognitoIdentityProviderClient({});
const USER_POOL_ID = () => process.env.USER_POOL_ID!;
const EMAIL = /^[^\s@"]{1,64}@[^\s@"]{1,190}$/;

type Args = Record<string, any>;
const PLATFORM = "digitalhome-cloud";
const json = (v: unknown) => (typeof v === "string" ? JSON.parse(v) : v ?? null);

// Parsed catalogues, by the S3 key of their version (a key is never reused).
const parsed = new Map<string, Article[]>();
async function articlesOf(s: Seller): Promise<Article[]> {
  if (!s.s3Key) return [];
  if (!parsed.has(s.s3Key)) {
    if (parsed.size > 50) parsed.clear();
    parsed.set(s.s3Key, articles(parse(await readGraph(s))));
  }
  return parsed.get(s.s3Key)!;
}

/** A seller row and its editor group (market-<id>). */
async function newSeller(id: string, name: string, kind: string, who: string): Promise<Seller> {
  const row = await createSeller(id, name, kind, who);
  await cognito.send(new CreateGroupCommand({
    UserPoolId: USER_POOL_ID(), GroupName: groupOf(id),
    Description: `Editors of the marketplace catalogue of ${row.name}`,
  })).catch((err) => { if (err?.name !== "GroupExistsException") throw err; });
  return row;
}

export const handler = async (event: AppSyncResolverEvent<Args>) => {
  const identity = event.identity as AppSyncIdentityCognito | undefined;
  if (!identity?.sub) throw new Error("Unauthenticated");
  const groups = identity.groups || [];
  const who = `user:${identity.username}`;
  const field = (event as unknown as { fieldName?: string }).fieldName ?? event.info?.fieldName;
  const args = event.arguments || {};

  const seller = async (): Promise<Seller> => {
    const s = await getSeller(sellerId(args.seller));
    if (!s) throw new Error(`There is no seller ${args.seller}`);
    return s;
  };
  const asEditor = async (): Promise<Seller> => {
    const s = await seller();
    if (!mayEdit(groups, "token", s.id)) throw new Error(`Only the editors of ${s.id} may change its catalogue`);
    return s;
  };
  const asAdmin = () => {
    if (!groups.includes(ADMIN_GROUP)) throw new Error("Only platform admins (with an authenticator app) may do this");
  };
  const userByEmail = async (email: string): Promise<string> => {
    if (!EMAIL.test(email)) throw new BadRequest("an e-mail address");
    const found = await cognito.send(new ListUsersCommand({ UserPoolId: USER_POOL_ID(), Filter: `email = "${email}"`, Limit: 1 }));
    const username = found.Users?.[0]?.Username;
    if (!username) throw new BadRequest(`nobody has signed up with ${email}`);
    return username;
  };

  try {
    switch (field) {
      case "listSellers":
        return (await listSellers()).map((s) => ({
          id: s.id, name: s.name, kind: s.kind, version: s.version, articles: s.articles ?? 0,
          updatedAt: s.updatedAt ?? null, mayEdit: mayEdit(groups, "token", s.id),
        }));
      case "marketGraph": {
        const s = await seller();
        return { seller: s.id, version: s.version, url: await graphUrl(s) };
      }
      case "marketArticles": {
        const all = args.seller ? [await seller()] : await listSellers();
        const q = String(args.query ?? "").trim().toLowerCase();
        const limit = Math.max(1, Math.min(Number(args.limit) || 500, 2000));
        const out: Array<Article & { seller: string }> = [];
        for (const s of all) {
          for (const a of await articlesOf(s)) {
            const text = [a.reference, a.label, a.brand, a.deviceType].join(" ").toLowerCase();
            if (!q || text.includes(q)) out.push({ seller: s.id, ...a });
          }
        }
        return JSON.stringify({
          versions: Object.fromEntries(all.map((s) => [s.id, s.version])),
          articles: out.slice(0, limit), more: out.length > limit,
        });
      }
      case "editMarketArticle": {
        const before = json(args.before) as Article | null;
        const after = json(args.after) as Article | null;
        for (let attempt = 0; attempt < 3; attempt++) {
          const s = await asEditor();
          const edit = applyEdit(s.id, parse(await readGraph(s)), String(args.reference ?? ""), before, after);
          if (edit.status === "conflict") return JSON.stringify(edit);
          const r = await writeGraph(s, await write(edit.quads), who);
          if (r.status === "invalid") return JSON.stringify({ status: "invalid", problems: r.problems });
          if (r.status === "ok") return JSON.stringify({ status: "ok", version: r.version, article: edit.article });
          // someone saved between our read and our write: read again and re-apply
        }
        return JSON.stringify({ status: "conflict", conflicts: [], message: "the catalogue keeps changing; try again" });
      }
      case "requestMarketSave": {
        const s = await asEditor();
        if (Number(args.baseVersion) !== s.version) {
          return { status: "conflict", currentVersion: s.version, currentUrl: await graphUrl(s), problems: [] };
        }
        const up = await stageUpload(s);
        return { status: "ready", key: up.key, url: up.url, problems: [] };
      }
      case "commitMarketSave": {
        const s = await asEditor();
        const r = await commit(s, String(args.key ?? ""), Number(args.baseVersion), who);
        if (r.status === "conflict") return { status: "conflict", currentVersion: r.current.version, currentUrl: r.current.url, problems: [] };
        if (r.status === "invalid") return { status: "invalid", problems: r.problems };
        return { status: "ok", version: r.version, articles: r.articles, problems: [] };
      }
      case "marketUploads": {
        const s = await asEditor();
        const files = cleanFiles(typeof args.files === "string" ? JSON.parse(args.files) : args.files);
        return JSON.stringify(await uploads(s, files));
      }
      case "createSeller": {
        asAdmin();
        const row = await newSeller(sellerId(args.id), args.name, args.kind, who);
        return { ...row, articles: 0, updatedAt: null, mayEdit: true };
      }
      case "importDeviceCatalogue": {
        asAdmin();
        const s = (await getSeller(PLATFORM)) ?? (await newSeller(PLATFORM, "digitalhome.cloud", "platform", who));
        const report = await importDeviceModels(s, who);
        console.log(`[market] importDeviceCatalogue by ${who}: ${report.status}, ${report.added} added, ${report.files} files`);
        return JSON.stringify(report);
      }
      case "sellerEditors": {
        asAdmin();
        const s = await seller();
        const res = await cognito.send(new ListUsersInGroupCommand({ UserPoolId: USER_POOL_ID(), GroupName: groupOf(s.id), Limit: 60 }));
        return (res.Users || []).map((u) => u.Attributes?.find((a) => a.Name === "email")?.Value || u.Username || "").filter(Boolean).sort();
      }
      case "addSellerEditor":
      case "removeSellerEditor": {
        asAdmin();
        const s = await seller();
        const username = await userByEmail(String(args.email ?? "").trim().toLowerCase());
        const Cmd = field === "addSellerEditor" ? AdminAddUserToGroupCommand : AdminRemoveUserFromGroupCommand;
        await cognito.send(new Cmd({ UserPoolId: USER_POOL_ID(), Username: username, GroupName: groupOf(s.id) }));
        console.log(`[market] ${field} ${s.id} by ${who}`);
        return true;
      }
      default:
        throw new Error(`unknown field ${field}`);
    }
  } catch (err) {
    if (err instanceof BadRequest) throw new Error(err.message);
    throw err;
  }
};
