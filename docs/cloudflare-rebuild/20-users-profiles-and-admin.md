# Users, Profiles and Admin

As of 27 Oct 2026. Part of the [Cloudflare rebuild docs](README.md). Sign-in, sessions and the permission model are in [12-auth-and-permissions.md](12-auth-and-permissions.md); this doc covers the people records and the screens that manage them.

## 1. Summary

The section holds every person the school knows about: login accounts (`profiles`, one per Supabase Auth user), their extended student and staff records (`student_details`, `staff_details`), support staff who have no login (`support_staff`), and the admin audit log. Admins manage them in the Student and Staff Profile Managers, reached from Admin Space.

What changes: accounts move into the school object ([12](12-auth-and-permissions.md)); the 12 admin API routes become `admin.*` object methods behind one permission check; the student roster's server-side paging moves from a Postgres function to an object query; sensitive student and staff fields get their own permission; bulk import runs as a batched job instead of one long request. The data model barely changes.

## 2. Users and screens

| Route | Who | Purpose |
| --- | --- | --- |
| `/more/admin-space` | Admin | Hub linking every admin tool (profile managers, certificate builder, classroom and homeroom managers, teacher teams, geofencing, attendance rules, design) |
| `/more/profiles` | Admin | Chooser between student and staff managers |
| `/more/profiles/students` (717 lines) | Admin | Student Profile Manager: paged roster with search, grade/section filters, sort, banned filter; add student; import CSV; edit profile; edit CBSE details; set password; email a password link; ban; delete |
| `/more/profiles/staff` (1,049 lines) | Admin | Staff Profile Manager: staff list by role; add staff; add support staff; import CSV; edit profile, role, flags; edit HR details; set password; ban; delete; convert to support staff |
| `/more/profiles/templates` | Admin | Certificate template editor (covered in [32-certificates.md](32-certificates.md)) |
| `/profile` | Everyone | Own profile: avatar upload, own details, request a password reset email |
| `/admin/users`, `/admin/staff` | — | Old URLs, now redirects to the profile managers |
| Profile card (global, `ProfileCardContext`) | Signed-in users | Pop-up card with a person's name, role, photo and class, opened from lists across the app |

Main code: `src/lib/admin.ts` (profiles, roster paging, account actions), `studentDetails.ts`, `staffDetails.ts`, `supportStaff.ts`, `adminAccountDeletion.ts`, `adminAudit.ts`, `passwords.ts`, `homeroomAutoManage.ts`; components under `src/components/staff` and `src/components/admin`.

## 3. How it works today

**Adding one person.** The admin fills name, email, role and (students) grade and section, chooses "auto-confirm with a password" or "send an invite". `/api/admin/create-user` creates the Supabase Auth user; the `handle_new_user` trigger inserts a `profiles` row as `student`; the route then sets the real role and fields with the service role. For a student with grade and section, `syncStudentHomeroom` puts them in the matching homeroom for the current academic year, creating the homeroom if needed. An invite or one-time link is emailed (or shown to the admin if email fails).

**Bulk import.** The admin uploads a CSV or Excel file. The browser parses it and posts rows to `/api/admin/bulk-import`, which creates accounts eight at a time, writes `student_details` or `staff_details` from the extra columns (admission number, parents, Aadhaar, CBSE numbers, bank details...), syncs homerooms and emails invites. It returns per-row results.

**Roster paging.** The student manager holds over 1,000 profiles; search, filters, sort and counts run in Postgres (`fetchStudentPage`, `student_roster_facets`) and only the visible page is fetched.

**Editing.** Profile changes go through `/api/admin/update-profile` (role changes protect the last admin); flag toggles through `/api/admin/set-staff-flag`; details forms upsert `student_details`/`staff_details` directly from the browser under row-level security.

**Banning and deleting.** Ban sets `profiles.is_banned` and a 100-year Supabase ban. Delete removes the auth user; `handle_profile_delete` then deletes the person's tasks, hands their comments, projects, announcements and classroom content to the oldest other admin, and clears nullable references.

**Support staff.** Cleaners, gardeners and other ground staff without phones live only in `support_staff` (28 rows): an admin marks their attendance and pays their salary. `convert-to-support` turns a login account into such a record and deletes the login (one-way).

