# Live Schema Reference

Generated 27 Oct 2026 from the live database `mps-web` (Supabase project `tgxxqzeaqxiwoqzopcku`), not from the migration files: the live schema is the one the rebuild must reproduce. Part of the [Cloudflare rebuild docs](../README.md).

Tables are grouped by the section doc that owns them. Each entry shows the live row count, the number of row-level security policies and indexes, every column, foreign keys and trigger functions.

Notation: `!` = NOT NULL; `ts` = timestamptz; `time` = time without time zone; `float8` = double precision; `int2`/`int8` = smallint/bigint; `[]` = Postgres array; other unfamiliar types are enums (listed at the end). `a→b` = column `a` references table `b`. Foreign keys to `profiles` are user references; `profiles.id` itself references `auth.users`.

Totals: 217 tables, 17 views, 37 enum types, 879 indexes, 696 policies, 171 triggers, 268 functions.

## 17 · Integrations, messaging and secrets

#### `integration_secrets` — 1 row · 1 policy · 1 index
- Columns: key text!, value jsonb!, updated_at ts
- Triggers: update_task_updated_at

#### `message_templates` — 22 rows · 4 policies · 1 index
- Columns: key text!, channel notification_channel!, locale text!, provider_template_name text, provider_template_lang text, variable_order text[], title_template text, body_template text, url_template text, active bool!, updated_at ts!

#### `notification_outbox` — 114 rows · 4 policies · 5 indexes
- Columns: id uuid!, module text!, event_type text!, channel notification_channel!, recipient_user_id uuid, recipient_address text, subject_ref jsonb!, template_key text, variables jsonb!, payload jsonb, dedupe_key text!, status notification_status!, priority int2!, perishable bool!, not_before ts!, expires_at ts, attempts int2!, last_error text, provider text, provider_message_id text, sent_at ts, delivered_at ts, failed_at ts, created_at ts!, updated_at ts!
- Links: recipient_user_id→profiles
- Triggers: update_task_updated_at

#### `payment_secrets` — 2 rows · 1 policy · 1 index
- Columns: key text!, value jsonb!, updated_at ts
- Triggers: update_task_updated_at

#### `whatsapp_numbers` — 0 rows · 4 policies · 3 indexes
- Columns: id uuid!, student_id uuid!, msisdn text!, label text, opt_in_at ts, opt_out_at ts, verified_at ts, source text!, created_at ts!
- Links: student_id→profiles

## 20 · Users, profiles and admin

#### `admin_audit_log` — 17 rows · 1 policy · 4 indexes
- Columns: id int8!, actor_id uuid, action text!, target_id uuid, details jsonb, ip text, created_at ts!
- Links: actor_id→profiles
- Triggers: admin_audit_append_only

#### `profiles` — 1,177 rows · 3 policies · 4 indexes
- Columns: id uuid!, email text!, full_name text!, role text!, avatar_url text, created_at ts, updated_at ts, grade int, section text, is_banned bool!, geofence_exempt bool!, is_non_teaching bool!, attendance_hidden bool!, display_role text, banned_at ts
- Links: id→auth.users
- Triggers: guard_profile_insert, guard_profile_privileged_columns, handle_profile_delete, sync_role_to_auth_metadata, update_updated_at_column

#### `staff_details` — 59 rows · 3 policies · 2 indexes
- Columns: id uuid!, staff_id uuid!, employee_id text, designation text, department text, qualification text, date_of_joining date, date_of_birth date, gender text, blood_group text, phone text, emergency_contact text, address text, aadhaar_no text, pan_no text, created_at ts, updated_at ts, subjects_taught text, employment_type text, date_of_retirement date, date_of_confirmation date, cbse_reg_no text, ugc_net_qualified text, teaching_diploma text, teaching_experience_years text, nationality text, religion text, category text, marital_status text, physically_challenged text, ex_serviceman text, alternate_phone text, emergency_contact_name text, emergency_contact_relation text, epf_no text, nps_no text, bank_account_no text, bank_name text, ifsc_code text, employee_category text, date_of_exit date, exit_reason text, notice_period_days int, pt_jurisdiction text
- Links: staff_id→profiles
- Triggers: update_task_updated_at

#### `student_details` — 928 rows · 3 policies · 3 indexes
- Columns: id uuid!, student_id uuid!, admission_no text, roll_no text, date_of_birth date, father_name text, mother_name text, guardian_name text, nationality text, mother_tongue text, religion text, category text, caste text, blood_group text, date_of_admission date, admission_class text, address text, phone text, aadhaar_no text, created_at ts, updated_at ts, pen_no text, cbse_reg_no text, udise_student_code text, gender text, place_of_birth text, differently_abled text, single_girl_child text, father_qualification text, father_occupation text, mother_qualification text, mother_occupation text, annual_income text, minority text, bpl_card_no text, ews_certificate_no text, previous_school text, tc_no text, tc_date date, guardian_phone text, guardian_phone_alt text, whatsapp_opt_in_at ts
- Links: student_id→profiles
- Triggers: update_task_updated_at

#### `support_staff` — 28 rows · 4 policies · 2 indexes
- Columns: id uuid!, full_name text!, employee_id text, designation text, department text, employment_type text, date_of_joining date, monthly_wage numeric(12,2), phone text, alternate_phone text, emergency_contact_name text, emergency_contact text, address text, date_of_birth date, gender text, blood_group text, aadhaar_no text, pan_no text, bank_account_no text, bank_name text, ifsc_code text, notes text, is_active bool!, attendance_hidden bool!, created_by uuid, created_at ts, updated_at ts, resigned_at ts
- Links: created_by→profiles
- Triggers: update_task_updated_at

## 21 · School settings and branding

#### `app_settings` — 1 row · 1 policy · 1 index
- Columns: key text!, value jsonb, updated_at ts

#### `site_config` — 0 rows · 4 policies · 1 index
- Columns: key text!, value jsonb!, updated_at ts

#### `site_settings` — 34 rows · 4 policies · 1 index
- Columns: key text!, value jsonb, updated_at ts
- Triggers: attendance_config_changed, site_settings_touch_updated_at

## 22 · Academic structure

#### `academic_years` — 3 rows · 4 policies · 4 indexes
- Columns: id uuid!, code text!, starts_on date!, ends_on date!, is_active bool!, status text!, promoted_at ts, notes text, created_by uuid, created_at ts!, updated_at ts!
- Links: created_by→profiles
- Triggers: update_updated_at_column

#### `homeroom_members` — 1,066 rows · 3 policies · 4 indexes
- Columns: id uuid!, homeroom_id uuid!, student_id uuid!, created_at ts
- Links: homeroom_id→homerooms, student_id→profiles

#### `homerooms` — 43 rows · 4 policies · 7 indexes
- Columns: id uuid!, name text!, grade int2, section text, created_by uuid, created_at ts, updated_at ts, academic_year text, expiry_date date, smartboard_id uuid, smartboard_banner jsonb, class_teacher_id uuid, academic_year_id uuid
- Links: academic_year_id→academic_years, class_teacher_id→profiles, created_by→profiles, smartboard_id→profiles
- Triggers: restrict_smartboard_homeroom_update, update_task_updated_at

#### `team_coordinators` — 10 rows · 4 policies · 3 indexes
- Columns: team_id uuid!, user_id uuid!, created_at ts
- Links: team_id→teams, user_id→profiles

#### `team_members` — 126 rows · 4 policies · 4 indexes
- Columns: id uuid!, team_id uuid!, user_id uuid!, created_at ts
- Links: team_id→teams, user_id→profiles

#### `teams` — 8 rows · 4 policies · 1 index
- Columns: id uuid!, name text!, created_at ts, description text, start_date date, end_date date, updated_at ts
- Triggers: update_updated_at_column

## 23 · Attendance

#### `attendance_day_timing_members` — 15 rows · 4 policies · 4 indexes
- Columns: id uuid!, timing_id uuid!, staff_id uuid!, created_at ts
- Links: staff_id→profiles, timing_id→attendance_day_timings
- Triggers: attendance_rule_member_changed

#### `attendance_day_timings` — 4 rows · 4 policies · 6 indexes
- Columns: id uuid!, scope_date date, label text!, is_default bool!, late_cutoff time!, checkout_cutoff time!, created_by uuid, created_at ts, updated_at ts, scope_type text!, scope_weekday int2
- Links: created_by→profiles
- Triggers: attendance_rule_changed

#### `attendance_geofence_zone_members` — 0 rows · 4 policies · 4 indexes
- Columns: id uuid!, zone_id uuid!, staff_id uuid!, created_at ts
- Links: staff_id→profiles, zone_id→attendance_geofence_zones

#### `attendance_geofence_zones` — 0 rows · 4 policies · 2 indexes
- Columns: id uuid!, label text!, lat float8!, lng float8!, radius_m int!, created_by uuid, created_at ts, updated_at ts, shape text!, polygon jsonb, trusted_accuracy_m int
- Links: created_by→profiles

#### `attendance_holiday_members` — 0 rows · 4 policies · 4 indexes
- Columns: id uuid!, holiday_id uuid!, staff_id uuid!, created_at ts
- Links: holiday_id→attendance_holidays, staff_id→profiles
- Triggers: attendance_rule_member_changed

#### `attendance_holidays` — 8 rows · 4 policies · 6 indexes
- Columns: id uuid!, scope_date date, name text!, created_by uuid, created_at ts, is_default bool!, scope_type text!, scope_weekday int2
- Links: created_by→profiles
- Triggers: attendance_rule_changed

#### `attendance_location_attempts` — 7,882 rows · 2 policies · 5 indexes
- Columns: id uuid!, staff_id uuid!, date date!, action text!, lat float8, lng float8, accuracy_m float8, sample_count int, agreeing_count int, best_accuracy_m float8, spread_m float8, acquisition_ms int, coarse_lock bool!, verdict text!, distance_m float8, signed_distance_m float8, margin_m float8, zone_id uuid, trusted_accuracy_m int, accepted bool!, failure text, user_agent text, created_at ts!
- Links: staff_id→profiles, zone_id→attendance_geofence_zones

#### `attendance_non_working_day_members` — 0 rows · 4 policies · 4 indexes
- Columns: id uuid!, non_working_day_id uuid!, staff_id uuid!, created_at ts
- Links: non_working_day_id→attendance_non_working_days, staff_id→profiles
- Triggers: attendance_rule_member_changed

#### `attendance_non_working_days` — 0 rows · 4 policies · 5 indexes
- Columns: id uuid!, scope_type text!, scope_date date, scope_weekday int2, name text!, is_default bool!, created_by uuid, created_at ts
- Links: created_by→profiles
- Triggers: attendance_rule_changed

#### `attendance_recompute_queue` — 0 rows · 1 policy · 4 indexes
- Columns: id uuid!, scope_type text!, scope_date date, scope_weekday int2, source text!, queued_at ts!

#### `attendance_records` — 50,449 rows · 4 policies · 7 indexes
- Columns: id uuid!, homeroom_id uuid!, student_id uuid!, date date!, status attendance_status!, leave_application_id uuid, marked_by uuid, remarks text, created_at ts, updated_at ts
- Links: homeroom_id→homerooms, leave_application_id→leave_applications, marked_by→profiles, student_id→profiles
- Triggers: force_attendance_marked_by, update_task_updated_at

#### `staff_attendance_records` — 7,753 rows · 4 policies · 6 indexes
- Columns: id uuid!, staff_id uuid!, date date!, status staff_attendance_status!, check_in_time ts, check_in_lat numeric(9,6), check_in_lng numeric(9,6), check_in_accuracy real, geofence_passed bool, leave_application_id uuid, marked_by uuid, remarks text, created_at ts, updated_at ts, check_out_time ts, check_out_lat float8, check_out_lng float8, check_out_accuracy float8, check_in_time_2 ts, check_in_lat_2 numeric(9,6), check_in_lng_2 numeric(9,6), check_in_accuracy_2 real, check_out_time_2 ts, check_out_lat_2 numeric(9,6), check_out_lng_2 numeric(9,6), check_out_accuracy_2 real, check_in_verdict text, check_out_verdict text, check_in_verdict_2 text, check_out_verdict_2 text, forgotten_checkout_ack_at ts, check_in_distance_m float8, check_out_distance_m float8, check_in_distance_m_2 float8, check_out_distance_m_2 float8
- Links: leave_application_id→leave_applications, marked_by→profiles, staff_id→profiles
- Triggers: force_attendance_marked_by, guard_attendance_location_columns, update_task_updated_at

#### `support_staff_attendance` — 1,962 rows · 4 policies · 4 indexes
- Columns: id uuid!, support_staff_id uuid!, date date!, status text!, marked_by uuid, remarks text, created_at ts, updated_at ts
- Links: marked_by→profiles, support_staff_id→support_staff
- Triggers: force_attendance_marked_by, update_task_updated_at

## 24 · Leave

