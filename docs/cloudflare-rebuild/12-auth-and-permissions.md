# Accounts, Sign-in and Permissions

As of 27 Oct 2026. Part of the [Cloudflare rebuild docs](README.md).

## Summary

- **Supabase Auth is replaced by EduBerry's own accounts, stored in each school's object.** Every live account is a plain email-and-password account (1,178 accounts, all bcrypt), so nothing exotic needs replacing: no social login, no phone login, no multi-factor.
- **Nobody has to reset their password.** Supabase stores standard bcrypt hashes; they are imported as they are, checked with bcrypt on the next sign-in, and quietly re-hashed with the new scheme.
- **Sessions move from `localStorage` to an `HttpOnly` cookie.** Today a single injected script can read the session; the 300-line cross-tab refresh-lock workaround in `src/lib/supabase.ts` also disappears.
- **Row-level security (696 policies) is replaced by one permission module in code**, with a permission matrix generalised from the fee module's existing grants system. Every object method declares the permission it needs; tests prove each role's access.
- **Two existing gaps close on the way:** any signed-in user can read every profile (including emails) today, and every admin API route re-implements its own "is this caller an admin" check.

## How it works today

### Accounts and sign-in

| Fact | Value |
| --- | --- |
| Provider | Supabase Auth (GoTrue), email and password only |
| Accounts | 1,178 (1,177 with profiles) |
| Password hashes | bcrypt, cost 10 (`$2a$10$`) for every account |
| Never signed in | 974 (mostly students created by bulk import) |
| Banned | 17 accounts with a ban set (`ban_duration` of 100 years) plus `profiles.is_banned` |
| Multi-factor, phone, OAuth | None |
| Session storage | JWT and refresh token in `localStorage` (`sb-<project>-auth-token`), shared across tabs |
| Session lifetime | Until sign-out or the refresh token expires after Supabase's inactivity window |

### Account flows

| Flow | Route or screen | What it does |
| --- | --- | --- |
| Sign in | `/login` → `supabase.auth.signInWithPassword` | Email and password |
| Forgot password | `/api/auth/forgot-password` | Branded email through Cloudflare (or Supabase mailer fallback); same answer for every address |
| Set or reset password from a link | `/update-password` | Redeems the emailed token in the browser |
| Admin creates one account | `/api/admin/create-user` | Auto-confirm with a generated password, or invite email, or a one-time link |
| Bulk import | `/api/admin/bulk-import` | CSV or Excel; creates accounts 8 at a time; emails invites |
| Admin sets a password | `/api/admin/reset-password` | `auth.admin.updateUserById` |
| Admin emails a password link | `/api/admin/send-password-email` | "Set up" or "Reset" email |
| Ban and unban | `/api/admin/toggle-ban` | Supabase ban plus `profiles.is_banned` |
| Delete account | `/api/admin/delete-user` | Deletes the auth user; `handle_profile_delete` reassigns or removes the person's content |
| Smartboard (kiosk) account | `/api/admin/create-smartboard` | A login bound to one homeroom |
| Change role or flags | `/api/admin/update-profile`, `/api/admin/set-staff-flag` | Role, grade, section, non-teaching, geofence exempt, attendance hidden |
| Convert to support staff | `/api/admin/convert-to-support` | Turns a login account into a non-login `support_staff` record |

Every one of these admin routes builds a service-role client and repeats the same check: read the caller's `profiles.role` and require `admin`.

### Roles and flags

| Role (`profiles.role`) | Live accounts | Today's reach |
| --- | --- | --- |
| `student` | 1,067 | Own records, own classrooms, exams, leave, fees, bus |
| `teacher` | 86 | Staff areas, classrooms they teach, grading, attendance |
| `coordinator` | 8 | Teacher plus teams, homerooms, announcements, task manager oversight |
| `principal` | 1 | School-wide reporting and approvals |
| `admin` | 5 | Everything, including user management and money settings |
| `driver` | 9 | Driver app and own salary only |
| `smartboard` | 1 | Kiosk for one homeroom |

Flags on `profiles` that change permissions: `is_banned`, `is_non_teaching`, `geofence_exempt`, `attendance_hidden`, `display_role` (a label only). Database triggers stop non-admins changing any of them (`guard_profile_insert`, `guard_profile_privileged_columns`) and mirror the role into the auth user's metadata (`sync_role_to_auth_metadata`).

### How access is enforced

| Mechanism | Count | Example |
| --- | --- | --- |
| Policies that check the role (`get_user_role()`) | 502 of 696 | Tasks: readable and writable by teacher, coordinator, principal, admin |
| Policies that check the user id (`auth.uid()`) | 154 | Leave: applicants see their own applications |
| Policies that check fee permissions | 121 | `has_fee_permission('fees.collect')` |
| Policies that call relationship helpers | 54 | `is_classroom_staff`, `is_homeroom_smartboard`, `is_exam_owner`, `transport_run_is_mine` |
| Policies open to every signed-in user (`true`) | 10 | All profiles readable by anyone signed in |
| `SECURITY DEFINER` functions | about 300 definitions | Business operations that bypass row-level security after their own checks |
| Hand-written route checks | 12 admin routes plus payroll and fee server guards | `callerProfile.role !== 'admin'` |

