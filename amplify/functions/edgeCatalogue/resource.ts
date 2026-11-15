import { defineFunction } from "@aws-amplify/backend";

// POST /edge/v1/catalogue and /edge/v1/catalogue/put (auth: Bearer device_token).
// The global device catalogue (DeviceModel) for edges: read it page by page,
// and write one model when the person who linked the edge is a catalogue
// admin (dhc-admins with TOTP). IAM + env in backend.ts.
export const edgeCatalogue = defineFunction({
  name: "edgeCatalogue",
  entry: "./handler.ts",
  timeoutSeconds: 20,
  resourceGroupName: "edge",
});