#### `leave_application_views` — 361 rows · 3 policies · 3 indexes
- Columns: application_id uuid!, user_id uuid!, viewed_at ts!
- Links: application_id→leave_applications, user_id→profiles

#### `leave_applications` — 200 rows · 4 policies · 3 indexes
- Columns: id uuid!, applicant_id uuid!, leave_type leave_type!, start_date date!, end_date date!, reason text!, status leave_status, created_at ts, updated_at ts, selected_approver_ids uuid[], attachment_url text, attachment_name text
- Links: applicant_id→profiles
- Triggers: update_task_updated_at

#### `leave_approvals` — 200 rows · 4 policies · 4 indexes
- Columns: id uuid!, leave_application_id uuid!, approver_id uuid, approver_role text!, team_id uuid, status leave_status, comments text, decided_at ts, created_at ts, attachment_url text, attachment_name text
- Links: approver_id→profiles, leave_application_id→leave_applications, team_id→teams

## 25 · Announcements and notifications

#### `announcement_audiences` — 25 rows · 3 policies · 9 indexes
- Columns: id uuid!, announcement_id uuid!, grade int, section text, team_id uuid, all_teams bool, all_students bool, user_id uuid
- Links: announcement_id→announcements, team_id→teams, user_id→profiles

#### `announcement_likes` — 71 rows · 3 policies · 3 indexes
- Columns: id uuid!, announcement_id uuid!, user_id uuid!, created_at ts!
- Links: announcement_id→announcements, user_id→auth.users

#### `announcement_reads` — 919 rows · 3 policies · 2 indexes
- Columns: user_id uuid!, announcement_id uuid!, read_at ts!
- Links: announcement_id→announcements, user_id→auth.users

#### `announcements` — 9 rows · 4 policies · 6 indexes
- Columns: id uuid!, title text!, content text!, type text!, created_by uuid!, created_at ts, updated_at ts, attachments jsonb, pinned bool!, pinned_at ts
- Links: created_by→profiles
- Triggers: update_task_updated_at

#### `notification_preferences` — 0 rows · 1 policy · 1 index
- Columns: user_id uuid!, event_type text!, channel notification_channel!, enabled bool!, updated_at ts!
- Links: user_id→profiles

#### `push_subscriptions` — 0 rows · 4 policies · 3 indexes
- Columns: id uuid!, user_id uuid!, endpoint text!, p256dh text!, auth text!, user_agent text, created_at ts!, last_used_at ts
- Links: user_id→auth.users

## 26 · Tasks and projects

#### `calendar_access` — 0 rows · 4 policies · 5 indexes
- Columns: id uuid!, owner_id uuid!, viewer_id uuid!, granted_by uuid, created_at ts
- Links: granted_by→profiles, owner_id→profiles, viewer_id→profiles

#### `project_members` — 264 rows · 4 policies · 4 indexes
- Columns: id uuid!, project_id uuid!, user_id uuid!, created_at ts
- Links: project_id→projects, user_id→profiles

#### `projects` — 23 rows · 4 policies · 2 indexes
- Columns: id uuid!, title text!, description text, start_date date, end_date date, sequential_mode bool, created_by uuid!, created_at ts, updated_at ts
- Links: created_by→profiles
- Triggers: update_task_updated_at

#### `subtask_checklist_items` — 3 rows · 4 policies · 2 indexes
- Columns: id uuid!, subtask_id uuid!, text text!, is_completed bool!, sort_order int!, created_at ts!
- Links: subtask_id→subtasks

#### `subtask_comment_attachments` — 0 rows · 2 policies · 2 indexes
- Columns: id uuid!, comment_id uuid!, url text!, name text!, type text!, created_at ts!
- Links: comment_id→subtask_comments

#### `subtask_comments` — 189 rows · 3 policies · 3 indexes
- Columns: id uuid!, subtask_id uuid!, author_id uuid!, content text!, created_at ts!, updated_at ts!
- Links: author_id→profiles, subtask_id→subtasks

#### `subtasks` — 298 rows · 4 policies · 7 indexes
- Columns: id uuid!, project_id uuid!, title text!, description text, status text!, due_date date, timing text, tag text, assignee_id uuid, sort_order int, created_at ts, updated_at ts, bonus_points int!, require_check bool!, end_time text, created_by uuid
- Links: assignee_id→profiles, created_by→profiles, project_id→projects
- Triggers: update_task_updated_at

#### `task_assignees` — 57,901 rows · 4 policies · 5 indexes
- Columns: id uuid!, task_id uuid!, user_id uuid!
- Links: task_id→tasks, user_id→profiles

#### `task_checklist_items` — 764 rows · 4 policies · 2 indexes
- Columns: id uuid!, task_id uuid!, text text!, is_completed bool, sort_order int, created_at ts
- Links: task_id→tasks

#### `task_comments` — 1,410 rows · 2 policies · 5 indexes
- Columns: id uuid!, task_id uuid!, user_id uuid!, content text!, created_at ts, attachment_url text, attachment_name text, attachment_type text
- Links: task_id→tasks, user_id→profiles

#### `tasks` — 57,917 rows · 4 policies · 10 indexes
- Columns: id uuid!, title text!, description text, status text!, is_overdue bool, due_date date, timing text, tag text, recurrence text!, created_by uuid!, created_at ts, updated_at ts, bonus_points int, require_check bool!, end_time text, completed_by uuid, completed_at ts, requires_submission bool!, submission_note text, classes text[]!, period int2, period_end int2
- Links: completed_by→profiles, created_by→profiles
- Triggers: update_task_updated_at

## 27 · Smartboard

#### `smartboard_task_completions` — 249 rows · 3 policies · 4 indexes
- Columns: id uuid!, task_id uuid!, student_id uuid!, status text!, submission text, updated_at ts!
- Links: student_id→profiles, task_id→smartboard_tasks

#### `smartboard_tasks` — 37 rows · 4 policies · 5 indexes
- Columns: id uuid!, homeroom_id uuid, classroom_id uuid, created_by uuid, title text!, description text, due_date date, timing text, end_time text, edu_points int!, created_at ts!, updated_at ts!, require_check bool!, requires_submission bool!, attachment_url text, attachment_name text
- Links: classroom_id→classrooms, created_by→profiles, homeroom_id→homerooms

## 28 · Classrooms and coursework

#### `classroom_discussions` — 40 rows · 3 policies · 4 indexes
- Columns: id uuid!, classroom_id uuid!, user_id uuid!, content text!, parent_id uuid, created_at ts, updated_at ts
- Links: classroom_id→classrooms, parent_id→classroom_discussions, user_id→profiles

#### `classroom_file_progress` — 1,293 rows · 1 policy · 4 indexes
- Columns: id uuid!, file_id uuid!, student_id uuid!, status text!, updated_at ts
- Links: file_id→classroom_files, student_id→profiles

#### `classroom_files` — 110 rows · 4 policies · 4 indexes
- Columns: id uuid!, folder_id uuid!, title text!, description text, due_date date, requires_submission bool, submission_type text, sort_order int, created_by uuid!, created_at ts, updated_at ts, requires_check bool, attachment_url text, attachment_name text, edu_points int!
- Links: created_by→profiles, folder_id→classroom_folders
- Triggers: update_task_updated_at

#### `classroom_folders` — 27 rows · 4 policies · 4 indexes
- Columns: id uuid!, classroom_id uuid!, type text!, title text!, description text, due_date date, sort_order int, created_by uuid!, created_at ts, updated_at ts
- Links: classroom_id→classrooms, created_by→profiles
- Triggers: update_task_updated_at

#### `classroom_members` — 10,706 rows · 3 policies · 4 indexes
- Columns: id uuid!, classroom_id uuid!, user_id uuid!, role text!, created_at ts
- Links: classroom_id→classrooms, user_id→profiles

#### `classroom_submissions` — 85 rows · 4 policies · 4 indexes
- Columns: id uuid!, file_id uuid!, student_id uuid!, content text!, submission_type text!, submitted_at ts, updated_at ts
- Links: file_id→classroom_files, student_id→profiles

#### `classrooms` — 325 rows · 4 policies · 5 indexes
- Columns: id uuid!, title text!, description text, start_date date, end_date date, coordinator_id uuid, created_by uuid!, created_at ts, updated_at ts, grade int, section varchar(10), banner_url text, logo_url text, subject text
- Links: coordinator_id→profiles, created_by→profiles
- Triggers: update_task_updated_at

## 29 · Exams

#### `exam_answers` — 430 rows · 4 policies · 5 indexes
- Columns: id uuid!, submission_id uuid!, question_id uuid!, response jsonb, awarded_marks numeric, is_correct bool, remark text, graded_by uuid, created_at ts, updated_at ts
- Links: graded_by→profiles, question_id→exam_questions, submission_id→exam_submissions
- Triggers: exam_answers_guard, update_task_updated_at

#### `exam_audiences` — 18 rows · 3 policies · 4 indexes
- Columns: id uuid!, exam_id uuid!, homeroom_id uuid, user_id uuid, created_at ts
- Links: exam_id→exams, homeroom_id→homerooms, user_id→profiles

#### `exam_graders` — 3 rows · 3 policies · 5 indexes
- Columns: id uuid!, exam_id uuid!, teacher_id uuid!, added_by uuid, created_at ts
- Links: added_by→profiles, exam_id→exams, teacher_id→profiles

#### `exam_questions` — 59 rows · 4 policies · 2 indexes
- Columns: id uuid!, exam_id uuid!, position int!, type text!, prompt text!, marks numeric!, options jsonb, correct_answer jsonb, multiple_select bool!, created_at ts, scoring_strategy text, scoring_params jsonb, image_url text
- Links: exam_id→exams

#### `exam_result_links` — 1 row · 3 policies · 5 indexes
- Columns: id uuid!, exam_id uuid!, classroom_id uuid!, assessment_id uuid, linked_by uuid, created_at ts
- Links: assessment_id→classroom_assessments, classroom_id→classrooms, exam_id→exams, linked_by→profiles

#### `exam_submissions` — 217 rows · 4 policies · 5 indexes
- Columns: id uuid!, exam_id uuid!, student_id uuid!, started_at ts, submitted_at ts, status text!, is_absent bool!, auto_score numeric, manual_score numeric, total_score numeric, max_score numeric, graded_by uuid, graded_at ts, created_at ts, updated_at ts
- Links: exam_id→exams, graded_by→profiles, student_id→profiles
- Triggers: exam_submissions_guard, update_task_updated_at

#### `exam_templates` — 6 rows · 4 policies · 3 indexes
- Columns: id uuid!, source_exam_id uuid, title text!, subject text, created_by uuid, questions jsonb!, created_at ts
- Links: created_by→profiles, source_exam_id→exams

#### `exams` — 15 rows · 4 policies · 2 indexes
- Columns: id uuid!, title text!, description text, subject text, grade int2, created_by uuid, duration_minutes int, start_at ts, end_at ts, due_at ts, total_marks numeric!, is_pyq bool!, results_published bool!, created_at ts, updated_at ts, exam_mode text!, is_closed bool!, closed_at ts, immediate_results bool!, auto_close_at ts
- Links: created_by→profiles
- Triggers: exam_set_created_by, update_task_updated_at

## 30 · Grades and report cards

#### `classroom_assessment_component_marks` — 17,587 rows · 4 policies · 3 indexes
- Columns: id uuid!, component_id uuid!, student_id uuid!, marks numeric, is_absent bool!, created_at ts, updated_at ts
- Links: component_id→classroom_assessment_components, student_id→profiles
- Triggers: tg_component_mark_recompute

#### `classroom_assessment_components` — 697 rows · 4 policies · 3 indexes
- Columns: id uuid!, assessment_id uuid!, name text!, max_marks numeric!, position int!, created_at ts, updated_at ts
- Links: assessment_id→classroom_assessments
- Triggers: tg_component_sync_assessment

#### `classroom_assessment_marks` — 6,213 rows · 4 policies · 4 indexes
- Columns: id uuid!, assessment_id uuid!, student_id uuid!, marks numeric, max_marks numeric!, created_at ts, updated_at ts, is_absent bool!
- Links: assessment_id→classroom_assessments, student_id→profiles

#### `classroom_assessments` — 252 rows · 4 policies · 5 indexes
- Columns: id uuid!, classroom_id uuid!, title text!, description text, date date, tag text!, created_by uuid!, created_at ts, updated_at ts, report_card_title text, max_marks numeric!, conversion_total numeric
- Links: classroom_id→classrooms, created_by→profiles
- Triggers: update_task_updated_at

#### `report_card_publications` — 0 rows · 3 policies · 3 indexes
- Columns: id uuid!, grade int!, section text!, report_card_title text!, published_by uuid, published_at ts!
- Links: published_by→profiles

#### `report_card_remarks` — 0 rows · 4 policies · 5 indexes
- Columns: id uuid!, student_id uuid!, report_card_title text!, author_id uuid!, remark text!, created_at ts, updated_at ts
- Links: author_id→profiles, student_id→profiles
- Triggers: update_task_updated_at

