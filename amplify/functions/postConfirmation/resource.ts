import { defineFunction } from "@aws-amplify/backend";

/**
 * postConfirmation — Cognito trigger that adds new users to the default
 * `dhc-welcome` group on first sign-up. Replaces the two duplicate
 * Gen 1 PostConfirmation Lambdas; CAPTCHA / CustomMessage / PostAuth
 * triggers are intentionally not ported (not used in the v2 auth flow).
 */
export const postConfirmation = defineFunction({
  name: "postConfirmation",
  entry: "./handler.ts",
  timeoutSeconds: 10,
  resourceGroupName: "auth",
  environment: {
    DEFAULT_GROUP: "dhc-welcome",
  },
});
