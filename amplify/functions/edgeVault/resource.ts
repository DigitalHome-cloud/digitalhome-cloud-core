import { defineFunction } from "@aws-amplify/backend";

// POST /edge/v1/vault/* (auth: Bearer device_token): a home's photos and
// documents (darkfactory ADR 0019). IAM + env in backend.ts.
export const edgeVault = defineFunction({
  name: "edgeVault",
  entry: "./handler.ts",
  timeoutSeconds: 30,
  memoryMB: 512,
  resourceGroupName: "edge",
});