#### `report_card_titles` — 10 rows · 3 policies · 3 indexes
- Columns: id uuid!, title text!, created_by uuid, created_at ts
- Links: created_by→profiles

## 31 · Timetable

#### `teacher_unavailability` — 0 rows · 4 policies · 5 indexes
- Columns: id uuid!, config_id uuid!, teacher_id uuid!, day text!, slot_id uuid!, created_at ts
- Links: config_id→timetable_configs, slot_id→timetable_period_slots, teacher_id→profiles

#### `timetable_combined_classes` — 26 rows · 4 policies · 7 indexes
- Columns: id uuid!, config_id uuid!, name text!, subject_id uuid, teacher_id uuid, room_id uuid, periods_per_week int2!, created_by uuid, created_at ts, updated_at ts, teacher_ids uuid[]!, room_type room_type!, max_per_day int2!, min_block int2!, max_block int2!
- Links: config_id→timetable_configs, created_by→profiles, room_id→timetable_rooms, subject_id→timetable_subjects, teacher_id→profiles
- Triggers: update_task_updated_at

#### `timetable_combined_members` — 103 rows · 3 policies · 5 indexes
- Columns: id uuid!, combined_id uuid!, homeroom_id uuid!, created_at ts, group_id uuid
- Links: combined_id→timetable_combined_classes, group_id→timetable_homeroom_groups, homeroom_id→homerooms

#### `timetable_configs` — 1 row · 4 policies · 4 indexes
- Columns: id uuid!, name text!, academic_year text, working_days text[]!, is_active bool!, created_by uuid, created_at ts, updated_at ts, academic_year_id uuid
- Links: academic_year_id→academic_years, created_by→profiles
- Triggers: update_task_updated_at

#### `timetable_constraints` — 177 rows · 4 policies · 6 indexes
- Columns: id uuid!, config_id uuid!, scope constraint_scope!, scope_id uuid, homeroom_id uuid, type constraint_type!, value int2, day text, slot_id uuid, created_by uuid, created_at ts, updated_at ts
- Links: config_id→timetable_configs, created_by→profiles, homeroom_id→homerooms, slot_id→timetable_period_slots
- Triggers: update_task_updated_at

#### `timetable_entries` — 1,472 rows · 4 policies · 12 indexes
- Columns: id uuid!, timetable_id uuid!, homeroom_id uuid!, day text!, slot_id uuid!, subject_id uuid, teacher_id uuid, room_id uuid, is_locked bool!, created_at ts, updated_at ts, teacher_name text, group_id uuid, split_key text, combined_key text, teacher_ids uuid[]!, teacher_names text[]!, block_key text
- Links: group_id→timetable_homeroom_groups, homeroom_id→homerooms, room_id→timetable_rooms, slot_id→timetable_period_slots, subject_id→timetable_subjects, teacher_id→profiles, timetable_id→timetables
- Triggers: update_task_updated_at

#### `timetable_entry_overrides` — 0 rows · 4 policies · 4 indexes
- Columns: id uuid!, config_id uuid!, timetable_id uuid, homeroom_id uuid!, day text!, slot_id uuid!, group_id uuid, effective_from date!, effective_to date, kind text!, subject_id uuid, teacher_id uuid, teacher_ids uuid[], room_id uuid, note text, created_by uuid, created_at ts, updated_at ts
- Links: config_id→timetable_configs, created_by→profiles, group_id→timetable_homeroom_groups, homeroom_id→homerooms, room_id→timetable_rooms, slot_id→timetable_period_slots, subject_id→timetable_subjects, teacher_id→profiles, timetable_id→timetables
- Triggers: update_task_updated_at

#### `timetable_group_members` — 0 rows · 3 policies · 4 indexes
- Columns: id uuid!, group_id uuid!, student_id uuid!, created_at ts
- Links: group_id→timetable_homeroom_groups, student_id→profiles

#### `timetable_homeroom_groups` — 2 rows · 4 policies · 4 indexes
- Columns: id uuid!, homeroom_id uuid!, name text!, kind homeroom_group_kind!, subject_id uuid, color text, created_by uuid, created_at ts, updated_at ts
- Links: created_by→profiles, homeroom_id→homerooms, subject_id→timetable_subjects
- Triggers: update_task_updated_at

#### `timetable_period_slot_times_backup` — 14 rows · 0 policies · 1 index
- Columns: slot_id uuid!, config_id uuid!, group_id uuid, start_time time, end_time time, saved_at ts!
- A one-off backup table from a migration; not needed in the rebuild.

#### `timetable_period_slots` — 14 rows · 4 policies · 4 indexes
- Columns: id uuid!, config_id uuid!, position int2!, label text, start_time time, end_time time, is_break bool!, created_at ts, updated_at ts, group_id uuid
- Links: config_id→timetable_configs, group_id→timetable_slot_groups
- Triggers: update_task_updated_at

#### `timetable_requirements` — 452 rows · 4 policies · 8 indexes
- Columns: id uuid!, config_id uuid!, homeroom_id uuid!, subject_id uuid!, teacher_id uuid, periods_per_week int2!, room_type room_type!, max_per_day int2!, created_at ts, updated_at ts, min_block int2!, max_block int2!, group_id uuid, teacher_ids uuid[]!
- Links: config_id→timetable_configs, group_id→timetable_homeroom_groups, homeroom_id→homerooms, subject_id→timetable_subjects, teacher_id→profiles
- Triggers: update_task_updated_at

#### `timetable_rooms` — 6 rows · 4 policies · 2 indexes
- Columns: id uuid!, name text!, room_type room_type!, capacity int2, created_by uuid, created_at ts, updated_at ts
- Links: created_by→profiles
- Triggers: update_task_updated_at

#### `timetable_slot_group_homerooms` — 0 rows · 4 policies · 4 indexes
- Columns: id uuid!, config_id uuid!, group_id uuid!, homeroom_id uuid!, created_at ts
- Links: config_id→timetable_configs, group_id→timetable_slot_groups, homeroom_id→homerooms

#### `timetable_slot_groups` — 0 rows · 4 policies · 2 indexes
- Columns: id uuid!, config_id uuid!, name text!, working_days text[]!, position int2!, color text, created_by uuid, created_at ts, updated_at ts
- Links: config_id→timetable_configs, created_by→profiles
- Triggers: update_task_updated_at

#### `timetable_subjects` — 38 rows · 4 policies · 2 indexes
- Columns: id uuid!, name text!, code text, color text, created_by uuid, created_at ts, updated_at ts
- Links: created_by→profiles
- Triggers: update_task_updated_at

#### `timetables` — 1 row · 4 policies · 4 indexes
- Columns: id uuid!, config_id uuid!, name text!, status timetable_status!, generated_at ts, published_at ts, created_by uuid, created_at ts, updated_at ts
- Links: config_id→timetable_configs, created_by→profiles
- Triggers: update_task_updated_at

## 32 · Certificates

#### `certificate_templates` — 0 rows · 4 policies · 2 indexes
- Columns: id uuid!, name text!, cert_type text!, title text, body text!, created_by uuid, created_at ts, updated_at ts
- Links: created_by→profiles
- Triggers: update_task_updated_at

#### `certificates` — 7 rows · 3 policies · 5 indexes
- Columns: id uuid!, certificate_no text!, cert_type text!, student_id uuid, student_name text!, academic_year text, data jsonb!, issued_by uuid, issue_date date!, status text!, created_at ts, updated_at ts, academic_year_id uuid
- Links: academic_year_id→academic_years, issued_by→profiles, student_id→profiles
- Triggers: update_task_updated_at

## 33 · Fees

The `fee_*` tables are the current fee system (see `docs/fee-upgrade-plan.md`). `school_fees` and `school_fee_payments` are the first-generation fee tables, empty on live and superseded.

#### `fee_audit_log` — 47 rows · 1 policy · 6 indexes
- Columns: id int8!, actor_id uuid, action text!, entity text!, entity_id uuid, student_id uuid, academic_year_id uuid, before jsonb, after jsonb, reason text, amount numeric(12,2), created_at ts!
- Links: academic_year_id→academic_years, actor_id→profiles, student_id→profiles
- Triggers: fee_audit_append_only

#### `fee_categories` — 6 rows · 4 policies · 2 indexes
- Columns: id uuid!, name text!, code text!, sort int!, active bool!, created_by uuid, created_at ts!, updated_at ts!
- Links: created_by→profiles
- Triggers: update_updated_at_column

#### `fee_concessions` — 0 rows · 1 policy · 9 indexes
- Columns: id uuid!, student_id uuid!, academic_year_id uuid!, kind text!, type_id uuid, scholarship_id uuid, invoice_id uuid, fee_head_id uuid, amount numeric(12,2)!, reason text, status text!, line_id uuid, moved_from_invoice_id uuid, auto_applied bool!, requested_by uuid, approved_by uuid, approved_at ts, decline_reason text, removed_by uuid, removed_at ts, removal_reason text, created_at ts!, updated_at ts!
- Links: academic_year_id→academic_years, approved_by→profiles, fee_head_id→fee_heads, invoice_id→fee_invoices, line_id→fee_invoice_lines, moved_from_invoice_id→fee_invoices, removed_by→profiles, requested_by→profiles, scholarship_id→fee_scholarships, student_id→profiles, type_id→fee_discount_types
- Triggers: update_updated_at_column

#### `fee_credits` — 0 rows · 1 policy · 4 indexes
- Columns: id uuid!, student_id uuid!, academic_year_id uuid!, source_payment_id uuid, amount numeric(12,2)!, consumed numeric(12,2)!, note text, created_at ts!
- Links: academic_year_id→academic_years, source_payment_id→fee_payments, student_id→profiles

#### `fee_discount_types` — 1 row · 4 policies · 2 indexes
- Columns: id uuid!, academic_year_id uuid!, name text!, code text!, mode text!, value numeric(12,2)!, scope text!, head_ids uuid[]!, stackable bool!, auto_rule text!, auto_config jsonb!, approval_threshold numeric(12,2), active bool!, notes text, created_by uuid, created_at ts!, updated_at ts!
- Links: academic_year_id→academic_years, created_by→profiles
- Triggers: update_updated_at_column

#### `fee_fine_categories` — 6 rows · 4 policies · 2 indexes
- Columns: id uuid!, name text!, code text!, default_amount numeric(12,2)!, active bool!, sort int!, created_at ts!

#### `fee_fines` — 1 row · 1 policy · 7 indexes
- Columns: id uuid!, student_id uuid!, academic_year_id uuid!, category_id uuid, invoice_id uuid, line_id uuid, amount numeric(12,2)!, reason text, status text!, waived_amount numeric(12,2), waive_reason text, applied_by uuid, waived_by uuid, created_at ts!, updated_at ts!
- Links: academic_year_id→academic_years, applied_by→profiles, category_id→fee_fine_categories, invoice_id→fee_invoices, line_id→fee_invoice_lines, student_id→profiles, waived_by→profiles
- Triggers: update_updated_at_column

#### `fee_grade_groups` — 2 rows · 2 policies · 3 indexes
- Columns: id uuid!, academic_year_id uuid!, grade int2!, name text!, sections text[]!, sort int!, created_by uuid, created_at ts!, updated_at ts!
- Links: academic_year_id→academic_years, created_by→profiles
- Triggers: fee_grade_groups_no_overlap, fee_v2_guard_issued_parent, update_updated_at_column

#### `fee_group_assignments` — 62 rows · 4 policies · 5 indexes
- Columns: id uuid!, academic_year_id uuid!, student_id uuid!, fee_group_id uuid!, is_rte bool!, prorate_from date, note text, assigned_by uuid, created_at ts!, updated_at ts!
- Links: academic_year_id→academic_years, assigned_by→profiles, fee_group_id→fee_groups, student_id→profiles
- Triggers: update_updated_at_column

#### `fee_groups` — 7 rows · 4 policies · 3 indexes
- Columns: id uuid!, academic_year_id uuid!, name text!, code text!, is_default bool!, is_rte bool!, description text, created_by uuid, created_at ts!, updated_at ts!
- Links: academic_year_id→academic_years, created_by→profiles
- Triggers: update_updated_at_column

#### `fee_heads` — 6 rows · 4 policies · 5 indexes
- Columns: id uuid!, name text!, description text, default_amount numeric(10,2)!, active bool!, created_by uuid, created_at ts, updated_at ts, academic_year_id uuid, category_id uuid, code text, tax_rate numeric(5,2)!, tax_inclusive bool!, is_refundable bool!, is_transport bool!, sort int!, frequency text!, gender_split bool!, optional bool!
- Links: academic_year_id→academic_years, category_id→fee_categories, created_by→profiles
- Triggers: fee_v2_guard_issued_parent, update_task_updated_at

