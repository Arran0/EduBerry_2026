# Legacy SQL (historical — already applied)

These scripts predate the `supabase-migrations/` convention. They lived loose in
the repository root and were each written to be pasted into the Supabase SQL
editor by hand, often "safe to run multiple times" rebuilds of a whole subsystem.

They are kept for reference only:

- **They have already been applied** to the live project, and in several cases
  later migrations in the parent directory have since superseded them. Running
  one now would revert newer work — for example `fix-announcement-rls.sql` and
  `announcements-migration.sql` both install an older announcements SELECT
  policy that `fix_announcement_individual_audience_visibility.sql` replaced.
- **The database is the source of truth** for current schema and policies, not
  these files.

New schema changes go in the parent directory (`supabase-migrations/*.sql`), one
file per change, named `add_*` / `fix_*` after what it does.
