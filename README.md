# HUSSHUSS

A mobile-first workout companion built with React, TypeScript, Vite, and Tailwind CSS.

## Run locally

```powershell
npm install
npm run dev
```

Open the local URL printed by Vite (usually `http://localhost:5173`).

To preview the app on an iPhone connected to the same Wi-Fi:

```powershell
npm run dev -- --host 0.0.0.0
```

Open `http://<your-computer-local-IP>:5173` in Safari. Use Safari's **Share → Add to Home Screen** to install the app shell. Phase 4.1 stores app data in that browser's IndexedDB; earlier LocalStorage records are migrated on first use. Offline caching and a service worker are not included.

## Checks

```powershell
npm run build
npm run lint
```

## Phase 2 features

- Push → Pull → Core & Legs rotation.
- Start, resume, cancel, and complete sessions. A session can only be completed after every exercise is marked done.
- Personalised Push, Pull, and Core & Legs routines with exercise-specific set and rep/time targets.
- Individually checkable warm-up and optional cool-down/stretch checklists with saved progress.
- Log kilograms and reps for each set, add or remove sets, edit values, and mark sets complete.
- Rest timer presets of 30, 60, 90, 120, and 180 seconds, with start, pause, resume, reset, and browser sound/notification alerts where supported.
- Versioned local data for rotation, current session, set entries, history, rest preferences, and timer deadline.
- Workout history with session date, duration, detailed set records, and confirmed deletion.
- Optional recovery days do not advance the rotation. Cancelled workouts are not recorded or advanced.
- Existing version-1 workout data is migrated to version 2. In-progress sets and completion states are preserved as a snapshot of the previous routine; new sessions use the updated programme.

## Phase 3.1 strength progression

- Exercise-specific history from completed set logs, with previous performance shown in active sessions.
- Estimated 1RM trends (Epley formula for completed, weighted sets of 2–12 reps; one rep uses its logged weight), volume-load and top-weight charts.
- Estimated 1RM personal records, potential plateaus flagged when the estimate grows by no more than 1% across three exposures, and rep-range-based load suggestions.
- Strength analysis is calculated from existing history at display time; no extra profile data or external services are used.

## Phase 3.2 performance dashboard

- Period-selectable training totals, completed-set counts, weekly averages, recent activity, and recorded elapsed session time.
- Calendar activity heatmap, weekly and monthly workout frequency, and current/longest active-week streaks. An active week means at least one completed workout; it is not a daily training target.
- Strength overview reuses Phase 3.1 analytics for recent estimated 1RM records, strongest exercises, improvements, and exercise trend charts.
- Statistics use completed workout history only. Recovery days and active lifting time are not independently recorded, so non-training days are not classified and elapsed session duration may include breaks.

## Phase 3.3 body measurements

- Manually record optional neck, chest, waist, shoulder, relaxed/flexed biceps and forearms, thigh, calf, and body-weight values with an editable date.
- Review, edit, delete, and compare dated entries; charts plot only recorded values across selectable ranges.
- Measurement records use a separate versioned data area and do not alter workout history or its schema. Data remains on this browser/device and is not synced.
- Progress photos are not included; reliable local photo storage requires a separate storage approach beyond the app's current local-storage data model.

## Phase 3.4 athletic development

- Optional manual assessments across strength, core stability, grip, balance, conditioning, agility, and explosive power.
- Built-in tests include push-ups, pull-ups, plank, farmer carry, left/right balance, timed run, shuttle run, vertical jump, and short sprint; custom tests support user-selected units and higher/lower-is-better direction.
- Assessment history, previous/latest/best comparisons, direction-aware improvements, and charts use only recorded results. Run pace is calculated only when distance and duration are both recorded together.
- Athletic data uses a separate versioned data area; workout and body measurement data remain unchanged. No overall athletic score or mandatory assessment schedule is used.

## Phase 3.5 personal insights and recovery

- Personal Insights summarizes completed workouts, completed-set volume-load, existing Phase 3.1 estimated 1RM records, direction-aware athletic assessment comparisons, and body-measurement record dates.
- Select rolling 7-day, 30-day, 90-day, or all-time summaries. Empty or incomparable records are called out rather than filled with estimates.
- IndexedDB is the primary local database. A coalesced outbox remains local for possible future sync; it does not upload data.
- Encrypted and plaintext backup exports and validated restore are available. Remote GitHub/Cloudflare sync is not configured.

