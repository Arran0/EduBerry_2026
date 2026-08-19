# Announcement notifications

Two layers, both free to run:

| Layer | What it does | Cost |
|---|---|---|
| In-app badge | Red count on the **Announcements** navbar item | none |
| Web Push | OS-level notification, app closed | none — self-signed VAPID |

## In-app badge

`useAnnouncementNotifications` counts announcements targeted at the signed-in
user that are newer than a per-device "last read" timestamp in localStorage —
the same high-water-mark approach the task and leave badges already use.
Opening `/announcements` marks everything read.

Targeting is resolved by `resolveAnnouncementScope()` in `src/lib/announcements.ts`,
shared with the feed itself so the badge can never disagree with what the user
actually sees. The user's own announcements are excluded from the count.

## Web Push

Push here is the **Web Push protocol with VAPID**: the server signs its own
payloads and posts them to whichever push service the browser nominates
(FCM for Chrome, Mozilla autopush for Firefox, Apple for Safari). There is no
messaging vendor, no account, and no per-message charge.

### One-time setup

1. Generate the key pair:

   ```bash
   npm run generate-vapid
   ```

2. Put the output in `.env.local` and in your host's environment settings:

   ```
   NEXT_PUBLIC_VAPID_PUBLIC_KEY=…   # sent to browsers, by design
   VAPID_PRIVATE_KEY=…              # server only, never expose
   VAPID_SUBJECT=mailto:admin@your-school.example
   ```

   Keep the pair stable once people have subscribed — regenerating it
   invalidates every existing subscription.

3. Run `supabase-migrations/add_push_subscriptions.sql` in the Supabase SQL
   editor.

Without the keys the app still works: the toggle hides itself, and the send
route reports `skipped: 'VAPID keys not configured'` instead of failing.

### Moving parts

| File | Role |
|---|---|
| `public/sw.js` | Service worker — shows the notification, routes the tap |
| `src/lib/push.ts` | Browser side: permission, subscribe, unsubscribe |
| `src/components/announcements/PushToggle.tsx` | The "Notify me" control in the banner |
| `src/app/api/push/subscribe` · `unsubscribe` | Stores/forgets one device |
| `src/app/api/announcements/notify` | Resolves the audience and sends |

### Send path

`NewAnnouncementForm` calls `/api/announcements/notify` after the announcement
is created. The route:

1. Verifies the caller **authored** that announcement (or is principal/admin),
   so it cannot be used to push arbitrary messages to the school.
2. Expands the announcement's audience rows to concrete user ids — all
   students, a grade/section, all staff, a team, or individually named members.
3. Drops the author, loads those users' subscriptions, and sends.
4. Prunes subscriptions the push service rejects with 404/410 (browser threw
   the subscription away), so the table doesn't accumulate dead devices.

Push failures are swallowed client-side — a notification that doesn't go out
must never make a successfully posted announcement look like it failed.

### Browser support

Chrome, Edge, Firefox and Android work in a normal tab. **iOS requires the app
to be installed to the home screen** (Add to Home Screen) before Safari exposes
push at all — the existing `public/manifest.json` already makes that possible.
Where push isn't available the toggle renders nothing rather than offering a
button that cannot work, and the in-app badge still functions.
