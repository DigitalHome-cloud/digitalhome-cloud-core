import { defineFunction } from "@aws-amplify/backend";

// The marketplace for the Portal (AppSync resolver): sellers, their catalogue
// graphs (read by every signed-in user; written by the seller's editors), and
// seller administration (dhc-admins). IAM + env in backend.ts.
export const market = defineFunction({
  name: "market",
  entry: "./handler.ts",
  timeoutSeconds: 60,
  memoryMB: 1024,
  resourceGroupName: "data",
});