The fee module already has a fine-grained model worth keeping and generalising: 28 named permissions (`fee_permissions`), granted per role (`fee_role_grants`, 196 rows) and overridden per user (`fee_user_grants`), with a trigger that stops an admin removing the last person able to manage permissions.

## Target design

### Where accounts live

Accounts belong to one school and live in that school's object, next to the data they guard. A session check is a local SQLite read inside the call the request already makes, so sign-in adds no extra network hop.

| Table (school database) | Purpose | Key columns |
| --- | --- | --- |
| `users` | One login per person | `id` (the existing Supabase user id, kept so every foreign key still matches), `email` (unique, lower-case), `password_hash`, `password_scheme` (`bcrypt` for imported, `scrypt` for new), `email_verified_at`, `must_change_password`, `banned_at`, `failed_attempts`, `locked_until`, `last_sign_in_at`, `created_at` |
| `profiles` | Unchanged columns from today (name, role, grade, section, flags, avatar) | `id` = `users.id` |
| `sessions` | Signed-in devices | `token_hash` (SHA-256 of the cookie value), `user_id`, `kind` (`user`, `kiosk`, `support`), `created_at`, `last_seen_at`, `expires_at`, `user_agent`, `ip_prefix` |
| `auth_tokens` | One-time links: invite, password reset, email change | `token_hash`, `user_id`, `purpose`, `expires_at`, `used_at` |
| `permissions` | Catalogue of named permissions | `key`, `label`, `category`, `is_dangerous` |
| `role_grants` | Default permissions per role | `role`, `permission_key`, `granted` |
| `user_grants` | Per-person overrides | `user_id`, `permission_key`, `granted`, `granted_by`, `note` |
| `admin_audit_log` | As today | Every account and permission change |

Sessions are server-side rows, not JWTs: signing out, banning or changing a role takes effect on the very next request, and there is no refresh-token race between tabs.

### Sign-in flow

```mermaid
sequenceDiagram
  participant B as Browser
  participant W as Router Worker
  participant S as School object
  B->>W: POST /api/auth/sign-in {email, password}
  W->>W: rate limit (per email and per IP prefix); Turnstile after failures
  W->>S: auth.getCredentials(email)
  S-->>W: {userId, hash, scheme, banned, locked} or "none" (with a dummy hash)
  W->>W: verify hash (bcrypt or scrypt) — CPU work stays out of the object
  W->>S: auth.completeSignIn(userId, ok, newHash?)
  S->>S: record attempt; if ok: create session row, re-hash if scheme was bcrypt
  S-->>W: session token
  W-->>B: Set-Cookie __Host-eb_session=<token>; HttpOnly; Secure; SameSite=Lax; Path=/
```

