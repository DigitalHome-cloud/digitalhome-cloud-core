import { defineFunction } from "@aws-amplify/backend";

// POST /edge/v1/homes (auth: Bearer device_token). The homes of the person
// who linked this edge, so an edge (the pro edge) picks a SmartHome ID from
// the cloud instead of inventing one. IAM + env in backend.ts.
export const edgeHomes = defineFunction({
  name: "edgeHomes",
  entry: "./handler.ts",
  timeoutSeconds: 15,
  resourceGroupName: "edge",
});
