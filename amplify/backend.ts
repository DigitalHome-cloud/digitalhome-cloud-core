import { defineBackend } from "@aws-amplify/backend";
import { CfnOutput, Stack } from "aws-cdk-lib";
import { Effect, PolicyStatement } from "aws-cdk-lib/aws-iam";
import {
  AttributeType,
  BillingMode,
  ProjectionType,
  Table,
  TableEncryption,
} from "aws-cdk-lib/aws-dynamodb";
import {
  ApiMapping,
  CfnStage,
  DomainName,
  HttpApi,
  HttpMethod,
  CorsHttpMethod,
} from "aws-cdk-lib/aws-apigatewayv2";
import { HttpLambdaIntegration } from "aws-cdk-lib/aws-apigatewayv2-integrations";
import {
  Certificate,
  CertificateValidation,
} from "aws-cdk-lib/aws-certificatemanager";
import {
  ARecord,
  AaaaRecord,
  HostedZone,
  RecordTarget,
} from "aws-cdk-lib/aws-route53";
import { ApiGatewayv2DomainProperties } from "aws-cdk-lib/aws-route53-targets";
import { auth } from "./auth/resource";
import { data } from "./data/resource";
import { storage } from "./storage/resource";
import { dhcDesignStorageProxy } from "./functions/dhcDesignStorageProxy/resource";
import { postConfirmation } from "./functions/postConfirmation/resource";
import { createDigitalHome } from "./functions/createDigitalHome/resource";
import { edgeDeviceAuthz } from "./functions/edgeDeviceAuthz/resource";
import { edgeToken } from "./functions/edgeToken/resource";
import { edgeTelemetry } from "./functions/edgeTelemetry/resource";
import { edgeTokenRotate } from "./functions/edgeTokenRotate/resource";
import { edgeDeviceApproval } from "./functions/edgeDeviceApproval/resource";
import { adminDebug } from "./functions/adminDebug/resource";

const backend = defineBackend({
  auth,
  data,
  storage,
  dhcDesignStorageProxy,
  postConfirmation,
  createDigitalHome,
  edgeDeviceAuthz,
  edgeToken,
  edgeTelemetry,
  edgeTokenRotate,
  edgeDeviceApproval,
  adminDebug,
});

// ─── dhcDesignStorageProxy IAM + env wiring (DH-SPEC-203, audit C-2 v2) ─────
// The Lambda needs:
//   1. S3 GetObject/PutObject/DeleteObject on the bucket (so it can sign URLs).
//   2. DDB Query on the SmartHomeDesign table (so it can verify ownership).
//   3. Two env vars resolving to the bucket name and table name.
// Gen 2 doesn't auto-grant cross-resource IAM when a function is attached as
// a custom-mutation handler, so we do it explicitly here.
const proxyLambda = backend.dhcDesignStorageProxy.resources.lambda;
const bucket = backend.storage.resources.bucket;
const smartHomeDesignTable = backend.data.resources.tables.SmartHomeDesign;
const digitalHomeTable = backend.data.resources.tables.DigitalHome;

proxyLambda.addToRolePolicy(
  new PolicyStatement({
    effect: Effect.ALLOW,
    actions: ["s3:GetObject", "s3:PutObject", "s3:DeleteObject"],
    resources: [`${bucket.bucketArn}/*`],
  })
);

proxyLambda.addToRolePolicy(
  new PolicyStatement({
    effect: Effect.ALLOW,
    actions: [
      "dynamodb:GetItem",
      "dynamodb:Query",
      "dynamodb:Scan",
      "dynamodb:BatchGetItem",
    ],
    resources: [
      smartHomeDesignTable.tableArn,
      `${smartHomeDesignTable.tableArn}/index/*`,
      digitalHomeTable.tableArn,
    ],
  })
);

