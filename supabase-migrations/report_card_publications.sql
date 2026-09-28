-- Report cards are held back from students until a class's cards are published.
--
-- Publication happens at the level the Class Marks view already works at — one
-- grade + section + report card title, the whole class at once. There is
-- deliberately no per-student row: an individual card is never published or
-- unpublished on its own, it only reports the status of the class it belongs to.
--
-- A row present = published. Unpublishing deletes the row, so the table only
-- ever holds what is currently released and "who published this" is always the
-- person whose decision is in force.

create table if not exists public.report_card_publications (
  id                uuid primary key default gen_random_uuid(),
  grade             integer not null,
  section           text not null,
  report_card_title text not null,
  published_by      uuid references public.profiles(id) on delete set null,
  published_at      timestamptz not null default now()
);

-- Sections are entered by hand in several places ("a", "A ", "A"), so identity
-- is on the normalised value — otherwise the same class could be published
-- twice and unpublishing one row would leave the cards visible.
create unique index if not exists report_card_publications_class_key
  on public.report_card_publications (grade, upper(btrim(section)), report_card_title);

-- The student-facing gate looks up every title released for a grade+section.
create index if not exists report_card_publications_grade_section_idx
  on public.report_card_publications (grade, upper(btrim(section)));

alter table public.report_card_publications enable row level security;

/**
 * Who may release a class's report cards: admins and principals anywhere, and
 * the class teacher of a homeroom for that exact grade + section. A subject
 * teacher who merely teaches the class does not qualify — the decision belongs
 * to the person who owns the homeroom.
 */
create or replace function public.can_publish_report_cards(p_grade integer, p_section text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select
    public.get_user_role() in ('admin', 'principal')
    or exists (
      select 1
      from public.homerooms h
      where h.class_teacher_id = auth.uid()
        and h.grade = p_grade
        and upper(btrim(h.section)) = upper(btrim(p_section))
    );
$$;

-- Status is readable by everyone signed in: a student's own view needs it to
-- know which cards to show, and staff need it to see what is still held back.
drop policy if exists report_card_publications_select on public.report_card_publications;
create policy report_card_publications_select
  on public.report_card_publications
  for select
  to authenticated
  using (true);

drop policy if exists report_card_publications_insert on public.report_card_publications;
create policy report_card_publications_insert
  on public.report_card_publications
  for insert
  to authenticated
  with check (public.can_publish_report_cards(grade, section));

drop policy if exists report_card_publications_delete on public.report_card_publications;
create policy report_card_publications_delete
  on public.report_card_publications
  for delete
  to authenticated
  using (public.can_publish_report_cards(grade, section));

-- No update policy: a publication is created or removed, never edited, so the
-- row always carries the publisher and time of the decision currently in force.
