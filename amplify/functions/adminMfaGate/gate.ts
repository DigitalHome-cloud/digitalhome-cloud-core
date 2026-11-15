/** The decision, without AWS: which groups go into the token. */

export const TOTP = "SOFTWARE_TOKEN_MFA";

export function parseProtected(env: string | undefined): string[] {
  return (env ?? "dhc-admins").split(",").map((g) => g.trim()).filter(Boolean);
}

/**
 * groups: the user's groups; mfaSettings: AdminGetUser's UserMFASettingList,
 * or null when Cognito could not be asked (then the protected groups are
 * dropped: fail closed for admin rights, never for sign-in).
 * Returns the groups to put in the token, or null when nothing changes.
 */
export function groupsForToken(
  groups: string[],
  protectedGroups: string[],
  mfaSettings: string[] | null,
): string[] | null {
  const held = groups.filter((g) => protectedGroups.includes(g));
  if (held.length === 0) return null;
  if (mfaSettings !== null && mfaSettings.includes(TOTP)) return null;
  return groups.filter((g) => !protectedGroups.includes(g));
}