backend.dhcDesignStorageProxy.addEnvironment(
  "STORAGE_BUCKET_NAME",
  bucket.bucketName
);
backend.dhcDesignStorageProxy.addEnvironment(
  "SMARTHOMEDESIGN_TABLE_NAME",
  smartHomeDesignTable.tableName
);
backend.dhcDesignStorageProxy.addEnvironment(
  "DIGITALHOME_TABLE_NAME",
  digitalHomeTable.tableName
);

// ─── DDB Point-in-Time Recovery (audit M-6) ────────────────────────────────
// Gen 2's data tables are wrapped by the AmplifyDynamoDbTable construct (not
// standard CfnTable), so the knob is exposed via cfnResources.amplifyDynamoDb
// Tables[name].pointInTimeRecoveryEnabled. PITR is free up to 35 days of
// recovery window and gives us a rollback path if a table is accidentally
// truncated.
const tablesNeedingPITR = [
  "UserProfile",
  "LibraryItem",
  "DigitalHome",
  "SmartHomeDesign",
  "DeviceModel",
  "DeviceInstance",
] as const;
for (const tableName of tablesNeedingPITR) {
  backend.data.resources.cfnResources.amplifyDynamoDbTables[
    tableName
  ].pointInTimeRecoveryEnabled = true;
}

// ─── postConfirmation IAM (Cognito group management) ────────────────────────
// The trigger needs to call cognito-idp:AdminAddUserToGroup, GetGroup, and
// CreateGroup. Gen 2's defineAuth({ triggers }) wires the Lambda invocation
// principal but does NOT auto-grant Cognito admin IAM, so we add it here.
//
// Important: scope to a wildcard userpool ARN, NOT backend.auth.resources
// .userPool.userPoolArn, to avoid a CFN circular dependency. The auth stack
// already references the postConfirmation Lambda (as a trigger), so adding
// a back-reference from the Lambda's role to the User Pool would close the
// cycle. The trigger event carries `event.userPoolId` at runtime — the
// Lambda uses that to address the actual pool — so a region+account-scoped
// wildcard is sufficient and keeps the IAM tight to this AWS account.
const proxyStack = Stack.of(backend.postConfirmation.resources.lambda);
const userPoolWildcardArn = `arn:aws:cognito-idp:${proxyStack.region}:${proxyStack.account}:userpool/*`;

backend.postConfirmation.resources.lambda.addToRolePolicy(
  new PolicyStatement({
    effect: Effect.ALLOW,
    actions: [
      "cognito-idp:AdminAddUserToGroup",
      "cognito-idp:GetGroup",
      "cognito-idp:CreateGroup",
    ],
    resources: [userPoolWildcardArn],
  })
);

// ─── createDigitalHome IAM + env wiring (Step 1 / abox.md) ─────────────────
// The Lambda performs:
//   - S3 PutObject under Private/DigitalHomes/* and Public/DigitalHomes/*
//     for abox.ttl, graph.jsonld, and folder placeholders.
//   - DDB GetItem/PutItem on the DigitalHome table (uniqueness + persist).
//   - Cognito CreateGroup + AdminAddUserToGroup (per-home group named after
//     the smartHomeId).
//
// Same wildcard-userpool pattern as postConfirmation — createDigitalHome is
// not a Cognito trigger, so we *could* reference backend.auth.resources
// .userPool.userPoolArn directly, but the wildcard is symmetrical with the
// existing pattern and keeps the IAM language consistent. We do, however,
// pass the User Pool ID to the Lambda via env var (no circular dep — the
// dependency only flows Lambda → UserPool, not back).
const createDhLambda = backend.createDigitalHome.resources.lambda;

createDhLambda.addToRolePolicy(
  new PolicyStatement({
    effect: Effect.ALLOW,
    actions: ["s3:PutObject"],
    resources: [
      `${bucket.bucketArn}/Private/DigitalHomes/*`,
      `${bucket.bucketArn}/Public/DigitalHomes/*`,
    ],
  })
);

