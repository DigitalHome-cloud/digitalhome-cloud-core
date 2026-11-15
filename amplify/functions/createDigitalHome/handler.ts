// createDigitalHome — AppSync custom mutation handler.
//
// Performs the six side effects of Step 1 (Initiation) per
// repos/core/experimental/abox/abox.md:
//
//   1. Validate input + compute smartHomeId from structured address fields.
//   2. Reject if a DigitalHome with that ID already exists.
//   3. Author abox.ttl + graph.jsonld (T-Box-compliant — createdBy is an IRI
//      to a rec:Agent instance, not a literal).
//   4. Persist a DigitalHome row in DynamoDB.
//   5. Create a Cognito group named after the smartHomeId (idempotent).
//   6. Add the caller to that group.
//   7. Write the A-Box files + folder placeholders to S3 under
//      Private/DigitalHomes/<id>/ (and a Public/ placeholder when not a demo).
//
// Auth: caller must be in dhc-standard, dhc-professional, or dhc-admins.

import {
  S3Client,
  PutObjectCommand,
} from "@aws-sdk/client-s3";
import {
  DynamoDBClient,
  GetItemCommand,
  PutItemCommand,
} from "@aws-sdk/client-dynamodb";
import { marshall } from "@aws-sdk/util-dynamodb";
import {
  CognitoIdentityProviderClient,
  AdminAddUserToGroupCommand,
  CreateGroupCommand,
} from "@aws-sdk/client-cognito-identity-provider";
import type { AppSyncResolverEvent, AppSyncIdentityCognito } from "aws-lambda";

import {
  computeSmartHomeId,
  validateParts,
  type SmartHomeIdParts,
} from "./smartHomeId";
import { buildAboxTurtle, buildAboxJsonLd } from "./abox";

const REGION = process.env.AWS_REGION || "eu-central-1";
const BUCKET = process.env.STORAGE_BUCKET_NAME!;
const TABLE = process.env.DIGITALHOME_TABLE_NAME!;
const USER_POOL_ID = process.env.USER_POOL_ID!;

const s3 = new S3Client({ region: REGION });
const ddb = new DynamoDBClient({ region: REGION });
const cognito = new CognitoIdentityProviderClient({ region: REGION });

// Tier-based authz (Welcome → local only, Standard/Pro → cloud) is the job
// of DH-SPEC-002, not Step 1. For now we only require an authenticated
// caller. Tighten when the tier matrix lands.
interface CreateArgs {
  country: string;
  postalCode: string;
  streetCode: string;
  houseNumber: string;
  suffix: string;
  city: string;
  addressLine1: string;
  addressLine2?: string | null;
  isDemo: boolean;
}

interface CreatePayload {
  smartHomeId: string;
  createdAt: string;
}

