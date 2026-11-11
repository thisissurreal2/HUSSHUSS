# Phase 3.5 secure sync scaffold

## What is implemented now

- Workout, measurement, and athletic-assessment schemas remain unchanged in their existing LocalStorage keys.
- Successful local writes are mirrored to an IndexedDB `records` store and coalesced by data area in an IndexedDB `syncQueue` store. The queue is a local outbox only; it is not sent anywhere.
- Existing localStorage values are copied into IndexedDB on first initialization when there is no mirror yet. LocalStorage remains the compatibility source of truth; no destructive migration occurs.
- Personal Insights summarizes actual completed workout, strength, measurement, and athletic-assessment records.
- Backup files use a versioned format. Encrypted files use PBKDF2-HMAC-SHA-256 (600,000 iterations) and AES-256-GCM with a random 16-byte salt, a random 12-byte nonce, and authenticated envelope metadata. The passphrase stays in memory during the operation.
- Restore validates all three current data schemas before confirmation, snapshots the previous three raw LocalStorage values under `husshuss.restore-safety.v1`, then replaces the three keys and their IndexedDB queue records in a transaction. The saved snapshot can be restored from Backup & sync to undo a successful replacement; a failed replacement attempts to roll back automatically. Other browser storage keys are not touched.

The IndexedDB outbox currently keeps the latest full snapshot for each data area, not an item-by-item journal. Its values are stored locally in readable form, just like the current LocalStorage records. No cloud endpoint or GitHub credential is configured, and the queue must not be interpreted as a successful sync. The encrypted backup format is implemented, but cloud uploads are not.

## Security boundary

Do not add a GitHub Personal Access Token, GitHub App private key, client secret, or other service credential to Vite variables or browser code. The frontend is public code. Keep the GitHub App private key and any server-side session-signing key only in Cloudflare Worker secrets. Use a private, dedicated repository and grant the app only repository Contents read/write and required Metadata read permission for that repository. Do not request Administration, organization, or account permissions unless a documented, necessary flow requires them.

Before any network write is enabled:

1. Encrypt the entire versioned data envelope in the browser with AES-GCM and a fresh random nonce for every encryption. Bind format/version and sync identity as authenticated additional data. Do not send a passphrase or derived key.
2. Authenticate the GitHub user and verify the installed app and exact repository server-side. Maintain an explicit account/repository allow-list; never accept an arbitrary owner, repository, branch, or path from a client.
3. Keep GitHub installation credentials on the server. Use short-lived installation tokens and an `HttpOnly`, `Secure`, `SameSite=Strict` session cookie; protect state-changing requests with CSRF tokens, strict Origin checks, and rate limits. Never persist a GitHub token in LocalStorage, IndexedDB, a URL, or logs.
4. Restrict writes to a single data file/path in the dedicated repository. Use GitHub's file SHA / conditional update to detect concurrent writes. On a conflict, preserve both ciphertext revisions for explicit recovery; never silently last-write-wins.
5. Test encryption/decryption, wrong passphrases, nonce uniqueness, authentication-tag failures, concurrent-device conflicts, expired sessions, revoked app installations, network failures, and backup recovery before marking sync available.

Client-side encryption protects the payload at rest in GitHub and from the Worker, but it does not protect data from a compromised device, malicious same-origin script, browser extension, or a user who loses the passphrase. A GitHub private repository is not a substitute for an independent backup. Plaintext export is intentionally available only after a clear confirmation.

## Manual setup required before implementation can be completed

No accounts, repositories, GitHub Apps, Cloudflare projects, secrets, or billing settings were created as part of this phase.

1. In GitHub, create a **private** repository dedicated to this app's data (for example `HUSSHUSS-data`). Do not reuse the source-code repository or add fitness data to an issue, gist, commit message, or public repository.
2. Register a **private GitHub App** under the account that owns that repository. Set only repository **Contents: read and write** and **Metadata: read-only** permissions; subscribe to no webhooks unless the eventual design requires them. Install it only on the dedicated data repository. Keep its private key off the iPhone and out of the web project.
3. Create a Cloudflare Pages project for the frontend and Pages Functions/Worker routes for server-side GitHub authorization and encrypted-blob reads/writes. Do not set Vite `VITE_*` secrets. Store the App ID, private key, installation/repository allow-list, and session-signing material only as Worker secrets. Never paste secrets into chat or source control.
4. Implement a one-time OAuth/installation handshake with unpredictable, short-lived server-validated state and a redirect URI on the deployed origin. Confirm the GitHub account/repository identity on the server; do not infer identity from user-submitted strings.
5. Implement a short-lived first-party session, CSRF/Origin protections, secure headers, repository path allow-list, request-size limits, rate limits, and audited generic errors that do not log payloads, tokens, or passphrases.
6. Only after end-to-end testing, enable a Sync action that encrypts locally, sends ciphertext, reports the remote revision, and handles conflicts. Pull must decrypt locally and fully validate before offering a restore/merge. Do not auto-replace newer local state.
7. Test on a second device using the encrypted export/passphrase path first. Verify the remote file contains ciphertext only and that the browser's network requests, server logs, and repository history contain no plaintext or key material.

### Cost and quota check

Checked against official plan and platform documentation on **November 11, 2026**:

- [GitHub Free plan](https://docs.github.com/en/get-started/learning-about-github/githubs-plans) currently includes unlimited private repositories for personal accounts. GitHub Actions is not needed for sync; avoid adding workflows that consume private-repository compute/storage.
- [Cloudflare Workers pricing](https://developers.cloudflare.com/workers/platform/pricing/) currently lists a Free tier with 100,000 Worker requests per day and 10 ms CPU per invocation. [Pages Functions](https://developers.cloudflare.com/pages/functions/pricing/) use the Workers request quota; static asset requests are free and unlimited. [Pages Free limits](https://developers.cloudflare.com/pages/platform/limits/) currently list 500 builds per month. A Workers Paid plan is listed at a $5/month minimum, so do not enable it for this project without an explicit user decision.
- These are provider limits, not a promise that a deployed sync implementation will remain free. Recheck before deployment and configure usage alerts/limits where available. This phase did not create an account or enable billing.

Cloudflare Worker secrets guidance: [Cloudflare secrets](https://developers.cloudflare.com/workers/configuration/secrets/). GitHub App permission guidance: [Choosing permissions](https://docs.github.com/en/apps/creating-github-apps/registering-a-github-app/choosing-permissions-for-a-github-app). GitHub Contents API: [Repository contents endpoints](https://docs.github.com/en/rest/repos/contents). Repository operational limits: [GitHub repository limits](https://docs.github.com/en/repositories/creating-and-managing-repositories/repository-limits).

## Current limitation

Cross-device authentication and remote sync are intentionally not implemented or claimed as working. They require the account/repository/App configuration above, backend code, security tests, and an end-to-end deployment that this local workspace cannot validate without those user-owned resources.
