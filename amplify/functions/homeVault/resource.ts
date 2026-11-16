import { defineFunction } from "@aws-amplify/backend";

// A home's vault for the Portal (AppSync resolver): photos and documents,
// grouped by configuration version, for the home's owners and dhc-admins
// (darkfactory ADR 0019). IAM + env in backend.ts.
export const homeVault = defineFunction({
  name: "homeVault",
  entry: "./handler.ts",
  timeoutSeconds: 30,
  memoryMB: 512,
  resourceGroupName: "data",
});
