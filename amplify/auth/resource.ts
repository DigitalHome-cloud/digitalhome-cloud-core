import { defineAuth } from "@aws-amplify/backend";
import { postConfirmation } from "../functions/postConfirmation/resource";

/**
 * Cognito User Pool + Identity Pool with email/password auth and 5 groups
 * matching the platform's tier system.
 *
 * Group meanings:
 *   - dhc-admins:           Library + ontology admins, full SmartHome read access
 *   - dhc-modelers:         can edit ontology drafts in the Modeler
 *   - dhc-devops-engineers: internal — gates the "isDemo" flag in DigitalHome
 *                           creation and other devops-only switches
 *   - dhc-professional:     paid tier, future feature gating
 *   - dhc-standard:         default paid tier, future feature gating
 *   - dhc-welcome:          auto-assigned on sign-up (postConfirmation Lambda)
 *
 * Google federation is intentionally NOT configured in this initial sandbox
 * cutover. To re-enable later:
 *   1. `npx ampx sandbox secret set GOOGLE_CLIENT_ID`
 *   2. `npx ampx sandbox secret set GOOGLE_CLIENT_SECRET`
 *   3. Add an `externalProviders` block to `loginWith` referencing
 *      `secret("GOOGLE_CLIENT_ID")` etc., plus callbackUrls + logoutUrls.
 *   4. Update the Google Cloud Console OAuth client redirect URIs to point
 *      at the new Cognito Hosted UI domain (the Gen 2 domain differs from
 *      the Gen 1 one).
 */
export const auth = defineAuth({
  loginWith: {
    email: true,
  },
  groups: [
    "dhc-admins",
    "dhc-modelers",
    "dhc-devops-engineers",
    "dhc-professional",
    "dhc-standard",
    "dhc-welcome",
  ],
  triggers: {
    postConfirmation,
  },
});
