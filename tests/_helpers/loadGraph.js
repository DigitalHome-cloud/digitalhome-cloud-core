import fs from 'node:fs';
import path from 'node:path';
import { Readable } from 'node:stream';
import { fileURLToPath } from 'node:url';
import N3 from 'n3';
import rdf from '@zazuko/env-node';
import SHACLValidator from 'rdf-validate-shacl';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const repoRoot = path.resolve(__dirname, '..', '..');

export const { namedNode, literal } = N3.DataFactory;

export function readTtl(relPath) {
  return fs.readFileSync(path.join(repoRoot, relPath), 'utf8');
}

export function parseToStore(ttl) {
  const parser = new N3.Parser();
  const store = new N3.Store();
  store.addQuads(parser.parse(ttl));
  return store;
}

export async function parseToDataset(ttl) {
  const parser = rdf.formats.parsers.get('text/turtle');
  return await rdf.dataset().import(parser.import(Readable.from([ttl])));
}

export async function validateAgainst(shapesTtl, dataTtl) {
  const shapes = await parseToDataset(shapesTtl);
  const data = await parseToDataset(dataTtl);
  const validator = new SHACLValidator(shapes, { factory: rdf });
  const report = await validator.validate(data);
  const results = (report?.results || []).map(r => ({
    focus: r.focusNode?.value,
    path: r.path?.value,
    message: r.message?.[0]?.value,
    sourceShape: r.sourceShape?.value,
  }));
  return { conforms: !!report?.conforms, results };
}

export const PREFIXES = `
@prefix dhc:  <https://digitalhome.cloud/ontology#> .
@prefix xsd:  <http://www.w3.org/2001/XMLSchema#> .
@prefix rdf:  <http://www.w3.org/1999/02/22-rdf-syntax-ns#> .
@prefix rdfs: <http://www.w3.org/2000/01/rdf-schema#> .
@prefix ex:   <http://example.org/> .
`;