#### `fee_installment_items` — 0 rows · 4 policies · 4 indexes
- Columns: id uuid!, installment_id uuid!, fee_head_id uuid!, amount numeric(12,2)!, created_at ts!
- Links: fee_head_id→fee_heads, installment_id→fee_installments

#### `fee_installments` — 0 rows · 4 policies · 5 indexes
- Columns: id uuid!, structure_id uuid!, seq int!, name text!, due_date date!, amount numeric(12,2), percent numeric(5,2), autogen_enabled bool!, autogen_days_before int!, sort int!, created_at ts!, updated_at ts!
- Links: structure_id→fee_structures
- Triggers: update_updated_at_column

#### `fee_instruments` — 0 rows · 4 policies · 4 indexes
- Columns: id uuid!, student_id uuid!, kind text!, number text!, bank text, branch text, account_holder text, amount numeric(12,2)!, instrument_date date, is_postdated bool!, present_on date, status text!, bounce_charge numeric(12,2), bounce_reason text, timeline jsonb!, created_by uuid, created_at ts!, updated_at ts!
- Links: created_by→profiles, student_id→profiles
- Triggers: update_updated_at_column

#### `fee_invoice_lines` — 49 rows · 4 policies · 4 indexes
- Columns: id uuid!, invoice_id uuid!, kind text!, fee_head_id uuid, label text!, amount numeric(12,2)!, tax_rate numeric(5,2)!, tax_amount numeric(12,2)!, source_id uuid, note text, sort int!, created_at ts!
- Links: fee_head_id→fee_heads, invoice_id→fee_invoices
- Triggers: fee_invoice_lines_refresh

#### `fee_invoices` — 49 rows · 3 policies · 10 indexes
- Columns: id uuid!, profile_id uuid!, student_id uuid!, academic_year_id uuid!, installment_id uuid, number text!, seq int8!, issue_date date!, due_date date!, gross numeric(12,2)!, discount_total numeric(12,2)!, tax_total numeric(12,2)!, late_fee_total numeric(12,2)!, fine_total numeric(12,2)!, net numeric(12,2)!, paid numeric(12,2)!, balance numeric(12,2)!, status text!, autogen bool!, verify_token text!, cancelled_reason text, cancelled_by uuid, cancelled_at ts, created_by uuid, created_at ts!, updated_at ts!, issue_id uuid
- Links: academic_year_id→academic_years, cancelled_by→profiles, created_by→profiles, installment_id→fee_installments, issue_id→fee_issues, profile_id→fee_profiles, student_id→profiles
- Triggers: update_updated_at_column

#### `fee_issue_cells` — 2 rows · 1 policy · 8 indexes
- Columns: id uuid!, issue_id uuid!, academic_year_id uuid!, grade int2, group_id uuid, head_id uuid!, term_id uuid, bill_month date, active bool!
- Links: academic_year_id→academic_years, group_id→fee_grade_groups, head_id→fee_heads, issue_id→fee_issues, term_id→fee_terms

#### `fee_issues` — 2 rows · 1 policy · 4 indexes
- Columns: id uuid!, academic_year_id uuid!, kind text!, charge_id uuid, term_id uuid, bill_month date, due_date date!, title text!, filters jsonb!, status text!, student_count int!, invoice_count int!, total numeric(12,2)!, issued_by uuid, issued_at ts!, undone_by uuid, undone_at ts, undo_reason text
- Links: academic_year_id→academic_years, charge_id→fee_other_charges, issued_by→profiles, term_id→fee_terms, undone_by→profiles

#### `fee_late_fee_charges` — 0 rows · 1 policy · 5 indexes
- Columns: id uuid!, invoice_id uuid!, rule_id uuid, line_id uuid, as_of date!, days_late int!, amount numeric(12,2)!, status text!, waive_reason text, waived_by uuid, delta_of uuid, created_at ts!
- Links: delta_of→fee_late_fee_charges, invoice_id→fee_invoices, line_id→fee_invoice_lines, rule_id→fee_late_fee_rules, waived_by→profiles

#### `fee_late_fee_exemptions` — 0 rows · 1 policy · 1 index
- Columns: invoice_id uuid!, reason text, created_by uuid, created_at ts!
- Links: created_by→profiles, invoice_id→fee_invoices

#### `fee_late_fee_rules` — 0 rows · 4 policies · 3 indexes
- Columns: id uuid!, academic_year_id uuid!, name text!, scope text!, scope_id uuid, grace_days int!, charge_type text!, rate numeric(12,2)!, frequency text!, basis text!, cap_amount numeric(12,2), cap_percent numeric(5,2), enabled bool!, enabled_from date, enabled_by uuid, notes text, created_by uuid, created_at ts!, updated_at ts!
- Links: academic_year_id→academic_years, created_by→profiles, enabled_by→profiles
- Triggers: update_updated_at_column

#### `fee_ledger_entries` — 80 rows · 1 policy · 5 indexes
- Columns: id int8!, student_id uuid!, academic_year_id uuid!, entry_date date!, kind text!, ref_table text, ref_id uuid, debit numeric(12,2)!, credit numeric(12,2)!, balance_after numeric(12,2)!, note text, created_by uuid, created_at ts!
- Links: academic_year_id→academic_years, created_by→profiles, student_id→profiles
- Triggers: fee_ledger_append_only

#### `fee_message_links` — 27 rows · 2 policies · 4 indexes
- Columns: id uuid!, token text!, kind text!, invoice_id uuid, student_id uuid!, expires_at ts!, revoked_at ts, opened_at ts, open_count int!, paid_at ts, created_by uuid, created_at ts!
- Links: created_by→profiles, invoice_id→fee_invoices, student_id→profiles

#### `fee_months` — 0 rows · 2 policies · 1 index
- Columns: academic_year_id uuid!, month date!, due_date date!, updated_by uuid, updated_at ts!
- Links: academic_year_id→academic_years, updated_by→profiles
- Triggers: fee_months_guard

#### `fee_number_series` — 2 rows · 1 policy · 2 indexes
- Columns: key text!, academic_year_id uuid!, next_seq int8!, updated_at ts!
- Links: academic_year_id→academic_years

#### `fee_online_orders` — 0 rows · 1 policy · 3 indexes
- Columns: id uuid!, student_id uuid!, academic_year_id uuid!, provider text!, order_id text!, amount numeric(12,2)!, allocations jsonb!, status text!, provider_payment_id text, payment_id uuid, receipt_no text, error text, created_at ts!, updated_at ts!

#### `fee_opening_balances` — 0 rows · 1 policy · 4 indexes
- Columns: id uuid!, student_id uuid!, academic_year_id uuid!, amount numeric(12,2)!, source_year_id uuid, note text, posted bool!, created_by uuid, created_at ts!
- Links: academic_year_id→academic_years, created_by→profiles, source_year_id→academic_years, student_id→profiles

#### `fee_optins` — 0 rows · 2 policies · 5 indexes
- Columns: id uuid!, academic_year_id uuid!, head_id uuid, charge_id uuid, student_id uuid!, created_by uuid, created_at ts!
- Links: academic_year_id→academic_years, charge_id→fee_other_charges, created_by→profiles, head_id→fee_heads, student_id→profiles

#### `fee_other_charge_students` — 0 rows · 1 policy · 2 indexes
- Columns: charge_id uuid!, student_id uuid!, grade int2, section text
- Links: charge_id→fee_other_charges, student_id→profiles

#### `fee_other_charges` — 0 rows · 1 policy · 3 indexes
- Columns: id uuid!, academic_year_id uuid!, kind text!, title text!, description text, amount numeric(12,2)!, due_date date!, fine_category_id uuid, filters jsonb!, created_by uuid, created_at ts!, updated_at ts!, optional bool!
- Links: academic_year_id→academic_years, created_by→profiles, fine_category_id→fee_fine_categories
- Triggers: update_updated_at_column

#### `fee_payment_allocations` — 2 rows · 2 policies · 4 indexes
- Columns: id uuid!, payment_id uuid!, invoice_id uuid!, amount numeric(12,2)!, created_at ts!
- Links: invoice_id→fee_invoices, payment_id→fee_payments
- Triggers: fee_alloc_refresh

#### `fee_payments` — 4 rows · 2 policies · 10 indexes
- Columns: id uuid!, student_id uuid!, academic_year_id uuid!, receipt_no text, seq int8, paid_on date!, method text!, amount numeric(12,2)!, reference text, notes text, instrument_id uuid, status text!, razorpay_order_id text, razorpay_payment_id text, utr text, provider_ref text, collect_vpa text, collected_by uuid, verified_by uuid, verified_at ts, reversed_by uuid, reversed_at ts, reversal_reason text, receipt_hash text, created_at ts!, updated_at ts!
- Links: academic_year_id→academic_years, collected_by→profiles, instrument_id→fee_instruments, reversed_by→profiles, student_id→profiles, verified_by→profiles
- Triggers: fee_payment_status_refresh, fee_payments_immutable, fee_payments_no_delete, update_updated_at_column

#### `fee_permissions` — 28 rows · 4 policies · 1 index
- Columns: key text!, label text!, help text!, category text!, sort int!, is_dangerous bool!

#### `fee_profiles` — 102 rows · 4 policies · 7 indexes
- Columns: id uuid!, student_id uuid!, academic_year_id uuid!, fee_group_id uuid, structure_id uuid, structure_source jsonb, status text!, prorate_from date, opening_balance numeric(12,2)!, is_rte bool!, notes text, created_by uuid, created_at ts!, updated_at ts!
- Links: academic_year_id→academic_years, created_by→profiles, fee_group_id→fee_groups, structure_id→fee_structures, student_id→profiles
- Triggers: update_updated_at_column

#### `fee_rates` — 1 row · 2 policies · 6 indexes
- Columns: id uuid!, academic_year_id uuid!, grade int2, group_id uuid, head_id uuid!, term_id uuid, gender text!, amount numeric(12,2)!, updated_by uuid, created_at ts!, updated_at ts!
- Links: academic_year_id→academic_years, group_id→fee_grade_groups, head_id→fee_heads, term_id→fee_terms, updated_by→profiles
- Triggers: fee_rates_guard_lock, update_updated_at_column

#### `fee_refunds` — 0 rows · 1 policy · 7 indexes
- Columns: id uuid!, student_id uuid!, academic_year_id uuid!, amount numeric(12,2)!, reason text!, source_payment_id uuid, source_credit_id uuid, status text!, method text, reference text, requested_by uuid, requested_at ts!, approved_by uuid, approved_at ts, decline_reason text, paid_by uuid, paid_at ts, paid_on date, created_at ts!, updated_at ts!
- Links: academic_year_id→academic_years, approved_by→profiles, paid_by→profiles, requested_by→profiles, source_credit_id→fee_credits, source_payment_id→fee_payments, student_id→profiles
- Triggers: update_updated_at_column

#### `fee_reminder_log` — 27 rows · 1 policy · 6 indexes
- Columns: id int8!, student_id uuid!, invoice_id uuid, schedule_id uuid, channel text!, template_key text, outbox_id uuid, msisdn text, link_id uuid, balance_then numeric(12,2), sent_at ts, delivered_at ts, read_at ts, failed_at ts, paid_at ts, sent_by uuid, created_at ts!
- Links: invoice_id→fee_invoices, link_id→fee_message_links, outbox_id→notification_outbox, schedule_id→fee_reminder_schedules, sent_by→profiles, student_id→profiles

#### `fee_reminder_schedules` — 1 row · 1 policy · 2 indexes
- Columns: id uuid!, academic_year_id uuid!, name text!, enabled bool!, offsets int[]!, send_at time!, channels text[]!, skip_if_paid bool!, quiet_days int[]!, created_by uuid, created_at ts!, updated_at ts!
- Links: academic_year_id→academic_years, created_by→profiles
- Triggers: update_updated_at_column

#### `fee_role_grants` — 196 rows · 4 policies · 2 indexes
- Columns: role text!, permission_key text!, granted bool!, updated_by uuid, updated_at ts!
- Links: permission_key→fee_permissions, updated_by→profiles
- Triggers: fee_guard_permission_lockout

#### `fee_rte_register` — 0 rows · 1 policy · 3 indexes
- Columns: id uuid!, student_id uuid!, academic_year_id uuid!, category text!, claim_period text, claimed_amount numeric(12,2)!, reimbursed_amount numeric(12,2)!, reimbursed_on date, government_ref text, status text!, notes text, created_by uuid, created_at ts!, updated_at ts!
- Links: academic_year_id→academic_years, created_by→profiles, student_id→profiles
- Triggers: update_updated_at_column

#### `fee_scholarships` — 0 rows · 4 policies · 2 indexes
- Columns: id uuid!, academic_year_id uuid!, name text!, code text!, funder text, annual_budget numeric(12,2), seats int, notes text, active bool!, created_by uuid, created_at ts!, updated_at ts!
- Links: academic_year_id→academic_years, created_by→profiles
- Triggers: update_updated_at_column

