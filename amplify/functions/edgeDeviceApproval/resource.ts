import { defineFunction } from "@aws-amplify/backend";

// Backs the approveDeviceCode / denyDeviceCode AppSync custom mutations (Portal
// /link page). Cognito-userPool authed; verifies the caller owns the target
// home before binding a pending device_code to it. IAM + env in backend.ts.
export const edgeDeviceApproval = defineFunction({
  name: "edgeDeviceApproval",
  entry: "./handler.ts",
  timeoutSeconds: 15,
  resourceGroupName: "data",
});
