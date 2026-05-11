/**
 * dhcDesignStorageProxy — AppSync Lambda resolver for multi-owner S3 access.
 *
 * Handles three AppSync mutations:
 *   - requestDesignReadUrl(smartHomeId, fileName)         (legacy, design save/load)
 *   - requestDesignWriteUrl(smartHomeId, fileName, ct?)   (legacy, design save/load)
 *   - requestDigitalHomeReadUrl(smartHomeId, fileName)    (step-1 designtime read)
 *
 * Path & ownership routing:
 *   requestDesign{Read,Write}Url → key  = tenant/{smartHomeId}/{fileName}
 *                                  authz = SmartHomeDesign.owners + dhc-admins
 *   requestDigitalHomeReadUrl    → key  = {Private|Public}/DigitalHomes/{id}/designtime/{fileName}
 *                                  authz = DigitalHome.owners       + dhc-admins
 *                                  root  = Public if DigitalHome.isDemo else Private
 *
 * Returns a 5-minute pre-signed S3 URL.
 *
 * Env vars (set in backend.ts via addEnvironment):
 *   STORAGE_BUCKET_NAME           — the dhcStorage S3 bucket
 *   SMARTHOMEDESIGN_TABLE_NAME    — the SmartHomeDesign DDB table
 *   DIGITALHOME_TABLE_NAME        — the DigitalHome DDB table (step-1)
 *   AWS_REGION                    — Lambda runtime default
 */

