import { defineFunction } from "@aws-amplify/backend";

/**
 * adminMfaGate — Cognito pre-token-generation trigger: admin groups only for
 * people with two-step sign-in.
 *
 * The pool's MFA is OPTIONAL (TOTP): ordinary users are never asked. A user in
 * a protected group (dhc-admins) whose account has no authenticator app gets
 * tokens WITHOUT that group, so every app and every AppSync rule treats them
 * as a normal user until they set up TOTP. Because MFA is OPTIONAL and TOTP is
 * their preferred method once set up, Cognito then asks for the code at every
 * sign-in. Enforced here once, for Portal, Designer, Modeler and PermTek-5.
 */
export const adminMfaGate = defineFunction({
  name: "adminMfaGate",
  entry: "./handler.ts",
  timeoutSeconds: 5,
  environment: {
    PROTECTED_GROUPS: "dhc-admins",
  },
});
