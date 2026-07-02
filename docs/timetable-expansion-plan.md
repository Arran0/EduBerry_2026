# Timetable Expansion — Round-by-Round Plan

A staged plan to grow the existing timetable module into an aSc-Timetables-class
scheduler. Each round is independently shippable, builds on the last, and ends
with a paste-ready prompt.

## Where we start (current state)

**Schema** (`supabase-migrations/add_timetable.sql`, `add_timetable_multi_active.sql`):
`timetable_subjects`, `timetable_rooms`, `timetable_configs`,
`timetable_period_slots`, `timetable_requirements`, `teacher_unavailability`,
`timetables` (versions), `timetable_entries` (grid). All admin-RLS write, staff/
student read.

**Types / data layer**: `src/lib/timetable/types.ts`, `src/lib/timetable.ts`
(fetch/create/update helpers), `src/lib/timetable/generator.ts` (greedy +
local-search solver, hard/soft constraints), `src/lib/timetable/export.ts`.

**UI**: `AdminTimetableBuilder.tsx` (tabs: Setup, Subjects & Rooms, Requirements,
Availability, Generate), `EditableTimetableGrid.tsx`, `TimetableGrid.tsx`,
`StudentTimetableView.tsx`, `StaffTimetableView.tsx`. Entry point
`src/app/more/timetable/page.tsx`.

**Homerooms**: `homerooms` (id, name, grade, section, academic_year) +
`homeroom_members` (homeroom_id, student_id). No class teacher, no groups.

**What is missing** (this plan delivers all of it): class teacher, name-click
person viewer, optional slot timings, homeroom/subject/teacher constraint
framework, homeroom groups, consecutive-period (double/triple) lessons, split
classes, combined classes, aSc-style master drag-and-drop editor, health score.

## Round map & dependencies

| Round | Theme | Depends on |
|---|---|---|
| 1 ✅ | Class teacher + optional slot timings + name-click viewer | — |
| 2 ✅ | Homeroom groups (subject-filter / custom, add by email) | 1 |
| 3 ✅ | Unified constraints framework (data + UI, no solver yet) | 1 |
| 4 ✅ | Solver honors constraints + consecutive (double/triple) periods | 3 |
| 5 ✅ | Split classes (parallel groups, same slot, diff room/teacher) | 2, 4 |
| 6 ✅ | Combined classes (many homerooms → one lesson) | 4 |
| 7 ✅ | aSc-style master drag-and-drop editor | 4, 5, 6 |
| 8 ✅ | Timetable Health Score | 3–6 |

Rounds are ordered so each generator/UI change lands on a stable data model.
Constraints (3) precede solver enforcement (4); groups (2) precede split (5);
the master editor (7) lands after split/combined so it renders every entry shape.

---

## Round 1 — Class teacher, optional slot timings, name-click viewer  ✅ DONE

Shipped: `homerooms.class_teacher_id` + nullable slot timings (migration
`add_timetable_r1_classteacher_and_slots.sql`); `updateHomeroomClassTeacher`,
`fetchTimetableForHomeroom`; a Class Teachers section in Setup; optional time
inputs in the slot editor; `PersonTimetableModal` + reusable `NameLink` wired into
the Setup and Requirements tabs so any teacher/student/class name opens its week.

**Goal.** (a) One class teacher per homeroom. (b) Period slots no longer require
start/end times. (c) Admin clicks any teacher/student/homeroom name and sees that
person's weekly timetable.

**Schema** — new migration `add_timetable_r1_classteacher_and_slots.sql`:
- `ALTER TABLE homerooms ADD COLUMN class_teacher_id UUID REFERENCES profiles(id) ON DELETE SET NULL;`
- Make `timetable_period_slots.start_time` / `end_time` nullable; keep `label`
  and `position` as the identity of a slot. Slots become "Period 1..N" by
  position; timings optional.

**Data layer** (`src/lib/timetable.ts`): `updateHomeroomClassTeacher(homeroomId,
teacherId)`; extend slot create/update so timings are optional; add
`fetchTimetableForHomeroom(homeroomId)` (mirror of the student fetch but by
homeroom, staff-scoped).

