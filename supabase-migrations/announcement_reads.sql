-- Per-user read markers for announcements.
--
-- The navbar badge has always tracked reading as a single "last seen"
-- timestamp in localStorage; that can't answer "which announcements has this
-- user read?", which is what the home notifications box needs in order to drop
-- an announcement once it has been read — on any device.
--
-- Applied to the live project on 2026-09-14; kept here so the schema change is
-- in the repo like every other migration.
create table if not exists public.announcement_reads (
  user_id         uuid not null references auth.users(id) on delete cascade,
  announcement_id uuid not null references public.announcements(id) on delete cascade,
  read_at         timestamptz not null default now(),
  primary key (user_id, announcement_id)
);

-- The PK covers lookups by user (and by user+announcement). This one covers
-- the cascade when an announcement is deleted.
create index if not exists announcement_reads_announcement_id_idx
  on public.announcement_reads (announcement_id);

alter table public.announcement_reads enable row level security;

-- A read marker is private to the reader: you may only see and write your own.
-- auth.uid() is wrapped in a scalar subquery so Postgres evaluates it once per
-- statement rather than once per row.
drop policy if exists "announcement_reads_select_own" on public.announcement_reads;
create policy "announcement_reads_select_own"
  on public.announcement_reads for select
  using (user_id = (select auth.uid()));

drop policy if exists "announcement_reads_insert_own" on public.announcement_reads;
create policy "announcement_reads_insert_own"
  on public.announcement_reads for insert
  with check (user_id = (select auth.uid()));

drop policy if exists "announcement_reads_delete_own" on public.announcement_reads;
create policy "announcement_reads_delete_own"
  on public.announcement_reads for delete
  using (user_id = (select auth.uid()));