createDhLambda.addToRolePolicy(
  new PolicyStatement({
    effect: Effect.ALLOW,
    actions: ["dynamodb:GetItem", "dynamodb:PutItem"],
    resources: [digitalHomeTable.tableArn],
  })
);

createDhLambda.addToRolePolicy(
  new PolicyStatement({
    effect: Effect.ALLOW,
    actions: [
      "cognito-idp:CreateGroup",
      "cognito-idp:AdminAddUserToGroup",
    ],
    resources: [userPoolWildcardArn],
  })
);

backend.createDigitalHome.addEnvironment(
  "STORAGE_BUCKET_NAME",
  bucket.bucketName
);
backend.createDigitalHome.addEnvironment(
  "DIGITALHOME_TABLE_NAME",
  digitalHomeTable.tableName
);
backend.createDigitalHome.addEnvironment(
  "USER_POOL_ID",
  backend.auth.resources.userPool.userPoolId
);

// ─── Edge ↔ Cloud registration (DH-SPEC-100) ──────────────────────────────
// The RFC 8628 device-flow endpoints for digitalhome-edge boxes. This is the
// repo's first API Gateway and first CDK-native DynamoDB tables — everything
// else is AppSync/Cognito. All of it lives in a dedicated "edge" nested stack;
// the Lambdas (in their own function stacks) reach it via cross-stack refs.
//
// Wire spec: digitalhome-edge/docs/specs/edge-cloud-api.md v0.2.
//
// The 4 HTTP Lambdas share resourceGroupName "edge", so they live in one nested
// stack; we build the tables + HTTP API into that SAME stack (Stack.of the
// grouped Lambda). Colocating the API (which references the Lambdas) with the
// tables (which the Lambdas reference) avoids the cross-stack circular
// dependency that a standalone createStack() would create. The AppSync approval
// Lambda stays in the "data" group and reads the edge tables one-directionally.
const edgeStack = Stack.of(backend.edgeDeviceAuthz.resources.lambda);

// DeviceCodes — short-lived pairing state (spec §5.1). Auto-expires 10 min
// after creation via the `expires_at` TTL attribute (unix epoch seconds).
// GSI `byUserCode` lets the Portal /link page (and the authz collision check)
// find a row by the human-typed user_code.
const deviceCodesTable = new Table(edgeStack, "DeviceCodes", {
  partitionKey: { name: "device_code", type: AttributeType.STRING },
  billingMode: BillingMode.PAY_PER_REQUEST,
  timeToLiveAttribute: "expires_at",
  pointInTimeRecovery: true,
  encryption: TableEncryption.AWS_MANAGED,
});
deviceCodesTable.addGlobalSecondaryIndex({
  indexName: "byUserCode",
  partitionKey: { name: "user_code", type: AttributeType.STRING },
  projectionType: ProjectionType.KEYS_ONLY,
});

// EdgeRegistry — durable per-edge record (spec §5.2). Rows land here only after
// a Cognito-approved token exchange. Stores sha256(device_token), never the
// raw token. GSIs: dedup on re-link by machine_id, admin list-per-home by
// home_id.
const edgeRegistryTable = new Table(edgeStack, "EdgeRegistry", {
  partitionKey: { name: "edge_id", type: AttributeType.STRING },
  billingMode: BillingMode.PAY_PER_REQUEST,
  pointInTimeRecovery: true,
  encryption: TableEncryption.AWS_MANAGED,
});
edgeRegistryTable.addGlobalSecondaryIndex({
  indexName: "byMachineId",
  partitionKey: { name: "machine_id", type: AttributeType.STRING },
  projectionType: ProjectionType.ALL,
});
edgeRegistryTable.addGlobalSecondaryIndex({
  indexName: "byHomeId",
  partitionKey: { name: "home_id", type: AttributeType.STRING },
  sortKey: { name: "edge_id", type: AttributeType.STRING },
  projectionType: ProjectionType.ALL,
});
// byOwner — the Portal "My Edges" view lists a user's registered edges.
edgeRegistryTable.addGlobalSecondaryIndex({
  indexName: "byOwner",
  partitionKey: { name: "linked_by_cognito_sub", type: AttributeType.STRING },
  sortKey: { name: "edge_id", type: AttributeType.STRING },
  projectionType: ProjectionType.ALL,
});