## Phase 4.1 IndexedDB primary storage

- Workout, measurement, and athletic-assessment reads and writes now use the existing `husshuss-local` IndexedDB database. Its `records` and `syncQueue` stores are preserved, and a schema upgrade adds migration metadata and a recovery archive.
- On first use, each existing LocalStorage data area is validated and copied in an atomic transaction. Workout version-1 records are upgraded using the existing workout migration. A separate readback validates the committed copy.
- Migration is idempotent and can be retried after interruption. Existing LocalStorage values are never removed or changed; they remain available as a recovery source. Invalid records are reported and retained, and corrupt IndexedDB snapshots are archived before a valid replacement.
- Each new IndexedDB write and corresponding local outbox entry commit together. The outbox remains local; no remote upload or authentication is enabled.
- Backup exports read from IndexedDB. Backup restore and undo replace all three data areas atomically, retaining a pre-restore safety snapshot in LocalStorage.

## Phase 4.2 GitHub connection foundation

- Same-origin Cloudflare Pages Functions support first-time App installation callbacks and reconnecting an already-installed App to another browser/device using a short-lived state challenge and server-verified installation ID.
- The backend verifies the App ID, `thisissurreal2` account, selected-only installation scope, and exactly the private `thisissurreal2/HUSSHUSS-data` repository before issuing a session. GitHub credentials and installation tokens remain server-side.
- The Backup & sync UI does not claim a connection without backend verification. A local Vite session without configured Pages Functions reports unavailable/unconfigured.
- Phase 4.2 was connection-only. Phase 4.3 adds explicit encrypted-backup upload/download using the existing browser AES-256-GCM format. See [Phase 4.3 encrypted backup sync](./docs/phase-4.3-encrypted-backup-sync.md) and the [Phase 4.2 connection setup](./docs/phase-4.2-github-connection.md).

## Phase 4.3 encrypted GitHub backup

- The GitHub App requires exactly Metadata read and Contents read/write, and remains installed only on the private `thisissurreal2/HUSSHUSS-data` repository. The backend verifies this scope for every operation.
- The browser encrypts a consistent local snapshot before upload. The passphrase and plaintext backup are never sent to the backend; the GitHub repository stores a single fixed encrypted backup file.
- Each device stores only its remote revision baseline and a local-data fingerprint in IndexedDB. Uploads are explicit and use optimistic conflict checks; the app does not merge or automatically overwrite changed remote data.
- Downloads are decrypted and validated in the browser before the user may confirm a restore. Restore uses the existing local recovery snapshot and atomic IndexedDB replacement.
- This is not a database or guaranteed permanent backup. Keep an independent encrypted export and the passphrase separately. The existing local sync outbox remains local-only.

## Local data and limitations

IndexedDB is the source of truth after migration. The old separate LocalStorage keys are retained unchanged as compatibility/recovery copies and are not updated by later edits. If IndexedDB is unavailable or has an unsupported newer schema, the application reports the error and cannot persist changes. Clearing browser site data can remove the primary database, outbox, and compatibility copies.

The Progress tab includes Personal Insights, which derives summaries from recorded data without assigning a readiness score or treating rest days as missed sessions. Backup & sync provides a versioned JSON export, an encrypted AES-256-GCM export, and a validated restore with a pre-restore safety snapshot that can undo the latest replacement. A plaintext export is available only after confirmation. Keep encrypted backup passphrases separately; they cannot be recovered.

GitHub connection and encrypted backup transfer require a correctly configured production Pages deployment and App installation; local Vite does not run Pages Functions. See the Phase 4.2 and Phase 4.3 documents before deployment. The [Phase 3.5 scaffold](./docs/phase-3.5-sync-scaffold.md) is retained as a historical pointer and is superseded by later phase documentation.

A running timer uses an absolute deadline and catches up when the page wakes; browsers may delay background execution and alerts while suspended.

Routines are starter examples, not individualized coaching. Estimated 1RM is approximate, requires a completed weighted set of up to 12 reps, and is not a tested maximum. Load suggestions and plateau flags are transparent heuristics, not medical or coaching advice. No exercise demo videos or Supabase integration are included. `.env.example` remains a placeholder; no API keys are needed to run the local app.
