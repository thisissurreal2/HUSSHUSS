# Phase 4.2: secure GitHub connection foundation

## What this phase does

The app has same-origin Cloudflare Pages Functions for starting a GitHub App installation, validating its callback, checking connection status, and clearing the local connection cookie. The Backup & sync screen reports **connected** only after the backend has re-verified the installed GitHub App and the exact private repository.

The verification is deliberately narrow:

- The only accepted repository is `thisissurreal2/HUSSHUSS-data`, and it must be private.
- The GitHub App must be installed for the `thisissurreal2` personal account, with repository selection set to selected and exactly that one repository available.
- The App needs only repository **Metadata: read-only** permission. The backend requests an installation token restricted to that permission.
- The frontend never receives a GitHub JWT, private key, or installation token. The short-lived, signed, `HttpOnly; Secure; SameSite=Strict` cookie contains only the installation identity and expires after ten minutes.
- The callback uses a signed, expiring state value and a matching HttpOnly browser cookie. The backend rechecks GitHub on status requests and renews the short-lived session only after a successful check.
- Disconnect clears both this browser's session and installation-state cookies, even if the request has no valid session. It does not uninstall or revoke the GitHub App in GitHub settings.
- There are no repository contents, fitness-data read/write, upload, download, delete, or sync endpoints in this phase. The IndexedDB database, LocalStorage migration copies, backup system, and local sync outbox are unchanged. No fitness data is sent to GitHub.

The GitHub API is called only by the backend to validate the installation and list its permitted repository metadata. The App private key and session-signing key must remain server-side.

## GitHub App setup (manual; not performed)

Do not create the App until you are ready to configure a deployed HTTPS origin. No GitHub resources have been created or changed by this implementation.

1. Register a **private GitHub App** under the account that owns `HUSSHUSS-data`.
2. Set its homepage URL to the deployed HUSSHUSS HTTPS origin.
3. Set its **Setup URL** to `https://<your-app-origin>/api/github/callback`. Do not add a webhook URL or subscribe to events for this connection-only phase.
4. Grant repository **Metadata: read-only** and no other permissions. GitHub requires Metadata access to inspect repository identity. Contents permission is not needed to verify the installation and must not be added in Phase 4.2.
5. Set installation access to **Only select repositories**, then install the App on exactly `thisissurreal2/HUSSHUSS-data`. Keep that repository private. Do not install on the source-code repository or all repositories.
6. Generate an App private key. Store the downloaded PEM only as a Cloudflare secret; never add it to this repo, a Vite variable, browser storage, or chat.

