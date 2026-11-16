import { defineFunction } from "@aws-amplify/backend";

// POST /edge/v1/market/* (auth: Bearer device_token): the marketplace for
// edges — sellers, their catalogue graphs (read; write when the person who
// linked the edge is the seller's editor), and their images and datasheets.
// IAM + env in backend.ts.
export const edgeMarket = defineFunction({
  name: "edgeMarket",
  entry: "./handler.ts",
  timeoutSeconds: 60,
  memoryMB: 1024,
  resourceGroupName: "edge",
});
