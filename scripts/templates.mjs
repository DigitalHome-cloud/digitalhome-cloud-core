#!/usr/bin/env node
// Board templates in the cloud (darkfactory ADR-0017), from the command line.
// Node 22, no dependencies. Signs in with a Portal refresh token kept in a
// file (never on the command line), as a template editor with an
// authenticator app.
//
//   node scripts/templates.mjs list
//   node scripts/templates.mjs get    <edition> [--out file.ttl]
//   node scripts/templates.mjs put    <edition> <file.ttl> [--dry-run]
//   node scripts/templates.mjs verify <edition> <template-id>
//   node scripts/templates.mjs copy   <edition> --to-outputs <prod outputs> [--to-token-file f] [--dry-run]
//
// Options for every command:
//   --outputs <amplify_outputs.json>   the instance (default ../portal/src/amplify_outputs.json)
//   --token-file <file>                its refresh token (default ~/.config/dhc/refresh-token)
//
// `put` replaces the edition's whole graph; it is refused when someone saved
// since you read it, or when a template breaks its edition. `copy` promotes
// an edition from one instance (stage) to another (prod). Verification is per
// instance: a template whose content changes there starts unverified.

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));

function parseArgs(argv) {
  const out = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--dry-run") out.dryRun = true;
    else if (a.startsWith("--")) {
      const v = argv[++i];
      if (v === undefined) die(`${a} needs a value`);
      out[a.slice(2).replace(/-([a-z])/g, (_, c) => c.toUpperCase())] = v;
    } else out._.push(a);
  }
  return out;
}

function die(msg) {
  console.error(`templates: ${msg}`);
  process.exit(2);
}

function instance(outputsFile, tokenFile) {
  const outputs = JSON.parse(fs.readFileSync(outputsFile, "utf8"));
  const auth = outputs.auth, data = outputs.data;
  if (!auth?.user_pool_client_id || !data?.url) die(`${outputsFile} has no auth or data section`);
  const token = fs.readFileSync(tokenFile, "utf8").trim();
  if (!token) die(`${tokenFile} is empty`);
  return { region: auth.aws_region, clientId: auth.user_pool_client_id, url: data.url, token, name: outputsFile };
}

async function signIn(inst) {
  const endpoint = process.env.DHC_COGNITO_ENDPOINT || `https://cognito-idp.${inst.region}.amazonaws.com/`;
  const res = await fetch(endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/x-amz-json-1.1", "X-Amz-Target": "AWSCognitoIdentityProviderService.InitiateAuth" },
    body: JSON.stringify({ AuthFlow: "REFRESH_TOKEN_AUTH", ClientId: inst.clientId, AuthParameters: { REFRESH_TOKEN: inst.token } }),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) die(`sign-in refused (${body.__type || res.status}): sign in to the Portal again and save a fresh refresh token`);
  // The ID token: it carries the groups adminMfaGate allows and the e-mail address.
  inst.idToken = body.AuthenticationResult.IdToken;
  return inst;
}

async function gql(inst, query, variables) {
  const res = await fetch(inst.url, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: inst.idToken },
    body: JSON.stringify({ query, variables }),
  });
  const body = await res.json().catch(() => ({}));
  if (body.errors?.length) die(body.errors.map((e) => e.message).join("; "));
  if (!res.ok) die(`AppSync answered ${res.status}`);
  return body.data;
}

const EDITIONS = `query { templateEditions { edition label latest supersedes version templates updatedAt mayEdit } }`;
const GRAPH = `query($e: String!) { templateGraph(edition: $e) { edition version url } }`;
const REQUEST = `mutation($e: String!, $b: Int!) { requestTemplatesSave(edition: $e, baseVersion: $b) { status key url currentVersion problems } }`;
const COMMIT = `mutation($e: String!, $k: String!, $b: Int!) { commitTemplatesSave(edition: $e, key: $k, baseVersion: $b) { status version templates currentVersion problems } }`;
const VERIFY = `mutation($e: String!, $t: String!) { verifyTemplate(edition: $e, template: $t) { status version problems } }`;

