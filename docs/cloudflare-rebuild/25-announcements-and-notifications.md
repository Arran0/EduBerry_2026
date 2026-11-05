# Announcements and Notifications

As of 5 Nov 2026. Part of the [rebuild docs](README.md). The design is a Neon Postgres project per school with Cloudflare for everything else ([01](01-architecture-options.md), [10](10-target-architecture.md)). Message delivery (outbox, Queues, push sending, WhatsApp) is in [14-jobs-messaging-realtime.md](14-jobs-messaging-realtime.md) and [17-integrations-and-secrets.md](17-integrations-and-secrets.md); this doc covers the school notice board and the in-app notification surfaces.

## 1. Summary

Coordinators, principals and admins post announcements (title, rich text, attachments) to an audience: all students, a grade, a grade-section, all teams, a team, or named people. Readers see a feed (pinned first), like posts, and get an unread badge, a home "notifications" box and a web push. Smartboards show their homeroom's announcements.

Live: 9 announcements, 25 audience rows, 71 likes, 919 read markers; push subscriptions 0 (push not yet enabled on live).

What changes: visibility stays with today's row-level security and feed function; push moves server-side, queued by the function that publishes the post; read state moves fully to the server (today it is split between `localStorage` high-water marks and a reads table); attachments are private (since 28 Oct 2026).

## 2. Users and screens

| Route | Who | Purpose |
| --- | --- | --- |
| `/announcements` (367 lines) | Everyone | Feed, new announcement form (privileged staff), like, pin (principal/admin), delete |
| Navbar badge | Everyone | Unread count (`useAnnouncementNotifications`) |
| Home notifications box | Everyone | Unread announcements, leave events, task events, dismissable |
| Profile → push toggle (`PushToggle`) | Everyone | Enable or disable push on this device |
| Smartboard | Kiosk | Homeroom feed (`get_homeroom_announcement_feed`) |

Code: `src/lib/announcements.ts`, `announcementReads.ts`, `notificationDismissals.ts`, `push.ts`, `src/lib/notifications/*`, components `AnnouncementCard`, `AnnouncementsList`, `ImageGallery`, `NewAnnouncementForm`, `NotificationToast`, `PushToggle`, `LeaveNotificationsListener`; `docs/announcement-notifications.md`.

## 3. How it works today