**Audit.** Account actions write to `admin_audit_log` (append-only by trigger).

## 4. Data

| Table | Rows | Purpose | Notes for the rebuild |
| --- | --- | --- | --- |
| `profiles` | 1,177 | One per login: name, email, role, grade, section, avatar, flags (`is_banned`, `geofence_exempt`, `is_non_teaching`, `attendance_hidden`, `display_role`) | `id` stays the person's id everywhere. Grade and section on the profile duplicate homeroom membership; keep for now, decide in [22](22-academic-structure.md) |
| `student_details` | 928 | 1:1 extended student record (42 columns: admission, roll, parents, guardian phones, Aadhaar, PEN, UDISE, CBSE, category, caste, income, TC, WhatsApp opt-in...) | Sensitive. Split read access: contact fields vs identity and socio-economic fields |
| `staff_details` | 59 | 1:1 HR record (44 columns: employee id, designation, department, qualifications, CBSE, Aadhaar, PAN, EPF, NPS, bank, PT jurisdiction, exit...) | Sensitive; bank and identity numbers readable by admin and payroll roles only |
| `support_staff` | 28 | People without logins, for attendance and salary | Unchanged |
| `admin_audit_log` | 17 | Actor, action, target, details, IP | Append-only guard kept as a SQLite trigger |

