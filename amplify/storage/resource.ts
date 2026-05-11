import { defineStorage } from "@aws-amplify/backend";

/**
 * Single S3 bucket for all platform content.
 *
 * Path scheme:
 *   - public/ontology/...           — global ontology artifacts (admin write)
 *   - public/smarthomes/{demoId}/   — demo SmartHome data (any authenticated
 *                                      user can read+write; admins reset on
 *                                      vandalism)
 *   - protected/{entity_id}/...     — owner write, all auth users read
 *   - private/{entity_id}/...       — owner only
 *   - tenant/{smartHomeId}/...      — REAL tenant design data. NOT granted
 *                                      to any auth/guest role. Only the
 *                                      dhcDesignStorageProxy Lambda's role
 *                                      can read/write — IAM is added in
 *                                      backend.ts via the CDK escape hatch.
 *                                      All access is via the signed-URL
 *                                      mutations (DH-SPEC-203, audit C-2 v2).
 */
export const storage = defineStorage({
  name: "dhcStorage",
  access: (allow) => ({
    "public/*": [
      allow.guest.to(["read"]),
      allow.authenticated.to(["read", "write", "delete"]),
    ],
    "protected/{entity_id}/*": [
      allow.authenticated.to(["read"]),
      allow.entity("identity").to(["read", "write", "delete"]),
    ],
    "private/{entity_id}/*": [
      allow.entity("identity").to(["read", "write", "delete"]),
    ],
    // tenant/* deliberately omitted — only the Lambda role gets access (see
    // backend.ts). Default-deny is the security boundary.
  }),
});
