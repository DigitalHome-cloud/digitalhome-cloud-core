// homeVault — a home's vault for the Portal (AppSync), darkfactory ADR 0019.
// The home's owners and dhc-admins only.
//
//   homeVaultItems(homeId, configVersion?)                  the items, grouped by configuration
//   requestHomeVaultUpload(homeId, files: AWSJSON, dryRun)  the dry run, then the upload links
//   commitHomeVaultItem(homeId, file: AWSJSON)              the catalogue row, once the file is there
//   homeVaultItemUrl(homeId, sha256)                        a 5-minute link to the original
//   setHomeVaultItemGroup(homeId, sha256, configVersion)    file it under another version or option

import type { AppSyncIdentityCognito, AppSyncResolverEvent } from "aws-lambda";
import { homeForPerson } from "../configurations-shared/access";
import * as api from "../home-vault-shared/api";

type Args = Record<string, unknown>;
const parsed = (v: unknown) => (typeof v === "string" ? JSON.parse(v) : v);

export const handler = async (event: AppSyncResolverEvent<Args>) => {
  const identity = event.identity as AppSyncIdentityCognito | undefined;
  if (!identity?.sub) throw new Error("Unauthenticated");
  const field = (event as unknown as { fieldName?: string }).fieldName ?? event.info?.fieldName;
  const args = event.arguments || {};
  const home = (await homeForPerson(args.homeId, { sub: identity.sub, username: identity.username, groups: identity.groups || [] })).homeId!;
  const by = `user:${identity.username}`;
  switch (field) {
    case "homeVaultItems": return api.items(home, args);
    case "requestHomeVaultUpload": return JSON.stringify(await api.upload(home, { ...args, files: parsed(args.files) }));
    case "commitHomeVaultItem": return api.commit(home, parsed(args.file) as Args, by);
    case "homeVaultItemUrl": return api.url(home, args);
    case "setHomeVaultItemGroup": return api.group(home, args);
    default: throw new Error(`homeVault: unknown field ${field}`);
  }
};
