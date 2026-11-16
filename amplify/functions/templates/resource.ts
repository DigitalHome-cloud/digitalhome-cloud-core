import { defineFunction } from "@aws-amplify/backend";

// Board templates for the Portal (AppSync resolver): one graph per norm
// edition, read by every signed-in user, written and verified by
// dhc-template-editors and dhc-admins (darkfactory ADR-0017). IAM + env in
// backend.ts.
export const templates = defineFunction({
  name: "templates",
  entry: "./handler.ts",
  timeoutSeconds: 60,
  memoryMB: 1024,
  resourceGroupName: "data",
});