#### `fee_settings` — 7 rows · 4 policies · 5 indexes
- Columns: id uuid!, academic_year_id uuid, key text!, value jsonb!, effective_from date!, effective_to date, version int!, status text!, notes text, created_by uuid, published_by uuid, published_at ts, created_at ts!
- Links: academic_year_id→academic_years, created_by→profiles, published_by→profiles
- Triggers: fee_settings_freeze_published

#### `fee_structure_items` — 0 rows · 4 policies · 4 indexes
- Columns: id uuid!, structure_id uuid!, fee_head_id uuid!, amount numeric(12,2)!, tax_rate numeric(5,2)!, sort int!, created_at ts!
- Links: fee_head_id→fee_heads, structure_id→fee_structures
- Triggers: fee_refresh_structure_total

#### `fee_structures` — 0 rows · 4 policies · 4 indexes
- Columns: id uuid!, academic_year_id uuid!, fee_group_id uuid!, grade int2, name text!, status text!, total_cached numeric(12,2)!, notes text, created_by uuid, created_at ts!, updated_at ts!
- Links: academic_year_id→academic_years, created_by→profiles, fee_group_id→fee_groups
- Triggers: update_updated_at_column

#### `fee_terms` — 3 rows · 6 policies · 3 indexes
- Columns: id uuid!, academic_year_id uuid!, name text!, seq int!, due_date date!, created_by uuid, created_at ts!, updated_at ts!
- Links: academic_year_id→academic_years, created_by→profiles
- Triggers: fee_v2_guard_issued_parent, update_updated_at_column

#### `fee_user_grants` — 28 rows · 4 policies · 3 indexes
- Columns: user_id uuid!, permission_key text!, granted bool!, note text, granted_by uuid, updated_at ts!
- Links: granted_by→profiles, permission_key→fee_permissions, user_id→profiles
- Triggers: fee_guard_permission_lockout

#### `school_fee_payments` — 0 rows · 4 policies · 5 indexes (first-generation, superseded)
- Columns: id uuid!, fee_id uuid!, payer_id uuid, method fee_payment_method!, amount numeric(10,2)!, status fee_payment_status!, razorpay_order_id text, razorpay_payment_id text, razorpay_signature text, upi_txn_ref text, verified_by uuid, verified_at ts, created_at ts, updated_at ts
- Links: fee_id→school_fees, payer_id→profiles, verified_by→profiles
- Triggers: update_task_updated_at

#### `school_fees` — 0 rows · 4 policies · 7 indexes (first-generation, superseded)
- Columns: id uuid!, fee_head_id uuid, student_id uuid!, amount numeric(10,2)!, description text, due_date date, status fee_status!, upi_reference text!, created_by uuid, created_at ts, updated_at ts, academic_year text, academic_year_id uuid
- Links: academic_year_id→academic_years, created_by→profiles, fee_head_id→fee_heads, student_id→profiles
- Triggers: update_task_updated_at

## 34 · Payroll and salary

Two generations live side by side: the older `salary_*` tables (cycles of base pay plus items, used today: 225 records) and the newer `payroll_*` engine (structures, components, rule sets, runs; set up but no runs yet). See `docs/payroll-upgrade-plan.md` and `docs/payroll-multi-location-plan.md`.

#### `payroll_advances` — 0 rows · 4 policies · 2 indexes
- Columns: id uuid!, employee_id uuid!, label text!, amount numeric(12,2)!, reason text, recovery_mode text!, emi_amount numeric(12,2)!, start_period text!, status text!, sanctioned_by uuid, sanctioned_on date, created_at ts, updated_at ts
- Links: employee_id→profiles, sanctioned_by→profiles
- Triggers: update_task_updated_at

#### `payroll_arrears` — 0 rows · 4 policies · 4 indexes
- Columns: id uuid!, employee_id uuid!, revision_id uuid, label text!, from_period text!, to_period text!, amount numeric(12,2)!, breakdown jsonb!, status text!, run_id uuid, created_by uuid, created_at ts, updated_at ts
- Links: created_by→profiles, employee_id→profiles, revision_id→payroll_revisions, run_id→payroll_runs
- Triggers: update_task_updated_at

#### `payroll_attendance_corrections` — 0 rows · 4 policies · 2 indexes
- Columns: id uuid!, employee_id uuid!, date date!, from_status text, to_status text!, reason text!, requested_by uuid, approved_by uuid, approved_at ts, applied_to_run_id uuid, created_at ts
- Links: approved_by→profiles, employee_id→profiles, requested_by→profiles

#### `payroll_calendar_members` — 0 rows · 1 policy · 4 indexes
- Columns: id uuid!, calendar_id uuid!, employee_id uuid!, created_at ts
- Links: calendar_id→payroll_calendars, employee_id→profiles

#### `payroll_calendars` — 1 row · 4 policies · 2 indexes
- Columns: id uuid!, name text!, is_default bool!, priority int!, effective_from date!, effective_to date, match jsonb, basis text!, fixed_days int!, week_pattern jsonb!, nth_weekday_rules jsonb!, created_by uuid, created_at ts, updated_at ts
- Links: created_by→profiles
- Triggers: update_task_updated_at

#### `payroll_components` — 30 rows · 4 policies · 2 indexes
- Columns: id uuid!, code text!, name text!, kind text!, calc_type text!, percent_of text, formula text, slabs jsonb, sequence int!, rounding text!, is_taxable bool!, counts_for_pf bool!, counts_for_esi bool!, counts_for_pt bool!, lop_applicable bool!, prorate_on_join_exit bool!, show_on_payslip bool!, is_system bool!, created_by uuid, created_at ts, updated_at ts
- Links: created_by→profiles
- Triggers: update_task_updated_at

#### `payroll_employee_overrides` — 0 rows · 4 policies · 3 indexes
- Columns: id uuid!, employee_id uuid!, component_id uuid!, calc_type text, value numeric(12,2), formula text, effective_from date!, effective_to date, reason text, created_by uuid, created_at ts
- Links: component_id→payroll_components, created_by→profiles, employee_id→profiles

#### `payroll_employee_statutory` — 0 rows · 4 policies · 1 index
- Columns: employee_id uuid!, pf_applicable bool!, eps_applicable bool!, pf_wage_override numeric(12,2), esi_override bool, esi_covered_at_period_start bool, uan text, esi_ip_number text, pan text, updated_at ts
- Links: employee_id→profiles
- Triggers: update_task_updated_at

#### `payroll_employee_structures` — 0 rows · 4 policies · 5 indexes
- Columns: id uuid!, employee_id uuid!, structure_id uuid!, effective_from date!, effective_to date, anchor_amount numeric(12,2)!, revision_id uuid, reason text, created_by uuid, created_at ts
- Links: created_by→profiles, employee_id→profiles, revision_id→payroll_revisions, structure_id→payroll_structures

#### `payroll_exceptions` — 0 rows · 1 policy · 3 indexes
- Columns: id uuid!, run_id uuid!, employee_id uuid, severity text!, code text!, message text!, details jsonb, resolved_at ts, resolved_by uuid, resolution_note text, created_at ts
- Links: employee_id→profiles, resolved_by→profiles, run_id→payroll_runs

#### `payroll_ff_settlements` — 0 rows · 4 policies · 3 indexes
- Columns: id uuid!, employee_id uuid!, resignation_date date, last_working_day date!, notice_days_required int!, notice_days_served int!, encashable_leave_days numeric(6,2)!, service_years numeric(6,2)!, service_days_in_final_year int!, bonus_eligible_days int!, bonus_year_wages numeric(12,2)!, status text!, run_id uuid, computed jsonb, approved_by uuid, approved_at ts, notes text, created_by uuid, created_at ts, updated_at ts
- Links: approved_by→profiles, created_by→profiles, employee_id→profiles, run_id→payroll_runs
- Triggers: update_task_updated_at

#### `payroll_leave_balances` — 0 rows · 4 policies · 2 indexes
- Columns: id uuid!, employee_id uuid!, year text!, leave_type text!, opening numeric(6,2)!, accrued numeric(6,2)!, used numeric(6,2)!, encashed numeric(6,2)!, lapsed numeric(6,2)!, carry_forward_cap numeric(6,2), encashable bool!, updated_at ts
- Links: employee_id→profiles
- Triggers: update_task_updated_at

#### `payroll_legal_entities` — 1 row · 4 policies · 3 indexes
- Columns: id uuid!, name text!, code text, pan text, tan text, registered_address text, deductor_name text, deductor_designation text, is_default bool!, status text!, created_by uuid, created_at ts, updated_at ts
- Links: created_by→profiles
- Triggers: update_task_updated_at

#### `payroll_line_components` — 0 rows · 4 policies · 3 indexes
- Columns: id uuid!, line_id uuid!, run_id uuid!, component_code text!, name text!, kind text!, amount numeric(12,2)!, full_amount numeric(12,2)!, sequence int!, computed_from jsonb, created_at ts
- Links: line_id→payroll_run_lines, run_id→payroll_runs
- Triggers: payroll_reject_locked_write

#### `payroll_loan_schedule` — 0 rows · 4 policies · 2 indexes
- Columns: id uuid!, loan_id uuid!, period text!, emi_due numeric(12,2)!, principal_part numeric(12,2)!, interest_part numeric(12,2)!, balance_after numeric(12,2)!
- Links: loan_id→payroll_loans

#### `payroll_loans` — 0 rows · 4 policies · 2 indexes
- Columns: id uuid!, employee_id uuid!, label text!, principal numeric(12,2)!, interest_rate numeric(6,3)!, interest_type text!, emi_amount numeric(12,2)!, tenure_months int!, start_period text!, status text!, sanctioned_by uuid, sanctioned_on date, notes text, created_at ts, updated_at ts
- Links: employee_id→profiles, sanctioned_by→profiles
- Triggers: update_task_updated_at

#### `payroll_location_members` — 104 rows · 4 policies · 4 indexes
- Columns: id uuid!, location_id uuid!, employee_id uuid!, effective_from date!, effective_to date, reason text, created_by uuid, created_at ts
- Links: created_by→profiles, employee_id→profiles, location_id→payroll_work_locations

#### `payroll_policy_group_members` — 0 rows · 1 policy · 4 indexes
- Columns: id uuid!, group_id uuid!, employee_id uuid!, created_at ts
- Links: employee_id→profiles, group_id→payroll_policy_groups

#### `payroll_policy_groups` — 1 row · 4 policies · 2 indexes
- Columns: id uuid!, name text!, is_default bool!, priority int!, effective_from date!, effective_to date, match jsonb, policy jsonb!, notes text, created_by uuid, created_at ts, updated_at ts
- Links: created_by→profiles
- Triggers: update_task_updated_at

#### `payroll_repayments` — 0 rows · 4 policies · 6 indexes
- Columns: id uuid!, loan_id uuid, advance_id uuid, run_id uuid, amount numeric(12,2)!, principal_part numeric(12,2)!, interest_part numeric(12,2)!, paid_on date!, note text, created_by uuid, created_at ts
- Links: advance_id→payroll_advances, created_by→profiles, loan_id→payroll_loans, run_id→payroll_runs
- Triggers: payroll_repayments_guard

#### `payroll_revisions` — 0 rows · 1 policy · 2 indexes
- Columns: id uuid!, label text!, kind text!, basis text!, value numeric(12,2), target_structure_id uuid, effective_from date!, arrears_from date, status text!, scope jsonb, reason text, approved_by uuid, applied_at ts, created_by uuid, created_at ts, updated_at ts
- Links: approved_by→profiles, created_by→profiles, target_structure_id→payroll_structures
- Triggers: update_task_updated_at

#### `payroll_rule_sets` — 25 rows · 4 policies · 4 indexes
- Columns: id uuid!, domain text!, jurisdiction text!, version int!, effective_from date!, effective_to date, rules jsonb!, source_note text, status text!, published_by uuid, published_at ts, created_by uuid, created_at ts, updated_at ts
- Links: created_by→profiles, published_by→profiles
- Triggers: payroll_rule_sets_freeze_published, update_task_updated_at

#### `payroll_run_events` — 0 rows · 1 policy · 2 indexes
- Columns: id uuid!, run_id uuid!, from_status text, to_status text!, actor_id uuid, note text, details jsonb, created_at ts
- Links: actor_id→profiles, run_id→payroll_runs
- Triggers: payroll_events_append_only