Full column lists: [reference/live-schema.md §20](reference/live-schema.md#20--users-profiles-and-admin).

## 5. Logic in the database

| Function | Kind | What it guarantees | Target |
| --- | --- | --- | --- |
| `handle_new_user` (trigger on `auth.users`) | Data trigger | Every login has a profile, starting as `student` | Part of `admin.createUser` (one transaction creates `users` and `profiles`) |
| `guard_profile_insert` | Guard | Non-admins cannot create a profile with a privileged role or flags | Permission check in the methods; no browser path can insert profiles |
| `guard_profile_privileged_columns` | Guard | Non-admins cannot change role, email, grade, section, ban or flags, even on their own profile | `profile.updateOwn` accepts only name and avatar; everything else needs `admin.users.manage` |
| `sync_role_to_auth_metadata` | Data trigger | Role copied into the JWT metadata | Not needed: the role is read from the database on every call |
| `handle_profile_delete` | Data trigger | Content reassignment and clean-up on delete | Explicit steps in `admin.deleteUser`, same order and rules |
| `admin_audit_append_only` | Guard | Audit rows cannot be changed | SQLite trigger + no update method |
| `staff_directory` | Read helper | Staff directory columns for any signed-in staff | `directory.staff` query |
| `student_roster_facets` | Read helper | Grade/section counts for filters | `admin.students.facets` query |
| `get_user_role` | Access helper | Role of the caller | Session's user |

## 6. Server routes and integrations

| Route today | Target method | Notes |
| --- | --- | --- |
| `POST /api/admin/create-user` | `admin.createUser` | Password hashing in the Worker; invite email via the outbox |
| `POST /api/admin/bulk-import` | `admin.import.start` + job | Rows stored in an `import_jobs` table, processed 50 per alarm tick, results polled by the screen |
| `POST /api/admin/update-profile` | `admin.updateProfile` | Keeps "cannot demote the last admin" |
| `POST /api/admin/set-staff-flag` | `admin.setFlag` | |
| `POST /api/admin/toggle-ban` | `admin.setBanned` | Deletes the person's sessions on ban |
| `POST /api/admin/reset-password` | `admin.setPassword` | |
| `POST /api/admin/send-password-email` | `admin.sendPasswordLink` | |
| `POST /api/admin/delete-user` | `admin.deleteUser` | Reassignment rules from `handle_profile_delete` |
| `POST /api/admin/convert-to-support` | `admin.convertToSupport` | |
| `POST /api/admin/create-smartboard` / `DELETE` | `admin.smartboards.create` / `remove` | See [27-smartboard.md](27-smartboard.md) |
| `POST /api/admin/sync-homerooms` | `admin.syncHomerooms` | Batched job |
| `POST /api/admin/update-banner` | `settings.uploadBanner` | See [21](21-school-settings-and-branding.md) |

Email (invites and password links) goes through the account-email templates ([12](12-auth-and-permissions.md)). No other integrations.

## 7. Jobs, files and live updates

- **Jobs:** bulk import and homeroom sync become batched jobs with progress.
- **Files:** avatars at `avatars/<userId>.<ext>` ([15](15-files-and-media.md)); served to any signed-in member of the school.
- **Live updates:** none.

## 8. Single-tenant assumptions

| Assumption | Fix |
| --- | --- |
| Accounts live in the deployment's Supabase Auth | Accounts in the school object |
| `handle_profile_delete` hands content to "the oldest other admin" | Same rule, but only within the school (automatic in the target) |
| Student emails are generated on the school's domain (`@muthamilpublicschool.edu.in`) by the import sheet | A per-school "generated email domain" setting, or admission-number sign-in (open question in [12](12-auth-and-permissions.md)) |
| `STUDENT_PASSWORD` env var in `scripts/bulk-create-students.js` | Removed; import uses invites or generated passwords |

## 9. Target design

### Tables (school database)

`users` and `sessions` from [12](12-auth-and-permissions.md); `profiles`, `student_details`, `staff_details`, `support_staff`, `admin_audit_log` carried over column for column with the type map from [13](13-data-layer.md). New: `import_jobs` (id, kind, status, total, done, failed, created_by, created_at) and `import_rows` (job_id, row_no, input JSON, result, error).

### Methods

| Method | Permission | Notes |
| --- | --- | --- |
| `profile.me` | signed in | Own profile and permissions |
| `profile.updateOwn` | signed in | Name and avatar only |
| `directory.staff`, `directory.students` | `directory.read` | Name, role, photo, class; no emails or phones |
| `admin.students.page`, `admin.students.facets` | `admin.users.read` | Keyset paging, search on a lower-cased name column with an index |
| `admin.staff.list` | `admin.users.read` | |
| `admin.details.get` / `admin.details.save` (student or staff) | `admin.users.manage`; sensitive fields need `people.sensitive.read` / `write` | |
| `admin.createUser`, `admin.updateProfile`, `admin.setFlag`, `admin.setBanned`, `admin.setPassword`, `admin.sendPasswordLink`, `admin.deleteUser`, `admin.convertToSupport` | `admin.users.manage` | Each writes `admin_audit_log` |
| `admin.import.start`, `admin.import.status` | `admin.users.import` | |
| `supportStaff.list` / `save` / `deactivate` | `admin.users.manage` | |

### Permission rows added

| Permission | Default roles |
| --- | --- |
| `directory.read` | teacher, coordinator, principal, admin |
| `admin.users.read`, `admin.users.manage`, `admin.users.import` | admin |
| `people.sensitive.read` | admin, principal |
| `people.sensitive.write` | admin |

## 10. Moving existing data

- `profiles`, `student_details`, `staff_details`, `support_staff`, `admin_audit_log`: straight copy with the type map; `avatar_url` rewritten to an R2 key.
- `auth.users` → `users` as described in [12](12-auth-and-permissions.md#moving-existing-accounts).
- Check: every `profiles.id` has a `users` row and vice versa (one live auth user has no profile today: 1,178 vs 1,177; decide whether to import it).

## 11. Parity checklist

- [ ] Adding a student with grade and section puts them in the right homeroom for the current academic year.
- [ ] Bulk import accepts today's CSV and Excel columns and reports per-row results; a 1,000-row file finishes without timing out.
- [ ] The student roster pages, searches (including grade words like "LKG"), filters and counts as today.
- [ ] The last admin cannot be demoted or deleted.
- [ ] Deleting a person reassigns or removes their content exactly as today.
- [ ] Converting to support staff copies the fields it does today and removes the login.
- [ ] Every account action appears in the audit log.
- [ ] A teacher can see a student's guardian phone for their own homeroom but not the student's Aadhaar or caste.

## 12. Open questions

- [ ] Separate guardian accounts (see [12](12-auth-and-permissions.md))? This doc's tables would gain `guardians` and `guardian_students`.
- [ ] Keep `profiles.grade`/`section` or derive from homeroom membership only?
- [ ] Import the one auth user that has no profile?
