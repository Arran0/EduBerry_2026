# Accounts, Sign-in and Permissions

As of 5 Nov 2026. Part of the [rebuild docs](README.md). The design is a Neon Postgres project per school with Cloudflare for everything else ([01](01-architecture-options.md), [10](10-target-architecture.md)).

## Summary

- **Supabase Auth is replaced by EduBerry's own sign-in, run by the Worker, with accounts kept in each school's own Postgres.** Every live account is a plain email-and-password account (1,178 accounts, all bcrypt), so nothing exotic needs replacing: no social login, no phone login, no multi-factor.
- **`auth.users` stays, with the same ids and column names.** The four foreign keys into it, the `on_auth_user_created` trigger and `sync_role_to_auth_metadata` keep working unchanged. Only Supabase's internal auth tables go.
- **Nobody has to reset their password.** Supabase stores standard bcrypt hashes; they are copied as they are, checked with bcrypt on the next sign-in, and quietly re-hashed with the new scheme.
- **Row-level security stays exactly as it is.** The 699 policies and the fee module's grants keep deciding who sees what. The database learns the user the same way it does today: from token claims that `auth.uid()` reads. No permission module has to be written to replace them.
- **Tokens get safer.** Today a one-hour JWT and its refresh token sit in `localStorage`, readable by any injected script, behind a 300-line cross-tab refresh lock in `src/lib/supabase.ts`. In the target the refresh token is an `HttpOnly` cookie and the access token lives 15 minutes in memory.
- **Two gaps close on the way.** Every admin API route re-implements its own "is this caller an admin" check, and staff can read every student's full details. A third gap is already closed: any signed-in user could read every profile's email, until the fix of 28 Oct 2026. Addresses now come from `profile_emails`, which shows a student's address only to staff and the student; the profile card shows it to anyone who opens it. The rebuild keeps that rule.

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
| Session lifetime | Until sign-out or the refresh token expires after Supabase's inactivity window; access tokens last one hour |

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

Flags on `profiles` that change permissions: `is_banned`, `is_non_teaching`, `geofence_exempt`, `attendance_hidden`, `display_role` (a label only). Database triggers stop non-admins changing any of them (`guard_profile_insert`, `guard_profile_privileged_columns`) and mirror the role into `auth.users.raw_user_meta_data` (`sync_role_to_auth_metadata`). A new `auth.users` row creates its profile through `handle_new_user`.

### How access is enforced

| Mechanism | Count | Example |
| --- | --- | --- |
| Policies that check the role (`get_user_role()`) | about 500 of 699 | Tasks: readable and writable by teacher, coordinator, principal, admin |
| Policies that call `auth.uid()` | 155 | Leave: applicants see their own applications |
| Policies that check fee permissions | 121 | `has_fee_permission('fees.collect')` |
| Policies that call relationship helpers | 54 | `is_classroom_staff`, `is_homeroom_smartboard`, `is_exam_owner`, `transport_run_is_mine` |
| Functions that call `auth.uid()` | 99 | Business operations that check the caller before acting |
| Functions that read `auth.jwt()` | 2 | `get_student_edu_dashboard`, `get_student_edu_standings` read `user_metadata.role` |
| Hand-written route checks | 12 admin routes plus payroll and fee server guards | `callerProfile.role !== 'admin'` |

The fee module's fine-grained model stays as it is: 28 named permissions (`fee_permissions`), granted per role (`fee_role_grants`, 196 rows) and overridden per user (`fee_user_grants`), with a trigger that stops an admin removing the last person able to manage permissions.

## Target design

### What Supabase provided, and what replaces it

