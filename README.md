# CAKRA isolated backup runner

This public repository contains only generic backup tooling. It contains no CAKRA application code, production database identity, Drive folder ID, OAuth token, encryption key, archive, or customer data.

## Security boundary

- The default branch and `production-backup` environment must be protected before any production database credential is added. The environment allows deployments from the protected default branch only. A manual disposable-secret boundary probe passed and was then removed from active workflows.
- The `validate` workflow accepts pull requests but has no environment, secrets, write token, backup command, or external-data access. No `pull_request_target` or `workflow_run` triggers are used.
- A manual production-backup workflow is under review. It has no schedule and cannot run from a pull request or any branch other than protected `main`. The twice-daily schedule remains an **inactive template** under `templates/` and requires separate owner approval after manual backup, recovery, and monitoring evidence. Do not use repository-level secrets for backup credentials.
- The encryption recipient is an RSA-3072+ **public** key supplied at execution time and checked against a separately pinned SHA-256. The private recovery key never enters this runner. Backups use a fresh AES-256-GCM data key wrapped with RSA-OAEP-SHA256.
- The PostgreSQL client uses `sslmode=verify-full` with the bundled public Supabase Root 2021 CA. Its DER SHA-256 fingerprint is pinned in code and checked before export. The CA file is mounted read-only into the pinned PostgreSQL 17 container. A missing, changed or expired root aborts the backup.
- Google Drive access is limited to the owner-approved app-owned folder through `drive.file`; the code checks folder ID, name, owner, private status, and app marker before upload. Uploaded bytes are read back and SHA-256 checked. Automatic deletion is absent.

## Current acceptance state

The protected branch and `production-backup` environment passed a disposable-secret boundary test. A manual monitor probe also passed, then both probe workflows were removed. The `synthetic-drive` workflow is manual and uses a separate `synthetic-drive` environment with the dedicated Web OAuth grant. It handles only generated random bytes and checks encrypted upload, Drive readback, download, decryption, and exact cleanup. The production database reader credential and RSA **public** recipient key are now sealed as `production-backup` environment secrets, following owner approval. The production environment does not share credentials with the synthetic workflow. Its Google Drive OAuth secrets have not been connected, and no production backup workflow is active on protected `main`.

The repository is owned by one person. GitHub Free permits protected branches and environment secrets here, but there is no independent reviewer. Compromise of that owner's account could change workflow code or protection settings and expose environment secrets. The owner must maintain strong GitHub MFA and review every workflow change. This risk persists until a separate approver can be required.

The backup schedule must be paired with an **independent** freshness monitor and delivered owner alert. The production command fails closed without a Healthchecks.io ping URL, signals start/success/failure, and emits no database data to that service. The URL is an environment secret. An owner-received failure alert and hosted monitor signal passed; the check was paused after testing because no production schedule is active. Resume it only when a real backup schedule begins. Test success pings must never be counted as backups. The [Healthchecks.io Hobbyist plan](https://healthchecks.io/pricing/) currently offers a free tier. GitHub scheduled events can be delayed or dropped, and scheduled workflows in an inactive public repository can be disabled after 60 days; cron alone is not an RPO guarantee. Keep the backup schedule template inactive until manual backup, isolated recovery and scheduling gates pass.

## Local verification

`npm test` has no third-party dependencies. `node src/run.mjs synthetic` additionally requires an owner-authorized Google OAuth grant and environment values; it encrypts random bytes, verifies Drive readback, downloads and decrypts them, then deletes only its own synthetic files. Never provide the owner's private recovery key to CI.