async function read(inst, edition) {
  const g = (await gql(inst, GRAPH, { e: edition })).templateGraph;
  if (!g.url) return { version: g.version, ttl: "" };
  const res = await fetch(g.url);
  if (!res.ok) die(`could not read the graph (${res.status})`);
  return { version: g.version, ttl: await res.text() };
}

async function put(inst, edition, ttl, dryRun) {
  const { version } = (await gql(inst, GRAPH, { e: edition })).templateGraph;
  const lines = ttl.split("\n").length;
  if (dryRun) {
    console.log(`would save ${edition} on ${inst.name}: ${lines} lines on top of version ${version}`);
    return;
  }
  const req = (await gql(inst, REQUEST, { e: edition, b: version })).requestTemplatesSave;
  if (req.status !== "ready") die(`${edition} moved to version ${req.currentVersion} meanwhile; run again`);
  const up = await fetch(req.url, { method: "PUT", headers: { "Content-Type": "text/turtle" }, body: ttl });
  if (!up.ok) die(`the upload failed (${up.status})`);
  const r = (await gql(inst, COMMIT, { e: edition, k: req.key, b: version })).commitTemplatesSave;
  if (r.status === "ok") console.log(`${edition}: version ${r.version}, ${r.templates} templates`);
  else if (r.status === "conflict") die(`${edition} moved to version ${r.currentVersion} meanwhile; run again`);
  else die(`refused:\n  ${r.problems.join("\n  ")}`);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const [cmd, edition, arg] = args._;
  const outputs = args.outputs || path.resolve(here, "../../portal/src/amplify_outputs.json");
  const tokenFile = args.tokenFile || path.join(os.homedir(), ".config/dhc/refresh-token");
  const need = (v, what) => v || die(`${cmd} needs ${what}`);
  if (!cmd || cmd === "help" || cmd === "--help") {
    console.log(fs.readFileSync(fileURLToPath(import.meta.url), "utf8").split("\n").slice(1, 20).map((l) => l.replace(/^\/\/ ?/, "")).join("\n"));
    return;
  }
  const inst = await signIn(instance(outputs, tokenFile));
  switch (cmd) {
    case "list": {
      for (const e of (await gql(inst, EDITIONS)).templateEditions) {
        console.log(`${e.edition.padEnd(16)} v${e.version}  ${String(e.templates ?? 0).padStart(3)} templates${e.latest ? "  latest" : ""}${e.mayEdit ? "  (you may edit)" : ""}`);
      }
      break;
    }
    case "get": {
      const { version, ttl } = await read(inst, need(edition, "an edition"));
      if (args.out) { fs.writeFileSync(args.out, ttl); console.log(`${edition} v${version} → ${args.out}`); }
      else process.stdout.write(ttl);
      break;
    }
    case "put":
      await put(inst, need(edition, "an edition"), fs.readFileSync(need(arg, "a Turtle file"), "utf8"), args.dryRun);
      break;
    case "verify": {
      const r = (await gql(inst, VERIFY, { e: need(edition, "an edition"), t: need(arg, "a template id") })).verifyTemplate;
      if (r.status !== "ok") die(`${r.status}: ${(r.problems || []).join("; ")}`);
      console.log(`${edition}/${arg} verified (version ${r.version})`);
      break;
    }
    case "copy": {
      const to = await signIn(instance(need(args.toOutputs, "--to-outputs"), args.toTokenFile || tokenFile));
      const { version, ttl } = await read(inst, need(edition, "an edition"));
      if (!ttl) die(`${edition} has no templates on ${inst.name}`);
      console.log(`${edition} v${version} from ${inst.name}`);
      await put(to, edition, ttl, args.dryRun);
      break;
    }
    default:
      die(`unknown command ${cmd} (list, get, put, verify, copy)`);
  }
}

main().catch((err) => die(err.message));
