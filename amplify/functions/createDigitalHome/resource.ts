import { defineFunction } from "@aws-amplify/backend";

export const createDigitalHome = defineFunction({
  name: "createDigitalHome",
  entry: "./handler.ts",
  timeoutSeconds: 30,
  resourceGroupName: "data",
});
