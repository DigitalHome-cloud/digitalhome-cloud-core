import { defineFunction } from "@aws-amplify/backend";

// POST /edge/v1/templates/* (auth: Bearer device_token): the board templates
// for edges, read only. IAM + env in backend.ts.
export const edgeTemplates = defineFunction({
  name: "edgeTemplates",
  entry: "./handler.ts",
  timeoutSeconds: 30,
  memoryMB: 512,
  resourceGroupName: "edge",
});