// Wire table names into every edge Lambda (the 4 HTTP handlers + the AppSync
// approval handler) and grant least-privilege DDB access per spec §8.1.
const edgeAuthzFn = backend.edgeDeviceAuthz.resources.lambda;
const edgeTokenFn = backend.edgeToken.resources.lambda;
const edgeTelemetryFn = backend.edgeTelemetry.resources.lambda;
const edgeRotateFn = backend.edgeTokenRotate.resources.lambda;
const edgeApprovalFn = backend.edgeDeviceApproval.resources.lambda;

for (const fn of [
  backend.edgeDeviceAuthz,
  backend.edgeToken,
  backend.edgeTelemetry,
  backend.edgeTokenRotate,
]) {
  fn.addEnvironment("DEVICE_CODES_TABLE_NAME", deviceCodesTable.tableName);
  fn.addEnvironment("EDGE_REGISTRY_TABLE_NAME", edgeRegistryTable.tableName);
}
// verification_uri the box shows (QR) points the user at the matching Portal
// per environment: stage → stage-portal, otherwise prod.
const deployBranch = process.env.AWS_BRANCH;
const portalLinkUrl =
  process.env.PORTAL_LINK_URL ||
  (deployBranch === "stage"
    ? "https://stage-portal.digitalhome.cloud/link"
    : "https://portal.digitalhome.cloud/link");
backend.edgeDeviceAuthz.addEnvironment("PORTAL_LINK_URL", portalLinkUrl);

// edgeDeviceAuthz: only writes pending DeviceCodes rows + reads the user_code
// GSI for collision avoidance.
edgeAuthzFn.addToRolePolicy(
  new PolicyStatement({
    effect: Effect.ALLOW,
    actions: ["dynamodb:PutItem", "dynamodb:Query"],
    resources: [
      deviceCodesTable.tableArn,
      `${deviceCodesTable.tableArn}/index/*`,
    ],
  })
);

// edgeToken: reads/updates/deletes DeviceCodes, queries the machine_id GSI for
// re-link dedup, and writes the durable EdgeRegistry row.
edgeTokenFn.addToRolePolicy(
  new PolicyStatement({
    effect: Effect.ALLOW,
    actions: [
      "dynamodb:GetItem",
      "dynamodb:UpdateItem",
      "dynamodb:DeleteItem",
    ],
    resources: [deviceCodesTable.tableArn],
  })
);
edgeTokenFn.addToRolePolicy(
  new PolicyStatement({
    effect: Effect.ALLOW,
    actions: ["dynamodb:PutItem", "dynamodb:Query"],
    resources: [
      edgeRegistryTable.tableArn,
      `${edgeRegistryTable.tableArn}/index/*`,
    ],
  })
);

// edgeTelemetry + edgeTokenRotate: read/update the EdgeRegistry row by PK only.
for (const fn of [edgeTelemetryFn, edgeRotateFn]) {
  fn.addToRolePolicy(
    new PolicyStatement({
      effect: Effect.ALLOW,
      actions: ["dynamodb:GetItem", "dynamodb:UpdateItem"],
      resources: [edgeRegistryTable.tableArn],
    })
  );
}

