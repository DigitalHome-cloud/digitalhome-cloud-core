import { AdminGetUserCommand, CognitoIdentityProviderClient } from "@aws-sdk/client-cognito-identity-provider";
import type { PreTokenGenerationTriggerHandler } from "aws-lambda";
import { groupsForToken, parseProtected } from "./gate";

const cognito = new CognitoIdentityProviderClient({});
const PROTECTED = parseProtected(process.env.PROTECTED_GROUPS);

export const handler: PreTokenGenerationTriggerHandler = async (event) => {
  const groups = event.request.groupConfiguration?.groupsToOverride ?? [];
  if (!groups.some((g) => PROTECTED.includes(g))) return event;   // most sign-ins: nothing to do

  // Ask Cognito, not the token: a token says nothing about MFA.
  let mfa: string[] | null = null;
  try {
    const u = await cognito.send(new AdminGetUserCommand({ UserPoolId: event.userPoolId, Username: event.userName }));
    mfa = u.UserMFASettingList ?? [];
  } catch (err) {
    console.error("[adminMfaGate] AdminGetUser failed; dropping protected groups for this token", err);
  }

  const keep = groupsForToken(groups, PROTECTED, mfa);
  if (keep !== null) {
    console.log(`[adminMfaGate] ${event.userName}: no TOTP, admin groups withheld from the token`);
    event.response.claimsOverrideDetails = {
      ...(event.response.claimsOverrideDetails ?? {}),
      groupOverrideDetails: { ...event.request.groupConfiguration, groupsToOverride: keep },
    };
  }
  return event;
};