| Supabase piece | Replacement |
| --- | --- |
| GoTrue sign-in, refresh, recovery, admin API | Worker routes under `/api/auth/*` and the admin routes, calling SQL functions in the school database |
| `auth.users` | Our own `auth.users` table in each school database: same ids, same column names that public functions and triggers use, plus a few new columns |
| `auth.sessions`, `auth.refresh_tokens`, `auth.one_time_tokens` and the rest of GoTrue's schema | Our own `auth.sessions` and `auth.one_time_tokens` |
| `auth.uid()`, `auth.jwt()`, `auth.role()` | Small SQL functions with the same names and results, or Neon's `pg_session_jwt` (spike S2) |
| JWT signing secret | One ES256 key pair per school; the public key is served as JWKS on the school's host |
| Mailer | The account-email system already used today, through the Email Service binding |

Neon Auth (managed Better Auth) was considered. It keeps accounts in its own `neon_auth` schema with its own ids, and importing existing bcrypt hashes is not documented, so it would mean either resets or a second user table. Owning sign-in is a few hundred lines and keeps `auth.users` where every foreign key expects it.

### Tables in each school database

| Table | Purpose | Key columns |
| --- | --- | --- |
| `auth.users` | One login per person | Kept from Supabase: `id`, `email`, `encrypted_password`, `email_confirmed_at`, `banned_until`, `last_sign_in_at`, `raw_user_meta_data`, `raw_app_meta_data`, `created_at`, `updated_at`. Added: `password_scheme` (`bcrypt` for imported, `scrypt` for new), `must_change_password`, `failed_attempts`, `locked_until` |
| `public.profiles` | Unchanged | `id` = `auth.users.id` |
| `auth.sessions` | One row per signed-in device; holds the refresh token | `id`, `user_id`, `refresh_hash` (SHA-256 of the cookie value), `kind` (`user`, `kiosk`, `support`), `created_at`, `last_seen_at`, `expires_at`, `user_agent`, `ip_prefix`, `revoked_at` |
| `auth.one_time_tokens` | Invite, password reset, email change | `token_hash`, `user_id`, `purpose`, `expires_at`, `used_at` |
| `public.admin_audit_log` | As today | Every account and permission change |

Only the owner role and a few `SECURITY DEFINER` functions can touch the `auth` tables; `authenticated` and `anon` have no grants on them, as on Supabase.

### Tokens

| Token | Form | Lifetime | Where it lives |
| --- | --- | --- | --- |
| Access token | JWT signed with the school's ES256 key. Claims: `sub` (user id), `role` (`authenticated`), `aud` (school id), `sid` (session id), `user_metadata.role` (for the two functions that read it), `exp` | 15 minutes | Browser memory only |
| Refresh token | Random 32 bytes; only its hash is stored, in `auth.sessions` | Sliding 30 days of inactivity, absolute 180 days; kiosk sessions until revoked | `__Host-eb_refresh` cookie: `HttpOnly`, `Secure`, `SameSite=Lax`, `Path=/api/auth`, no `Domain` |

- Each school has its own key pair, so a token for one school does not verify at another; `aud` is checked as well. The private keys are kept encrypted in the platform database with a key from Workers Secrets.
- Refreshing rotates the refresh token. Presenting an old one revokes the whole session, which catches a stolen cookie.
- Signing out, banning or "sign out everywhere" revokes the session rows at once; an access token already issued stops working within 15 minutes, a quarter of today's window. Role changes take effect immediately, because policies read the role from `profiles`, not from the token.
- Tabs share nothing in storage. Each tab gets its own access token from the refresh cookie when it loads, so the cross-tab refresh lock goes.

### Sign-in flow

```mermaid
sequenceDiagram
  participant B as Browser
  participant W as Router Worker
  participant N as School's Neon database
  B->>W: POST /api/auth/sign-in {email, password}
  W->>W: rate limit (per email and per IP prefix); Turnstile after failures
  W->>N: auth_credentials(email) (jobs role)
  N-->>W: {userId, hash, scheme, banned, locked} or none (Worker then checks a dummy hash)
  W->>W: verify the hash (bcrypt or scrypt): CPU work stays out of Postgres
  W->>N: auth_complete_sign_in(userId, ok, newHash?, refreshHash, device)
  N->>N: record the attempt; if ok, create the session row and store the new hash if the scheme was bcrypt
  N-->>W: session id, role
  W->>W: sign the access token
  W-->>B: Set-Cookie __Host-eb_refresh=...; body {accessToken, expiresIn}
```

