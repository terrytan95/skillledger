# Team policy and signed manifest

SkillLedger Team mode is local-first. The app stores a trust policy and one active signed manifest under:

```text
~/.agents/.skillledger/team/policy.json
~/.agents/.skillledger/team/manifest.json
```

The first imported policy is the v1 trust anchor and cannot be replaced through the app. Private keys and signing stay outside SkillLedger.

## Policy

```json
{
  "schemaVersion": 1,
  "teamId": "acme",
  "name": "Acme Engineering",
  "managedRepositories": [
    { "repository": "acme/skills", "paths": ["skills"] }
  ],
  "trustedSigners": [
    {
      "id": "release-key",
      "publicKey": "base64-encoded-Ed25519-SPKI-DER",
      "roles": ["maintainer"]
    }
  ],
  "approvalRules": {
    "restoreCanonical": "maintainer",
    "updateCanonical": "owner",
    "replaceCopy": "maintainer"
  }
}
```

Roles are `maintainer` and `owner`; owners satisfy maintainer rules. Managed paths use normalized POSIX relative paths.

## Manifest

```json
{
  "payload": {
    "schemaVersion": 1,
    "teamId": "acme",
    "sequence": 7,
    "issuedAt": "2026-07-26T00:00:00Z",
    "expiresAt": "2027-07-26T00:00:00Z",
    "skills": {
      "review-code": {
        "repository": "acme/skills",
        "path": "skills/review-code",
        "revision": "0123456789abcdef0123456789abcdef01234567",
        "sha256": "64-character-sha256-tree-hash"
      }
    },
    "approvals": [
      { "action": "restore-canonical", "skillId": "review-code" },
      { "action": "replace-copy", "skillId": "review-code", "agentId": "*" }
    ]
  },
  "signature": {
    "keyId": "release-key",
    "algorithm": "ed25519",
    "value": "base64-signature"
  }
}
```

The signature covers UTF-8 `payload` encoded as compact JSON with object keys recursively sorted and array order preserved. Manifest sequences cannot move backwards or reuse a sequence for different content. Expired manifests are rejected.

Allowed approval actions are `restore-canonical`, `update-canonical`, and `replace-copy`. Source approvals must also match the exact signed pin and a managed repository/path. Copy replacement accepts an exact Agent id or `*`.

The GitHub adapter follows the official [Git commit](https://docs.github.com/en/rest/git/commits), [Git tree](https://docs.github.com/en/rest/git/trees), and [Git blob](https://docs.github.com/en/rest/git/blobs) APIs. Public resources require no token.
