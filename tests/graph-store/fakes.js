// In-memory stand-ins for the DynamoDB table, the S3 bucket and URL signing
// that graph-store uses. Only what the store sends is understood.
import { ConditionalCheckFailedException } from "@aws-sdk/client-dynamodb";
import { marshall, unmarshall } from "@aws-sdk/util-dynamodb";

export function fakeClients() {
  const rows = new Map();
  const objects = new Map();
  const sent = [];
  const ddb = {
    async send(cmd) {
      const name = cmd.constructor.name, input = cmd.input;
      sent.push(name);
      if (name === "ScanCommand") return { Items: [...rows.values()].map((r) => marshall(r)) };
      if (name === "GetItemCommand") {
        const r = rows.get(unmarshall(input.Key).id);
        return r ? { Item: marshall(r) } : {};
      }
      if (name === "PutItemCommand") {
        const r = unmarshall(input.Item);
        if (input.ConditionExpression === "attribute_not_exists(id)" && rows.has(r.id)) {
          throw new ConditionalCheckFailedException({ message: "exists", $metadata: {} });
        }
        rows.set(r.id, r);
        return {};
      }
      if (name === "UpdateItemCommand") {
        const id = unmarshall(input.Key).id;
        const v = unmarshall(input.ExpressionAttributeValues);
        const row = rows.get(id);
        if (!row || row.version !== v[":base"]) {
          throw new ConditionalCheckFailedException({ message: "stale", $metadata: {} });
        }
        const names = input.ExpressionAttributeNames || {};
        for (const part of input.UpdateExpression.replace(/^SET /, "").split(", ")) {
          const [field, value] = part.split(" = ");
          row[names[field] ?? field] = v[value];
        }
        return {};
      }
      throw new Error(`fake ddb: ${name}`);
    },
  };
  const s3 = {
    async send(cmd) {
      const name = cmd.constructor.name, { Key, Body } = cmd.input;
      sent.push(name);
      if (name === "PutObjectCommand") { objects.set(Key, String(Body)); return {}; }
      if (name === "DeleteObjectCommand") { objects.delete(Key); return {}; }
      if (name === "GetObjectCommand") {
        if (!objects.has(Key)) throw Object.assign(new Error("NoSuchKey"), { $metadata: { httpStatusCode: 404 } });
        const text = objects.get(Key);
        return { Body: { transformToString: async () => text } };
      }
      throw new Error(`fake s3: ${name}`);
    },
  };
  const sign = async (cmd) => `https://signed.example.org/${cmd.input.Key}`;
  return { clients: { ddb, s3, sign }, rows, objects, sent };
}
