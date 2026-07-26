# Security

Please report vulnerabilities privately through GitHub Security Advisories for this repository.

SkillLedger is local-first, but it is not read-only. It discovers local skills and can repair Agent links, replace approved independent copies, and restore or update canonical skills from an explicitly pinned GitHub source. Filesystem changes require a preview, SHA-256 precondition checks, durable journaling and backups, atomic replacement, verification, and rollback.

Network access is limited to checking GitHub Releases for a newer version and fetching exact pinned GitHub source content during an approved reconciliation. Update checks do not download or install application updates, and local inventory data is not sent with these requests.

Team policies and signed manifests are imported and verified locally. Private signing keys never enter SkillLedger; source and copy operations are blocked unless the configured policy, repository path, signer role, and explicit approval match.
