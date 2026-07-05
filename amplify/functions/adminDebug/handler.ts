// adminDebug — read-only AWS inspection for the Portal /debug page.
//
// AppSync custom queries (all dhc-admins only, enforced here AND by allow.group):
//   debugS3(prefix)  — browse the storage bucket (keys/sizes; no object content)
//   debugTables      — list this stack's DynamoDB tables with counts/size
//   debugCognito     — list Cognito groups + member counts (+ the caller's groups)
//   debugConsole     — AWS-console deep-links for every artifact
//
// Gen 2 passes the field name as event.fieldName (top-level), NOT event.info.fieldName.

import {
  S3Client,
  ListObjectsV2Command,
} from "@aws-sdk/client-s3";
import {
  DynamoDBClient,
  ListTablesCommand,
  DescribeTableCommand,
} from "@aws-sdk/client-dynamodb";
import {
  CognitoIdentityProviderClient,
  ListGroupsCommand,
  ListUsersInGroupCommand,
} from "@aws-sdk/client-cognito-identity-provider";
import type { AppSyncResolverEvent, AppSyncIdentityCognito, Context } from "aws-lambda";

const REGION = process.env.AWS_REGION || "eu-central-1";
const BUCKET = process.env.BUCKET_NAME!;
const POOL = process.env.USER_POOL_ID!;
const ADMIN_GROUP = "dhc-admins";
const CORE_APP_ID = "d1abchwrql1qxd";
const PORTAL_APP_ID = "d2996kz21l6s55";

const s3 = new S3Client({ region: REGION });
const ddb = new DynamoDBClient({ region: REGION });
const idp = new CognitoIdentityProviderClient({ region: REGION });

interface Args {
  prefix?: string;
}

async function stackTableNames(): Promise<string[]> {
  const names: string[] = [];
  let token: string | undefined;
  do {
    const r = await ddb.send(new ListTablesCommand({ ExclusiveStartTableName: token, Limit: 100 }));
    names.push(...(r.TableNames || []));
    token = r.LastEvaluatedTableName;
  } while (token);
  // Amplify data-model tables end in "-NONE"; the edge stack tables carry the app id.
  return names.filter((n) => /-NONE$/.test(n) || n.startsWith(`amplify-${CORE_APP_ID}`));
}

function apiIdFrom(tables: string[]): string {
  for (const t of tables) {
    const m = t.match(/-([a-z0-9]{26})-NONE$/);
    if (m) return m[1];
  }
  return "";
}

export const handler = async (event: AppSyncResolverEvent<Args>, context: Context) => {
  const identity = event.identity as AppSyncIdentityCognito | undefined;
  const groups = identity?.groups || [];
  if (!groups.includes(ADMIN_GROUP)) {
    throw new Error("Forbidden: dhc-admins only");
  }
  const field = (event as unknown as { fieldName?: string }).fieldName;
  const account = (context?.invokedFunctionArn || "").split(":")[4] || "";

  if (field === "debugS3") {
    const prefix = (event.arguments?.prefix || "").replace(/^\/+/, "");
    const out = await s3.send(
      new ListObjectsV2Command({ Bucket: BUCKET, Prefix: prefix, Delimiter: "/", MaxKeys: 1000 })
    );
    return {
      bucket: BUCKET,
      prefix,
      folders: (out.CommonPrefixes || []).map((p) => p.Prefix),
      objects: (out.Contents || [])
        .filter((o) => o.Key !== prefix)
        .map((o) => ({ key: o.Key, size: o.Size, lastModified: o.LastModified?.toISOString() })),
      truncated: !!out.IsTruncated,
    };
  }

  if (field === "debugTables") {
    const ours = await stackTableNames();
    const tables = [];
    for (const name of ours.sort()) {
      try {
        const d = await ddb.send(new DescribeTableCommand({ TableName: name }));
        const t = d.Table!;
        tables.push({
          name,
          itemCount: t.ItemCount ?? null,
          sizeBytes: t.TableSizeBytes ?? null,
          status: t.TableStatus ?? null,
          arn: t.TableArn ?? null,
        });
      } catch (e) {
        tables.push({ name, error: String(e) });
      }
    }
    return { region: REGION, tables };
  }

  if (field === "debugCognito") {
    const out: Array<Record<string, unknown>> = [];
    let token: string | undefined;
    do {
      const r = await idp.send(new ListGroupsCommand({ UserPoolId: POOL, Limit: 60, NextToken: token }));
      for (const g of r.Groups || []) {
        let count = 0;
        let gtok: string | undefined;
        do {
          const u = await idp.send(
            new ListUsersInGroupCommand({ UserPoolId: POOL, GroupName: g.GroupName!, Limit: 60, NextToken: gtok })
          );
          count += (u.Users || []).length;
          gtok = u.NextToken;
        } while (gtok);
        out.push({
          group: g.GroupName,
          description: g.Description ?? null,
          precedence: g.Precedence ?? null,
          memberCount: count,
        });
      }
      token = r.NextToken;
    } while (token);
    out.sort((a, b) => String(a.group).localeCompare(String(b.group)));
    return { pool: POOL, groups: out, yourGroups: groups };
  }

  if (field === "debugConsole") {
    const apiId = apiIdFrom(await stackTableNames());
    const c = `https://${REGION}.console.aws.amazon.com`;
    return {
      region: REGION,
      account,
      s3: `https://s3.console.aws.amazon.com/s3/buckets/${BUCKET}?region=${REGION}&tab=objects`,
      dynamodb: `${c}/dynamodbv2/home?region=${REGION}#tables`,
      cognito: `${c}/cognito/v2/idp/user-pools/${POOL}/users?region=${REGION}`,
      appsync: apiId
        ? `${c}/appsync/home?region=${REGION}#/apis/${apiId}/v1/home`
        : `${c}/appsync/home?region=${REGION}`,
      amplifyCore: `${c}/amplify/apps/${CORE_APP_ID}`,
      amplifyPortal: `${c}/amplify/apps/${PORTAL_APP_ID}`,
    };
  }

  throw new Error(`Unsupported field: ${field}`);
};