#### `payroll_run_lines` — 0 rows · 4 policies · 9 indexes
- Columns: id uuid!, run_id uuid!, employee_id uuid!, structure_id uuid, policy_group_id uuid, calendar_id uuid, gross_earnings numeric(12,2)!, total_deductions numeric(12,2)!, employer_contributions numeric(12,2)!, employer_cost numeric(12,2)!, net_pay numeric(12,2)!, payable_days numeric(6,2)!, paid_days numeric(6,2)!, lop_days numeric(6,2)!, inputs jsonb, trace jsonb, payout_status text, payout_reference text, created_at ts, updated_at ts, location_id uuid, entity_id uuid, jurisdiction text
- Links: calendar_id→payroll_calendars, employee_id→profiles, entity_id→payroll_legal_entities, location_id→payroll_work_locations, policy_group_id→payroll_policy_groups, run_id→payroll_runs, structure_id→payroll_structures
- Triggers: payroll_allow_payout_update, payroll_reject_locked_write

#### `payroll_runs` — 0 rows · 4 policies · 3 indexes
- Columns: id uuid!, period_month int2!, period_year int2!, period_from date!, period_to date!, pay_date date, run_type text!, status text!, label text, notes text, rule_set_ids jsonb, variance_acknowledged_by uuid, variance_acknowledged_at ts, calculated_at ts, approved_by uuid, approved_at ts, locked_by uuid, locked_at ts, locked_hash text, created_by uuid, created_at ts, updated_at ts, location_ids uuid[]
- Links: approved_by→profiles, created_by→profiles, locked_by→profiles, variance_acknowledged_by→profiles
- Triggers: payroll_runs_guard_status, update_task_updated_at

#### `payroll_scenarios` — 0 rows · 1 policy · 1 index
- Columns: id uuid!, name text!, description text, period_month int2!, period_year int2!, scope jsonb!, change jsonb!, result jsonb, created_by uuid, created_at ts, updated_at ts
- Links: created_by→profiles
- Triggers: update_task_updated_at

#### `payroll_structure_components` — 0 rows · 1 policy · 4 indexes
- Columns: id uuid!, structure_id uuid!, component_id uuid!, calc_type text, value numeric(12,2), formula text, sequence int
- Links: component_id→payroll_components, structure_id→payroll_structures

#### `payroll_structures` — 0 rows · 4 policies · 3 indexes
- Columns: id uuid!, code text!, name text!, employee_category text, version int!, supersedes_id uuid, status text!, effective_from date!, effective_to date, notes text, created_by uuid, created_at ts, updated_at ts
- Links: created_by→profiles, supersedes_id→payroll_structures
- Triggers: update_task_updated_at

#### `payroll_tax_declarations` — 0 rows · 4 policies · 3 indexes
- Columns: id uuid!, employee_id uuid!, financial_year text!, regime text!, sections jsonb!, previous_employer jsonb, proofs jsonb!, status text!, verified_by uuid, verified_at ts, rejection_note text, created_at ts, updated_at ts
- Links: employee_id→profiles, verified_by→profiles
- Triggers: update_task_updated_at

#### `payroll_work_locations` — 1 row · 4 policies · 4 indexes
- Columns: id uuid!, entity_id uuid!, name text!, code text, address text, state_code text!, is_default bool!, priority int!, match jsonb, epf_establishment_id text, esi_employer_code text, pt_registration_no text, pt_enrolment_no text, lwf_registration_no text, bank_account_id uuid, effective_from date!, effective_to date, status text!, notes text, created_by uuid, created_at ts, updated_at ts
- Links: created_by→profiles, entity_id→payroll_legal_entities
- Triggers: update_task_updated_at

#### `salary_cycles` — 2 rows · 4 policies · 3 indexes
- Columns: id uuid!, period_month int2!, period_year int2!, status text!, notes text, created_by uuid, created_at ts, updated_at ts, payroll_config jsonb
- Links: created_by→profiles
- Triggers: update_task_updated_at

#### `salary_record_items` — 356 rows · 4 policies · 2 indexes
- Columns: id uuid!, record_id uuid!, label text!, amount numeric(10,2)!, created_at ts
- Links: record_id→salary_records

#### `salary_records` — 225 rows · 4 policies · 7 indexes
- Columns: id uuid!, cycle_id uuid!, staff_id uuid, base_amount numeric(10,2)!, status payroll_status!, payout_status text, payout_reference text, notes text, created_by uuid, created_at ts, updated_at ts, working_days_override int, leave_override numeric(5,2), late_override numeric(5,2), pf_amount_override numeric(10,2), esi_amount_override numeric(10,2), half_day_override numeric(5,2), support_staff_id uuid, pay_by_cash bool!, person_name_snapshot text, person_role_snapshot text, working_days_snapshot int2, leave_snapshot int2, late_snapshot int2, half_day_snapshot int2, bonus_points_snapshot int
- Links: created_by→profiles, cycle_id→salary_cycles, staff_id→profiles, support_staff_id→support_staff
- Triggers: update_task_updated_at

#### `staff_bank_accounts` — 81 rows · 4 policies · 3 indexes
- Columns: id uuid!, staff_id uuid!, account_holder_name text!, account_number text!, ifsc text!, bank_name text, payout_fund_account_id text, created_by uuid, created_at ts, updated_at ts
- Links: created_by→profiles, staff_id→profiles
- Triggers: update_task_updated_at

#### `staff_salary_base` — 95 rows · 4 policies · 3 indexes
- Columns: id uuid!, staff_id uuid!, base_amount numeric(10,2)!, active bool!, notes text, created_by uuid, created_at ts, updated_at ts, pf_basic numeric(10,2), pf_applicable bool!, esi_override bool, uan text, esi_ip_number text, eps_applicable bool!
- Links: created_by→profiles, staff_id→profiles
- Triggers: update_task_updated_at

#### `support_staff_bank_accounts` — 18 rows · 1 policy · 2 indexes
- Columns: id uuid!, support_staff_id uuid!, account_holder_name text!, account_number text!, ifsc text!, bank_name text, payout_fund_account_id text, created_by uuid, created_at ts, updated_at ts
- Links: created_by→profiles, support_staff_id→support_staff
- Triggers: update_task_updated_at

#### `support_staff_salary_base` — 28 rows · 1 policy · 2 indexes
- Columns: id uuid!, support_staff_id uuid!, base_amount numeric(10,2)!, active bool!, notes text, pf_basic numeric(10,2), pf_applicable bool!, esi_override bool, uan text, esi_ip_number text, eps_applicable bool!, created_by uuid, created_at ts, updated_at ts
- Links: created_by→profiles, support_staff_id→support_staff
- Triggers: update_task_updated_at

## 36 · Transport

`transport_*` is the current transport system (see `docs/transport-expansion-plan.md`); `bus_*` tables hold bus fees and `driver_*` tables hold driver payroll, both older than the `fee_*` and `payroll_*` systems.

#### `bus_fee_draft_passengers` — 0 rows · 1 policy · 4 indexes
- Columns: id uuid!, draft_id uuid!, passenger_id uuid!, amount numeric(10,2), description text, created_at ts
- Links: draft_id→bus_fee_drafts, passenger_id→profiles

#### `bus_fee_drafts` — 0 rows · 1 policy · 7 indexes
- Columns: id uuid!, title text!, month text!, route_id uuid, fee_head_id uuid, description text, due_date date, status text!, issued_at ts, created_by uuid, created_at ts, updated_at ts, academic_year_id uuid
- Links: academic_year_id→academic_years, created_by→profiles, fee_head_id→bus_fee_heads, route_id→transport_routes
- Triggers: transport_fill_academic_year, update_task_updated_at

#### `bus_fee_heads` — 0 rows · 4 policies · 3 indexes
- Columns: id uuid!, name text!, description text, default_amount numeric(10,2)!, active bool!, created_by uuid, created_at ts, updated_at ts
- Links: created_by→profiles
- Triggers: update_task_updated_at

#### `bus_fees` — 2 rows · 4 policies · 8 indexes
- Columns: id uuid!, route_id uuid, passenger_id uuid!, amount numeric(10,2)!, description text, due_date date, status bus_fee_status!, upi_reference text!, created_by uuid, created_at ts, updated_at ts, fee_head_id uuid, billing_period text, academic_year_id uuid
- Links: academic_year_id→academic_years, created_by→profiles, fee_head_id→bus_fee_heads, passenger_id→profiles, route_id→transport_routes
- Triggers: transport_fill_academic_year, update_task_updated_at

#### `bus_payments` — 0 rows · 4 policies · 6 indexes
- Columns: id uuid!, fee_id uuid!, payer_id uuid, method bus_payment_method!, amount numeric(10,2)!, status bus_payment_status!, razorpay_order_id text, razorpay_payment_id text, razorpay_signature text, upi_txn_ref text, verified_by uuid, verified_at ts, created_at ts, updated_at ts, academic_year_id uuid
- Links: academic_year_id→academic_years, fee_id→bus_fees, payer_id→profiles, verified_by→profiles
- Triggers: transport_fill_academic_year, update_task_updated_at

#### `driver_bank_accounts` — 5 rows · 4 policies · 2 indexes
- Columns: id uuid!, driver_id uuid!, account_holder_name text!, account_number text!, ifsc text!, bank_name text, payout_fund_account_id text, created_by uuid, created_at ts, updated_at ts
- Links: created_by→profiles, driver_id→profiles
- Triggers: update_task_updated_at

#### `driver_payroll` — 0 rows · 4 policies · 4 indexes (older, superseded by cycles)
- Columns: id uuid!, driver_id uuid!, period_start date!, period_end date!, base_amount numeric(10,2)!, status payroll_status!, notes text, created_by uuid, created_at ts, updated_at ts, payout_status text, payout_reference text
- Links: created_by→profiles, driver_id→profiles
- Triggers: update_task_updated_at

#### `driver_payroll_base` — 9 rows · 4 policies · 3 indexes
- Columns: id uuid!, driver_id uuid!, base_amount numeric(10,2)!, active bool!, notes text, created_by uuid, created_at ts, updated_at ts, pf_basic numeric(10,2), pf_applicable bool!, esi_override bool, uan text, esi_ip_number text, eps_applicable bool!
- Links: created_by→profiles, driver_id→profiles
- Triggers: update_task_updated_at

#### `driver_payroll_cycles` — 0 rows · 4 policies · 3 indexes
- Columns: id uuid!, period_month int2!, period_year int2!, status text!, notes text, created_by uuid, created_at ts, updated_at ts, payroll_config jsonb
- Links: created_by→profiles
- Triggers: update_task_updated_at

#### `driver_payroll_items` — 0 rows · 4 policies · 2 indexes
- Columns: id uuid!, payroll_id uuid!, label text!, amount numeric(10,2)!, created_at ts
- Links: payroll_id→driver_payroll

#### `driver_payroll_record_items` — 0 rows · 4 policies · 2 indexes
- Columns: id uuid!, record_id uuid!, label text!, amount numeric(10,2)!, created_at ts
- Links: record_id→driver_payroll_records

#### `driver_payroll_records` — 0 rows · 4 policies · 5 indexes
- Columns: id uuid!, cycle_id uuid!, driver_id uuid!, base_amount numeric(10,2)!, status payroll_status!, payout_status text, payout_reference text, notes text, created_by uuid, created_at ts, updated_at ts, working_days_override int, leave_override numeric(5,2), late_override numeric(5,2), pf_amount_override numeric(10,2), esi_amount_override numeric(10,2), half_day_override numeric(5,2)
- Links: created_by→profiles, cycle_id→driver_payroll_cycles, driver_id→profiles
- Triggers: update_task_updated_at

#### `transport_alerts` — 6,805 rows · 4 policies · 11 indexes
- Columns: id uuid!, run_id uuid, route_id uuid, vehicle_id uuid, stop_id uuid, student_id uuid, type transport_alert_type!, severity transport_alert_severity!, status transport_alert_status!, dedupe_key text!, title text!, detail text, metrics jsonb!, lat float8, lng float8, occurrences int!, first_seen_at ts!, last_seen_at ts!, acknowledged_by uuid, acknowledged_at ts, resolved_at ts, resolution_note text, created_at ts!, updated_at ts!, academic_year_id uuid
- Links: academic_year_id→academic_years, acknowledged_by→profiles, route_id→transport_routes, run_id→transport_trip_runs, stop_id→transport_route_stops, student_id→profiles, vehicle_id→transport_vehicles
- Triggers: transport_fill_academic_year, transport_notify_alert, update_task_updated_at

#### `transport_boarding_events` — 0 rows · 4 policies · 5 indexes
- Columns: id int8!, run_id uuid!, student_id uuid!, event transport_boarding_event!, stop_id uuid, occurred_at ts!, method transport_scan_method!, actor_id uuid, lat float8, lng float8, note text, created_at ts!
- Links: actor_id→profiles, run_id→transport_trip_runs, stop_id→transport_route_stops, student_id→profiles

#### `transport_incident_updates` — 0 rows · 1 policy · 3 indexes
- Columns: id uuid!, incident_id uuid!, author_id uuid, kind text!, body text!, created_at ts!
- Links: author_id→profiles, incident_id→transport_incidents

