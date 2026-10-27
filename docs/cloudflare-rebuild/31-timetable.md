# Timetable

As of 27 Oct 2026. Part of the [Cloudflare rebuild docs](README.md). The feature history and design detail are in `docs/timetable-expansion-plan.md` (rounds 1–8 done) and `services/solver/README.md`.

## 1. Summary

An aSc-style timetable builder: subjects, rooms, period slots (with optional slot groups and timings per homeroom set), requirements (periods per week per homeroom and subject, teachers, room type, max per day, block lengths), teacher unavailability, a constraints framework (time off, min/max per day or week, max in a row, pin class teacher) at teacher, homeroom, subject, group or class-teacher scope, homeroom groups (split classes), combined classes across homerooms, and date overrides (substitutions). A greedy plus local-search generator runs **in the browser** and streams progress; a separate Python CP-SAT service proves a week impossible (naming the clashing rules) or improves a week. A master drag-and-drop editor, a health score, lesson stats, teacher load, and student and staff views complete it. Teachers' published timetables also feed the task planner.

Live: 1 config, 1 timetable, 1,472 entries, 452 requirements, 177 constraints, 38 subjects, 6 rooms, 14 period slots, 26 combined classes.

What changes: almost nothing in the logic, because the generator and every scheduling rule already live in TypeScript (`src/lib/timetable/*`, 7,500 lines with tests). The data moves into the school object; saving a generated week (`replace_timetable_entries`) becomes one object call; the solver service runs as a Cloudflare Container.

## 2. Users and screens

| Route or component | Who | Purpose |
| --- | --- | --- |
| `/more/timetable` (72 lines) → `AdminTimetableBuilder` | Admin, timetable managers | Tabs: Setup (config, working days, slots, slot groups), Subjects and rooms, Requirements, Availability and constraints (homeroom, subject, teacher), Generate (browser solver, "Can this be built?", "Improve this week") |
| `MasterTimetableEditor`, `EditableTimetableGrid`, `DraftWeekGrid`, `SlotDetailsModal`, `HealthPanel`, `LessonStatsCard`, `TeacherLoad` | Admin | Drag-and-drop editing, locking, health score, loads |
| `StudentTimetableView`, `StaffTimetableView`, `TeacherWeekView`, `PersonTimetableModal`, `NameLink` | Students, staff | Read-only views; click a name to see that person's week |
| `DateChangesNotice` | All | Date overrides (substitutions, cancellations) |
| Task Manager (`TimetableSuggestSheet`, planner) | Teachers | Create tasks from the published timetable ([26](26-tasks-and-projects.md)) |

## 3. How it works today

1. Admins enter setup data; every table is admin-write, staff and student read.
2. **Generate** runs `generator.ts` in the browser (about 15 s, stoppable, with progress) using `buildSchedules`, `expandBlocks`, `expandCombined` and `buildConstraintIndex`.
3. **Prove / improve:** `solverPayload.ts` flattens the same structures into a transport format; `/api/timetable/solve` authenticates the caller and forwards to the private Python service (`SOLVER_INTERNAL_URL`, shared secret, up to 60 s on Vercel), which returns a proof of infeasibility with a minimal set of conflicting rules, or an improved week.
4. **Save:** `replace_timetable_entries(timetable_id, rows)` deletes and re-inserts the grid in one statement, resolving teacher names.
5. **Publish:** `timetables.status` `draft` → `published`.
6. **Overrides:** `timetable_entry_overrides` change a slot for a date range (`overrides.ts`).

## 4. Data

| Table | Rows | Purpose |
| --- | --- | --- |
| `timetable_configs` | 1 | Name, academic year, working days, active |
| `timetable_period_slots` | 14 | Position, label, times, break, slot group |
| `timetable_slot_groups`, `timetable_slot_group_homerooms` | 0 / 0 | Different bell schedules for sets of homerooms |
| `timetable_subjects`, `timetable_rooms` | 38 / 6 | Catalogues |
| `timetable_requirements` | 452 | Homeroom × subject: periods per week, teachers, room type, max per day, block sizes, group |
| `teacher_unavailability` | 0 | Teacher × day × slot |
| `timetable_constraints` | 177 | Scope, type, value, day, slot |
| `timetable_homeroom_groups`, `timetable_group_members` | 2 / 0 | Split groups inside a homeroom |
| `timetable_combined_classes`, `timetable_combined_members` | 26 / 103 | One lesson for several homerooms or groups |
| `timetables` | 1 | Versions with status |
| `timetable_entries` | 1,472 | The grid: homeroom × day × slot → subject, teachers (array and denormalised names), room, lock, group, split/combined/block keys |
| `timetable_entry_overrides` | 0 | Dated changes |
| `timetable_period_slot_times_backup` | 14 | One-off migration backup; not carried over |

## 5. Logic in the database

| Function | Target |
| --- | --- |
| `replace_timetable_entries` | `timetable.saveEntries(timetableId, rows)`: delete and insert in one call; teacher names filled from profiles |
| Row-level security (admin write, everyone read) | `timetable.manage` permission for writes; reads for all signed-in users |

## 6. Server routes and integrations

| Route | Target |
| --- | --- |
| `/api/timetable/solve` | `timetable.solve(mode, payload)`: the Worker starts the `SolverContainer` (Python, OR-Tools CP-SAT) and passes the payload; time budget up to 60 s; result returned to the browser |

Container sizing: a CP-SAT run is CPU-bound; a `standard-2` (1 vCPU, 6 GiB) or `standard-3` instance for up to 60 s costs about a tenth of a cent per run, and the plan's included container usage covers hundreds of runs a month.

## 7. Jobs, files and live updates

None. Exports (`export.ts`) are generated in the browser.

## 8. Single-tenant assumptions

| Assumption | Fix |
| --- | --- |
| Solver URL and secret per deployment | One container binding for all schools |
| Working days stored as day names (`'Mon'`...) | Keep; shared enum |

## 9. Target design

### Tables

Carried over, with array columns (`teacher_ids`, `teacher_names`, `working_days`) as JSON arrays. Consider a child table `timetable_entry_teachers (entry_id, teacher_id)` if teacher-week queries (every staff member's view, task generation) need an index on teacher; today they filter the grid in code, which is fine at 1,500 entries per school but would be ~15,000 at a large school. Indexes: `timetable_entries (timetable_id, homeroom_id)`, plus the teacher table if added.

### Methods

| Method | Permission |
| --- | --- |
| `timetable.config` (everything the builder needs in one call) | `timetable.manage` |
| `timetable.save*` for each setup table | `timetable.manage` |
| `timetable.saveEntries`, `timetable.publish`, `timetable.overrides.*` | `timetable.manage` |
| `timetable.solve` | `timetable.manage` |
| `timetable.forHomeroom`, `timetable.forTeacher`, `timetable.forStudent` (with overrides applied for a date) | signed in |

The generator stays in the browser (it streams progress and is stoppable), sending the final grid with `saveEntries`.

## 10. Moving existing data

Straight copy; drop the backup table. Verify the published grid renders identically for every homeroom and teacher.

## 11. Parity checklist

- [ ] The generator, health score, lesson stats, overrides and workload produce the same results (port the 8 existing test files).
- [ ] "Can this be built?" and "Improve this week" return the same answers through the container.
- [ ] Saving a large grid is atomic (no half-saved timetable).
- [ ] Students and staff see the published week with date overrides applied.
- [ ] Teachers' timetable-based task creation works as today.

## 12. Open questions

- [ ] Should only one timetable per config be allowed to be `published` at a time (today's "multi active" migration suggests several)?