**UI**:
- Setup tab: show homerooms with a class-teacher `SmartSelect`.
- Slot editor (Setup): make time inputs optional; render "Period N" when blank.
- New `PersonTimetableModal` — given `{kind: 'teacher'|'student'|'homeroom', id}`
  render that week's grid using the existing `TimetableGrid`. Wire clickable
  names in the admin builder + generate/preview grids to open it.

**Acceptance.** Admin can set a class teacher; can add a period with no time; can
click a name anywhere in the builder and see the correct weekly grid.

> **Prompt for Round 1:**
> "In the EduBerry timetable module, implement three things. (1) Add one class
> teacher per homeroom: migration adding `homerooms.class_teacher_id` (FK to
> profiles, ON DELETE SET NULL), an `updateHomeroomClassTeacher` data-layer
> helper, and a class-teacher `SmartSelect` per homeroom in the Setup tab.
> (2) Make period-slot timings optional: alter `timetable_period_slots.start_time`
> and `end_time` to be nullable, update the slot create/update helpers and the
> Setup slot editor so a slot needs only a position/label, and render 'Period N'
> when a slot has no time. (3) Add a name-click viewer: a `PersonTimetableModal`
> that takes a teacher, student, or homeroom and shows that person's weekly
> timetable using the existing grid components, plus a
> `fetchTimetableForHomeroom` helper; make teacher/student/homeroom names in the
> admin builder clickable to open it. Follow the existing file structure, RLS
> patterns, and UI style. Add the migration to `supabase-migrations/`."

---

## Round 2 — Homeroom groups  ✅ DONE

Shipped: `timetable_homeroom_groups` + `timetable_group_members` (migration
`add_timetable_r2_homeroom_groups.sql`); `fetchGroupsForHomeroom`, `createGroup`,
`updateGroup`, `deleteGroup`, `addGroupMemberByEmail` (validates the student is in
the parent homeroom), `removeGroupMember`; a new **Groups** tab to create subject-
tagged or custom groups, colour them, and bulk-add students by email.

**Goal.** Split a homeroom into named groups. Groups are subject-filter based
(e.g. Biology vs Computer students) or custom-named. Students are added to a
group by email.

**Schema** — `add_timetable_r2_homeroom_groups.sql`:
- `timetable_homeroom_groups` (id, homeroom_id FK, name, subject_id nullable FK,
  kind enum `subject|custom`, color, created_by, timestamps).
- `timetable_group_members` (id, group_id FK, student_id FK, unique(group_id,
  student_id)).
- Admin-write RLS; staff read; students read own membership.

**Data layer**: CRUD for groups; `addGroupMemberByEmail(groupId, email)` —
resolve email → profile id (must be a member of the parent homeroom), insert;
`fetchGroupsForHomeroom`. Bulk paste of emails.

**UI**: In Setup (or a new "Groups" sub-panel per homeroom), create groups,
optionally bind a group to a subject, add students by pasting emails; show
resolved/unresolved emails.

**Acceptance.** A homeroom can be divided into ≥2 groups; students added by
email; a group can carry a subject tag for later split-class use.

> **Prompt for Round 2:**
> "Add homeroom groups to the EduBerry timetable module. Migration creating
> `timetable_homeroom_groups` (homeroom_id FK, name, optional subject_id FK, kind
> enum subject|custom, color) and `timetable_group_members` (group_id FK,
> student_id FK, unique), with admin-write / staff-read / student-read-own RLS
> matching the existing timetable tables. Data-layer helpers: create/update/
> delete group, `fetchGroupsForHomeroom`, and `addGroupMemberByEmail(groupId,
> email)` that resolves the email to a profile which must already belong to the
> parent homeroom, reporting unresolved emails. UI: a per-homeroom Groups panel
> in the admin builder to create groups (subject-tagged or custom-named), pick a
> color, and add students by pasting one or more emails, showing which resolved.
> Reuse existing UI primitives and RLS style."