| Rule | Value |
| --- | --- |
| New password hashing | scrypt through `node:crypto` (native in Workers), N = 2^15, r = 8, p = 3 (OWASP's 32 MiB setting); confirm timing in spike S4 |
| Imported hashes | bcrypt checked with a pure-JavaScript bcrypt library, then replaced with scrypt on success |
| Timing | Unknown emails are checked against a dummy hash so response time does not reveal which emails exist |
| Lockout | 10 failures lock the account for 15 minutes; admins can clear it |
| Session length | Sliding 30 days of inactivity, absolute 180 days; kiosk sessions do not expire until revoked |
| Cookie | `__Host-` prefix, `HttpOnly`, `Secure`, `SameSite=Lax`, no `Domain` attribute, so a session for one school's host is never sent to another |
| Sign-out | Deletes the session row; "sign out everywhere" deletes all of the user's rows |
| Banned or deleted | Every session of that user is deleted at once |

### One-time links (invite, reset, verify)

The account-email system in `docs/account-email-system.md` keeps its templates and sender. Only the token source changes:

1. The object creates a random 32-byte token, stores its SHA-256 hash in `auth_tokens` with purpose and expiry (invite 7 days, reset 1 hour), and returns the raw token once.
2. The Worker sends the email through the Email Service binding with a link to `https://<school primary host>/update-password#token=<raw>`. The token sits in the fragment, so it never reaches server logs or link scanners' request lines.
3. The page posts the token and new password to `/api/auth/redeem`; the object checks the hash, expiry and single use, sets the password, deletes the user's other sessions and signs them in.

### Kiosk, driver and support sessions

| Kind | How it differs |
| --- | --- |
| Smartboard kiosk | Signed in once by an admin on the device; session `kind = 'kiosk'` bound to one homeroom; no expiry; revocable from the homeroom screen |
| Driver | Normal user session; the driver app keeps it on the phone. Bus run actions also check the run's assigned crew |
| EduBerry support | Created from a platform support grant ([11](11-tenancy-and-control-plane.md)); `kind = 'support'`; expires with the grant; every action is audited in both the school and the platform logs |

## Permissions in code

### The model

Three layers, checked in this order inside every object method:

1. **Authenticated?** A valid, unexpired session for a user who is not banned.
2. **Allowed to do this kind of thing?** A named permission (`tasks.manage`, `fees.collect`, `attendance.mark_students`, `transport.run_crew`...) resolved from `user_grants`, else `role_grants`, else denied. This replaces the 502 role-checking policies and generalises the fee module's model to every section.
3. **Allowed on this record?** A relationship check written once per section: classroom staff for that classroom, class teacher of that homeroom, author of that announcement, approver on that leave application, crew on that bus run, the student themself or their guardian. This replaces the 154 user-id policies and 54 helper-function policies.

```ts
// Shape of every object method (illustrative)
export const markHomeroomAttendance = method({
  permission: 'attendance.mark_students',
  input: MarkAttendanceInput,
  async run(ctx, input) {
    await ctx.require(canMarkHomeroom(ctx.user, input.homeroomId)) // relationship check
    // ...queries and writes, all in one transaction
  },
})
```

Reads that list rows (feeds, directories, reports) filter in the query by the same rules, through shared helpers (`visibleAnnouncementIds(user)`, `studentsVisibleTo(user)`), so a screen can never fetch rows the person could not open one by one.

### Default role grants

The full matrix is built section by section; each section doc adds its rows. The starting point mirrors today's behaviour:

| Permission group | student | teacher | coordinator | principal | admin | driver | smartboard |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Own profile, own records | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ | — |
| Staff directory (names, roles, photos) | — | ✔ | ✔ | ✔ | ✔ | — | — |
| Student directory and details | — | ✔ | ✔ | ✔ | ✔ | — | homeroom only |
| Task manager | — | ✔ | ✔ | ✔ | ✔ | — | — |
| Classrooms (teach) | — | assigned | assigned + team | ✔ | ✔ | — | — |
| Student attendance (mark) | — | class teacher / assigned | ✔ | ✔ | ✔ | — | own homeroom |
| Announcements (create) | — | — | ✔ | ✔ | ✔ | — | — |
| Leave approvals | — | as selected approver | ✔ | ✔ | ✔ | — | — |
| Fees | own invoices | per fee grants | per fee grants | per fee grants | per fee grants | — | — |
| Payroll and salary | own payslip | own payslip | own payslip | per grants | ✔ | own payslip | — |
| Transport operations | own child's bus | — | — | view | ✔ | own runs | — |
| User management, settings | — | — | — | — | ✔ | — | — |

### Things today's policies allow that the rebuild should not

| Today | Risk | Target |
| --- | --- | --- |
| Every signed-in user can read every profile row, including emails | A student can list every account's email | Directory endpoints return only name, role, photo and class; emails visible to admins and the person themself |
| Staff can read every student's full details (Aadhaar, caste, income, guardian phones) | Wider than a teacher needs | `student_details.read_sensitive` permission, granted to admin and principal by default; teachers see contact fields for their own homerooms |
| Uploaded files are in a public bucket with guessable paths (leave certificates, feedback files, task attachments) | Anyone with a link can open a medical certificate | Files private by default, served after a permission check ([15](15-files-and-media.md)) |
| Admin checks re-implemented in each route | One forgotten check is an escalation | One `admin.*` permission set checked by the shared method wrapper |

## Moving existing accounts

| Field | From | To |
| --- | --- | --- |
| Id | `auth.users.id` | `users.id` (unchanged) |
| Email | `auth.users.email` (lower-cased) | `users.email` |
| Password | `auth.users.encrypted_password` (`$2a$10$...`) | `users.password_hash`, `password_scheme = 'bcrypt'` |
| Confirmed | `email_confirmed_at` | `email_verified_at` |
| Banned | `banned_until` in the future or `profiles.is_banned` | `banned_at` |
| Last sign-in | `last_sign_in_at` | `last_sign_in_at` |
| Sessions | Not moved | Everyone signs in once after cutover |

The export query needs the service role on the live project (it reads `auth.users`). The importer runs it once per school at cutover.

## Parity checklist

- [ ] Every flow in the "Account flows" table works with the same wording and the same email.
- [ ] An imported account signs in with its existing password and is re-hashed.
- [ ] A banned account cannot sign in and loses its open sessions immediately.
- [ ] A non-admin cannot change role, grade, section or any flag on any profile, including their own.
- [ ] Deleting an account reassigns or removes their content exactly as `handle_profile_delete` does today.
- [ ] Smartboard sessions can only act on their homeroom.
- [ ] Forgot-password gives the same answer for known and unknown emails, and is rate-limited.
- [ ] For every table, a test per role shows the same rows visible as today's policies, except the tightened cases above.

## Open questions

- [ ] Should students sign in with an admission number instead of an email? Most student emails today are generated addresses on the school's domain.
- [ ] Parent accounts: today a parent uses the student's login. Separate guardian accounts linked to one or more students would fix shared passwords and suit WhatsApp opt-in; worth deciding before the rebuild fixes the schema.
- [ ] Multi-factor sign-in for admins and finance roles (time-based codes)?
