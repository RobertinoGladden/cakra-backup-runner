# CAKRA isolated backup runner

This public repository contains only generic backup tooling. It contains no CAKRA application code, production database identity, Drive folder ID, OAuth token, encryption key, archive, or customer data.

## Security boundary

- The default branch and `production-backup` environment must be protected before any non-synthetic credential is added. The environment must allow deployments from the protected default branch only. The `boundary-probe` workflow is manual and consumes only a disposable random sentinel.
- The `validate` workflow accepts pull requests but has no environment, secrets, write token, backup command, or external-data access. No `pull_request_target` or `workflow_run` triggers are used.
- The actual backup schedule is an **inactive template** under `templates/`. Moving it into `.github/workflows/` and setting production secrets requires separate owner approval and a reviewed change. Do not use repository-level secrets for backup credentials.
- The encryption recipient is an RSA-3072+ **public** key supplied at execution time and checked against a separately pinned SHA-256. The private recovery key never enters this runner. Backups use a fresh AES-256-GCM data key wrapped with RSA-OAEP-SHA256.
- Google Drive access is limited to the owner-approved app-owned folder through `drive.file`; the code checks folder ID, name, owner, private status, and app marker before upload. Uploaded bytes are read back and SHA-256 checked. Automatic deletion is absent.

## Current acceptance state

The repository starts with synthetic boundary testing only. A successful GitHub environment run proves a disposable secret was available on the protected branch; a rejected run from another branch proves the branch policy. Neither proves that production credentials are safe until branch protection, workflow review, OAuth client type, alerting, and recovery have been accepted.

The backup schedule must be paired with an **independent** freshness monitor and delivered owner alert. The production command fails closed without a Healthchecks.io ping URL, signals start/success/failure, and emits no database data to that service. The URL must be an environment secret and the owner must approve that external monitor and confirm a received test alert. The [Healthchecks.io Hobbyist plan](https://healthchecks.io/pricing/) currently offers a free tier, but it is not configured. GitHub scheduled events can be delayed or dropped; cron alone is not an RPO guarantee. Keep the backup workflow template inactive until monitoring is configured and tested.

## Local verification

`npm test` has no third-party dependencies. `node src/run.mjs synthetic` additionally requires an owner-authorized Google OAuth grant and environment values; it encrypts random bytes, verifies Drive readback, downloads and decrypts them, then deletes only its own synthetic files. Never provide the owner's private recovery key to CI.
