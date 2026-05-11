import { type ClientSchema, a, defineData } from "@aws-amplify/backend";
import { dhcDesignStorageProxy } from "../functions/dhcDesignStorageProxy/resource";
import { createDigitalHome } from "../functions/createDigitalHome/resource";

/**
 * AppSync data layer. Models + custom mutations.
 *
 * Authorization rules ported from the Gen 1 schema (post-C-1 + C-5 closure):
 *   - UserProfile:     owner-only + admin read   (audit C-5)
 *   - LibraryItem:     admin write, any signed-in user read
 *   - DigitalHome:     multi-owner + admin       (audit C-1; replaces SmartHome model)
 *   - SmartHomeDesign: multi-owner + admin       (audit C-1; design-lock state — keyed
 *                      by smartHomeId so it joins back to DigitalHome.smartHomeId)
 *   - requestDesignReadUrl / requestDesignWriteUrl: signed-URL mutations
 *     backed by dhcDesignStorageProxy Lambda    (audit C-2 v2)
 *   - createDigitalHome: structured-address create flow that produces the full
 *     "shell" (DDB row + Cognito group + S3 abox.ttl/graph.jsonld/data folder)
 *     per repos/core/experimental/abox/abox.md (Step 1).
 */

const schema = a.schema({
  // ─── enums ────────────────────────────────────────────────────────
  Locale: a.enum(["EN", "FR", "DE"]),

  // ─── models ───────────────────────────────────────────────────────
  UserProfile: a
    .model({
      displayName: a.string(),
      email: a.email(),
      locale: a.ref("Locale"),
      marketingOptIn: a.boolean(),
    })
    .authorization((allow) => [
      allow.owner(),
      allow.group("dhc-admins").to(["read"]),
    ]),

  LibraryItem: a
    .model({
      title: a.string().required(),
      compatibleClasses: a.string().array().required(),
      region: a.string(),
      standards: a.string().array(),
      version: a.string().required(),
      description: a.string(),
      hasActorCapability: a.boolean(),
      hasSensorCapability: a.boolean(),
      hasControllerCapability: a.boolean(),
    })
    .authorization((allow) => [
      allow.group("dhc-admins").to(["create", "update", "delete"]),
      allow.authenticated().to(["read"]),
    ]),

  // DigitalHome — primary key is smartHomeId (the {country}-{postalCode}-{streetCode}
  // {houseNumber}-{suffix} string is unique by construction). The createDigitalHome
  // custom mutation does the actual write — this model definition exists so AppSync
  // exposes list/get/update/delete operations against the same DDB table.
  DigitalHome: a
    .model({
      smartHomeId: a.id().required(),
      owners: a.string().array(),
      country: a.string().required(),
      postalCode: a.string().required(),
      streetCode: a.string().required(),
      houseNumber: a.string().required(),
      suffix: a.string().required(),
      city: a.string().required(),
      addressLine1: a.string().required(),
      addressLine2: a.string(),
      isDemo: a.boolean().required(),
      createdBy: a.string().required(),
    })
    .identifier(["smartHomeId"])
    .authorization((allow) => [
      allow.ownersDefinedIn("owners"),
      allow.group("dhc-admins"),
    ]),

  SmartHomeDesign: a
    .model({
      smartHomeId: a.string().required(),
      owners: a.string().array(),
      version: a.integer().required(),
      lastModified: a.datetime().required(),
      lockedBy: a.string(),
      lockedAt: a.datetime(),
      ontologyVersion: a.string(),
    })
    .authorization((allow) => [
      allow.ownersDefinedIn("owners"),
      allow.group("dhc-admins"),
    ])
    // Index on smartHomeId so the Lambda's owner-check Query is O(items per
    // SmartHome) instead of a full Scan (scales as the table grows).
    .secondaryIndexes((index) => [index("smartHomeId")]),

  // ─── custom return type for the signed-URL mutations ─────────────
  DesignStorageUrl: a.customType({
    url: a.string().required(),
    expiresAt: a.datetime().required(),
    contentType: a.string(),
  }),

  // ─── custom return type for initiateDigitalHome ──────────────────
  InitiateDigitalHomePayload: a.customType({
    smartHomeId: a.string().required(),
    createdAt: a.datetime().required(),
  }),

  // ─── initiateDigitalHome custom mutation ─────────────────────────
  // Backed by the createDigitalHome Lambda. Performs:
  //   - DDB PutItem (DigitalHome row)
  //   - Cognito group create + add caller
  //   - S3 writes: abox.ttl, graph.jsonld, data/ placeholder, optional Public/ placeholder
  // Auth: caller must be in dhc-standard, dhc-professional, or dhc-admins.
  // Named "initiate" to distinguish from the auto-generated CRUD createDigitalHome.
  initiateDigitalHome: a
    .mutation()
    .arguments({
      country: a.string().required(),
      postalCode: a.string().required(),
      streetCode: a.string().required(),
      houseNumber: a.string().required(),
      suffix: a.string().required(),
      city: a.string().required(),
      addressLine1: a.string().required(),
      addressLine2: a.string(),
      isDemo: a.boolean().required(),
    })
    .returns(a.ref("InitiateDigitalHomePayload"))
    .handler(a.handler.function(createDigitalHome))
    .authorization((allow) => [allow.authenticated()]),

  // ─── signed-URL mutations (backed by dhcDesignStorageProxy) ──────
  requestDesignReadUrl: a
    .mutation()
    .arguments({
      smartHomeId: a.id().required(),
      fileName: a.string().required(),
    })
    .returns(a.ref("DesignStorageUrl"))
    .handler(a.handler.function(dhcDesignStorageProxy))
    .authorization((allow) => [allow.authenticated()]),

  requestDesignWriteUrl: a
    .mutation()
    .arguments({
      smartHomeId: a.id().required(),
      fileName: a.string().required(),
      contentType: a.string(),
    })
    .returns(a.ref("DesignStorageUrl"))
    .handler(a.handler.function(dhcDesignStorageProxy))
    .authorization((allow) => [allow.authenticated()]),

  // Step-1 designtime read — signed URL for
  //   {Private|Public}/DigitalHomes/{smartHomeId}/designtime/{fileName}
  // Authz handled inside the Lambda (DigitalHome.owners + dhc-admins).
  requestDigitalHomeReadUrl: a
    .mutation()
    .arguments({
      smartHomeId: a.id().required(),
      fileName: a.string().required(),
    })
    .returns(a.ref("DesignStorageUrl"))
    .handler(a.handler.function(dhcDesignStorageProxy))
    .authorization((allow) => [allow.authenticated()]),
});

export type Schema = ClientSchema<typeof schema>;

export const data = defineData({
  schema,
  authorizationModes: {
    defaultAuthorizationMode: "userPool",
  },
});