The connection flow begins when the user chooses **Connect private repository**. HUSSHUSS signs a short-lived state, binds it to a Secure HttpOnly `SameSite=Lax` browser cookie (needed for GitHub's top-level callback navigation), and redirects to the App's GitHub installation page. GitHub returns to the configured Setup URL. The backend checks the state and browser cookie, validates the installation and account using an App JWT, creates an in-memory installation token limited to Metadata read, and confirms that the only accessible repository is the exact private allow-listed repository. Only then is a short-lived first-party `SameSite=Strict` session cookie issued.

## Cloudflare Pages setup (manual; not performed)

The Pages Functions are in the repository-root `functions/` directory and serve `/api/github/connect`, `/api/github/callback`, `/api/github/status`, and `/api/github/disconnect`. Deploy the Vite app and Functions together using Cloudflare Pages connected to this source repository; a static-only upload of `dist/` does not include Functions.

1. Create a Cloudflare Pages project connected to the private HUSSHUSS source repository, with the production branch selected.
2. Use `npm ci` as the build command and `dist` as the output directory. The build script type-checks both the browser app and the Pages Functions.
3. In the Pages project's **Settings → Variables and Secrets**, add the following values to the Production environment (and Preview only if you intend to use it there):

| Name | Cloudflare setting | Value |
|---|---|---|
| `APP_ORIGIN` | Variable | Exact deployed origin, such as `https://app.example.com`; no path or trailing slash |
| `ALLOWED_REPOSITORY` | Variable | `thisissurreal2/HUSSHUSS-data` |
| `GITHUB_APP_SLUG` | Variable | The slug shown in the GitHub App URL |
| `GITHUB_APP_ID` | Secret | Numeric GitHub App ID |
| `GITHUB_APP_PRIVATE_KEY` | Secret | Entire PEM private key, preserving its line breaks |
| `SESSION_SIGNING_KEY` | Secret | 32 cryptographically random bytes encoded as exactly 64 hexadecimal characters |

Generate `SESSION_SIGNING_KEY` from a cryptographically secure random-number generator (CSPRNG), with all 32 bytes generated randomly; do not use a password, phrase, UUID, or repeated/predictable value. For example, on a trusted local machine use a reputable password manager's 32-byte random generator and request a 64-character hexadecimal output. The 64 hex characters encode 32 bytes (256 bits) of entropy. Do not save the value to a project file or commit it. Add it directly in the Cloudflare dashboard's secret input, and avoid shell arguments, terminal transcripts, chat, clipboard history, and source control. The application rejects values that are not exactly 64 hexadecimal characters.

Use the Cloudflare dashboard's secret input for all private values. Do not place these values in `VITE_*`, `.env`, `.dev.vars`, checked-in Wrangler config, source code, or build arguments. `.dev.vars*` is git-ignored. No real environment file or production secret is included in this repository. Do not paste credentials into chat or shell command history.

4. Deploy the site and Functions. Confirm the site is HTTPS and the App's Setup URL exactly matches `/api/github/callback` on this origin.
5. Check `/api/github/status` before connecting. An unconfigured backend responds with `configured: false` and `connected: false`; it never claims a connection based on local state. A Vite-only local server does not run Pages Functions and therefore cannot perform or verify a GitHub connection.
6. Only after reviewing the deployed routes and secrets, install the App on the one private data repository and use the UI to connect. Verify the UI names the private repository and disconnect it afterward if desired.

Cloudflare secret values must be configured separately for each environment. Use the dashboard's environment-specific bindings; do not promote preview secrets into production by copying them into source control.

## Rate limiting (manual Cloudflare configuration required)

The Pages Function code does **not** implement a shared rate limiter. An in-memory counter would be unreliable across Worker isolates and Cloudflare locations. Before public deployment, configure a Cloudflare WAF rate-limiting rule on the proxied custom domain that serves the Pages app:

1. In Cloudflare, open the zone for the app's custom hostname, then **Security → Security rules → Create rule → Rate limiting rules**.
2. Match these three paths with this expression:

   ```text
   (http.request.uri.path eq "/api/github/connect" or http.request.uri.path eq "/api/github/callback" or http.request.uri.path eq "/api/github/status")
   ```

3. Use **IP** as the counting characteristic (the Free plan's available characteristic).
4. Set the threshold to **10 requests per 10 seconds**, choose **Block**, and set the mitigation timeout to **10 seconds**.
5. Deploy the rule and verify ordinary connection and status checks remain below the threshold.

Cloudflare's official [rate-limiting availability](https://developers.cloudflare.com/waf/rate-limiting-rules/#availability) documentation currently lists one rate-limiting rule on Free, with path matching, IP counting, and a 10-second period/mitigation. If the zone already uses its one Free rule, do not replace it without reviewing the existing protection; choose an available plan/configuration only with the account owner's informed approval. The rule applies only when traffic traverses the configured Cloudflare zone, so use the proxied custom domain; do not assume it protects an unconfigured `pages.dev` hostname.

Cloudflare documents that rate-limit counters are approximate and local to data-center locations, so excess requests can pass before the rule takes effect and limits are not global. This is a low-cost abuse deterrent, not strict/global enforcement or a guarantee against GitHub API request bursts. Do not represent rate limiting as active until the rule is manually deployed and checked. See [request-rate calculation and locality](https://developers.cloudflare.com/waf/rate-limiting-rules/request-rate/).

## Free-tier feasibility

The connection-only feature uses low-volume Pages Function requests and GitHub App API calls. The official [Cloudflare Workers pricing page](https://developers.cloudflare.com/workers/platform/pricing/) lists a Free tier with 100,000 Worker requests per day and 10 ms CPU per invocation; [Pages Functions pricing](https://developers.cloudflare.com/pages/functions/pricing/) uses the Workers request quota, while static asset requests are free. The official [GitHub plans documentation](https://docs.github.com/en/get-started/learning-about-github/githubs-plans) says GitHub Free personal accounts include unlimited private repositories.

These published tiers make a low-volume, personal connection foundation feasible without intentionally selecting a paid service. They are not a guarantee of zero cost: provider terms, account-level configuration, quotas, and pricing can change. Review the current limits before deployment, monitor usage, and do not enable a paid plan or billing without an explicit decision. This task did not create an account, project, App, repository, or billing configuration.

## Security and scope limitations

- The UI status is unconfigured/unavailable in a normal local Vite session until the backend is deployed and configured. No real GitHub connection was created or tested here.
- This is a connection foundation, not a backup or sync service. The outbox remains local-only, and no fitness-data requests are made.
- A private GitHub repository is not a guaranteed permanent backup. Future transfer must encrypt the complete data envelope client-side before any network request, and must independently handle recovery and conflicts.
- The current GitHub App permission is metadata read-only. A later encrypted-file transfer phase must separately review and request the minimum additional Contents permission before implementing those operations.
- An installation may be revoked or its repository selection changed at any time. If GitHub cannot verify an existing session, the status is reported as unavailable rather than falsely claiming either a live connection or a confirmed disconnection.
- The session cookie is intentionally short-lived. The UI re-verifies against GitHub and renews the cookie on a successful status check.
- Every status check makes server-to-GitHub verification requests. This phase does not configure Cloudflare rate-limiting rules or usage alerts; review and set platform protections before exposing a deployment broadly.

## Official references

- [GitHub App permissions](https://docs.github.com/en/apps/creating-github-apps/registering-a-github-app/choosing-permissions-for-a-github-app)
- [Authenticating as a GitHub App and generating a JWT](https://docs.github.com/en/apps/creating-github-apps/authenticating-with-a-github-app/generating-a-json-web-token-jwt-for-a-github-app)
- [GitHub App installation access tokens](https://docs.github.com/en/rest/apps/apps#create-an-installation-access-token-for-an-app)
- [GitHub REST API versions](https://docs.github.com/en/rest/about-the-rest-api/api-versions)
- [Cloudflare Worker secrets](https://developers.cloudflare.com/workers/configuration/secrets/)
- [Cloudflare rate-limiting availability](https://developers.cloudflare.com/waf/rate-limiting-rules/#availability)
- [Cloudflare request-rate calculation](https://developers.cloudflare.com/waf/rate-limiting-rules/request-rate/)
- [Cloudflare Workers pricing and limits](https://developers.cloudflare.com/workers/platform/pricing/)
- [Cloudflare Pages Functions pricing](https://developers.cloudflare.com/pages/functions/pricing/)

The configured GitHub API version `2026-03-10` was checked against GitHub's official supported versions page on November 12, 2026; it is listed as supported with no end-of-support date scheduled. Recheck that page before deployment or future maintenance.
