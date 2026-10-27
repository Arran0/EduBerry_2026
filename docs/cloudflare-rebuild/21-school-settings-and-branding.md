# School Settings and Branding

As of 27 Oct 2026. Part of the [Cloudflare rebuild docs](README.md).

## 1. Summary

Each school customises how the app looks and names itself: school name, tagline, logo, favicon, colours, login page, per-page themes, page icons and 19 page banners, plus formal details for certificates (affiliation number, address, principal, seal). Everything lives as JSON rows in one `site_settings` key/value table, read by `PageConfigContext` and cached in the browser so the first paint uses the school's colours.

The same table also holds settings that belong to other sections (attendance time zone and geofence, fee UPI and Razorpay config, payout config, the bus school location) and one secret that should not be there (`fee_runtime`, the drain URL and cron secret).

What changes: settings move into the school object as a typed table where each key has a schema, an owner section and read/write permissions; branding becomes readable before sign-in through a public endpoint; the runtime secret disappears; the hard-coded "Muthamil Public School" defaults become neutral; the PWA manifest and favicon are generated per school.

## 2. Users and screens

| Route | Who | Purpose |
| --- | --- | --- |
| `/admin/design` (788 lines) | Admin | Tabs: Branding, School profile, Themes (per-page colour palettes, page icons), Login page, Banners (19 page banners) |
| `/admin/settings` | — | Old route; redirects each old tab to its new home |
| `/login` | Everyone | Reads `branding` and `login_config` before sign-in |
| Every page with a `PageBanner` (16 pages) | Signed-in users | Reads its banner key |
| `/api/favicon` | Browsers | Circular SVG favicon built from the uploaded favicon or logo |
| `/home` welcome banner, `/profile` banner | Admin edits, everyone sees | Image URLs in `welcome_banner` and `profile_banner` |

Code: `src/lib/pageConfig.ts` (types, defaults, cache, save), `src/contexts/PageConfigContext.tsx` (provider, flash-free warm start), `src/lib/schoolProfile.ts`, `src/lib/bannerStyle.ts`, `src/lib/luminance.ts`, `src/components/PageBanner`.

## 3. How it works today

1. On load, `PageConfigContext` paints from a copy of the whole settings table kept in `localStorage` (so there is no flash of default colours), then calls `site_settings_version()` (max `updated_at` plus row count). If the version matches, nothing else is fetched; otherwise it reads the whole table again.
2. Revalidation is rate-limited so a burst of reads in one page load shares one probe.
3. Admin-only keys (`fee_runtime`) are returned by row-level security only to admins and are never written to `localStorage`.
4. Saving a setting upserts the row and invalidates the cache.
5. Uploads (logo, favicon, banners, login background, seal) go to the public `classroom-files` bucket under `site/`; the row stores the full public URL. `/api/admin/update-banner` uploads the profile banner with the service role.
6. The `attendance_config_changed` trigger on `site_settings` queues an attendance recompute when attendance settings change.

## 4. Data

### `site_settings` keys on live (34 rows)

| Key | Owner section | Contents |
| --- | --- | --- |
| `branding` | 21 | App title, subtitle, school name, tagline, logo URL, favicon URL, primary and secondary colour |
| `login_config` | 21 | Login page text, gradient colours, button colours, background image, feature bullets |
| `page_icons` | 21 | Icon and gradient per app page |
| `page_themes` | 21 | Colour palette per page |
| `more_apps_bg` | 21 | Background of the "More" menu |
| `welcome_banner`, `profile_banner` | 21 | Image URLs |
| `school_profile` (not yet saved on live) | 21 | Affiliation no, school code, recognition no, address, city, state, PIN, phone, email, website, principal, seal URL |
| 19 page banners: `announcement_banner`, `task_banner`, `academics_banner`, `exam_banner`, `attendance_banner`, `staff_attendance_banner`, `leave_banner`, `staff_leave_banner`, `fees_banner`, `salary_banner`, `bus_banner`, `timetable_banner`, `feedback_banner`, `classrooms_banner`, `homerooms_banner`, `teams_banner`, `profiles_banner`, `student_profiles_banner`, `staff_profiles_banner` | 21 | Title, text, colours or image per page |
| `attendance_config` | 23 | Time zone and attendance options |
| `geofence` | 23 | School-wide geofence defaults |
| `upi_config`, `razorpay_config` | 33 | Fee collection display config (secrets are elsewhere) |
| `fee_runtime` | 14/33 | Drain URL and cron secret (admin-only) — removed in the target |
| `payout_config`, `salary_hidden_members` | 34 | Payout mode; staff hidden from salary lists |
| `transport_school_location` | 36 | School coordinates for transport |

Other settings tables: `app_settings` (1 row, `homeroom_expiry_dates`, owned by [22](22-academic-structure.md)); `site_config` (empty, legacy); `fee_settings` (versioned fee settings, owned by [33](33-fees.md)).