---

## Round 3 — Unified constraints framework (data + UI)  ✅ DONE

Shipped: one polymorphic `timetable_constraints` table (migration
`add_timetable_r3_constraints.sql`, which also copies existing
`teacher_unavailability` rows in as teacher time-off); `fetchConstraints`,
`addConstraint`, `deleteConstraint`, `setValueConstraint` helpers; a new
**Constraints** tab with Teachers / Homerooms / Subjects sub-tabs covering
time-off grids, min/max per day & per week (all or a specific homeroom), teacher
max-in-a-row, and pin-class-teacher-to-slot. The old Availability tab was removed
and folded in.

**Goal.** One place to express every constraint the request lists, stored
generically, surfaced in a "Constraints" tab. No solver changes yet — just
capture and display, so Round 4 has real data to honor.

**Schema** — `add_timetable_r3_constraints.sql`, one polymorphic table
`timetable_constraints`:
- `config_id` FK, `scope` enum `teacher|homeroom|subject|group|class_teacher`,
  `scope_id` UUID (teacher/homeroom/subject/group id; null = "all"),
  `homeroom_id` UUID null (for "for a particular homeroom" min/max), `type` enum:
  - `time_off` (+ day, slot_id) — teacher/homeroom/subject unavailable.
  - `min_per_day` / `max_per_day` / `min_per_week` / `max_per_week` (+ value).
  - `max_in_a_row` (+ value) — teacher only.
  - `pin_class_teacher` (+ day, slot_id) — class teacher teaches her homeroom at
    this slot.
- `value SMALLINT`, `day TEXT null`, `slot_id UUID null`, timestamps, admin RLS.
- Migrate existing `teacher_unavailability` rows into `type='time_off',
  scope='teacher'` (keep the old table readable for back-compat, or fold in).

**Data layer**: generic `fetchConstraints(configId)`, `upsertConstraint`,
`deleteConstraint`, plus typed builders per constraint kind.

**UI** — new **Constraints tab** in `AdminTimetableBuilder`, three sections:
- **Teachers**: time-off grid, min/max per day/week (all or per-homeroom),
  max periods in a row.
- **Homerooms**: time-off grid, pin class teacher to a slot.
- **Subjects**: time-off grid, min/max per day/week (all or per-homeroom).
(The Availability tab folds into this; keep as a redirect.)

**Acceptance.** Every constraint in the request can be entered and persisted and
re-loads correctly. Solver still runs as before (constraints not yet enforced).

> **Prompt for Round 3:**
> "Add a unified constraints framework to the EduBerry timetable module.
> Migration for a single `timetable_constraints` table: config_id FK, scope enum
> (teacher|homeroom|subject|group|class_teacher), scope_id (nullable = 'all'),
> optional homeroom_id (for per-homeroom min/max), type enum (time_off,
> min_per_day, max_per_day, min_per_week, max_per_week, max_in_a_row,
> pin_class_teacher), value SMALLINT, day TEXT null, slot_id UUID null, admin-write
> RLS. Migrate existing teacher_unavailability rows into this table as
> scope=teacher, type=time_off. Data layer: fetchConstraints, upsertConstraint,
> deleteConstraint plus typed helpers per kind. UI: a new Constraints tab in the
> admin builder with Teacher, Homeroom, and Subject sections covering time-off
> slots, min/max per day and per week (all or a specific homeroom), teacher max-
> in-a-row, and pin-class-teacher-to-slot. Fold the old Availability tab into it.
> Do NOT change the generator yet — this round only captures and persists
> constraints. Match existing RLS and UI patterns."

---

## Round 4 — Solver honors constraints + consecutive (double/triple) periods  ✅ DONE