1. **Post.** The form builds audience rows; `type` (`student`, `staff`, `both`) is derived from them and stored so row-level security can filter cheaply. Attachments upload to the private bucket under `announcements/` (since 28 Oct 2026; readable by the announcement's audience through signed links). After insert, the browser calls `/api/announcements/notify`, which re-checks the author, resolves recipients and sends web push.
2. **Read.** `get_announcement_feed(limit, offset)` returns posts with audiences, author and like counts; visibility comes from row-level security: coordinators, principals and admins see all; teachers see `staff`/`both` posts for their teams or all teams; students see `student`/`both` posts for their grade/section or all students; anyone sees posts addressed to them by name.
3. **Unread.** A per-device `localStorage` "last read" timestamp floors the count; `announcement_reads` records per-post reads for the home box across devices. Opening the page marks everything read.
4. **Pin and like.** Pinned posts sort first; likes are one row per user.
5. **Home box dismissals** are kept in `localStorage` per device.

## 4. Data

| Table | Rows | Purpose |
| --- | --- | --- |
| `announcements` | 9 | Title, content, type, attachments (JSON), pinned, author |
| `announcement_audiences` | 25 | One row per target: grade + section, all_students, team, all_teams, or user |
| `announcement_likes` | 71 | User ↔ announcement |
| `announcement_reads` | 919 | User ↔ announcement, read_at |
| `push_subscriptions` | 0 | Endpoint and keys per browser |
| `notification_preferences` | 0 | Per-user, per-event, per-channel opt-outs (unused so far) |

## 5. Logic in the database

Under Neon every function, trigger and policy below moves unchanged with the database ([13](13-data-layer.md)), and the policies keep deciding who sees what. The right-hand column notes the exceptions: jobs `pg_cron` called, which the hub's timer now calls, and anything that used `pg_net`, Supabase Auth or Storage.

| Function | Under Neon |
| --- | --- |
| `get_announcement_feed` | Unchanged |
| `announcement_ids_addressed_to_me`, `announcement_ids_for_staff_audience`, `announcement_ids_for_student_audience` | Unchanged |
| `get_unread_announcements`, `count_unread_announcements` | Unchanged |
| `get_homeroom_announcement_feed` | Unchanged |
| `cleanup_stale_push_subscriptions` (cron) | Unchanged; called by the hub's timer through the `jobs` queue ([14](14-jobs-messaging-realtime.md)) |

## 6. Server routes and integrations

| Route | Target |
| --- | --- |
| `/api/announcements/notify` | A Worker route in phase 1; then removed, once the function that publishes a post writes push rows to the outbox ([14](14-jobs-messaging-realtime.md)) |
| `/api/push/subscribe`, `/api/push/unsubscribe` | `push.subscribe`, `push.unsubscribe` |

## 7. Jobs, files and live updates

- **Files:** `announcements/<announcementId>/...`, private; readable by the audience.
- **Live updates:** optional `announcements` channel to refresh badges instantly; polling the unread count on navigation is enough for launch.
- **WhatsApp:** the reminders branch adds an "announcement reminder" to parents of the student audience; it reuses the same audience rules.

## 8. Single-tenant assumptions

VAPID keys per deployment become one platform key pair ([17](17-integrations-and-secrets.md)).

## 9. Target design

Under Neon ([01](01-architecture-options.md)) this section's tables, functions and policies move as they are; nothing below is needed for the move itself. What follows is the phase 2 design ([16](16-frontend-and-api.md)): the endpoints the screens call, each running one SQL function as the signed-in user, and schema improvements worth making along the way as ordinary migrations. An endpoint written `section.action` is `POST /api/section/action`. Permission names label today's rules, which stay in the policies and functions; the fee module's grants remain the only named permission system.

### Tables

Carried over. Drop the stored `type` (derived on read by the resolver, or kept as a cached column maintained by `create`/`update`). Add an index on `announcement_audiences (team_id)`, `(grade, section)`, `(user_id)` and `announcements (pinned DESC, created_at DESC)`.

Move home-box dismissals and the "last read" mark to the server (`notification_reads (user_id, kind, ref_id, read_at)`), so badges agree across devices.

### Audience rules

Today's feed function and policies decide who sees a post, and they stay, covered by tests per role ([91](91-test-and-parity-plan.md)). The push recipients of a new post are that same audience minus the author minus people who opted out in `notification_preferences`, worked out in SQL by the publishing function.

### Endpoints (phase 2)

| Endpoint | Permission |
| --- | --- |
| `announcements.feed`, `announcements.unread`, `announcements.markRead`, `announcements.like` | signed in |
| `announcements.create`, `announcements.update` | `announcements.post` (coordinator, principal, admin) |
| `announcements.delete` | author (coordinator) or `announcements.moderate` (principal, admin) |
| `announcements.pin` | `announcements.moderate` |
| `announcements.homeroomFeed` | smartboard of that homeroom; staff |
| `notifications.box`, `notifications.dismiss` | signed in |
| `push.subscribe`, `push.unsubscribe`, `notifications.preferences.save` | signed in |

## 10. Moving existing data

Moves with the dump ([13](13-data-layer.md)); attachment URLs inside `attachments` JSON rewritten to R2 keys. Push subscriptions are not migrated (browsers re-subscribe; the endpoint is tied to the old VAPID key).

## 11. Parity checklist

- [ ] For each role, the feed shows exactly the posts today's policies show (test with every audience kind).
- [ ] Pinned posts first, then newest; likes and counts correct.
- [ ] Badge, home box and push agree on what is unread.
- [ ] A new post's push reaches its audience even if the author closes the tab immediately.
- [ ] Smartboards show their homeroom's posts.

## 12. Open questions

- [ ] Should announcements support scheduled publishing and expiry?
- [ ] Should parents (if guardian accounts are added) be an audience type?
