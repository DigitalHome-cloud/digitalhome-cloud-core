import { defineStorage } from "@aws-amplify/backend";

/**
 * Single S3 bucket for all platform content.
 *
 * Path scheme:
 *   - public/ontology/...           — global ontology artifacts (admin write)
 *   - public/market/{seller}/sha256/ — marketplace images and datasheets
 *                                      (ADR 0016), written only through the
 *                                      market Lambdas' presigned PUTs
 *   - public/catalogue/...          — the retired DeviceModel catalogue's
 *                                      files; the rule stays so the broad
 *                                      public/* write grant does not open it
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
    // The retired DeviceModel catalogue's files. More specific than public/*
    // (longest prefix wins), so this subtree stays admin-write only.
    "public/catalogue/*": [
      allow.guest.to(["read"]),
      allow.authenticated.to(["read"]),
      allow.groups(["dhc-admins"]).to(["read", "write", "delete"]),
    ],
    // Marketplace images and datasheets, by content:
    // public/market/{seller}/sha256/{hash}.{ext}. World-readable; nobody
    // writes here through Cognito — only through the hash-bound presigned
    // PUTs the market / edgeMarket Lambdas hand to a seller's editors.
    // (The catalogues themselves are under market/graphs/, Lambda-only.)
    "public/market/*": [
      allow.guest.to(["read"]),
      allow.authenticated.to(["read"]),
    ],
    // Area weather + air-quality Delta Lake — world-readable (operator app /
    // analytics), admin-write only so the shared dataset can't be clobbered by
    // arbitrary authenticated users. The ingest pipeline writes via a direct
    // IAM principal, not a Cognito role, so it is unaffected by these rules.
    "public/weather/*": [
      allow.guest.to(["read"]),
      allow.authenticated.to(["read"]),
      allow.groups(["dhc-admins"]).to(["read", "write", "delete"]),
    ],
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
