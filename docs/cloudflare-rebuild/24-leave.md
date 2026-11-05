# Leave and On-Duty Applications

As of 5 Nov 2026. Part of the [rebuild docs](README.md). The design is a Neon Postgres project per school with Cloudflare for everything else ([01](01-architecture-options.md), [10](10-target-architecture.md)).

## 1. Summary

Students and staff apply for leave or on-duty (OD): casual, medical, on duty, half day, or a late permit, for a date range, with a reason and an optional attachment (often a medical certificate). The applicant picks who should review it; each reviewer gets an approval row and decides. Any rejection rejects the application; when every reviewer has approved, it is approved. Approved leave is written into attendance. Reviewers and applicants see unread markers, counts, live updates and push notifications.

Live usage: 200 applications (148 approved, 25 rejected, 27 pending), 200 approval rows; 172 decided by the principal.

What changes: the decision, the status roll-up, the attendance write and the push all happen in one SQL function behind one Worker route (today the browser performs four separate steps after a decision, and any of them can be lost if the tab closes); attachments are already private (since 28 Oct 2026); live updates move from Supabase Realtime to the school's hub. Leave writes go through Worker routes from phase 1, because they feed live screens and push ([14](14-jobs-messaging-realtime.md)).

## 2. Users and screens

| Route | Who | Purpose |
| --- | --- | --- |
| `/more/leave` | Students; staff reviewing student leave | Student leave workspace: apply, my applications, review queue, all applications (scoped) |
| `/more/staff-leave` | Staff | Staff leave workspace: apply, my applications, review queue |
| Home notification box | Everyone | New applications to review, decisions on my applications |
| Attendance screens | Staff | Leave shown against attendance days |

Components: `StudentLeaveWorkspace`, `StaffLeaveWorkspace`, `StudentLeaveModal`, `StaffLeaveModal`, `LeaveAppList`, `LeaveApplicationCard`, `LeaveApplicationDetailModal`, `LeaveAppPreviewModal`, `ApproverDecisionPanel`, `LeaveStatsCard`. Code: `src/lib/leave.ts` (838 lines), `leaveNotifications.ts`, `leaveNotificationEvents.ts`, hooks `usePagedLeaveLists`, `useLeaveRealtime`, `useLeaveNotifications`.

## 3. How it works today

1. **Apply.** The applicant fills type, dates, reason, optional attachment (uploaded to the private bucket under `leave/` since 28 Oct 2026, readable by whoever can read the application; before that, the public bucket) and chooses reviewers: students search staff; staff choose coordinators, principals, admins or specific staff (`searchStaffRecipients` by applicant role). The browser inserts the application (`pending`) and one `leave_approvals` row per reviewer with their role (and team, where relevant), then calls `/api/leave/notify` for push.
2. **Review.** Reviewers see a paged queue (`fetchApprovalQueueIds`), open an application (marks it viewed in `leave_application_views`) and approve or reject with a comment and optional attachment.
3. **After a decision** the browser, in sequence: updates the approval row; calls `sync_leave_application_status` (any rejection → rejected; all approved → approved; else pending); marks it viewed; calls `/api/leave/notify` to push the applicant; and, if approved, writes attendance (`syncLeaveToStudentAttendance` or `syncLeaveToStaffAttendance`).
4. **Unread state.** An application is unread for a reviewer until they decide, and for the applicant until they see the latest decision (`leave_application_views.viewed_at` vs `updated_at`).
5. **Live updates.** `useLeaveRealtime` subscribes to `leave_applications` and `leave_approvals` changes for the user.
6. **Delete.** Principal and admin can delete an application (approvals first).

## 4. Data

| Table | Rows | Purpose |
| --- | --- | --- |
| `leave_applications` | 200 | Applicant, type (`leave_type` enum: casual, medical, on_duty, half_day, late), dates, reason, status (`pending`, `approved`, `rejected`), selected reviewer ids (array), attachment |
| `leave_approvals` | 200 | One per reviewer: role, team, status, comments, decided_at, attachment |
| `leave_application_views` | 361 | Who last viewed which application and when |

## 5. Logic in the database

