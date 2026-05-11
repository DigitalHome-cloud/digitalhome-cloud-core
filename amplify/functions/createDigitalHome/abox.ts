// A-Box authoring for Step 1 (DigitalHome initiation).
// Produces both a Turtle string (via n3 Writer) and a JSON-LD object
// describing the same triples — written to S3 as
// designtime/abox.ttl and designtime/graph.jsonld.

import { Writer, DataFactory } from "n3";

const { namedNode, literal } = DataFactory;

export const NS = {
  dhc: "https://digitalhome.cloud/ontology#",
  rec: "https://w3id.org/rec#",
  rdfs: "http://www.w3.org/2000/01/rdf-schema#",
  rdf: "http://www.w3.org/1999/02/22-rdf-syntax-ns#",
  xsd: "http://www.w3.org/2001/XMLSchema#",
  owl: "http://www.w3.org/2002/07/owl#",
  instance: "https://digitalhome.cloud/instance/",
};

export interface AboxInput {
  smartHomeId: string;
  agentId: string; // cognito sub — segment of the agent IRI
  agentLabel: string; // human-readable display name
  country: string;
  postalCode: string;
  city: string;
  addressLine1: string;
  addressLine2?: string;
  isDemo: boolean;
  createdAt: string; // ISO 8601 UTC
  updatedAt: string; // ISO 8601 UTC
}

const dhc = (local: string) => namedNode(NS.dhc + local);
const rec = (local: string) => namedNode(NS.rec + local);
const rdfs = (local: string) => namedNode(NS.rdfs + local);
const rdfType = namedNode(NS.rdf + "type");
const xsdLit = (value: string, dt: "dateTime" | "boolean" | "string") =>
  literal(value, namedNode(NS.xsd + dt));

export function agentIri(agentId: string) {
  return namedNode(NS.instance + "agents/" + agentId);
}

export function homeIri(smartHomeId: string) {
  return namedNode(NS.instance + "DigitalHomes/" + smartHomeId);
}

export function buildAboxTurtle(input: AboxInput): Promise<string> {
  return new Promise((resolve, reject) => {
    const writer = new Writer({
      prefixes: {
        dhc: NS.dhc,
        rec: NS.rec,
        rdfs: NS.rdfs,
        xsd: NS.xsd,
        instance: NS.instance,
      },
    });

    const agent = agentIri(input.agentId);
    const home = homeIri(input.smartHomeId);

    // Agent
    writer.addQuad(agent, rdfType, rec("Agent"));
    writer.addQuad(agent, rdfs("label"), literal(input.agentLabel));

    // DigitalHome
    writer.addQuad(home, rdfType, dhc("DigitalHome"));
    writer.addQuad(home, dhc("smartHomeId"), literal(input.smartHomeId));
    writer.addQuad(home, dhc("createdBy"), agent);
    writer.addQuad(home, dhc("createdAt"), xsdLit(input.createdAt, "dateTime"));
    writer.addQuad(home, dhc("updatedAt"), xsdLit(input.updatedAt, "dateTime"));
    writer.addQuad(home, rec("country"), literal(input.country));
    writer.addQuad(home, rec("postalCode"), literal(input.postalCode));
    writer.addQuad(home, rec("city"), literal(input.city));
    writer.addQuad(home, rec("addressLine1"), literal(input.addressLine1));
    if (input.addressLine2 && input.addressLine2.trim()) {
      writer.addQuad(home, rec("addressLine2"), literal(input.addressLine2));
    }
    writer.addQuad(home, dhc("isDemo"), xsdLit(String(input.isDemo), "boolean"));

    writer.end((err, result) => {
      if (err) reject(err);
      else resolve(result);
    });
  });
}

export function buildAboxJsonLd(input: AboxInput): Record<string, unknown> {
  const agent = NS.instance + "agents/" + input.agentId;
  const home = NS.instance + "DigitalHomes/" + input.smartHomeId;

  const homeNode: Record<string, unknown> = {
    "@id": home,
    "@type": "dhc:DigitalHome",
    smartHomeId: input.smartHomeId,
    createdBy: agent,
    createdAt: input.createdAt,
    updatedAt: input.updatedAt,
    country: input.country,
    postalCode: input.postalCode,
    city: input.city,
    addressLine1: input.addressLine1,
    isDemo: input.isDemo,
  };
  if (input.addressLine2 && input.addressLine2.trim()) {
    homeNode.addressLine2 = input.addressLine2;
  }

  return {
    "@context": {
      dhc: NS.dhc,
      rec: NS.rec,
      rdfs: NS.rdfs,
      xsd: NS.xsd,
      instance: NS.instance,
      smartHomeId: { "@id": "dhc:smartHomeId" },
      createdBy: { "@id": "dhc:createdBy", "@type": "@id" },
      createdAt: { "@id": "dhc:createdAt", "@type": "xsd:dateTime" },
      updatedAt: { "@id": "dhc:updatedAt", "@type": "xsd:dateTime" },
      isDemo: { "@id": "dhc:isDemo", "@type": "xsd:boolean" },
      country: { "@id": "rec:country" },
      postalCode: { "@id": "rec:postalCode" },
      city: { "@id": "rec:city" },
      addressLine1: { "@id": "rec:addressLine1" },
      addressLine2: { "@id": "rec:addressLine2" },
      label: "rdfs:label",
    },
    "@graph": [
      {
        "@id": agent,
        "@type": "rec:Agent",
        label: input.agentLabel,
      },
      homeNode,
    ],
  };
}