## 5. Logic in the database

| Function or trigger | What it does | Target |
| --- | --- | --- |
| `site_settings_version()` | Max `updated_at` + row count, for the browser cache | `settings.version` counter in the object, bumped on every write, returned by `/api/auth/me` and `/api/settings/public` |
| `is_sensitive_site_setting(key)` | Marks `fee_runtime` as admin-only | Per-key read permission in the settings registry |
| `site_settings_touch_updated_at` (trigger) | Stamps `updated_at` | Write helper |
| `attendance_config_changed` (trigger) | Queues attendance recompute when attendance settings change | The `settings.save` method calls the attendance module's recompute when an attendance key changes |

## 6. Server routes and integrations

| Route | Target |
| --- | --- |
| `/api/favicon` | `GET /favicon` in the Worker, built from the school's `public/site/` R2 files, cached for a day |
| `/api/admin/update-banner` | `settings.uploadImage` (any branding image) |
| (new) `/manifest.webmanifest` | Generated from `branding`: name, short name, theme colour, icons |
| (new) `GET /api/settings/public` | Branding, login config, page icons and themes — readable without a session, cacheable at the edge per host for a minute |

## 7. Jobs, files and live updates

- **Files:** all branding images under `schools/<id>/public/site/` in R2, served without a session ([15](15-files-and-media.md)).
- **Jobs:** none.
- **Live updates:** none; the version check is enough.

## 8. Single-tenant assumptions

| Assumption | Where | Fix |
| --- | --- | --- |
| `BRANDING_DEFAULTS` and `LOGIN_DEFAULTS` name "MPS Web" and "Muthamil Public School" | `src/lib/pageConfig.ts` | Neutral defaults ("Your school"); real values written at provisioning |
| Static `public/manifest.json`, `logo.png`, favicons | `public/` | Per-school manifest and favicon; the static files remain only as EduBerry's own defaults |
| Favicon route trusts only "our Supabase Storage" host | `/api/favicon` | Reads the school's own R2 prefix |
| `localStorage` cache keyed by Supabase project ref | `PageConfigContext` | Key by host; one browser can hold two schools' caches without mixing them |
| Image URLs stored with the Supabase host | Branding and banner rows | Store R2 keys |

## 9. Target design

### Table

`settings` (school database):

| Column | Meaning |
| --- | --- |
| `key` | Namespaced key: `branding`, `login`, `page_icons`, `page_themes`, `banner.tasks`, `school_profile`, `attendance.config`, `fees.upi`, `payroll.payout`, `transport.school_location`, ... |
| `value` | JSON, validated against the key's schema on write |
| `version` | Incremented on each write |
| `updated_by`, `updated_at` | Audit |

A code-side registry lists every key: owner module, Zod schema, default, read permission (`public`, `member`, `staff`, or a module permission), write permission, and whether changing it triggers work in another module. Settings that belong to a section are documented and owned by that section; this section owns the registry and the branding keys.

### Methods

| Method | Permission | Notes |
| --- | --- | --- |
| `settings.public` | none (host-scoped) | Branding, login, icons, themes, banners |
| `settings.bundle` | signed in | Everything the person may read, plus the version |
| `settings.save(key, value)` | the key's write permission (`settings.design` for branding keys) | Validates, bumps version, runs side effects |
| `settings.uploadImage(slot, file)` | `settings.design` | Writes to `public/site/` and updates the key |
| `schoolProfile.get` / `save` | `settings.design` | Used by certificates |

### Browser cache

Keep the flash-free warm start: the SPA stores the last `settings.public` and `settings.bundle` per host in `localStorage`, paints from it, and refreshes only when the version from `/api/auth/me` differs.

## 10. Moving existing data

- Copy every `site_settings` row to `settings`, renaming keys to the namespaced form and dropping `fee_runtime`.
- Rewrite image URLs inside `branding`, `login_config`, banners, `welcome_banner`, `profile_banner` and `school_profile.seal_url` to R2 keys and copy the images.
- `app_settings.homeroom_expiry_dates` → `settings` key `homerooms.expiry_dates`.
- Validate every migrated value against its new schema; report anything that fails.

## 11. Parity checklist

- [ ] Login page shows the school's colours, logo and text with no flash of defaults, before sign-in.
- [ ] Every page banner, theme and icon matches today's.
- [ ] Favicon and installed-app icon and name are the school's.
- [ ] Changing branding shows on other open tabs and devices on their next navigation.
- [ ] Changing attendance settings triggers the same recompute as today.
- [ ] Two schools opened in the same browser never show each other's branding.

## 12. Open questions

- [ ] Should EduBerry offer a few complete theme presets at provisioning so a new school looks finished before an admin touches Design?
