import { defineFunction } from "@aws-amplify/backend";

// POST /edge/v1/configurations/* (auth: Bearer device_token): a home's live
// configuration, its versions and planning options (darkfactory ADR 0018).
// IAM + env in backend.ts.
export const edgeConfigurations = defineFunction({
  name: "edgeConfigurations",
  entry: "./handler.ts",
  timeoutSeconds: 30,
  memoryMB: 512,
  resourceGroupName: "edge",
});
