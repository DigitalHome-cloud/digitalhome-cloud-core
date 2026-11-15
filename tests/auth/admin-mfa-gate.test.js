// The admin MFA gate's decision (amplify/functions/adminMfaGate/gate.ts), without AWS.
import { describe, expect, it } from "vitest";
import { TOTP, groupsForToken, parseProtected } from "../../amplify/functions/adminMfaGate/gate.ts";

const P = ["dhc-admins"];

describe("adminMfaGate", () => {
  it("leaves users outside the protected groups alone", () => {
    expect(groupsForToken(["dhc-welcome", "DE-80331-MAR12-01"], P, null)).toBeNull();
    expect(groupsForToken([], P, [])).toBeNull();
  });

  it("keeps dhc-admins for an admin with an authenticator app", () => {
    expect(groupsForToken(["dhc-admins", "dhc-welcome"], P, [TOTP])).toBeNull();
  });

  it("withholds dhc-admins from an admin without TOTP, keeps the other groups", () => {
    expect(groupsForToken(["dhc-admins", "dhc-welcome", "t-abc"], P, [])).toEqual(["dhc-welcome", "t-abc"]);
    expect(groupsForToken(["dhc-admins"], P, ["SMS_MFA"])).toEqual([]);      // only TOTP counts
  });

  it("fails closed for admin rights when Cognito could not be asked", () => {
    expect(groupsForToken(["dhc-admins", "dhc-modelers"], P, null)).toEqual(["dhc-modelers"]);
  });

  it("reads the protected groups from the environment", () => {
    expect(parseProtected(undefined)).toEqual(["dhc-admins"]);
    expect(parseProtected(" dhc-admins , dhc-devops-engineers ")).toEqual(["dhc-admins", "dhc-devops-engineers"]);
  });
});
