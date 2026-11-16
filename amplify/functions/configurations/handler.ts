// configurations — a home's configurations for the Portal (AppSync),
// darkfactory ADR 0018. The home's owners and dhc-admins only.
//
//   homeConfigurations(homeId)                                    live, versions (live/superseded/legacy), options
//   homeConfigurationGraph(homeId, id)                             a version or option: { id, kind, version, url }
//   createHomeConfigOption(homeId, basedOn, label)                 a planning option, a copy of basedOn
//   saveHomeConfigOption(homeId, option, baseVersion, key?)        step 1 (no key): where to PUT · step 2: keep it
//   promoteHomeConfigOption(homeId, option)                        the option becomes MMMM+1-0000
//   seedHomeConfiguration(homeId, ttl)                             the first live configuration, 0001-0000
//   addHomeConfigMinor(homeId, ttl, expectedLive?)                 MMMM-mmmm+1, additions only

import type { AppSyncIdentityCognito, AppSyncResolverEvent } from "aws-lambda";
import { homeForPerson } from "../configurations-shared/access";
import * as api from "../configurations-shared/api";

type Args = Record<string, unknown>;

export const handler = async (event: AppSyncResolverEvent<Args>) => {
  const identity = event.identity as AppSyncIdentityCognito | undefined;
  if (!identity?.sub) throw new Error("Unauthenticated");
  const field = (event as unknown as { fieldName?: string }).fieldName ?? event.info?.fieldName;
  const args = event.arguments || {};
  const home = (await homeForPerson(args.homeId, { sub: identity.sub, username: identity.username, groups: identity.groups || [] })).homeId!;
  const by = `user:${identity.username}`;
  switch (field) {
    case "homeConfigurations": return api.overview(home);
    case "homeConfigurationGraph": return api.get(home, args.id);
    case "createHomeConfigOption": return api.createOption(home, args, by);
    case "saveHomeConfigOption": return api.saveOption(home, args, by);
    case "promoteHomeConfigOption": return api.promote(home, args, by);
    case "seedHomeConfiguration": return api.seed(home, args, by);
    case "addHomeConfigMinor": return api.minor(home, args, by);
    default: throw new Error(`configurations: unknown field ${field}`);
  }
};
