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

Open `http://<your-computer-local-IP>:5173` in Safari. Use Safari's **Share → Add to Home Screen** to install the app shell. Phase 2 stores workouts in that browser's local storage; offline caching and a service worker are not included.

## Checks

```powershell
npm run build
npm run lint
```

## Phase 2 features

- Push → Pull → Core & Athleticism rotation with one lower-body exercise in each workout.
- Start, resume, cancel, and complete sessions. A session can only be completed after every exercise is marked done.
- Personalised Push, Pull, and Core & Athleticism routines with exercise-specific set and rep/time targets.
- Individually checkable warm-up and optional cool-down/stretch checklists with saved progress.
- Log kilograms and reps for each set, add or remove sets, edit values, and mark sets complete.
- Rest timer presets of 30, 60, 90, 120, and 180 seconds, with start, pause, resume, reset, and browser sound/notification alerts where supported.
- Versioned local storage for rotation, current session, set entries, history, rest preferences, and timer deadline.
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
- Measurement records use a separate versioned local-storage key and do not alter workout history or its schema. Data remains on this browser/device and is not synced.
- Progress photos are not included; reliable local photo storage requires a separate storage approach beyond the app's current local-storage data model.

## Phase 3.4 athletic development

- Optional manual assessments across strength, core stability, grip, balance, conditioning, agility, and explosive power.
- Built-in tests include push-ups, pull-ups, plank, farmer carry, left/right balance, timed run, shuttle run, vertical jump, and short sprint; custom tests support user-selected units and higher/lower-is-better direction.
- Assessment history, previous/latest/best comparisons, direction-aware improvements, and charts use only recorded results. Run pace is calculated only when distance and duration are both recorded together.
- Athletic data uses a separate versioned local-storage key; workout and body measurement data remain unchanged. No overall athletic score or mandatory assessment schedule is used.

## Phase 3.5 personal insights and recovery

- Personal Insights summarizes completed workouts, completed-set volume-load, existing Phase 3.1 estimated 1RM records, direction-aware athletic assessment comparisons, and body-measurement record dates.
- Select rolling 7-day, 30-day, 90-day, or all-time summaries. Empty or incomparable records are called out rather than filled with estimates.
- A local IndexedDB mirror and coalesced outbox are prepared for future sync integration; they do not upload data and LocalStorage remains the compatibility source of truth.
- Encrypted and plaintext backup exports and validated restore are available. Remote GitHub/Cloudflare sync is not configured.

## Local data and limitations

Workout, measurement, and athletic-assessment data remain in their existing, separate versioned LocalStorage keys. Successful changes are also mirrored into an IndexedDB local outbox for a future sync integration; LocalStorage remains the current source of truth and no schema migration is performed. The queue is local only and does not upload data. Clearing browser site data can remove both local copies.

The Progress tab includes Personal Insights, which derives summaries from recorded data without assigning a readiness score or treating rest days as missed sessions. Backup & sync provides a versioned JSON export, an encrypted AES-256-GCM export, and a validated restore with a pre-restore safety snapshot that can undo the latest replacement. A plaintext export is available only after confirmation. Keep encrypted backup passphrases separately; they cannot be recovered.

Cross-device GitHub sync is not configured or available yet. No repository, GitHub App, Cloudflare Worker, credentials, or billing settings were created. See [the Phase 3.5 secure sync scaffold](./docs/phase-3.5-sync-scaffold.md) for the security boundary, exact account setup steps, and currently documented free-tier quotas. Do not treat the IndexedDB outbox as remotely synced data.

A running timer uses an absolute deadline and catches up when the page wakes; browsers may delay background execution and alerts while suspended.

Routines are starter examples, not individualized coaching. Estimated 1RM is approximate, requires a completed weighted set of up to 12 reps, and is not a tested maximum. Load suggestions and plateau flags are transparent heuristics, not medical or coaching advice. No exercise demo videos, authentication, Supabase, or cloud sync are included. `.env.example` remains a placeholder for a later phase; no API keys are needed now.