Shipped: `min_block`/`max_block` on `timetable_requirements` (migration
`add_timetable_r4_subject_blocks.sql`) + a Block-size selector in the Requirements
tab. The generator (`generator.ts`) is now block-based and constraint-aware via a
shared `constraints.ts` index — HARD: teacher/homeroom/subject time-off, max per
day & per week, teacher max-in-a-row, pin-class-teacher, and contiguous blocks
that never straddle a break; SOFT: min per day & per week, unfilled pins, plus the
original spread/gap/balance terms. `detectConflicts`/`conflictCellKeys` gained
optional constraint args for live highlighting; `GenerateTab` and
`EditableTimetableGrid` feed constraints + class-teacher data through. Verified
end-to-end against a scenario harness (double-period contiguity, time-off,
max-in-a-row, max-per-week, and pins all hold).

**Goal.** Make `generator.ts` enforce Round 3 constraints as hard/soft, and add
subject consecutive-block scheduling (labs/PE needing 2–3 back-to-back slots with
no break between).

**Schema** — `add_timetable_r4_subject_blocks.sql`: add to
`timetable_requirements` (or a companion table) `min_block SMALLINT DEFAULT 1`,
`max_block SMALLINT DEFAULT 1` (consecutive-slot grouping per lesson).

**Types/generator** (`generator.ts`, `types.ts`):
- Extend `GeneratorInput` with constraints + block sizes.
- **Hard**: time-off (teacher/homeroom/subject), max_per_day, max_per_week,
  max_in_a_row, pin_class_teacher (reserve that cell for the class teacher),
  consecutive blocks placed as contiguous teaching slots (skip breaks) matching
  min/max_block.
- **Soft**: min_per_day / min_per_week shortfalls (penalty), keep existing
  spread/gap/balance terms.
- Add block-aware placement (place a 2- or 3-slot lesson as one contiguous unit)
  and a validator update in `detectConflicts` / `conflictCellKeys`.

**UI**: Requirements tab gains min/max block inputs per requirement. Generate tab
surfaces new conflict kinds (block-unplaceable, constraint-violated).

**Acceptance.** Given a subject with min_block=2, the generator places it as
adjacent slots; teacher max-in-a-row and per-day/week caps are never exceeded;
pinned class-teacher slots are respected; min targets show as soft warnings when
unmet.

> **Prompt for Round 4:**
> "Extend the EduBerry timetable generator to honor the constraints framework and
> support consecutive-period blocks. Migration adding min_block/max_block to
> timetable_requirements. Update generator.ts and types.ts: feed constraints and
> block sizes into GeneratorInput; enforce as HARD constraints time_off
> (teacher/homeroom/subject), max_per_day, max_per_week, teacher max_in_a_row,
> pin_class_teacher (reserve the cell for the class teacher), and consecutive
> blocks (place a min_block..max_block lesson as contiguous teaching slots,
> skipping breaks); enforce as SOFT constraints min_per_day and min_per_week
> shortfalls. Update detectConflicts/conflictCellKeys for the new kinds and add
> block-aware placement to the greedy build and local search. Add min/max block
> inputs to the Requirements tab and surface the new conflict types in the
> Generate tab. Keep the existing restart + local-search structure."

---

## Round 5 — Split classes

**Goal.** A homeroom splits into parallel groups in the *same* period — different
subjects, teachers, rooms (e.g. 40 → Physics Lab (20) + Chemistry Lab (20)).

**Model.** Reuse Round 2 groups. Introduce split requirements: a requirement
targets a `group_id` instead of the whole homeroom, and multiple group
requirements share a period. Schema `add_timetable_r5_split.sql`: add nullable
`group_id` to `timetable_requirements` and `timetable_entries`; a `split_key` on
entries to tie parallel group entries to the same cell.

**Generator**: treat a set of group-requirements for one homeroom as a
"parallel bundle" — occupy one homeroom cell but allow N teachers/rooms
simultaneously; validate no group's teacher/room double-books elsewhere.

**UI**: Requirements tab — mark a requirement as targeting a group; grid renders a
split cell (stacked sub-rows for each parallel group). Viewers show a student only
their group's lesson.

**Acceptance.** One period shows two parallel lab groups with distinct
teachers/rooms; each student sees only their group; no double-booking.