| Rule | Value |
| --- | --- |
| New password hashing | scrypt through `node:crypto` in Workers, N = 2^15, r = 8, p = 3 (OWASP's 32 MiB setting); timing confirmed in spike S6 |
| Imported hashes | bcrypt checked with a JavaScript bcrypt library, then replaced with scrypt on success |
| Timing | Unknown emails are checked against a dummy hash so response time does not reveal which emails exist |
| Lockout | 10 failures lock the account for 15 minutes; admins can clear it |
| Banned or deleted | Every session of that user is revoked at once |

### How the database knows the user

Every query runs as the signed-in user, as it does through PostgREST today.

| Path | What happens |
| --- | --- |
| Worker routes | The Worker verifies the access token (a signature check, no query), then sends one transaction: `set local role authenticated`, `select set_config('request.jwt.claims', <claims>, true)`, then the route's SQL. Without a token: `set local role anon` |
| Neon Data API (phase 1) | The browser sends the access token as a bearer token. Neon checks it against the school's JWKS URL and runs the query as `authenticated` with the claims available to `auth.uid()` |

`auth.uid()` has to return the same id on both paths. Two ways, decided by spike S2:

| Way | How | Trade-off |
| --- | --- | --- |
| Our own `auth` shim | `auth.uid()` returns `current_setting('request.jwt.claims', true)::jsonb ->> 'sub'` as a uuid; `auth.jwt()` and `auth.role()` likewise. These are the definitions Supabase itself uses | Simplest for the Worker path; works on the Data API only if it exposes the claims the same way |
| Neon's `pg_session_jwt` | The extension provides `auth.uid()` from a verified JWT. The Worker passes the token itself at the start of each transaction instead of setting claims | One mechanism for both paths; the database checks the signature again on every request |

Either way the 155 policies and 99 functions that call `auth.uid()`, and the two that read `auth.jwt()`, stay unchanged.

### One-time links (invite, reset, verify)

The account-email system in `docs/account-email-system.md` keeps its templates and sender. Only the token source changes:

1. A SQL function creates a random 32-byte token, stores its SHA-256 hash in `auth.one_time_tokens` with purpose and expiry (invite 7 days, reset 1 hour), and returns the raw token once.
2. The Worker sends the email through the Email Service binding with a link to `https://<school primary host>/update-password#token=<raw>`. The token sits in the fragment, so it never reaches server logs or link scanners' request lines.
3. The page posts the token and new password to `/api/auth/redeem`. The Worker hashes the password; the SQL function checks the token's hash, expiry and single use, sets the password, revokes the user's other sessions and starts a new one.

### Admin account actions

Each admin flow becomes a Worker route that does the CPU work (hashing a generated password, parsing a spreadsheet, sending emails) and calls one `SECURITY DEFINER` SQL function as the user: `admin_create_user`, `admin_set_password`, `admin_set_ban`, `admin_delete_user`, `admin_create_smartboard`, and so on. Each function checks `get_user_role() = 'admin'` itself and writes `admin_audit_log`. The check lives in one place next to the data, so a route cannot forget it. `admin_create_user` inserts into `auth.users`, and the existing `on_auth_user_created` trigger creates the profile as it does today.

### Kiosk, driver and support sessions

| Kind | How it differs |
| --- | --- |
| Smartboard kiosk | Signed in once by an admin on the device; session `kind = 'kiosk'` bound to one homeroom; no expiry; revocable from the homeroom screen |
| Driver | Normal user session; the driver app keeps it on the phone. Bus run actions also check the run's assigned crew, as today's policies do |
| EduBerry support | Created from a platform support grant ([11](11-tenancy-and-control-plane.md)); `kind = 'support'`; expires with the grant; every action is audited in both the school and the platform logs |

## Permissions

Policies, helper functions and fee grants carry over unchanged, so day-one behaviour is today's behaviour. The tightenings below are ordinary migrations, applied to the current app first where possible so the rebuild starts from the safer rule.

### Things today's policies allow that the rebuild should not

| Today | Risk | Target |
| --- | --- | --- |
| Every signed-in user could read every profile row, including emails (fixed in the current app on 28 Oct 2026: `profile_emails`, `profile_directory`, `profile_card_email`, and `profiles.email` hidden from the API roles) | A student could list every account's email | Kept as fixed |
| Staff can read every student's full details (Aadhaar, caste, income, guardian phones) | Wider than a teacher needs | Split the sensitive columns behind their own policy: admin and principal see all; teachers see contact fields for their own homerooms |
| Uploaded files are in a public bucket (leave certificates and task, subtask and announcement attachments moved to a private bucket on 28 Oct 2026; coursework, submissions, avatars and banners are still public by URL, no longer listable) | Anyone with a link can open them | Files private by default in R2, served after a permission check ([15](15-files-and-media.md)) |
| Admin checks re-implemented in each route | One forgotten check is an escalation | The check moves into each admin SQL function, as above |
| `service_role` bypasses RLS for every server route | A bug in one server route can read or write anything | No login role is a member of `service_role`. Server-only work uses `app_jobs`, which may only execute the job and webhook functions ([11](11-tenancy-and-control-plane.md)) |

## Moving existing accounts

Supabase's `auth` schema is not restored. The importer copies the needed columns of `auth.users` into the new table before the public schema's foreign keys are checked:

| Field | From | To |
| --- | --- | --- |
| Id | `auth.users.id` | `auth.users.id` (unchanged) |
| Email | `auth.users.email` (lower-cased) | `auth.users.email` |
| Password | `encrypted_password` (`$2a$10$...`) | `encrypted_password`, `password_scheme = 'bcrypt'` |
| Confirmed | `email_confirmed_at` | `email_confirmed_at` |
| Banned | `banned_until` in the future or `profiles.is_banned` | `banned_until` |
| Metadata | `raw_user_meta_data`, `raw_app_meta_data` | Same columns |
| Last sign-in | `last_sign_in_at` | `last_sign_in_at` |
| Sessions | Not moved | Everyone signs in once after cutover |

Reading `auth.users` needs the service role on the live project. The importer runs it once per school at cutover ([90](90-data-migration-and-cutover.md)).

## Parity checklist

- [ ] Every flow in the "Account flows" table works with the same wording and the same email.
- [ ] An imported account signs in with its existing password and is re-hashed.
- [ ] A banned account cannot sign in, and its open sessions stop refreshing at once.
- [ ] A non-admin cannot change role, grade, section or any flag on any profile, including their own.
- [ ] Deleting an account reassigns or removes their content exactly as `handle_profile_delete` does today.
- [ ] Smartboard sessions can only act on their homeroom.
- [ ] Forgot-password gives the same answer for known and unknown emails, and is rate-limited.
- [ ] `auth.uid()` returns the same id on the Worker path and the Data API path.
- [ ] For every table, a test per role shows the same rows visible as on Supabase today, except the tightened cases above ([91](91-test-and-parity-plan.md)).
- [ ] A token issued by one school is refused by every other school, on both paths.

## Open questions

- [ ] Should students sign in with an admission number instead of an email? Most student emails today are generated addresses on the school's domain.
- [ ] Parent accounts: today a parent uses the student's login. Separate guardian accounts linked to one or more students would fix shared passwords and suit WhatsApp opt-in; worth deciding before the first new school.
- [ ] Multi-factor sign-in for admins and finance roles (time-based codes)?
