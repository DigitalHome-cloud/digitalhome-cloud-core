import { defineFunction } from "@aws-amplify/backend";

/**
 * dhcDesignStorageProxy — AppSync Lambda resolver returning short-lived S3
 * signed URLs for SmartHomeDesign owners (DH-SPEC-203, audit C-2).
 *
 * IAM grants on bucket + DDB are added in backend.ts via CDK escape hatches
 * (Gen 2 doesn't auto-wire them when the resolver is defined inside a.schema).
 */
export const dhcDesignStorageProxy = defineFunction({
  name: "dhcDesignStorageProxy",
  entry: "./handler.ts",
  timeoutSeconds: 30,
  // resourceGroupName: "data" co-locates the Lambda with the data stack so it
  // can reach the SmartHomeDesign DDB table without a circular dependency.
  resourceGroupName: "data",
});