> **Prompt for Round 5:**
> "Add split classes to the EduBerry timetable module, building on homeroom
> groups. Migration adding nullable group_id to timetable_requirements and
> timetable_entries plus a split_key on entries to group parallel entries in one
> cell. A requirement may target a group instead of the whole homeroom; several
> group-requirements in the same homeroom form a parallel bundle scheduled into
> the same period with different subjects, teachers, and rooms. Update the
> generator to place parallel bundles into one homeroom cell while still
> preventing teacher/room double-booking, and update conflict detection. UI:
> Requirements tab lets a requirement target a group; the grid renders a split
> cell with a stacked sub-row per group; student viewers show only the viewer's
> group. Reuse the Round 2 groups model and existing grid components."

---

## Round 6 — Combined classes

**Goal.** Several homerooms attend one lesson together — one teacher, one room
(e.g. Music for 10A+10B+10C in the School Hall).

**Schema** — `add_timetable_r6_combined.sql`: `timetable_combined_classes` (id,
config_id, name, subject_id, teacher_id, room_id, periods_per_week) +
`timetable_combined_members` (combined_id, homeroom_id). Combined entries land in
`timetable_entries` for each member homeroom sharing a `combined_key`.

**Generator**: schedule a combined class once, occupying the same day+slot across
all member homerooms, one teacher, one (large) room; validate none of the member
homerooms is otherwise booked at that slot.

**UI**: A "Combined classes" panel (Requirements area) to define the group of
homerooms, teacher, room, periods/week; grid shows the merged cell across member
rows; each homeroom's viewer shows the combined lesson.

**Acceptance.** One Music period occupies 10A/10B/10C simultaneously with a single
teacher and the hall; no member homeroom is double-booked.

> **Prompt for Round 6:**
> "Add combined classes to the EduBerry timetable module. Migration for
> `timetable_combined_classes` (config_id, name, subject_id, teacher_id, room_id,
> periods_per_week) and `timetable_combined_members` (combined_id, homeroom_id),
> admin-write RLS. Combined lessons persist as timetable_entries for each member
> homeroom sharing a combined_key. Update the generator to schedule a combined
> class once, occupying the same day+slot across all member homerooms with one
> teacher and one room, and validate that no member homeroom is otherwise booked
> at that slot. UI: a Combined-classes panel to pick the homerooms, subject,
> teacher, room, and periods/week; render the merged cell across member rows in
> the grid and in each homeroom's viewer. Match existing patterns."

---

## Round 7 — aSc-style master drag-and-drop editor  ✅ DONE

Shipped: `MasterTimetableEditor` — homeroom rows × (day → slot sub-columns) with a
sticky class column and sticky headers. Native HTML5 drag-and-drop moves a lesson
to another period (swapping same-group occupants); split-group and combined
lessons move as units (combined updates every member together); cells lock/unlock
and conflicts highlight live via `conflictCellKeys`. Wired into the Generate tab
as a **Master grid** view toggle alongside the per-class editor; edits persist
through the existing Save/Publish flow.

**Goal.** The headline editor. Leftmost column = every homeroom name; then seven
day columns Monday..Sunday; each day column has slot sub-columns (Period 1..N).
Drag a lesson from one cell to another with live conflict validation; render
split and combined cells correctly.

**Approach.** New `MasterTimetableEditor.tsx` replacing/augmenting the Generate
tab's grid:
- Rows: homerooms (sticky first column). Columns: working days → slot sub-columns.
- Uses HTML5 drag-and-drop (or `@dnd-kit` if already a dependency — check
  `package.json`). Drag an entry to an empty valid cell; swap on occupied.
- On every move: run `detectConflicts` + constraint check client-side; highlight
  offending cells (reuse `conflictCellKeys`); block or warn on hard violations.
- Lock/unlock a cell (existing `is_locked`); locked cells resist drag and are
  preserved on regenerate.
- Persist via `updateEntry` / `replaceEntries`; optimistic UI.
- Render split cells (stacked groups) and combined cells (spanning member rows).

**Acceptance.** Admin drags lessons across the full-school grid; conflicts light
up instantly; changes persist; locks survive regeneration; split/combined cells
render and move as units.

