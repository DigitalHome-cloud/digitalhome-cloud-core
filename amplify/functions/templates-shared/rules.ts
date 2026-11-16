/**
 * The board templates' rules, without AWS (darkfactory ADR-0017). One Turtle
 * graph per norm edition, its id the edition's (nfc15100-2024 ↔
 * dhc:NormEdition_NFC15100_2024). Read by every signed-in user and every
 * linked edge; written by dhc-template-editors and dhc-admins, each only with
 * an authenticator app.
 */
import { TOTP } from "../adminMfaGate/gate";
import { BadRequest } from "../graph-store/errors";

export { BadRequest };
export const DHC = "https://digitalhome.cloud/ontology#";
export const DHT = "https://digitalhome.cloud/templates#";
export const ID_BASE = "https://digitalhome.cloud/id/templates/";
export const ADMIN_GROUP = "dhc-admins";
export const EDITOR_GROUP = "dhc-template-editors";
export const EDITION_ID = /^([a-z][a-z0-9]{1,19})-([0-9]{4})$/;
export const PART_ID = /^[a-z0-9][a-z0-9-]{0,39}$/;
export const MAX_GRAPH_BYTES = 2 * 1024 * 1024;

/** nfc15100-2024 → https://digitalhome.cloud/ontology#NormEdition_NFC15100_2024 */
export function editionIri(id: string): string {
  const m = EDITION_ID.exec(String(id ?? ""));
  if (!m) throw new BadRequest("an edition id looks like nfc15100-2024");
  return `${DHC}NormEdition_${m[1].toUpperCase()}_${m[2]}`;
}

/** The reverse; null for an IRI that is not a dhc:NormEdition_<NORM>_<year>. */
export function editionIdOf(iri: string): string | null {
  const m = /^https:\/\/digitalhome\.cloud\/ontology#NormEdition_([A-Z][A-Z0-9]{1,19})_([0-9]{4})$/.exec(iri);
  return m ? `${m[1].toLowerCase()}-${m[2]}` : null;
}

export const editionPrefix = (edition: string) => `${ID_BASE}${edition}/`;
export const templateIri = (edition: string, template: string) => {
  if (!PART_ID.test(template)) throw new BadRequest("a template id is 1 to 40 lowercase letters, digits and -");
  return editionPrefix(edition) + template;
};

/**
 * May someone with these groups change the templates? Template editors and
 * platform admins, only with an authenticator app. `mfa` as in the market's
 * mayEdit: the token's groups ("token", which adminMfaGate only fills with
 * protected groups after TOTP) or AdminGetUser's UserMFASettingList.
 */
export function mayEditTemplates(groups: string[] | null, mfa: string[] | "token" | null): boolean {
  if (!groups || !groups.some((g) => g === ADMIN_GROUP || g === EDITOR_GROUP)) return false;
  if (mfa === "token") return true;
  return mfa !== null && mfa.includes(TOTP);
}
