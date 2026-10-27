# Announcements and Notifications

As of 27 Oct 2026. Part of the [Cloudflare rebuild docs](README.md). Message delivery (outbox, Queues, push sending, WhatsApp) is in [14-jobs-messaging-realtime.md](14-jobs-messaging-realtime.md) and [17-integrations-and-secrets.md](17-integrations-and-secrets.md); this doc covers the school notice board and the in-app notification surfaces.

## 1. Summary

Coordinators, principals and admins post announcements (title, rich text, attachments) to an audience: all students, a grade, a grade-section, all teams, a team, or named people. Readers see a feed (pinned first), like posts, and get an unread badge, a home "notifications" box and a web push. Smartboards show their homeroom's announcements.

Live: 9 announcements, 25 audience rows, 71 likes, 919 read markers; push subscriptions 0 (push not yet enabled on live).

What changes: visibility, today enforced by row-level security on the feed function, becomes an explicit audience resolver in the object; push moves server-side; read state moves fully to the server (today it is split between `localStorage` high-water marks and a reads table); attachments become private.

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

1. **Post.** The form builds audience rows; `type` (`student`, `staff`, `both`) is derived from them and stored so row-level security can filter cheaply. Attachments upload to the public bucket under `announcements/`. After insert, the browser calls `/api/announcements/notify`, which re-checks the author, resolves recipients and sends web push.
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

| Function | Target |
| --- | --- |
| `get_announcement_feed` | `announcements.feed(cursor)` using `visibleAnnouncementIds(user)` |
| `announcement_ids_addressed_to_me`, `announcement_ids_for_staff_audience`, `announcement_ids_for_student_audience` | The audience resolver, one function for feed, badge, push recipients and smartboard |
| `get_unread_announcements`, `count_unread_announcements` | `announcements.unread()` from `announcement_reads` |
| `get_homeroom_announcement_feed` | `announcements.homeroomFeed(homeroomId)` for smartboards |
| `cleanup_stale_push_subscriptions` (cron) | Removed: dead endpoints are deleted when a send returns 404/410 |

## 6. Server routes and integrations

| Route | Target |
| --- | --- |
| `/api/announcements/notify` | Removed; `announcements.create` writes push rows to the outbox |
| `/api/push/subscribe`, `/api/push/unsubscribe` | `push.subscribe`, `push.unsubscribe` |

## 7. Jobs, files and live updates

- **Files:** `announcements/<announcementId>/...`, private; readable by the audience.
- **Live updates:** optional `announcements` channel to refresh badges instantly; polling the unread count on navigation is enough for launch.
- **WhatsApp:** the reminders branch adds an "announcement reminder" to parents of the student audience; it reuses the same audience resolver.

## 8. Single-tenant assumptions

VAPID keys per deployment become one platform key pair ([17](17-integrations-and-secrets.md)).

## 9. Target design

### Tables

Carried over. Drop the stored `type` (derived on read by the resolver, or kept as a cached column maintained by `create`/`update`). Add an index on `announcement_audiences (team_id)`, `(grade, section)`, `(user_id)` and `announcements (pinned DESC, created_at DESC)`.

Move home-box dismissals and the "last read" mark to the server (`notification_reads (user_id, kind, ref_id, read_at)`), so badges agree across devices.

### Audience resolver

`audienceOf(announcement)` → set of user ids; `visibleAnnouncementIds(user)` → ids visible to a user. Both follow today's rules exactly; both are covered by tests per role. The push recipients of a new post are `audienceOf(post)` minus the author minus people who opted out in `notification_preferences`.

### Methods

| Method | Permission |
| --- | --- |
| `announcements.feed`, `announcements.unread`, `announcements.markRead`, `announcements.like` | signed in |
| `announcements.create`, `announcements.update` | `announcements.post` (coordinator, principal, admin) |
| `announcements.delete` | author (coordinator) or `announcements.moderate` (principal, admin) |
| `announcements.pin` | `announcements.moderate` |
| `announcements.homeroomFeed` | smartboard of that homeroom; staff |
| `notifications.box`, `notifications.dismiss` | signed in |
| `push.subscribe`, `push.unsubscribe`, `notifications.preferences.save` | signed in |

## 10. Moving existing data

Straight copy; attachment URLs inside `attachments` JSON rewritten to R2 keys. Push subscriptions are not migrated (browsers re-subscribe; the endpoint is tied to the old VAPID key).

## 11. Parity checklist

- [ ] For each role, the feed shows exactly the posts today's policies show (test with every audience kind).
- [ ] Pinned posts first, then newest; likes and counts correct.
- [ ] Badge, home box and push agree on what is unread.
- [ ] A new post's push reaches its audience even if the author closes the tab immediately.
- [ ] Smartboards show their homeroom's posts.

## 12. Open questions

- [ ] Should announcements support scheduled publishing and expiry?
- [ ] Should parents (if guardian accounts are added) be an audience type?
