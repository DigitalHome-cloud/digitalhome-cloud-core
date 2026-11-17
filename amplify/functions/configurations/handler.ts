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
//   withdrawHomeConfigVersion(homeId, id)                          a live major that changed nothing is taken back
//   mintHomeTags(homeId, count)                                    blank QR tags for the home (ADR 0018 point 10)
//   homeTag(tagId)                                                 a tag: its home and the item it stands for
//   bindHomeTag(tagId, item?)                                      bind it on site, rebind, or unbind (no item)

import type { AppSyncIdentityCognito, AppSyncResolverEvent } from "aws-lambda";
import { homeForPerson } from "../configurations-shared/access";
import * as api from "../configurations-shared/api";
import * as tags from "../configurations-shared/tags";

type Args = Record<string, unknown>;

export const handler = async (event: AppSyncResolverEvent<Args>) => {
  const identity = event.identity as AppSyncIdentityCognito | undefined;
  if (!identity?.sub) throw new Error("Unauthenticated");
  const field = (event as unknown as { fieldName?: string }).fieldName ?? event.info?.fieldName;
  const args = event.arguments || {};
  const who = { sub: identity.sub, username: identity.username, groups: identity.groups || [] };
  const by = `user:${identity.username}`;
  // A tag names its home: look it up, then the same owners-only check.
  if (field === "homeTag" || field === "bindHomeTag") {
    const tag = await tags.getTag(args.tagId);
    if (!tag) throw new Error("No such tag");
    await homeForPerson(tag.homeId, who);
    return tags.publicTag(field === "homeTag" ? tag : await tags.bindTag(tag, args.item, by));
  }
  const home = (await homeForPerson(args.homeId, who)).homeId!;
  switch (field) {
    case "homeConfigurations": return api.overview(home);
    case "homeConfigurationGraph": return api.get(home, args.id);
    case "createHomeConfigOption": return api.createOption(home, args, by);
    case "saveHomeConfigOption": return api.saveOption(home, args, by);
    case "promoteHomeConfigOption": return api.promote(home, args, by);
    case "seedHomeConfiguration": return api.seed(home, args, by);
    case "addHomeConfigMinor": return api.minor(home, args, by);
    case "withdrawHomeConfigVersion": return api.withdraw(home, args, by);
    case "mintHomeTags": return tags.mintTags(home, args.count, by);
    default: throw new Error(`configurations: unknown field ${field}`);
  }
};