> **Prompt for Round 7:**
> "Build an aSc-Timetables-style master drag-and-drop editor for the EduBerry
> timetable module. New MasterTimetableEditor component: leftmost sticky column
> lists every homeroom; then one column per working day (Monday..Sunday), each day
> split into slot sub-columns (Period 1..N). Support dragging a lesson from one
> cell to another (swap when the target is occupied). On every drag, validate
> hard constraints and clashes client-side using the existing detectConflicts and
> conflictCellKeys plus the constraints framework, highlighting offending cells and
> blocking hard violations. Support locking/unlocking cells (is_locked) so locked
> lessons resist drag and survive regeneration. Persist moves via the existing
> updateEntry/replaceEntries helpers with optimistic UI. Correctly render and move
> split cells (stacked per-group sub-rows) and combined cells (spanning member
> homeroom rows). Check package.json for an existing DnD library before adding
> one. Wire it into the admin builder as the primary editing surface."

---

## Round 8 — Timetable Health Score  ✅ DONE

Shipped: pure `computeHealth` in `health.ts` returning a 0–100 score, a `green`/
`amber`/`red` band, a hard-violation count, six weighted component sub-scores
(coverage, clash-free, constraints met, teacher gaps, subject spread, daily
balance), and a ranked issues list with readable messages. Any hard clash or
coverage shortfall caps the score out of the green band. A collapsible
`HealthPanel` (score + mini bars + breakdown + top issues) sits atop the Generate
tab and recomputes live as the grid changes. Verified: a clean timetable scores
99/green with no issues; a broken one caps at 59/amber and surfaces the right
critical issues.

**Goal.** A 0–100 health score plus a breakdown panel, quantifying how good the
current published/draft timetable is.

**Approach.** `src/lib/timetable/health.ts` — pure function
`computeHealth(entries, constraints, requirements, slots, config)` returning:
- **Hard-violation count** (any → capped score / red).
- **Component sub-scores**: constraint satisfaction (time-off, min/max,
  max-in-a-row, pins), teacher gap minimization, subject spread, daily-load
  balance, room-type fit, unmet `min_*` targets, split/combined integrity.
- Weighted total → 0–100 with letter/emoji band and a ranked list of the biggest
  problems ("Teacher X has 3 idle gaps on Tue", "Biology under weekly minimum").

**UI**: A Health panel in the Generate/Master editor showing the score, radial or
bar breakdown, and the top issues (each clickable → jumps/opens the person or
cell). Recompute live as the grid changes.

**Acceptance.** Score reflects real quality; fixing a flagged issue raises the
score; zero hard violations required for a "green" band.

> **Prompt for Round 8:**
> "Add a Timetable Health Score to the EduBerry timetable module. Create
> src/lib/timetable/health.ts with a pure computeHealth(entries, constraints,
> requirements, slots, config) returning a 0–100 score, per-component sub-scores
> (constraint satisfaction, teacher gaps, subject spread, daily-load balance,
> room-type fit, unmet minimum targets, split/combined integrity), a hard-
> violation count, and a ranked list of the biggest issues with links to the
> offending person/cell. Build on the existing softPenalty logic and the
> constraints framework. Add a Health panel to the Generate tab / master editor
> showing the score, a bar or radial breakdown, and clickable top issues, and
> recompute it live as the grid changes. Any hard violation caps the score out of
> the green band."

---

## Notes

- Every round adds a migration to `supabase-migrations/` following the existing
  admin-write / staff-read / student-read-own RLS convention and ends with
  `NOTIFY pgrst, 'reload schema';`.
- Keep the generator's restart + local-search skeleton; add constraints as new
  hard filters or soft-penalty terms rather than rewriting it.
- Reuse `TimetableGrid` / `EditableTimetableGrid` and the `ui.tsx` primitives
  (`SegmentedNav`, `SmartSelect`) for consistency.
- Rounds 5–6 can be reordered freely; Round 7 should come after both so the
  editor renders every entry shape once.
</content>
</invoke>
