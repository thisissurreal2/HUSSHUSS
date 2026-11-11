# Phase 4.3: encrypted GitHub backup sync

## Scope and trust boundaries

Phase 4.3 adds explicit encrypted backup transfer through the existing same-origin Cloudflare Pages Functions. Local IndexedDB remains the source of truth. This is a manual backup/restore flow, not continuous synchronization, a database, or a guaranteed permanent backup.

The browser builds the existing versioned backup bundle and encrypts it with the existing PBKDF2-SHA-256 (600,000 iterations) and AES-256-GCM format before making an upload request. The passphrase is used only in the browser, is never saved, and is never sent to Cloudflare or GitHub. The backend validates the encrypted envelope's structure and size, but does not decrypt it. GitHub stores one fixed file, `husshuss/encrypted-backup-v1.json`, in the private data repository.

The Pages Functions:

- `GET /api/github/sync/metadata` reports whether the fixed backup file exists and its Git blob SHA/size. It does not retrieve the backup blob.
- `GET /api/github/sync/download` retrieves and validates the remote envelope, then returns only its encrypted backup payload and version metadata.
- `POST /api/github/sync/upload` accepts only a structurally valid encrypted backup. It checks the caller's expected remote version before writing and supplies GitHub's observed SHA on updates as a second race guard.

Each request requires the signed, short-lived Phase 4.2 browser session and re-verifies the GitHub App installation. The installation must belong to `thisissurreal2`, be selected-repository-only, expose exactly `thisissurreal2/HUSSHUSS-data`, and have exactly Metadata read plus Contents write permissions. The private key, JWT, installation token, and session-signing key remain server-side. The existing App must not be granted access to the HUSSHUSS source repository or any other repository.

## User flow

1. Connect the browser using the existing Phase 4.2 flow and verify the private repository.
2. Select the encrypted-backup passphrase (at least 12 characters). The app does not persist it.
3. Use **Encrypt and upload** to create and explicitly send a new local snapshot. IndexedDB data remains unchanged by upload.
4. On another device, enter the same passphrase and choose **Download and validate**. The app decrypts and validates the backup locally, then displays record counts without changing local data.
5. Choose **Restore validated remote backup** and confirm. The existing restore path saves a local recovery snapshot before replacing all three data areas. The app checks that the remote version has not changed since validation.

There is no merge. If the remote file changed since this device's stored baseline—or if a remote backup exists but this device has no baseline—ordinary upload is blocked. Download and validate the remote copy, then explicitly choose either **Restore validated remote backup** or **Keep local data and replace remote**. The latter requires a second confirmation and the exact reviewed remote revision; a newer concurrent version still causes a conflict. If the previously synced file is missing, recreating it requires a separate explicit confirmation. No conflict resolution is automatic.

Per-device sync metadata (remote SHA, revision, version ID, timestamp, and a SHA-256 fingerprint of local backup data) is stored in the `syncMetadata` IndexedDB object store. It contains no fitness records, passphrase, or encryption key. The fingerprint is used only to detect local changes on that device. The existing local outbox remains unchanged and is not uploaded.

## GitHub and Cloudflare configuration

This feature requires a GitHub App installation with repository permissions set to exactly:

- **Metadata: Read-only**
- **Contents: Read and write**

Keep the installation restricted to the single private repository `thisissurreal2/HUSSHUSS-data`. Do not add organization-wide or source-repository access. The backend verifies the installation and requests an installation token constrained to these permissions.

The existing Cloudflare Pages Functions deployment and Phase 4.2 server-side secrets are reused. The app must be deployed with the repository-root `functions/` directory included. Do not put credentials in frontend variables, source files, or committed environment files. No authentication provider, external API, paid service, or new credential is introduced by this phase.

Enabling Contents write is a meaningful increase in access: a stolen or compromised backend installation token could modify repository contents within the installation's selected repository. Keep the installation repository selection narrow, retain server-side token handling, review Cloudflare logs and rate limits, and do not treat GitHub as the only copy of important records.

## Data limits and recovery

- The existing encrypted-backup format and restore validation are reused; the plaintext backup format is never accepted by the upload endpoint.
- Plaintext backup content remains in browser memory during encryption/decryption. It is not written to remote storage by this code.
- The server accepts encrypted payloads up to 70 MiB. The existing local backup parser caps plaintext backup JSON at 50 MB. Very large backups may be constrained by browser memory, GitHub's Contents API, Cloudflare request limits, or network timeouts.
- A wrong passphrase, malformed encrypted envelope, interrupted download, or failed decryption is reported before local data is changed.
- Restore uses the existing recovery-snapshot and atomic IndexedDB replacement path. If local recovery storage or IndexedDB fails, inspect the recovery UI and local exports before retrying.
- A remote GitHub repository is not guaranteed permanent storage. Keep an independent encrypted export in a separately controlled location and keep the passphrase separately.
- There is no automatic background sync, automatic download, merge, delete, or remote-history browser. Each successful upload replaces the fixed current backup file; GitHub's repository history may retain earlier encrypted versions, but this app does not promise their availability.

## Validation and deployment status

Route tests mock GitHub's API and verify installation checks, session authorization, encrypted-only upload, metadata without blob downloads, unchanged encrypted download, rejection of plaintext/malformed payloads, and prevention of overwrite without the expected baseline. These tests do not contact production GitHub or Cloudflare and do not prove the configured production installation has the required Contents permission.

After deployment, verify `/api/github/status`, check the remote metadata endpoint, upload a small encrypted backup, validate/download it on another browser, and test the confirmed restore using disposable test data first. Do not deploy or change GitHub or Cloudflare settings without the account owner's approval.
