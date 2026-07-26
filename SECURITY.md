# Security

Please report vulnerabilities privately through GitHub Security Advisories for this repository.

SkillLedger currently performs read-only local discovery. It does not send inventory data over the network. Future filesystem writes must preserve user data through preview, precondition checks, journaling, atomic replacement, verification, and rollback.
