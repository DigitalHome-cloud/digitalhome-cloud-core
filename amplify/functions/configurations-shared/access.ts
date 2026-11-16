// Who may read and change a home's configurations and vault (ADRs 0018,
// 0019): its owners and dhc-admins through AppSync; through an edge, the home
// the edge is linked to and every home of the person who linked it (as
// edgeHomes lists them). The home is found by its meaningless homeId.

import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { findByHomeId, mayUse, type HomeRow } from "../home-id/home-id";
import { BadRequest, homeId as checkHomeId } from "./rules";

let ddb: { send(command: any): Promise<any> } = new DynamoDBClient({});
/** Tests only. */
export const useDdb = (client: { send(command: any): Promise<any> }) => { ddb = client; };

const TABLE = () => process.env.DIGITALHOME_TABLE_NAME!;

export class Forbidden extends Error {}

export async function homeFor(id: unknown): Promise<HomeRow> {
  const home = await findByHomeId(ddb, TABLE(), checkHomeId(id));
  if (!home) throw new BadRequest(`no home ${id}`);
  return home;
}

/** A signed-in person (AppSync identity). */
export async function homeForPerson(id: unknown, who: { sub?: string; username?: string; groups?: string[] }): Promise<HomeRow> {
  const home = await homeFor(id);
  if (!mayUse(home, who)) throw new Forbidden("Not authorized");
  return home;
}

/** A linked edge (its registry row). */
export async function homeForEdge(id: unknown, edge: { linked_by_cognito_sub?: string; home_id?: string }): Promise<HomeRow> {
  const home = await homeFor(id);
  const sub = edge.linked_by_cognito_sub || "";
  if (!(home.smartHomeId === edge.home_id || (sub && (home.owners || []).includes(sub)))) throw new Forbidden("Not authorized");
  return home;
}