#### `transport_incidents` — 0 rows · 4 policies · 8 indexes
- Columns: id uuid!, run_id uuid, route_id uuid, vehicle_id uuid, type transport_incident_type!, severity transport_alert_severity!, status transport_incident_status!, raised_by uuid, occurred_at ts!, lat float8, lng float8, accuracy_m real, snapshot jsonb!, description text, resolved_at ts, resolved_by uuid, resolution_note text, created_at ts!, updated_at ts!, academic_year_id uuid
- Links: academic_year_id→academic_years, raised_by→profiles, resolved_by→profiles, route_id→transport_routes, run_id→transport_trip_runs, vehicle_id→transport_vehicles
- Triggers: transport_fill_academic_year, update_task_updated_at

#### `transport_route_paths` — 4 rows · 4 policies · 2 indexes
- Columns: route_id uuid!, direction transport_direction!, polyline jsonb!, corridor_m int!, length_m float8, cumulative jsonb, source text!, updated_by uuid, updated_at ts!
- Links: route_id→transport_routes, updated_by→profiles

#### `transport_route_schedules` — 0 rows · 4 policies · 8 indexes
- Columns: id uuid!, route_id uuid!, direction transport_direction!, label text, days_of_week int2[]!, start_time time!, end_time time, vehicle_id uuid, driver_id uuid, attendant_id uuid, auto_start bool!, active_from date, active_to date, active bool!, created_by uuid, created_at ts!, updated_at ts!, academic_year_id uuid
- Links: academic_year_id→academic_years, attendant_id→profiles, created_by→profiles, driver_id→profiles, route_id→transport_routes, vehicle_id→transport_vehicles
- Triggers: transport_fill_academic_year, update_task_updated_at

#### `transport_route_stops` — 22 rows · 4 policies · 2 indexes
- Columns: id uuid!, route_id uuid!, seq int!, name text!, landmark text, lat float8!, lng float8!, radius_m int!, shape text!, polygon jsonb, trusted_accuracy_m int, inbound_offset_min int, outbound_offset_min int, dwell_seconds int!, kind transport_stop_kind!, active bool!, created_at ts!, updated_at ts!
- Links: route_id→transport_routes
- Triggers: update_task_updated_at

#### `transport_routes` — 4 rows · 4 policies · 9 indexes
- Columns: id uuid!, name text!, description text, pickup_time time, drop_time time, default_driver_id uuid, active bool!, created_by uuid, created_at ts, updated_at ts, code text, color text!, default_vehicle_id uuid, default_attendant_id uuid, school_stop_id uuid, settings jsonb!, archived_at ts, direction transport_direction!, fee_mode text, academic_year_id uuid
- Links: academic_year_id→academic_years, created_by→profiles, default_attendant_id→profiles, default_driver_id→profiles, default_vehicle_id→transport_vehicles, school_stop_id→transport_route_stops
- Triggers: transport_fill_academic_year, transport_route_year_cascade, update_task_updated_at

#### `transport_run_metrics` — 0 rows · 1 policy · 5 indexes
- Columns: run_id uuid!, route_id uuid, vehicle_id uuid, driver_id uuid, service_date date!, direction transport_direction!, stops_total int!, stops_arrived int!, stops_on_time int!, stops_late int!, stops_skipped int!, avg_delay_seconds int, max_delay_seconds int, expected_riders int!, boarded_riders int!, excused_riders int!, no_show_riders int!, capacity int, fix_count int!, coverage_pct int2, longest_gap_seconds int, alerts_opened int!, started_late_seconds int, computed_at ts!
- Links: driver_id→profiles, route_id→transport_routes, run_id→transport_trip_runs, vehicle_id→transport_vehicles

#### `transport_run_passengers` — 24 rows · 4 policies · 9 indexes
- Columns: id uuid!, run_id uuid!, student_id uuid!, assignment_id uuid, board_stop_id uuid, alight_stop_id uuid, state transport_boarding_state!, boarded_at ts, alighted_at ts, method transport_scan_method!, excuse_reason text, marked_by uuid, created_at ts!, updated_at ts!
- Links: alight_stop_id→transport_route_stops, assignment_id→transport_student_assignments, board_stop_id→transport_route_stops, marked_by→profiles, run_id→transport_trip_runs, student_id→profiles
- Triggers: transport_notify_boarding, update_task_updated_at

#### `transport_run_stops` — 15 rows · 4 policies · 5 indexes
- Columns: id uuid!, run_id uuid!, stop_id uuid!, seq int!, scheduled_arrival_at ts, eta_at ts, eta_updated_at ts, arrived_at ts, departed_at ts, arrival_source transport_event_source, arrival_verdict text, skipped bool!, expected_boardings int!, actual_boardings int!, delay_seconds int, created_at ts!, updated_at ts!
- Links: run_id→transport_trip_runs, stop_id→transport_route_stops
- Triggers: update_task_updated_at

#### `transport_runtime_config` — 2 rows · 1 policy · 1 index
- Columns: key text!, value text, updated_at ts!

#### `transport_staff` — 1 row · 4 policies · 4 indexes
- Columns: id uuid!, profile_id uuid!, kind transport_staff_kind!, employee_code text, phone text, licence_no text, licence_expiry date, badge_no text, blood_group text, photo_url text, address text, emergency_contact text, verified_at ts, active bool!, notes text, created_by uuid, created_at ts!, updated_at ts!
- Links: created_by→profiles, profile_id→profiles
- Triggers: update_task_updated_at

#### `transport_stop_events` — 24 rows · 4 policies · 5 indexes
- Columns: id int8!, run_id uuid!, run_stop_id uuid, stop_id uuid, event_type transport_stop_event_type!, source transport_event_source!, occurred_at ts!, telemetry_id int8, lat float8, lng float8, distance_m float8, verdict text, actor_id uuid, created_at ts!
- Links: actor_id→profiles, run_id→transport_trip_runs, run_stop_id→transport_run_stops, stop_id→transport_route_stops
- Triggers: transport_notify_stop_event

#### `transport_stop_fees` — 0 rows · 4 policies · 3 indexes
- Columns: stop_id uuid!, route_id uuid!, amount numeric(10,2), amount_one_way numeric(10,2), updated_by uuid, updated_at ts!
- Links: route_id→transport_routes, stop_id→transport_route_stops, updated_by→profiles

#### `transport_stop_metrics` — 0 rows · 1 policy · 2 indexes
- Columns: stop_id uuid!, direction transport_direction!, service_date date!, route_id uuid, arrivals int!, on_time int!, avg_delay_seconds int, max_delay_seconds int, expected_riders int!, boarded_riders int!, computed_at ts!
- Links: route_id→transport_routes, stop_id→transport_route_stops

#### `transport_student_assignments` — 39 rows · 4 policies · 8 indexes
- Columns: id uuid!, route_id uuid!, student_id uuid!, created_at ts, fee_amount numeric(10,2), location_label text, pickup_stop_id uuid, drop_stop_id uuid, rides_inbound bool!, rides_outbound bool!, started_on date!, ended_on date, guardian_phone text, notes text, updated_at ts!, academic_year_id uuid
- Links: academic_year_id→academic_years, drop_stop_id→transport_route_stops, pickup_stop_id→transport_route_stops, route_id→transport_routes, student_id→profiles
- Triggers: transport_fill_academic_year, update_task_updated_at

#### `transport_student_credentials` — 1 row · 4 policies · 4 indexes
- Columns: id uuid!, student_id uuid!, method transport_scan_method!, token_hash text!, label text, active bool!, issued_by uuid, issued_at ts!, revoked_at ts, last_used_at ts
- Links: issued_by→profiles, student_id→profiles

#### `transport_telemetry` — 0 rows · 4 policies · 8 indexes
- Columns: id int8!, run_id uuid, vehicle_id uuid, source_id uuid, source transport_fix_source!, reported_by uuid, lat float8!, lng float8!, accuracy_m real, heading_deg real, speed_kmh real, altitude_m real, satellites int2, ignition bool, odometer_km float8, battery_pct int2, suspect bool!, recorded_at ts!, received_at ts!, raw jsonb
- Links: reported_by→profiles, run_id→transport_trip_runs, source_id→transport_telemetry_sources, vehicle_id→transport_vehicles
- Triggers: transport_apply_fix

#### `transport_telemetry_archive` — 0 rows · 1 policy · 2 indexes
- Columns: run_id uuid!, bucket_at ts!, lat float8!, lng float8!, heading_deg real, speed_kmh real, accuracy_m real, source transport_fix_source!, progress_m float8, off_route_m float8
- Links: run_id→transport_trip_runs

#### `transport_telemetry_sources` — 1 row · 1 policy · 5 indexes
- Columns: id uuid!, kind transport_source_kind!, label text!, vehicle_id uuid, vendor text, external_id text, priority int2!, ingest_key_prefix text, active bool!, last_seen_at ts, last_error text, health jsonb, poll_config jsonb, created_by uuid, created_at ts!, updated_at ts!
- Links: created_by→profiles, vehicle_id→transport_vehicles
- Triggers: update_task_updated_at

#### `transport_trip_runs` — 3 rows · 4 policies · 15 indexes
- Columns: id uuid!, schedule_id uuid, route_id uuid!, direction transport_direction!, service_date date!, status transport_run_status!, vehicle_id uuid, driver_id uuid, attendant_id uuid, scheduled_start_at ts!, scheduled_end_at ts, started_at ts, ended_at ts, last_fix_at ts, last_lat float8, last_lng float8, last_heading_deg real, last_speed_kmh real, telemetry_state transport_telemetry_state!, active_source_id uuid, current_stop_id uuid, next_stop_id uuid, next_stop_eta_at ts, delay_seconds int, progress_m float8, off_route_m float8, open_alert_count int!, replacement_for_run_id uuid, change_note text, cancel_reason text, created_by uuid, created_at ts!, updated_at ts!, academic_year_id uuid
- Links: academic_year_id→academic_years, active_source_id→transport_telemetry_sources, attendant_id→profiles, created_by→profiles, current_stop_id→transport_route_stops, driver_id→profiles, next_stop_id→transport_route_stops, replacement_for_run_id→transport_trip_runs, route_id→transport_routes, schedule_id→transport_route_schedules, vehicle_id→transport_vehicles
- Triggers: transport_fill_academic_year, transport_notify_run_started, update_task_updated_at

#### `transport_vehicles` — 3 rows · 4 policies · 4 indexes
- Columns: id uuid!, registration_no text!, display_name text, make_model text, capacity int!, fuel_type text, status transport_vehicle_status!, insurance_expiry date, fitness_expiry date, permit_expiry date, puc_expiry date, photo_url text, notes text, settings jsonb!, created_by uuid, created_at ts!, updated_at ts!
- Links: created_by→profiles
- Triggers: update_task_updated_at

## 37 · Home, profile and other

#### `feedbacks` — 0 rows · 4 policies · 5 indexes
- Columns: id uuid!, submitted_by uuid!, subject text!, message text!, file_url text, file_name text, file_size int, reply text, replied_by uuid, replied_at ts, created_at ts, updated_at ts
- Links: replied_by→profiles, submitted_by→profiles
- Triggers: update_task_updated_at

#### `user_activity_streaks` — 195 rows · 1 policy · 1 index
- Columns: user_id uuid!, current_streak int!, longest_streak int!, last_open_date date, updated_at ts
- Links: user_id→profiles

## Views

All 17 views are reporting views over the fee and payroll tables. In the rebuild each becomes a query in the owning section (or a summary table kept current on write).

- Fees (14): fee_collection_all, fee_collection_daily, fee_concession_summary, fee_defaulters_by_class, fee_instrument_pipeline, fee_invoices_v, fee_ledger_v, fee_outstanding_aging, fee_payments_v, fee_profiles_v, fee_scholarship_budgets, fee_search_index, fee_staff_collection, fee_year_summary
- Payroll (3): payroll_advance_balances, payroll_leave_available, payroll_loan_balances

## Enum types

SQLite has no enum type. Each becomes `TEXT` with a `CHECK (col IN (...))` constraint, and a TypeScript union generated from the same list.