Under Neon every function, trigger and policy below moves unchanged with the database ([13](13-data-layer.md)), and the policies keep deciding who sees what. The right-hand column notes the exceptions: jobs `pg_cron` called, which the hub's timer now calls, and anything that used `pg_net`, Supabase Auth or Storage.

| Function | Under Neon |
| --- | --- |
| `sync_leave_application_status` | Unchanged |
| `is_own_leave_application` | Unchanged |
| `mark_leave_application_viewed`, `mark_leave_applications_viewed` | Unchanged |
| Row-level security (staff see student leave; applicants see own; reviewers see addressed) | Unchanged |

## 6. Server routes and integrations

`/api/leave/notify` (push to reviewers or applicant) is removed: `leave.apply` and `leave.decide` write push rows to the outbox ([14](14-jobs-messaging-realtime.md)).

## 7. Jobs, files and live updates

- **Files:** attachments at `leave/<applicationId>/...`, private; readable by the applicant, the reviewers and staff allowed to see that application.
- **Live updates:** channel `leave:user:<id>`; after `apply`, `decide` and `delete` the Worker publishes the events `app_after_write()` returns to the hub, which forwards them to the applicant and every reviewer.
- **Jobs:** none.

## 8. Single-tenant assumptions

None beyond the platform-wide ones.

## 9. Target design

Under Neon ([01](01-architecture-options.md)) this section's tables, functions and policies move as they are; nothing below is needed for the move itself. What follows is the phase 2 design ([16](16-frontend-and-api.md)): the endpoints the screens call, each running one SQL function as the signed-in user, and schema improvements worth making along the way as ordinary migrations. An endpoint written `section.action` is `POST /api/section/action`. Permission names label today's rules, which stay in the policies and functions; the fee module's grants remain the only named permission system.

### Tables

Carried over. `selected_approver_ids` (array) is redundant with `leave_approvals`; drop it in a later migration once nothing reads it (the approval rows are the source of truth). Indexes: `leave_applications (applicant_id, created_at)`, `(status, created_at)`; `leave_approvals (approver_id, status)`, `(leave_application_id)`; `leave_application_views (user_id, application_id)` primary key.

### Endpoints (phase 2)

| Endpoint | Permission | Effect |
| --- | --- | --- |
| `leave.reviewers(query)` | signed in | Allowed reviewers for the caller's role |
| `leave.apply(input)` | signed in (students and staff) | Application + approval rows + push to reviewers + live broadcast |
| `leave.mine(page, tab)`, `leave.queue(page, tab)`, `leave.all(page, scope, search)` | own / reviewer / `leave.view_all_students` or `leave.view_all_staff` | Keyset pages with counts |
| `leave.get(id)` | applicant, reviewer, or view-all permission | Marks viewed |
| `leave.decide(id, decision, comment, attachment?)` | the reviewer on that approval row | One transaction: approval → roll-up status → mark viewed → attendance written if approved → push to applicant → live broadcast |
| `leave.stats(userId)` | self or staff | Counts by type and status |
| `leave.delete(id)` | `leave.delete` (principal, admin) | Removes approvals and views; what happens to attendance it wrote is an open question below |

## 10. Moving existing data

Moves with the dump ([13](13-data-layer.md)); attachment URLs rewritten to R2 keys and files copied. Check every application's status equals the roll-up of its approvals; list mismatches.

## 11. Parity checklist

- [ ] Each role sees exactly the reviewer choices it has today.
- [ ] Any rejection rejects; all approvals approve; otherwise pending.
- [ ] Approving writes attendance for every date and every homeroom of the student (or the staff record), with the same status mapping (OD → present, half day → half day, late → late, others → absent).
- [ ] Unread markers, counts and badges behave as today for applicants and reviewers.
- [ ] Applicant and reviewers see changes live and get push notifications even if the other side closes the tab immediately.
- [ ] Deleting an application removes the attendance it wrote (today it does not; confirm the desired behaviour).

## 12. Open questions

- [ ] When leave is deleted after approval, should the attendance it wrote be reverted? (Today it is left in place.)
- [ ] Should reviewer selection be rule-based (class teacher → coordinator → principal) instead of applicant-chosen?