import {
  S3Client,
  GetObjectCommand,
  PutObjectCommand,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import {
  DynamoDBClient,
  ScanCommand,
  GetItemCommand,
  type ScanCommandInput,
} from "@aws-sdk/client-dynamodb";
import { marshall, unmarshall } from "@aws-sdk/util-dynamodb";
import type {
  AppSyncResolverEvent,
  AppSyncIdentityCognito,
} from "aws-lambda";

const REGION = process.env.AWS_REGION || "eu-central-1";
const BUCKET = process.env.STORAGE_BUCKET_NAME;
const SMARTHOMEDESIGN_TABLE = process.env.SMARTHOMEDESIGN_TABLE_NAME;
const DIGITALHOME_TABLE = process.env.DIGITALHOME_TABLE_NAME;
const URL_TTL_SECONDS = 300;
const FILE_NAME_RE = /^[A-Za-z0-9._-]+$/;

const s3 = new S3Client({ region: REGION });
const ddb = new DynamoDBClient({ region: REGION });

interface ProxyArgs {
  smartHomeId: string;
  fileName: string;
  contentType?: string;
}

interface ProxyResponse {
  url: string;
  expiresAt: string;
  contentType: string | null;
}

export const handler = async (
  event: AppSyncResolverEvent<ProxyArgs>
): Promise<ProxyResponse> => {
  // Amplify Gen 2's JS pipeline resolver flattens the AppSync $context,
  // so fieldName is a top-level event property — not under `event.info`.
  // Keep the `event.info?.fieldName` fallback in case Amplify reverts to
  // the standard envelope in a future release.
  const fieldName =
    event.info?.fieldName ??
    (event as unknown as { fieldName?: string }).fieldName;
  if (!fieldName) {
    throw new Error(
      `[proxy] no fieldName in event — keys: ${Object.keys(event).join(",")}`
    );
  }
  // We only authorize the AppSync API with Cognito User Pool, so identity is
  // always the Cognito variant when the resolver is invoked. Narrow the union.
  const identity = event.identity as AppSyncIdentityCognito | undefined;
  const { smartHomeId, fileName, contentType } = event.arguments ?? ({} as ProxyArgs);

  if (!smartHomeId || !fileName) {
    throw new Error("smartHomeId and fileName are required");
  }
  if (!BUCKET) {
    throw new Error("Server misconfigured: missing STORAGE_BUCKET_NAME");
  }
  if (!FILE_NAME_RE.test(fileName)) {
    throw new Error("Invalid fileName: only [A-Za-z0-9._-] characters allowed");
  }

  const username = identity?.username;
  const groups = identity?.groups || [];
  const sub = identity?.sub;
  const isAdmin = groups.includes("dhc-admins");

  if (!username) {
    throw new Error("Unauthenticated");
  }

  // Helper: caller is authorized if admin or in the supplied owners list.
  // Owners are stored as Cognito sub strings (postConfirmation Lambda + the
  // initiateDigitalHome Lambda both use sub). Username matches sub when the
  // pool's sign-in method is sub-based; for safety we check both.
  const isOwner = (owners: string[]) =>
    isAdmin || owners.includes(username) || (!!sub && owners.includes(sub));

  // ─── digitalhome (step-1 designtime files) ─────────────────────────
  if (fieldName === "requestDigitalHomeReadUrl") {
    if (!DIGITALHOME_TABLE) {
      throw new Error("Server misconfigured: missing DIGITALHOME_TABLE_NAME");
    }
    const result = await ddb.send(
      new GetItemCommand({
        TableName: DIGITALHOME_TABLE,
        Key: marshall({ smartHomeId }),
      })
    );
    if (!result.Item) {
      throw new Error(`DigitalHome ${smartHomeId} not found`);
    }
    const home = unmarshall(result.Item) as {
      owners?: string[];
      isDemo?: boolean;
    };
    if (!isOwner(home.owners || [])) {
      throw new Error("Not authorized");
    }
    const root = home.isDemo ? "Public" : "Private";
    const key = `${root}/DigitalHomes/${smartHomeId}/designtime/${fileName}`;
    const url = await getSignedUrl(
      s3,
      new GetObjectCommand({ Bucket: BUCKET, Key: key }),
      { expiresIn: URL_TTL_SECONDS }
    );
    return {
      url,
      expiresAt: new Date(Date.now() + URL_TTL_SECONDS * 1000).toISOString(),
      contentType: null,
    };
  }

  // ─── legacy design save/load (tenant/{id}/...) ─────────────────────
  if (
    fieldName === "requestDesignReadUrl" ||
    fieldName === "requestDesignWriteUrl"
  ) {
    if (!SMARTHOMEDESIGN_TABLE) {
      throw new Error(
        "Server misconfigured: missing SMARTHOMEDESIGN_TABLE_NAME"
      );
    }

    if (!isAdmin) {
      const scanInput: ScanCommandInput = {
        TableName: SMARTHOMEDESIGN_TABLE,
        FilterExpression: "smartHomeId = :sh",
        ExpressionAttributeValues: { ":sh": { S: smartHomeId } },
        ProjectionExpression: "#id, owners",
        ExpressionAttributeNames: { "#id": "id" },
        Limit: 1,
      };
      const result = await ddb.send(new ScanCommand(scanInput));
      const design = (result.Items || []).map(
        (it: Record<string, unknown>) => unmarshall(it as Record<string, never>)
      )[0];
      if (!design) {
        throw new Error(`SmartHomeDesign not found for ${smartHomeId}`);
      }
      if (!isOwner(design.owners || [])) {
        throw new Error("Not authorized");
      }
    }

    const key = `tenant/${smartHomeId}/${fileName}`;
    const url =
      fieldName === "requestDesignReadUrl"
        ? await getSignedUrl(
            s3,
            new GetObjectCommand({ Bucket: BUCKET, Key: key }),
            { expiresIn: URL_TTL_SECONDS }
          )
        : await getSignedUrl(
            s3,
            new PutObjectCommand({
              Bucket: BUCKET,
              Key: key,
              ContentType: contentType,
            }),
            { expiresIn: URL_TTL_SECONDS }
          );
    return {
      url,
      expiresAt: new Date(Date.now() + URL_TTL_SECONDS * 1000).toISOString(),
      contentType: contentType ?? null,
    };
  }

  throw new Error(`Unknown field: ${fieldName}`);
};