| Enum | Values |
| --- | --- |
| attendance_status | present, absent, late, on_leave, excused, on_duty, half_day |
| bus_fee_status | unpaid, partial, paid, cancelled |
| bus_payment_method | razorpay, upi_qr, cash, card, bank, cheque |
| bus_payment_status | pending, verified, failed |
| constraint_scope | teacher, homeroom, subject, group, class_teacher |
| constraint_type | time_off, min_per_day, max_per_day, min_per_week, max_per_week, max_in_a_row, pin_class_teacher |
| fee_payment_method | razorpay, upi_qr, cash, card, bank, cheque |
| fee_payment_status | pending, verified, failed |
| fee_status | unpaid, partial, paid, cancelled |
| homeroom_group_kind | subject, custom |
| leave_status | pending, approved, rejected |
| leave_type | casual, medical, on_duty, half_day, late |
| notification_channel | push, whatsapp, sms, email, inapp |
| notification_status | queued, sending, sent, delivered, failed, skipped, cancelled |
| payroll_status | draft, approved, paid |
| room_type | classroom, science_lab, computer_lab, other |
| salary_cycle_status | open, processing, completed |
| staff_attendance_status | present, absent, late, on_leave, wfh, half_day, e |
| timetable_status | draft, published |
| transport_alert_severity | info, warning, critical |
| transport_alert_status | open, acknowledged, resolved, auto_resolved |
| transport_alert_type | delay, deviation, long_stop, wrong_direction, overspeed, no_gps, device_offline, trip_not_started, stop_skipped, student_not_boarded, student_not_dropped, capacity_exceeded, sos |
| transport_boarding_event | board, alight, mark_absent, mark_excused, undo |
| transport_boarding_state | expected, boarded, absent, dropped, no_show, excused |
| transport_direction | inbound, outbound |
| transport_event_source | geofence, manual, device, scheduled |
| transport_fix_source | driver_app, device_push, device_poll, manual, simulated |
| transport_incident_status | open, responding, resolved, false_alarm |
| transport_incident_type | sos, breakdown, accident, medical, security, route_blocked, other |
| transport_run_status | scheduled, boarding, in_progress, completed, cancelled, missed, abandoned |
| transport_scan_method | manual, rfid, nfc, qr, auto |
| transport_source_kind | driver_app, gps_device, vendor_api |
| transport_staff_kind | driver, attendant |
| transport_stop_event_type | arrival, departure, skip |
| transport_stop_kind | stop, school, depot |
| transport_telemetry_state | unknown, live, stale, offline |
| transport_vehicle_status | active, maintenance, retired |

`staff_attendance_status` contains a stray value `e`, added by an old migration; check before reproducing it.

## Functions by section

268 functions in `public`. `*` marks `SECURITY DEFINER` (runs with the owner's rights, bypassing row-level security); "(trigger)" marks trigger functions. Each section doc says what its functions do and where the logic goes in the School object. Functions from the WhatsApp reminders branch (`wa_*`) are not on live and are not listed.

| Section | Functions |
| --- | --- |
| Shared helpers (13) | get_user_role\*, get_server_time\*, update_task_updated_at (trigger), update_updated_at_column (trigger), current_academic_year, current_academic_year_id, academic_year_code_for, academic_year_id_for, ensure_academic_year\*, set_active_academic_year\*, normalize_academic_year_code, normalize_msisdn, zz_probe |
| 17 Messaging and secrets (5) | notify_claim_batch\*, notify_enqueue\*, payment_secrets_read\*, payment_secrets_write\*, cleanup_net_responses\* |
| 20 Users and admin (8) | admin_audit_append_only (trigger), guard_profile_insert\* (trigger), guard_profile_privileged_columns\* (trigger), handle_new_user\* (trigger), handle_profile_delete\* (trigger), sync_role_to_auth_metadata\* (trigger), staff_directory\*, student_roster_facets |
| 21 Settings (3) | is_sensitive_site_setting, site_settings_touch_updated_at (trigger), site_settings_version |
| 22 Academic structure (7) | get_grade_sections_with_students, get_homeroom_classrooms\*, is_homeroom_member\*, my_teammate_ids\*, shares_team_with\*, homeroom_attendance_counts, student_attendance_tally |
| 23 Attendance (23) | ack_forgotten_checkout\*, attendance_config_changed\* (trigger), attendance_day_off_kind\*, attendance_derived_status\*, attendance_effective_cutoffs\*, attendance_effective_fence\*, attendance_failure_class, attendance_haversine_m, attendance_location_verdict, attendance_minute_of_day, attendance_no_position_verdict, attendance_polygon_signed_distance_m, attendance_queue_recompute\*, attendance_recompute_pending\*, attendance_rule_changed\* (trigger), attendance_rule_member_changed\* (trigger), attendance_timezone\*, cleanup_attendance_location_attempts\*, force_attendance_marked_by\* (trigger), guard_attendance_location_columns\* (trigger), recompute_staff_attendance_dates\*, staff_attendance_punch\*, get_monthly_member_stats\* (shared with tasks) |
| 24 Leave (4) | is_own_leave_application\*, mark_leave_application_viewed\*, mark_leave_applications_viewed\*, sync_leave_application_status\* |
| 25 Announcements and push (7) | announcement_ids_addressed_to_me, announcement_ids_for_staff_audience, announcement_ids_for_student_audience, count_unread_announcements, get_announcement_feed, get_unread_announcements, cleanup_stale_push_subscriptions\* |
| 26 Tasks (6) | task_stats_rows_for_user, task_unread_comment_count, tasks_bonus_for_user, tasks_for_user_week, tasks_overdue_for_user, record_app_open\* |
| 27 Smartboard (6) | get_homeroom_announcement_feed, is_homeroom_smartboard\*, is_smartboard_account\*, is_smartboard_of_student\*, restrict_smartboard_homeroom_update (trigger), set_smartboard_banner\* |
| 28 Classrooms (15) | _assert_classroom_staff\*, _classroom_edu_earned\*, classroom_manager_page, classroom_member_counts, get_classroom_edu_leaderboard\*, get_classroom_edu_month_summary\*, get_classroom_edu_monthly\*, get_classroom_edu_top3\*, get_classroom_homework_edu_top3\*, get_student_edu_dashboard\*, get_student_edu_standings\*, is_classroom_member\*, is_classroom_staff\*, user_is_classroom_member\*, owns_submission\* |
| 29 Exams (11) | can_manage_exam\*, exam_answers_guard (trigger), exam_debug_whoami\*, exam_set_created_by (trigger), exam_submissions_guard (trigger), get_exam_questions_for_student\*, is_exam_owner\*, is_exam_student\*, reorder_exam_questions, student_can_review_exam\*, submission_exam_id\* |
| 30 Grades and report cards (5) | can_publish_report_cards\*, get_classroom_assessment_trend\*, recompute_assessment_component_totals\*, tg_component_mark_recompute\* (trigger), tg_component_sync_assessment\* (trigger) |
| 31 Timetable (1) | replace_timetable_entries |
| 33 Fees (83) | apply_fee_permission_preset\*, fee_actor, fee_actor_can\*, fee_add_fine\*, fee_alloc_refresh (trigger), fee_apply_concession\*, fee_audit_append_only (trigger), fee_autogen_tick\*, fee_bill_register, fee_carry_forward\*, fee_cell_locked, fee_claim_outbox\*, fee_clone_grid\*, fee_clone_year\*, fee_collect\*, fee_collection_by_head, fee_compute_late_fee, fee_contact_msisdn, fee_create_profiles\*, fee_decide_concession\*, fee_decide_refund\*, fee_delete_charge\*, fee_ensure_profile\*, fee_generate_invoices\*, fee_grade_groups_no_overlap (trigger), fee_guard_permission_lockout (trigger), fee_import_bus_ledger\*, fee_instrument_transition\*, fee_invoice_lines_refresh (trigger), fee_is_service_context, fee_issue_blockers\*, fee_issue_charge\*, fee_issue_grid\*, fee_issue_transport\*, fee_kick_drain\*, fee_late_fee_sweep\*, fee_ledger_append_only (trigger), fee_log\*, fee_mark_overdue\*, fee_may_message, fee_months_guard (trigger), fee_next_number\*, fee_norm_gender, fee_overdue_tick\*, fee_pay_refund\*, fee_payment_status_refresh (trigger), fee_payments_immutable (trigger), fee_payments_no_delete (trigger), fee_post_ledger\*, fee_queue_reminder\*, fee_rates_guard_lock (trigger), fee_receipt_payload, fee_record_rte\*, fee_refresh_invoice\*, fee_refresh_structure_total (trigger), fee_reminder_tick\*, fee_remove_concession\*, fee_request_refund\*, fee_requires\*, fee_resolve_pay_link\*, fee_reverse_payment\*, fee_row_students\*, fee_save_charge\*, fee_save_setting\*, fee_seal_receipt\*, fee_set_charge_optional\*, fee_set_late_fee_rule_enabled\*, fee_set_rates\*, fee_setting, fee_settings_freeze_published (trigger), fee_students_by_msisdn\*, fee_sync_transport_heads\*, fee_transport_head\*, fee_undo_issue\*, fee_v2_guard_issued_parent (trigger), fee_verify_document\*, fee_visible_amount (2 overloads), fee_waive_fine\*, fee_waive_late_fee\*, has_fee_permission\*, has_fee_permission_for\*, my_fee_permissions\* |
| 34 Payroll and salary (18) | driver_cycle_tallies, driver_payroll_record_belongs_to_me\*, generate_driver_payroll_cycle\*, generate_salary_cycle\*, payroll_allow_payout_update\* (trigger), payroll_belongs_to_me\*, payroll_events_append_only (trigger), payroll_line_is_mine_and_final\*, payroll_lock_run\*, payroll_reject_locked_write\* (trigger), payroll_repayments_guard\* (trigger), payroll_resolve_rule_set\*, payroll_rule_sets_freeze_published (trigger), payroll_run_is_locked\*, payroll_runs_guard_status (trigger), payroll_verify_lock\*, salary_cycle_tallies, salary_record_belongs_to_me\* |
| 36 Transport (53) | is_trip_driver\*, is_trip_passenger\*, cleanup_transport_archive\*, cleanup_transport_telemetry\*, transport_academic_year_for\*, transport_apply_fix\* (trigger), transport_archive_telemetry\*, transport_clear_alert\*, transport_copy_year\*, transport_end_run\*, transport_fill_academic_year\* (trigger), transport_gtfs_realtime\*, transport_gtfs_static\*, transport_humanise_gap, transport_is_crew\*, transport_is_transport_staff\*, transport_issue_credential\*, transport_kick_drain\*, transport_mark_boarding\*, transport_materialise_runs\*, transport_notify_alert\* (trigger), transport_notify_boarding\* (trigger), transport_notify_run_started\* (trigger), transport_notify_stop_event\* (trigger), transport_notify_student\*, transport_point_to_path_m, transport_process_fix\*, transport_raise_alert\*, transport_raise_incident\*, transport_recompute_eta\*, transport_register_card\*, transport_replay_run\*, transport_report_attendance_mismatch\*, transport_report_delay_by_stop\*, transport_report_gps_health\*, transport_report_ontime\*, transport_report_utilisation\*, transport_resolve_moot_alerts\*, transport_rollup_metrics\*, transport_route_counts, transport_route_has_crew\*, transport_route_is_mine\*, transport_route_year_cascade\* (trigger), transport_run_is_mine\*, transport_scan_boarding\*, transport_simulate_day\*, transport_simulation_clear\*, transport_start_run\*, transport_stop_is_mine\*, transport_student_contact\*, transport_tick\*, transport_today_snapshot\*, transport_watch_outbox\* |

## Scheduled jobs (`pg_cron`)

All times UTC. IST = UTC + 5:30.

| Job | Schedule | Calls | Owning section |
| --- | --- | --- | --- |
| transport-tick | every minute | transport_tick() | 36 |
| transport-notify-drain | every minute | transport_kick_drain() (pg_net call to the drain route) | 36 / 14 |
| fee-drain | every minute | fee_kick_drain() (pg_net call to the drain route) | 33 / 14 |
| transport-watch-outbox | every 15 min | transport_watch_outbox() | 36 |
| transport-materialise-runs | 21:30 daily (03:00 IST) | transport_materialise_runs(tomorrow in school time zone) | 36 |
| fee-autogen | 20:30 daily (02:00 IST) | fee_autogen_tick() | 33 |
| fee-overdue | 21:00 daily (02:30 IST) | fee_overdue_tick() | 33 |
| fee-reminders | 04:30 daily (10:00 IST) | fee_reminder_tick() | 33 |
| transport-archive-telemetry | 02:30 daily | transport_archive_telemetry() | 36 |
| cleanup-transport-telemetry | 03:00 daily | cleanup_transport_telemetry() | 36 |
| cleanup-transport-archive | 03:15 daily | cleanup_transport_archive() | 36 |
| cleanup-net-responses | 03:20 daily | cleanup_net_responses() | 14 |
| transport-rollup-metrics | 03:45 daily | transport_rollup_metrics() | 36 |
| cleanup-attendance-location-attempts | 04:00 daily | cleanup_attendance_location_attempts() | 23 |
| cleanup-stale-push-subscriptions | 05:00 daily | cleanup_stale_push_subscriptions() | 25 |

## Realtime, storage and extensions

| Feature | Live configuration |
| --- | --- |
| Realtime publication `supabase_realtime` | leave_applications, leave_approvals, transport_trip_runs, transport_run_stops, transport_run_passengers, transport_alerts |
| Storage buckets | `classroom-files` (628 objects, ~996 MB), `feedback-files` (2 objects, ~0.7 MB) |
| Extensions | plpgsql, pg_stat_statements, uuid-ossp, pgcrypto, supabase_vault, pg_cron, pg_net, btree_gist |
