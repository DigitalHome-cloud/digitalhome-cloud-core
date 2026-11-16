// templates — board templates for the Portal (AppSync), darkfactory ADR-0017.
//
//   templateEditions                                every signed-in user (mayEdit per caller)
//   templateGraph(edition)                          every signed-in user: { version, url }
//   requestTemplatesSave(edition, baseVersion)      editors: where to PUT the new Turtle
//   commitTemplatesSave(edition, key, baseVersion)  editors: { status: ok | conflict | invalid, … }
//   verifyTemplate(edition, template)               editors: marks one template verified by
//                                                   the caller's e-mail address, now
//
// Editors are dhc-template-editors and dhc-admins. Rights come from the
// token's groups: adminMfaGate puts both into a token only for people with
// an authenticator app, so a group in the token is enough.

import { AdminGetUserCommand, CognitoIdentityProviderClient } from "@aws-sdk/client-cognito-identity-provider";
import type { AppSyncIdentityCognito, AppSyncResolverEvent } from "aws-lambda";
import { BadRequest, mayEditTemplates, templateIri } from "../templates-shared/rules";
import { edition, listEditions, rowOf, store, verifyTemplate } from "../templates-shared/store";

const cognito = new CognitoIdentityProviderClient({});
type Args = Record<string, any>;

async function emailOf(identity: AppSyncIdentityCognito): Promise<string> {
  const claimed = (identity.claims as Record<string, unknown> | undefined)?.email;
  if (typeof claimed === "string" && claimed) return claimed;
  const user = await cognito.send(new AdminGetUserCommand({ UserPoolId: process.env.USER_POOL_ID!, Username: identity.username }));
  const email = user.UserAttributes?.find((a) => a.Name === "email")?.Value;
  if (!email) throw new Error("Your account has no e-mail address to sign the verification with");
  return email;
}

export const handler = async (event: AppSyncResolverEvent<Args>) => {
  const identity = event.identity as AppSyncIdentityCognito | undefined;
  if (!identity?.sub) throw new Error("Unauthenticated");
  const groups = identity.groups || [];
  const who = `user:${identity.username}`;
  const field = (event as unknown as { fieldName?: string }).fieldName ?? event.info?.fieldName;
  const args = event.arguments || {};
  const mayEdit = mayEditTemplates(groups, "token");
  const asEditor = () => {
    if (!mayEdit) throw new Error("Only template editors (with an authenticator app) may change the templates");
  };

  try {
    switch (field) {
      case "templateEditions":
        return (await listEditions()).map((e) => ({
          edition: e.id, label: e.label, norm: e.norm, latest: e.latest, supersedes: e.supersedes,
          version: e.version, templates: e.templates, updatedAt: e.updatedAt, mayEdit,
        }));
      case "templateGraph": {
        const ed = edition(args.edition);
        const row = await store().get(ed.id);
        return { edition: ed.id, version: row?.version ?? 0, url: row ? await store().url(row) : null };
      }
      case "requestTemplatesSave": {
        asEditor();
        const row = await rowOf(args.edition, who);
        if (Number(args.baseVersion) !== row.version) {
          return { status: "conflict", currentVersion: row.version, currentUrl: await store().url(row), problems: [] };
        }
        const up = await store().stageUpload(row.id);
        return { status: "ready", key: up.key, url: up.url, problems: [] };
      }
      case "commitTemplatesSave": {
        asEditor();
        const row = await rowOf(args.edition, who);
        const r = await store().commit(row, String(args.key ?? ""), Number(args.baseVersion), who);
        if (r.status === "conflict") return { status: "conflict", currentVersion: r.current.version, currentUrl: r.current.url, problems: [] };
        if (r.status === "invalid") return { status: "invalid", problems: r.problems };
        console.log(`[templates] ${row.id} v${r.version} (${r.counts.templates} templates) by ${who}`);
        return { status: "ok", version: r.version, templates: r.counts.templates ?? 0, problems: [] };
      }
      case "verifyTemplate": {
        asEditor();
        const ed = edition(args.edition);
        const t = String(args.template ?? "");
        const iri = t.startsWith("https://") ? t : templateIri(ed.id, t);
        const r = await verifyTemplate(ed.id, iri, await emailOf(identity), who);
        if (r.status === "conflict") return { status: "conflict", currentVersion: r.current.version, problems: [] };
        if (r.status === "invalid") return { status: "invalid", problems: r.problems };
        console.log(`[templates] ${ed.id}: ${iri} verified by ${who}`);
        return { status: "ok", version: r.version, templates: r.counts.templates ?? 0, problems: [] };
      }
      default:
        throw new Error(`unknown field ${field}`);
    }
  } catch (err) {
    if (err instanceof BadRequest) throw new Error(err.message);
    throw err;
  }
};
