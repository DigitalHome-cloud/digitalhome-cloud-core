import { defineFunction } from "@aws-amplify/backend";

// Backs the read-only admin debug queries (Portal /debug page): browse S3, list
// DynamoDB tables, list Cognito groups, and build AWS-console deep-links. Gated to
// the dhc-admins group at the AppSync layer AND re-checked in the handler. IAM +
// env are wired in backend.ts. resourceGroupName "data" colocates it with the data
// stack (same as edgeDeviceApproval) to avoid cross-stack circular deps.
export const adminDebug = defineFunction({
  name: "adminDebug",
  entry: "./handler.ts",
  timeoutSeconds: 30,
  resourceGroupName: "data",
});