// edgeDeviceApproval (AppSync): queries the KEYS_ONLY user_code GSI, re-reads
// the base row (GetItem) for device_info, updates DeviceCodes, reads DigitalHome
// to verify home ownership, and (two-step) reads/updates EdgeRegistry to list
// and (re)assign the caller's edges.
edgeApprovalFn.addToRolePolicy(
  new PolicyStatement({
    effect: Effect.ALLOW,
    actions: ["dynamodb:Query", "dynamodb:GetItem", "dynamodb:UpdateItem"],
    resources: [
      deviceCodesTable.tableArn,
      `${deviceCodesTable.tableArn}/index/*`,
    ],
  })
);
edgeApprovalFn.addToRolePolicy(
  new PolicyStatement({
    effect: Effect.ALLOW,
    actions: ["dynamodb:GetItem"],
    resources: [digitalHomeTable.tableArn],
  })
);
edgeApprovalFn.addToRolePolicy(
  new PolicyStatement({
    effect: Effect.ALLOW,
    actions: ["dynamodb:GetItem", "dynamodb:UpdateItem", "dynamodb:Query"],
    resources: [
      edgeRegistryTable.tableArn,
      `${edgeRegistryTable.tableArn}/index/*`,
    ],
  })
);
backend.edgeDeviceApproval.addEnvironment(
  "DEVICE_CODES_TABLE_NAME",
  deviceCodesTable.tableName
);
backend.edgeDeviceApproval.addEnvironment(
  "DIGITALHOME_TABLE_NAME",
  digitalHomeTable.tableName
);
backend.edgeDeviceApproval.addEnvironment(
  "EDGE_REGISTRY_TABLE_NAME",
  edgeRegistryTable.tableName
);

// HTTP API — POST routes under /edge/v1/*. The edge appends fixed paths to its
// configured base URL and ignores any cloud_endpoints we return, so these
// paths are load-bearing and must not move.
const edgeApi = new HttpApi(edgeStack, "EdgeHttpApi", {
  apiName: "dhc-edge-api",
  // CORS is irrelevant to the edge (server-to-server) but harmless; keep it
  // tight to the JSON POST surface.
  corsPreflight: {
    allowOrigins: ["*"],
    allowMethods: [CorsHttpMethod.POST],
    allowHeaders: ["content-type", "authorization"],
  },
});

const routes: Array<[string, typeof edgeAuthzFn]> = [
  ["/edge/v1/device_authorization", edgeAuthzFn],
  ["/edge/v1/token", edgeTokenFn],
  ["/edge/v1/telemetry", edgeTelemetryFn],
  ["/edge/v1/token/rotate", edgeRotateFn],
];
for (const [path, fn] of routes) {
  edgeApi.addRoutes({
    path,
    methods: [HttpMethod.POST],
    integration: new HttpLambdaIntegration(
      `EdgeIntegration${path.replace(/[^a-zA-Z0-9]/g, "")}`,
      fn
    ),
  });
}

// Stage-level throttling (spec §7.2). This is a coarse account-friendly cap on
// the whole edge surface; the precise per-device_code 12/min limit on /token is
// enforced in the edgeToken handler via poll_count/last_poll_at. Tighter
// IP-based limits (WAF) are a later hardening step.
const defaultStage = edgeApi.defaultStage?.node.defaultChild as CfnStage;
if (defaultStage) {
  defaultStage.defaultRouteSettings = {
    throttlingBurstLimit: 20,
    throttlingRateLimit: 10,
  };
}

// ─── Custom domain (branch-aware) ─────────────────────────────────────────
// Map the edge HTTP API onto a stable hostname per environment:
//   stage branch → stage-api.digitalhome.cloud
//   main  branch → api.digitalhome.cloud   (the edge client's hardcoded default)
// Only on the deployed pipeline branches — personal sandboxes keep the raw
// execute-api URL (AWS_BRANCH is unset there). DNS is Route53-hosted in this
// account, so the ACM cert (DNS-validated) and the alias record are created
// automatically. NOTE: the Amplify pipeline deploy role must have ACM +
// Route53 (ListHostedZonesByName / ChangeResourceRecordSets / GetChange)
// permissions, or the deploy will fail here.
const edgeApiDomain =
  deployBranch === "main"
    ? "api.digitalhome.cloud"
    : deployBranch === "stage"
    ? "stage-api.digitalhome.cloud"
    : null;