export const handler = async (
  event: AppSyncResolverEvent<CreateArgs>
): Promise<CreatePayload> => {
  if (!BUCKET || !TABLE || !USER_POOL_ID) {
    throw new Error(
      "Server misconfigured: STORAGE_BUCKET_NAME, DIGITALHOME_TABLE_NAME, USER_POOL_ID required"
    );
  }

  // 1. Authenticate
  const identity = event.identity as AppSyncIdentityCognito | undefined;
  if (!identity?.sub) {
    throw new Error("Unauthenticated");
  }
  const sub = identity.sub;
  const username = identity.username || sub;
  const claims = (identity as unknown as { claims?: Record<string, string> }).claims || {};
  const displayName =
    claims.name || claims["cognito:username"] || username;

  // 2. Validate input (arguments are flat — no `input` wrapper)
  const args = event.arguments;
  if (!args) throw new Error("arguments are required");
  const parts: SmartHomeIdParts = {
    country: (args.country || "").toUpperCase().trim(),
    postalCode: (args.postalCode || "").trim(),
    streetCode: (args.streetCode || "").toUpperCase().trim(),
    houseNumber: (args.houseNumber || "").trim(),
    suffix: (args.suffix || "").trim(),
  };
  const partsValid = validateParts(parts);
  if (!partsValid.valid) {
    throw new Error(`Invalid input: ${partsValid.error}`);
  }
  const city = (args.city || "").trim();
  const addressLine1 = (args.addressLine1 || "").trim();
  const addressLine2 = (args.addressLine2 || "").trim();
  if (!city) throw new Error("city is required");
  if (!addressLine1) throw new Error("addressLine1 is required");

  // 4. Compute id
  const smartHomeId = computeSmartHomeId(parts);

  // 5. Uniqueness check (DDB GetItem on smartHomeId PK)
  const existing = await ddb.send(
    new GetItemCommand({
      TableName: TABLE,
      Key: marshall({ smartHomeId }),
    })
  );
  if (existing.Item) {
    throw new Error(`DigitalHome ${smartHomeId} already exists`);
  }

  // 6. Build A-Box artifacts
  const now = new Date().toISOString();
  const aboxInput = {
    smartHomeId,
    agentId: sub,
    agentLabel: displayName,
    country: parts.country,
    postalCode: parts.postalCode,
    city,
    addressLine1,
    addressLine2: addressLine2 || undefined,
    isDemo: !!args.isDemo,
    createdAt: now,
    updatedAt: now,
  };
  const ttl = await buildAboxTurtle(aboxInput);
  const jsonld = buildAboxJsonLd(aboxInput);

  // 7. DDB PutItem
  await ddb.send(
    new PutItemCommand({
      TableName: TABLE,
      Item: marshall(
        {
          smartHomeId,
          country: parts.country,
          postalCode: parts.postalCode,
          streetCode: parts.streetCode,
          houseNumber: parts.houseNumber,
          suffix: parts.suffix,
          city,
          addressLine1,
          addressLine2: addressLine2 || null,
          isDemo: !!args.isDemo,
          createdBy: sub,
          createdAt: now,
          updatedAt: now,
          owners: [sub],
          __typename: "DigitalHome",
        },
        { removeUndefinedValues: true }
      ),
    })
  );

  // 8. Cognito group (idempotent — ignore GroupExistsException)
  try {
    await cognito.send(
      new CreateGroupCommand({
        GroupName: smartHomeId,
        UserPoolId: USER_POOL_ID,
        Description: `Members of DigitalHome ${smartHomeId}`,
      })
    );
  } catch (err) {
    const errName = (err as { name?: string })?.name;
    if (errName !== "GroupExistsException") {
      console.warn("[createDigitalHome] CreateGroup failed:", err);
    }
  }

  // 9. Add caller to the group
  await cognito.send(
    new AdminAddUserToGroupCommand({
      GroupName: smartHomeId,
      UserPoolId: USER_POOL_ID,
      Username: username,
    })
  );

  // S3 writes — route by isDemo:
  //   real homes → Private/DigitalHomes/<id>/...   (owner-only)
  //   demo homes → Public/DigitalHomes/<id>/...    (publicly viewable)
  const baseRoot = args.isDemo ? "Public" : "Private";
  const base = `${baseRoot}/DigitalHomes/${smartHomeId}`;

  await s3.send(
    new PutObjectCommand({
      Bucket: BUCKET,
      Key: `${base}/designtime/abox.ttl`,
      Body: ttl,
      ContentType: "text/turtle; charset=utf-8",
    })
  );
  await s3.send(
    new PutObjectCommand({
      Bucket: BUCKET,
      Key: `${base}/designtime/graph.jsonld`,
      Body: JSON.stringify(jsonld, null, 2),
      ContentType: "application/ld+json; charset=utf-8",
    })
  );
  await s3.send(
    new PutObjectCommand({
      Bucket: BUCKET,
      Key: `${base}/data/.keep`,
      Body: "",
    })
  );

  // 11. Return
  return { smartHomeId, createdAt: now };
};
