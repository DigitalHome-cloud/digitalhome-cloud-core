import { defineFunction } from "@aws-amplify/backend";

// A home's configurations for the Portal (AppSync resolver): the live one,
// its versions and the planning options, for the home's owners and
// dhc-admins (darkfactory ADR 0018). IAM + env in backend.ts.
export const configurations = defineFunction({
  name: "configurations",
  entry: "./handler.ts",
  timeoutSeconds: 60,
  memoryMB: 512,
  resourceGroupName: "data",
});