if (edgeApiDomain && edgeApi.defaultStage) {
  // fromHostedZoneAttributes (not fromLookup) — Amplify Gen2 stacks are
  // env-agnostic, so a context lookup fails; the zone id is stable, so pin it.
  const zone = HostedZone.fromHostedZoneAttributes(edgeStack, "DhcZone", {
    hostedZoneId: "Z07301791TDZ9RI2P98OL",
    zoneName: "digitalhome.cloud",
  });
  const cert = new Certificate(edgeStack, "EdgeApiCert", {
    domainName: edgeApiDomain,
    validation: CertificateValidation.fromDns(zone),
  });
  const dn = new DomainName(edgeStack, "EdgeApiDomain", {
    domainName: edgeApiDomain,
    certificate: cert,
  });
  // Root mapping → routes stay at /edge/v1/* (no base path).
  new ApiMapping(edgeStack, "EdgeApiMapping", {
    api: edgeApi,
    domainName: dn,
    stage: edgeApi.defaultStage,
  });
  const recordName = edgeApiDomain.replace(".digitalhome.cloud", "");
  const target = RecordTarget.fromAlias(
    new ApiGatewayv2DomainProperties(dn.regionalDomainName, dn.regionalHostedZoneId)
  );
  new ARecord(edgeStack, "EdgeApiARecord", { zone, recordName, target });
  new AaaaRecord(edgeStack, "EdgeApiAaaaRecord", { zone, recordName, target });

  new CfnOutput(edgeStack, "dhcEdgeApiCustomDomain", {
    value: `https://${edgeApiDomain}/edge/v1`,
    description: "Custom-domain base URL for the edge API (cloudApiUrl).",
  });
}

// Surface the invoke URL as a stack-scoped CloudFormation Output (NOT an
// exportValue — a named Export is global per account/region and would collide
// across the sandbox and stage stacks). Set the edge box's Node-RED
// cloudApiUrl to `<this>/edge/v1`.
new CfnOutput(edgeStack, "dhcEdgeApiEndpoint", {
  value: edgeApi.apiEndpoint,
  description:
    "Base URL of the edge HTTP API. Edge cloudApiUrl = <this>/edge/v1.",
});

// ─── adminDebug IAM + env (read-only AWS inspection for the /debug page) ────
// List/describe only — no GetObject, no writes. dhc-admins is enforced at the
// AppSync layer (allow.group) and re-checked in the handler. The userpool-wildcard
// ARN mirrors postConfirmation/createDigitalHome to avoid an auth→data CFN cycle.
const dbgLambda = backend.adminDebug.resources.lambda;
dbgLambda.addToRolePolicy(
  new PolicyStatement({
    effect: Effect.ALLOW,
    actions: ["s3:ListBucket"],
    resources: [bucket.bucketArn],
  })
);
dbgLambda.addToRolePolicy(
  new PolicyStatement({
    effect: Effect.ALLOW,
    actions: ["dynamodb:ListTables"],
    resources: ["*"],
  })
);
dbgLambda.addToRolePolicy(
  new PolicyStatement({
    effect: Effect.ALLOW,
    actions: ["dynamodb:DescribeTable"],
    resources: [
      `arn:aws:dynamodb:${Stack.of(dbgLambda).region}:${Stack.of(dbgLambda).account}:table/*`,
    ],
  })
);
dbgLambda.addToRolePolicy(
  new PolicyStatement({
    effect: Effect.ALLOW,
    actions: [
      "cognito-idp:ListGroups",
      "cognito-idp:ListUsersInGroup",
      "cognito-idp:ListUsers",
    ],
    resources: [userPoolWildcardArn],
  })
);
backend.adminDebug.addEnvironment("BUCKET_NAME", bucket.bucketName);
backend.adminDebug.addEnvironment(
  "USER_POOL_ID",
  backend.auth.resources.userPool.userPoolId
);

export default backend;
