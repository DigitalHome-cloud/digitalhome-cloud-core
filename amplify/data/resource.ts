import { type ClientSchema, a, defineData } from "@aws-amplify/backend";
import { dhcDesignStorageProxy } from "../functions/dhcDesignStorageProxy/resource";
import { createDigitalHome } from "../functions/createDigitalHome/resource";
import { edgeDeviceApproval } from "../functions/edgeDeviceApproval/resource";
import { adminDebug } from "../functions/adminDebug/resource";
import { market } from "../functions/market/resource";
import { templates } from "../functions/templates/resource";
import { configurations } from "../functions/configurations/resource";
import { homeVault } from "../functions/homeVault/resource";

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
 *   - The device catalogue is the marketplace (custom types Market*, the
 *     market Lambda; ADR 0016). DeviceModel was retired.
 *   - DeviceInstance: multi-owner + admin (per-SmartHome device inventory,
 *                     keyed/indexed by smartHomeId — same pattern as
 *                     SmartHomeDesign so the Designer can list a home's devices)
 *   - requestDeviceFileReadUrl / requestDeviceFileWriteUrl: signed-URL mutations
 *     (dhcDesignStorageProxy) for per-device spec/doc files under
 *     {Private|Public}/DigitalHomes/{id}/devices/{type}/{serial}/{fileName}
 *   - requestDeviceInboxReadUrl / requestDeviceInboxWriteUrl: signed-URL
 *     mutations for the CSV mass-import inbox at
 *     {Private|Public}/DigitalHomes/{id}/devices/inbox.json
 */

const schema = a.schema({
  // ─── enums ────────────────────────────────────────────────────────
  Locale: a.enum(["EN", "FR", "DE"]),

  // Top-level device taxonomy (organizational, app-level — NOT the T-Box).
  // Sub-types live in the frontend constant; Brick `compatibleClasses` stays
  // the optional semantic anchor.
  DeviceCategory: a.enum([
    "COMPUTING_IT",
    "CONTROLLERS_AUTOMATION",
    "FACILITIES_APPLIANCES",
    "MEDIA_COMMUNICATION",
    "SECURITY_MONITORING",
  ]),

  // DeviceInstance lifecycle state (replaces the v1 free-string `status`).
  DeviceLifecycle: a.enum([
    "NEW",
    "ACTIVE",
    "END_OF_LIFE",
    "DECOMMISSIONED",
  ]),

  // ─── models ───────────────────────────────────────────────────────
  UserProfile: a
    .model({
      displayName: a.string(),
      email: a.email(),
      locale: a.ref("Locale"),
      marketingOptIn: a.boolean(),
      // Persisted active-home selection. Written by whichever app the user
      // switches homes in (Portal Manager / Designer selector) and read on
      // load by the others, so the elected SmartHome follows the user across
      // apps instead of being trapped in per-subdomain localStorage.
      activeSmartHomeId: a.string(),
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
      // The home's permanent, meaningless id (ADR 0018). The SmartHome ID is
      // a name made from the address; what is keyed per home from ADR 0018 on
      // (configuration versions, options, the vault) uses this. Minted by
      // initiateDigitalHome, or by the first function that needs it.
      homeId: a.string(),
    })
    .identifier(["smartHomeId"])
    .authorization((allow) => [
      allow.ownersDefinedIn("owners"),
      allow.group("dhc-admins"),
    ]),

  // Area — geographic area keyed by {country}-{postalCode} (e.g. "DE-39576").
  // Weather + air-quality data (in the Delta Lake) are keyed by AREA, not by
  // SmartHome: many homes share one area's climate. A DigitalHome belongs to
  // Area `${country}-${postalCode}`. lastIngestedAt is stamped by the weather
  // pipeline. Shared reference data: admins write, all authenticated users read.
  Area: a
    .model({
      areaId: a.id().required(),
      country: a.string().required(),
      postalCode: a.string().required(),
      name: a.string().required(),
      latitude: a.float().required(),
      longitude: a.float().required(),
      timezone: a.string(),
      lastIngestedAt: a.datetime(),
      createdBy: a.string(),
    })
    .identifier(["areaId"])
    .authorization((allow) => [
      allow.group("dhc-admins").to(["create", "update", "delete"]),
      allow.authenticated().to(["read"]),
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

  // DeviceInstance — a physical device deployed in one SmartHome. Keyed by the
  // default Amplify id; indexed by smartHomeId so the Designer can list a
  // home's devices cheaply (same rationale as SmartHomeDesign). Per-device
  // spec/doc files live under
  // {Private|Public}/DigitalHomes/{smartHomeId}/devices/{deviceType}/{serialNumber}/.
  DeviceInstance: a
    .model({
      smartHomeId: a.string().required(),
      owners: a.string().array(),
      modelNumber: a.string().required(),
      // The marketplace article this device is (its IRI,
      // https://digitalhome.cloud/id/market/<seller>/<reference>); modelNumber
      // stays the reference, for display and older rows.
      article: a.string(),
      serialNumber: a.string().required(),
      deviceType: a.string().required(),
      purchaseDate: a.date(),
      installationDate: a.date(),
      firmwareVersion: a.string(),
      lifecycleState: a.ref("DeviceLifecycle"),
      location: a.string(),
      s3SpecsPath: a.string(),
    })
    .authorization((allow) => [
      allow.ownersDefinedIn("owners"),
      allow.group("dhc-admins"),
    ])
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
    homeId: a.string(),
    createdAt: a.datetime().required(),
  }),

  // ─── custom return type for edge device-code approve/deny ────────
  DeviceApprovalResult: a.customType({
    status: a.string().required(),
    home_id: a.string(),
  }),

  // ─── device_info shown on the /link approval screen ──────────────
  // Lets the user sanity-check "yes, that's my box" before approving.
  DeviceCodeInfo: a.customType({
    status: a.string().required(),
    hostname: a.string(),
    lan_ip: a.string(),
    dhe_version: a.string(),
    machine_id: a.string(),
    edge_kind: a.string(),   // ADR 0020: a pro edge is linked to no home
  }),

  // ─── one registered edge, for the Portal "My Edges" view ─────────
  EdgeSummary: a.customType({
    edge_id: a.string().required(),
    home_id: a.string(),
    machine_id: a.string(),
    hostname: a.string(),
    dhe_version: a.string(),
    status: a.string(),
    last_telemetry_at: a.string(),
    linked_at: a.string(),
    // ADR 0020: "pro" (works for its person's homes) or "devops" (one home)
    edge_kind: a.string(),
    // a pro edge's workspaces' homes: SmartHome IDs the caller may use
    work_homes: a.string().array(),
    work_homes_at: a.string(),
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

  // ─── edge device-flow approval (backed by edgeDeviceApproval) ────
  // The Portal /link page calls these after the user logs in with Cognito.
  // describeDeviceCode returns the box's device_info for the approval screen;
  // approveDeviceCode binds a pending device_code (looked up by the human
  // user_code) to a home the caller owns; denyDeviceCode rejects it. The
  // Lambda enforces the owner/admin check — see spec DH-SPEC-100 §3.2.
  describeDeviceCode: a
    .query()
    .arguments({
      user_code: a.string().required(),
    })
    .returns(a.ref("DeviceCodeInfo"))
    .handler(a.handler.function(edgeDeviceApproval))
    .authorization((allow) => [allow.authenticated()]),

  approveDeviceCode: a
    .mutation()
    .arguments({
      user_code: a.string().required(),
      // Optional (two-step model): omit to register the edge to the caller now
      // and link it to a home later via linkEdgeToHome.
      home_id: a.string(),
    })
    .returns(a.ref("DeviceApprovalResult"))
    .handler(a.handler.function(edgeDeviceApproval))
    .authorization((allow) => [allow.authenticated()]),

  denyDeviceCode: a
    .mutation()
    .arguments({
      user_code: a.string().required(),
    })
    .returns(a.ref("DeviceApprovalResult"))
    .handler(a.handler.function(edgeDeviceApproval))
    .authorization((allow) => [allow.authenticated()]),

  // ─── two-step: list the caller's edges + (re)assign them to homes ─
  listMyEdges: a
    .query()
    .returns(a.ref("EdgeSummary").array())
    .handler(a.handler.function(edgeDeviceApproval))
    .authorization((allow) => [allow.authenticated()]),

  // Assign (or, with no home_id, unassign) an edge the caller owns to a home
  // the caller owns. Enforced in the Lambda.
  linkEdgeToHome: a
    .mutation()
    .arguments({
      edge_id: a.string().required(),
      home_id: a.string(),
    })
    .returns(a.ref("EdgeSummary"))
    .handler(a.handler.function(edgeDeviceApproval))
    .authorization((allow) => [allow.authenticated()]),

  // ─── admin debug: read-only AWS inspection (backed by adminDebug) ─
  // dhc-admins only, enforced both here and in the Lambda. Returns AWSJSON.
  debugS3: a
    .query()
    .arguments({ prefix: a.string() })
    .returns(a.json())
    .handler(a.handler.function(adminDebug))
    .authorization((allow) => [allow.group("dhc-admins")]),

  debugTables: a
    .query()
    .returns(a.json())
    .handler(a.handler.function(adminDebug))
    .authorization((allow) => [allow.group("dhc-admins")]),

  debugCognito: a
    .query()
    .returns(a.json())
    .handler(a.handler.function(adminDebug))
    .authorization((allow) => [allow.group("dhc-admins")]),

  debugConsole: a
    .query()
    .returns(a.json())
    .handler(a.handler.function(adminDebug))
    .authorization((allow) => [allow.group("dhc-admins")]),

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

  // Per-device spec/doc files. Key (built in the Lambda):
  //   {Private|Public}/DigitalHomes/{smartHomeId}/devices/{deviceType}/{serialNumber}/{fileName}
  // Authz: DigitalHome.owners + dhc-admins (same check as requestDigitalHomeReadUrl).
  requestDeviceFileReadUrl: a
    .mutation()
    .arguments({
      smartHomeId: a.id().required(),
      deviceType: a.string().required(),
      serialNumber: a.string().required(),
      fileName: a.string().required(),
    })
    .returns(a.ref("DesignStorageUrl"))
    .handler(a.handler.function(dhcDesignStorageProxy))
    .authorization((allow) => [allow.authenticated()]),

  requestDeviceFileWriteUrl: a
    .mutation()
    .arguments({
      smartHomeId: a.id().required(),
      deviceType: a.string().required(),
      serialNumber: a.string().required(),
      fileName: a.string().required(),
      contentType: a.string(),
    })
    .returns(a.ref("DesignStorageUrl"))
    .handler(a.handler.function(dhcDesignStorageProxy))
    .authorization((allow) => [allow.authenticated()]),

  // CSV mass-import inbox — a single file directly under devices/ (no
  // deviceType/serialNumber segment), so it needs its own mutation pair.
  // Key (built in the Lambda):
  //   {Private|Public}/DigitalHomes/{smartHomeId}/devices/inbox.json
  // Authz: DigitalHome.owners + dhc-admins (same check as requestDigitalHomeReadUrl).
  requestDeviceInboxReadUrl: a
    .mutation()
    .arguments({
      smartHomeId: a.id().required(),
    })
    .returns(a.ref("DesignStorageUrl"))
    .handler(a.handler.function(dhcDesignStorageProxy))
    .authorization((allow) => [allow.authenticated()]),

  requestDeviceInboxWriteUrl: a
    .mutation()
    .arguments({
      smartHomeId: a.id().required(),
      contentType: a.string(),
    })
    .returns(a.ref("DesignStorageUrl"))
    .handler(a.handler.function(dhcDesignStorageProxy))
    .authorization((allow) => [allow.authenticated()]),

  // ─── the marketplace (backed by the market Lambda) ──────────────
  // One catalogue graph per seller (Turtle in S3, a version in MarketSeller),
  // read by every signed-in user, written by the seller's editors (group
  // market-<id>) through a two-step save, administered by dhc-admins. The
  // Lambda enforces who may do what; the rules here only require sign-in.
  // Edges use /edge/v1/market/* (edgeMarket) with the same store.
  MarketSeller: a.customType({
    id: a.string().required(),
    name: a.string().required(),
    kind: a.string().required(),
    version: a.integer().required(),
    articles: a.integer(),
    updatedAt: a.string(),
    mayEdit: a.boolean(),
  }),
  MarketGraph: a.customType({
    seller: a.string().required(),
    version: a.integer().required(),
    url: a.string(),
  }),
  MarketSave: a.customType({
    status: a.string().required(),          // ready | ok | conflict | invalid
    key: a.string(),
    url: a.string(),
    version: a.integer(),
    articles: a.integer(),
    currentVersion: a.integer(),
    currentUrl: a.string(),
    problems: a.string().array(),
  }),

  listSellers: a
    .query()
    .returns(a.ref("MarketSeller").array())
    .handler(a.handler.function(market))
    .authorization((allow) => [allow.authenticated()]),

  marketGraph: a
    .query()
    .arguments({ seller: a.string().required() })
    .returns(a.ref("MarketGraph"))
    .handler(a.handler.function(market))
    .authorization((allow) => [allow.authenticated()]),

  // { versions: {seller: n}, articles: [{ seller, reference, label, brand, … }], more }
  marketArticles: a
    .query()
    .arguments({ seller: a.string(), query: a.string(), limit: a.integer() })
    .returns(a.json())
    .handler(a.handler.function(market))
    .authorization((allow) => [allow.authenticated()]),

  // One article, as it was read (before; null = new) and as it should be
  // (after; null = remove). Merged into the CURRENT catalogue, so others'
  // changes to other facts survive. → { status: ok | conflict | invalid, … }
  editMarketArticle: a
    .mutation()
    .arguments({
      seller: a.string().required(),
      reference: a.string().required(),
      before: a.json(),
      after: a.json(),
    })
    .returns(a.json())
    .handler(a.handler.function(market))
    .authorization((allow) => [allow.authenticated()]),

  requestMarketSave: a
    .mutation()
    .arguments({ seller: a.string().required(), baseVersion: a.integer().required() })
    .returns(a.ref("MarketSave"))
    .handler(a.handler.function(market))
    .authorization((allow) => [allow.authenticated()]),

  commitMarketSave: a
    .mutation()
    .arguments({ seller: a.string().required(), key: a.string().required(), baseVersion: a.integer().required() })
    .returns(a.ref("MarketSave"))
    .handler(a.handler.function(market))
    .authorization((allow) => [allow.authenticated()]),

  // files: [{ sha256, ext, size }] → [{ name, key, exists, url?, headers? }]
  marketUploads: a
    .mutation()
    .arguments({ seller: a.string().required(), files: a.json().required() })
    .returns(a.json())
    .handler(a.handler.function(market))
    .authorization((allow) => [allow.authenticated()]),

  createSeller: a
    .mutation()
    .arguments({ id: a.string().required(), name: a.string().required(), kind: a.string().required() })
    .returns(a.ref("MarketSeller"))
    .handler(a.handler.function(market))
    .authorization((allow) => [allow.group("dhc-admins")]),

  sellerEditors: a
    .query()
    .arguments({ seller: a.string().required() })
    .returns(a.string().array())
    .handler(a.handler.function(market))
    .authorization((allow) => [allow.group("dhc-admins")]),

  addSellerEditor: a
    .mutation()
    .arguments({ seller: a.string().required(), email: a.string().required() })
    .returns(a.boolean())
    .handler(a.handler.function(market))
    .authorization((allow) => [allow.group("dhc-admins")]),

  removeSellerEditor: a
    .mutation()
    .arguments({ seller: a.string().required(), email: a.string().required() })
    .returns(a.boolean())
    .handler(a.handler.function(market))
    .authorization((allow) => [allow.group("dhc-admins")]),

  // ─── board templates (backed by the templates Lambda; ADR-0017) ─────────
  // One template graph per norm edition (Turtle in S3, a version in
  // NormTemplates), read by every signed-in user, written and verified by
  // dhc-template-editors and dhc-admins through a two-step save. The Lambda
  // enforces who may write; the rules here only require sign-in. Edges read
  // them through /edge/v1/templates/* (edgeTemplates).
  NormTemplateEdition: a.customType({
    edition: a.string().required(),         // nfc15100-2024
    label: a.string(),
    norm: a.string(),                       // the dhc:Norm IRI
    latest: a.boolean(),
    supersedes: a.string(),
    version: a.integer().required(),
    templates: a.integer(),
    updatedAt: a.string(),
    mayEdit: a.boolean(),
  }),
  TemplateGraph: a.customType({
    edition: a.string().required(),
    version: a.integer().required(),
    url: a.string(),
  }),
  TemplateSave: a.customType({
    status: a.string().required(),          // ready | ok | conflict | invalid
    key: a.string(),
    url: a.string(),
    version: a.integer(),
    templates: a.integer(),
    currentVersion: a.integer(),
    currentUrl: a.string(),
    problems: a.string().array(),
  }),

  templateEditions: a
    .query()
    .returns(a.ref("NormTemplateEdition").array())
    .handler(a.handler.function(templates))
    .authorization((allow) => [allow.authenticated()]),

  templateGraph: a
    .query()
    .arguments({ edition: a.string().required() })
    .returns(a.ref("TemplateGraph"))
    .handler(a.handler.function(templates))
    .authorization((allow) => [allow.authenticated()]),

  requestTemplatesSave: a
    .mutation()
    .arguments({ edition: a.string().required(), baseVersion: a.integer().required() })
    .returns(a.ref("TemplateSave"))
    .handler(a.handler.function(templates))
    .authorization((allow) => [allow.authenticated()]),

  commitTemplatesSave: a
    .mutation()
    .arguments({ edition: a.string().required(), key: a.string().required(), baseVersion: a.integer().required() })
    .returns(a.ref("TemplateSave"))
    .handler(a.handler.function(templates))
    .authorization((allow) => [allow.authenticated()]),

  // template: its id in the edition (t3-electric-heating) or its IRI
  verifyTemplate: a
    .mutation()
    .arguments({ edition: a.string().required(), template: a.string().required() })
    .returns(a.ref("TemplateSave"))
    .handler(a.handler.function(templates))
    .authorization((allow) => [allow.authenticated()]),

  // ─── A home's configurations (ADR 0018): live, legacy, planning options ──
  // Keyed on the home's meaningless homeId. The Lambda allows the home's
  // owners and dhc-admins only (allow.authenticated() just lets it run).
  HomeConfigVersion: a.customType({
    id: a.string().required(),              // <homeId>-MMMM-mmmm
    version: a.string().required(),         // MMMM-mmmm
    status: a.string().required(),          // live | superseded | legacy
    kind: a.string().required(),            // first | major | minor
    basedOn: a.string(),
    fromOption: a.string(),
    triples: a.integer(),
    summary: a.string(),
    at: a.string(),
    by: a.string(),
  }),
  HomeConfigOption: a.customType({
    id: a.string().required(),              // <homeId>-pNN
    label: a.string(),
    basedOn: a.string(),
    status: a.string(),                     // open | promoted
    promotedTo: a.string(),
    version: a.integer(),                   // the option graph's save counter
    updatedAt: a.string(),
    updatedBy: a.string(),
  }),
  HomeConfigurations: a.customType({
    homeId: a.string().required(),
    live: a.string(),
    versions: a.ref("HomeConfigVersion").array(),
    options: a.ref("HomeConfigOption").array(),
  }),
  HomeConfigGraph: a.customType({
    id: a.string().required(),
    kind: a.string(),                       // option | first | major | minor
    version: a.string(),
    url: a.string(),                        // 15 minutes
  }),
  HomeConfigSave: a.customType({
    status: a.string().required(),          // ready | ok | conflict | invalid
    key: a.string(),
    url: a.string(),
    version: a.integer(),
    triples: a.integer(),
    currentVersion: a.integer(),
    currentUrl: a.string(),
    problems: a.string().array(),
  }),
  HomeConfigChange: a.customType({
    status: a.string().required(),          // ok | conflict | invalid
    id: a.string(),
    version: a.string(),
    summary: a.string(),
    live: a.string(),
    problems: a.string().array(),
  }),

  homeConfigurations: a
    .query()
    .arguments({ homeId: a.string().required() })
    .returns(a.ref("HomeConfigurations"))
    .handler(a.handler.function(configurations))
    .authorization((allow) => [allow.authenticated()]),

  homeConfigurationGraph: a
    .query()
    .arguments({ homeId: a.string().required(), id: a.string().required() })
    .returns(a.ref("HomeConfigGraph"))
    .handler(a.handler.function(configurations))
    .authorization((allow) => [allow.authenticated()]),

  createHomeConfigOption: a
    .mutation()
    .arguments({ homeId: a.string().required(), basedOn: a.string().required(), label: a.string().required() })
    .returns(a.ref("HomeConfigOption"))
    .handler(a.handler.function(configurations))
    .authorization((allow) => [allow.authenticated()]),

  // step 1 without key: where to PUT; step 2 with the key from step 1
  saveHomeConfigOption: a
    .mutation()
    .arguments({ homeId: a.string().required(), option: a.string().required(), baseVersion: a.integer().required(), key: a.string() })
    .returns(a.ref("HomeConfigSave"))
    .handler(a.handler.function(configurations))
    .authorization((allow) => [allow.authenticated()]),

  promoteHomeConfigOption: a
    .mutation()
    .arguments({ homeId: a.string().required(), option: a.string().required() })
    .returns(a.ref("HomeConfigChange"))
    .handler(a.handler.function(configurations))
    .authorization((allow) => [allow.authenticated()]),

  seedHomeConfiguration: a
    .mutation()
    .arguments({ homeId: a.string().required(), ttl: a.string().required() })
    .returns(a.ref("HomeConfigChange"))
    .handler(a.handler.function(configurations))
    .authorization((allow) => [allow.authenticated()]),

  addHomeConfigMinor: a
    .mutation()
    .arguments({ homeId: a.string().required(), ttl: a.string().required(), expectedLive: a.string() })
    .returns(a.ref("HomeConfigChange"))
    .handler(a.handler.function(configurations))
    .authorization((allow) => [allow.authenticated()]),

  // a live major that changed nothing goes back to the version before it
  withdrawHomeConfigVersion: a
    .mutation()
    .arguments({ homeId: a.string().required(), id: a.string().required() })
    .returns(a.ref("HomeConfigChange"))
    .handler(a.handler.function(configurations))
    .authorization((allow) => [allow.authenticated()]),

  // ─── Blank QR tags (ADR 0018 point 10): minted per home, bound on site ───
  HomeTag: a.customType({
    tagId: a.string().required(),
    homeId: a.string().required(),
    item: a.string(),
    boundAt: a.string(),
  }),
  HomeTagsMinted: a.customType({
    homeId: a.string().required(),
    tags: a.string().array().required(),
  }),

  mintHomeTags: a
    .mutation()
    .arguments({ homeId: a.string().required(), count: a.integer().required() })
    .returns(a.ref("HomeTagsMinted"))
    .handler(a.handler.function(configurations))
    .authorization((allow) => [allow.authenticated()]),

  homeTag: a
    .query()
    .arguments({ tagId: a.string().required() })
    .returns(a.ref("HomeTag"))
    .handler(a.handler.function(configurations))
    .authorization((allow) => [allow.authenticated()]),

  bindHomeTag: a
    .mutation()
    .arguments({ tagId: a.string().required(), item: a.string() })
    .returns(a.ref("HomeTag"))
    .handler(a.handler.function(configurations))
    .authorization((allow) => [allow.authenticated()]),

  // ─── A home's vault (ADR 0019): photos and documents by configuration ───
  HomeVaultItem: a.customType({
    sha256: a.string().required(),
    kind: a.string().required(),            // photo | video | document | other
    name: a.string().required(),
    size: a.float(),
    contentType: a.string(),
    takenAt: a.string(),
    caption: a.string(),
    configVersion: a.string(),              // the first tag (older clients)
    tags: a.string().array(),               // <homeId>-MMMM-mmmm and <homeId>-pNN, one or several
    thumbUrl: a.string(),                   // 5 minutes
    uploadedAt: a.string(),
    uploadedBy: a.string(),
  }),
  HomeVaultItems: a.customType({
    homeId: a.string().required(),
    items: a.ref("HomeVaultItem").array(),
  }),
  HomeVaultResult: a.customType({
    status: a.string(),
    sha256: a.string(),
    configVersion: a.string(),
    url: a.string(),
  }),

  homeVaultItems: a
    .query()
    .arguments({ homeId: a.string().required(), configVersion: a.string(), tag: a.string() })
    .returns(a.ref("HomeVaultItems"))
    .handler(a.handler.function(homeVault))
    .authorization((allow) => [allow.authenticated()]),

  homeVaultItemUrl: a
    .query()
    .arguments({ homeId: a.string().required(), sha256: a.string().required() })
    .returns(a.ref("HomeVaultResult"))
    .handler(a.handler.function(homeVault))
    .authorization((allow) => [allow.authenticated()]),

  // files: [{ sha256, size, name, contentType, takenAt?, caption?, configVersion?, thumb? }]
  // → JSON { files: [{ sha256, status: known | new | too_large, url?, headers?, thumbUrl? }] }
  requestHomeVaultUpload: a
    .mutation()
    .arguments({ homeId: a.string().required(), files: a.json().required(), dryRun: a.boolean() })
    .returns(a.json())
    .handler(a.handler.function(homeVault))
    .authorization((allow) => [allow.authenticated()]),

  commitHomeVaultItem: a
    .mutation()
    .arguments({ homeId: a.string().required(), file: a.json().required() })
    .returns(a.ref("HomeVaultResult"))
    .handler(a.handler.function(homeVault))
    .authorization((allow) => [allow.authenticated()]),

  setHomeVaultItemGroup: a
    .mutation()
    .arguments({ homeId: a.string().required(), sha256: a.string().required(), configVersion: a.string() })
    .returns(a.ref("HomeVaultResult"))
    .handler(a.handler.function(homeVault))
    .authorization((allow) => [allow.authenticated()]),

  // several items at once → JSON { status, items: [{ sha256, tags }] }
  tagHomeVaultItems: a
    .mutation()
    .arguments({ homeId: a.string().required(), sha256s: a.string().array().required(), add: a.string().array(), remove: a.string().array() })
    .returns(a.json())
    .handler(a.handler.function(homeVault))
    .authorization((allow) => [allow.authenticated()]),

});

export type Schema = ClientSchema<typeof schema>;

export const data = defineData({
  schema,
  authorizationModes: {
    defaultAuthorizationMode: "userPool",
  },
});
