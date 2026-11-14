
# HUSHHUSS background rest-timer notifications

This feature uses the iOS Home Screen PWA's Web Push support and a separate Cloudflare Worker with a Durable Object alarm. The Pages app does not keep a JavaScript timer alive in the background: the Durable Object stores the deadline and sends a Web Push message when the alarm fires.

## Files added

- `public/sw.js`: receives push events and displays the system notification.
- `src/pushNotifications.ts`: registers the service worker, subscribes the installed PWA, and schedules/cancels timer alarms.
- `push-worker/worker.ts`: authenticated Worker API and per-device Durable Object alarm.
- `wrangler.push.toml`: separate Worker and SQLite-backed Durable Object configuration.

## Deploy the notification Worker

1. Install the new dependency in the project: `npm install`. This updates `package-lock.json` for `@block65/webcrypto-web-push`.
2. Install or use Wrangler: `npx wrangler login`.
3. Generate a VAPID key pair with `npx web-push generate-vapid-keys` (the command may download the `web-push` utility temporarily). Keep the private key secret; only the public key is used in the browser.
4. Set the Worker secrets (paste each value when prompted):
   - `npx wrangler secret put VAPID_SUBJECT --config wrangler.push.toml` (use a `mailto:` contact you control)
   - `npx wrangler secret put VAPID_PUBLIC_KEY --config wrangler.push.toml`
   - `npx wrangler secret put VAPID_PRIVATE_KEY --config wrangler.push.toml`
5. Confirm `APP_ORIGIN` in `wrangler.push.toml` exactly matches the production Pages origin.
6. Deploy: `npx wrangler deploy --config wrangler.push.toml`.
7. Copy the deployed Worker URL and set `VITE_PUSH_API_URL` to it in the local production build environment and in Cloudflare Pages > Settings > Environment variables. Because this is a Vite build-time variable, trigger a fresh Pages deployment after setting it.

## App build and deploy

Run `npm install`, `npm run build`, `npm run lint`, and `npm test`. Commit and push the intended files, then wait for the Pages deployment to succeed.

## iPhone setup and test

1. Open the deployed HUSHHUSS Home Screen app.
2. Open the rest timer and tap **Enable background alerts**. Accept the iOS notification permission prompt.
3. Start a short rest (for example, 30 seconds), switch to another app, and wait for the alert.
4. Repeat with the screen locked. Verify pause, reset, skip, and duration adjustment cancel or replace the scheduled alarm.

Web Push requires the installed Home Screen app on supported iOS versions (iOS 16.4+), notification permission, network access when scheduling, and the deployed Worker/secrets. Delivery is controlled by iOS and Apple's push service; it can be delayed by network or system conditions and should not be treated as a millisecond-precise alarm. Notification sound and vibration follow the user's iOS notification and Focus settings; a web app cannot force a custom background vibration pattern or bypass Focus/Silent settings.

## Data safety

The notification Worker stores only a Web Push subscription, a hash of a random per-install API token, and the current timer deadline/message. It does not read or write HUSHHUSS workout records, XP, measurements, or encrypted backups. No IndexedDB schema or workout data migration is part of this feature.
