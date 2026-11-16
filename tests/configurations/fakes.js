// In-memory DynamoDB (several tables, composite keys, the conditions and
// updates the configuration store sends, all-or-nothing transactions) and S3
// (with If-None-Match), for the configurations and the vault.
import { ConditionalCheckFailedException, TransactionCanceledException } from "@aws-sdk/client-dynamodb";
import { marshall, unmarshall } from "@aws-sdk/util-dynamodb";

const KEYS = {
  HomeConfigVersions: ["homeId", "version"],
  HomeConfigOptions: ["id"],
  HomeVaultItems: ["homeId", "sha256"],
};

function evalCondition(expr, row, names, values) {
  if (!expr) return true;
  const name = (n) => names[n] ?? n;
  return expr.split(" AND ").every((part) => {
    part = part.trim();
    let m;
    if ((m = /^attribute_not_exists\((.+)\)$/.exec(part))) return !row || row[name(m[1])] === undefined;
    if ((m = /^attribute_exists\((.+)\)$/.exec(part))) return !!row && row[name(m[1])] !== undefined;
    if ((m = /^(\S+) = (:\w+)$/.exec(part))) return !!row && row[name(m[1])] === values[m[2]];
    throw new Error(`fake ddb: condition ${part}`);
  });
}

function applyUpdate(expr, row, names, values) {
  const name = (n) => names[n] ?? n;
  for (const clause of expr.split(/(?=\bADD\b)|(?=\bSET\b)|(?=\bREMOVE\b)/)) {
    const c = clause.trim();
    if (c.startsWith("REMOVE ")) { for (const f of c.slice(7).split(", ")) delete row[name(f.trim())]; continue; }
    if (c.startsWith("SET ")) {
      for (const part of c.slice(4).split(", ")) {
        const [field, value] = part.split(" = ");
        row[name(field.trim())] = values[value.trim()];
      }
    } else if (c.startsWith("ADD ")) {
      const [field, value] = c.slice(4).trim().split(" ");
      row[name(field)] = (row[name(field)] || 0) + values[value];
    }
  }
}

export function fakeAws() {
  const tables = new Map();
  const objects = new Map();
  const table = (t) => { if (!tables.has(t)) tables.set(t, new Map()); return tables.get(t); };
  const keyOf = (t, obj) => JSON.stringify((KEYS[t] || ["id"]).map((k) => obj[k]));

  function put(input) {
    const rows = table(input.TableName), item = unmarshall(input.Item), k = keyOf(input.TableName, item);
    const values = input.ExpressionAttributeValues ? unmarshall(input.ExpressionAttributeValues) : {};
    if (!evalCondition(input.ConditionExpression, rows.get(k), input.ExpressionAttributeNames || {}, values)) return false;
    return () => rows.set(k, item);
  }
  function update(input) {
    const rows = table(input.TableName), key = unmarshall(input.Key), k = keyOf(input.TableName, key);
    const names = input.ExpressionAttributeNames || {};
    const values = input.ExpressionAttributeValues ? unmarshall(input.ExpressionAttributeValues) : {};
    if (!evalCondition(input.ConditionExpression, rows.get(k), names, values)) return false;
    return () => {
      const row = rows.get(k) || { ...key };
      applyUpdate(input.UpdateExpression, row, names, values);
      rows.set(k, row);
      return row;
    };
  }
  function del(input) {
    const rows = table(input.TableName), k = keyOf(input.TableName, unmarshall(input.Key));
    const values = input.ExpressionAttributeValues ? unmarshall(input.ExpressionAttributeValues) : {};
    if (!evalCondition(input.ConditionExpression, rows.get(k), input.ExpressionAttributeNames || {}, values)) return false;
    return () => rows.delete(k);
  }
  const fail = () => { throw new ConditionalCheckFailedException({ message: "condition", $metadata: {} }); };

  const ddb = {
    async send(cmd) {
      const n = cmd.constructor.name, input = cmd.input;
      if (n === "GetItemCommand") {
        const r = table(input.TableName).get(keyOf(input.TableName, unmarshall(input.Key)));
        return r ? { Item: marshall(r) } : {};
      }
      if (n === "PutItemCommand") { const go = put(input); if (!go) fail(); go(); return {}; }
      if (n === "UpdateItemCommand") {
        const go = update(input); if (!go) fail();
        const row = go();
        return { Attributes: marshall(row) };
      }
      if (n === "ScanCommand") {
        let items = [...table(input.TableName).values()];
        if (input.FilterExpression) {
          const v = unmarshall(input.ExpressionAttributeValues);
          items = items.filter((r) => evalCondition(input.FilterExpression, r, input.ExpressionAttributeNames || {}, v));
        }
        return { Items: items.map((r) => marshall(r)) };
      }
      if (n === "QueryCommand") {
        const v = unmarshall(input.ExpressionAttributeValues);
        const items = [...table(input.TableName).values()].filter((r) => evalCondition(input.KeyConditionExpression, r, input.ExpressionAttributeNames || {}, v));
        return { Items: items.map((r) => marshall(r)) };
      }
      if (n === "TransactWriteItemsCommand") {
        const steps = input.TransactItems.map((t) => (t.Put ? put(t.Put) : t.Update ? update(t.Update) : t.Delete ? del(t.Delete) : null));
        if (steps.some((s) => !s)) throw new TransactionCanceledException({ message: "cancelled", $metadata: {} });
        steps.forEach((s) => s());
        return {};
      }
      throw new Error(`fake ddb: ${n}`);
    },
  };
  const s3 = {
    async send(cmd) {
      const n = cmd.constructor.name, { Key, Body, IfNoneMatch } = cmd.input;
      if (n === "PutObjectCommand") {
        if (IfNoneMatch === "*" && objects.has(Key)) throw Object.assign(new Error("PreconditionFailed"), { $metadata: { httpStatusCode: 412 } });
        objects.set(Key, String(Body)); return {};
      }
      if (n === "DeleteObjectCommand") { objects.delete(Key); return {}; }
      if (n === "HeadObjectCommand") {
        if (!objects.has(Key)) throw Object.assign(new Error("NotFound"), { name: "NotFound", $metadata: { httpStatusCode: 404 } });
        return { ContentLength: objects.get(Key).length };
      }
      if (n === "GetObjectCommand") {
        if (!objects.has(Key)) throw Object.assign(new Error("NoSuchKey"), { $metadata: { httpStatusCode: 404 } });
        const text = objects.get(Key);
        return { Body: { transformToString: async () => text } };
      }
      throw new Error(`fake s3: ${n}`);
    },
  };
  const signed = [];
  const sign = async (cmd) => { signed.push(cmd); return `https://signed.example.org/${cmd.input.Key}`; };
  return { clients: { ddb, s3, sign }, tables, table, objects, signed };
}
