-- ============================================================
-- Indexes for the 77 unindexed foreign keys flagged by the Supabase
-- performance advisor (confirmed live via get_advisors). Fixes both
-- suboptimal FK-join performance and the sequential-scan storm in
-- handle_profile_delete (fix_safe_user_delete_no_admin_task_dump.sql),
-- which runs 12 UPDATE/DELETE statements against 9 of these exact columns
-- on BEFORE DELETE of a profile.
-- ============================================================

CREATE INDEX IF NOT EXISTS idx_announcement_likes_user_id ON public.announcement_likes(user_id);
CREATE INDEX IF NOT EXISTS idx_announcements_created_by ON public.announcements(created_by);
CREATE INDEX IF NOT EXISTS idx_attendance_day_timings_created_by ON public.attendance_day_timings(created_by);
CREATE INDEX IF NOT EXISTS idx_attendance_geofence_zones_created_by ON public.attendance_geofence_zones(created_by);
CREATE INDEX IF NOT EXISTS idx_attendance_holidays_created_by ON public.attendance_holidays(created_by);
CREATE INDEX IF NOT EXISTS idx_attendance_location_attempts_zone_id ON public.attendance_location_attempts(zone_id);
CREATE INDEX IF NOT EXISTS idx_attendance_records_leave_application_id ON public.attendance_records(leave_application_id);
CREATE INDEX IF NOT EXISTS idx_attendance_records_marked_by ON public.attendance_records(marked_by);
CREATE INDEX IF NOT EXISTS idx_bus_fee_drafts_created_by ON public.bus_fee_drafts(created_by);
CREATE INDEX IF NOT EXISTS idx_bus_fee_drafts_fee_head_id ON public.bus_fee_drafts(fee_head_id);
CREATE INDEX IF NOT EXISTS idx_bus_fee_heads_created_by ON public.bus_fee_heads(created_by);
CREATE INDEX IF NOT EXISTS idx_bus_fees_created_by ON public.bus_fees(created_by);
CREATE INDEX IF NOT EXISTS idx_bus_locations_driver_id ON public.bus_locations(driver_id);
CREATE INDEX IF NOT EXISTS idx_bus_payments_payer_id ON public.bus_payments(payer_id);
CREATE INDEX IF NOT EXISTS idx_bus_payments_verified_by ON public.bus_payments(verified_by);
CREATE INDEX IF NOT EXISTS idx_bus_trips_created_by ON public.bus_trips(created_by);
CREATE INDEX IF NOT EXISTS idx_calendar_access_granted_by ON public.calendar_access(granted_by);
CREATE INDEX IF NOT EXISTS idx_certificate_templates_created_by ON public.certificate_templates(created_by);
CREATE INDEX IF NOT EXISTS idx_certificates_issued_by ON public.certificates(issued_by);
CREATE INDEX IF NOT EXISTS idx_classroom_assessments_created_by ON public.classroom_assessments(created_by);
CREATE INDEX IF NOT EXISTS idx_classroom_discussions_user_id ON public.classroom_discussions(user_id);
CREATE INDEX IF NOT EXISTS idx_classroom_files_created_by ON public.classroom_files(created_by);
CREATE INDEX IF NOT EXISTS idx_classroom_folders_created_by ON public.classroom_folders(created_by);
CREATE INDEX IF NOT EXISTS idx_classrooms_created_by ON public.classrooms(created_by);
CREATE INDEX IF NOT EXISTS idx_driver_payroll_created_by ON public.driver_payroll(created_by);
CREATE INDEX IF NOT EXISTS idx_driver_payroll_base_created_by ON public.driver_payroll_base(created_by);
CREATE INDEX IF NOT EXISTS idx_driver_payroll_cycles_created_by ON public.driver_payroll_cycles(created_by);
CREATE INDEX IF NOT EXISTS idx_driver_payroll_records_created_by ON public.driver_payroll_records(created_by);
CREATE INDEX IF NOT EXISTS idx_exam_answers_graded_by ON public.exam_answers(graded_by);
CREATE INDEX IF NOT EXISTS idx_exam_graders_added_by ON public.exam_graders(added_by);
CREATE INDEX IF NOT EXISTS idx_exam_result_links_assessment_id ON public.exam_result_links(assessment_id);
CREATE INDEX IF NOT EXISTS idx_exam_result_links_linked_by ON public.exam_result_links(linked_by);
CREATE INDEX IF NOT EXISTS idx_exam_submissions_graded_by ON public.exam_submissions(graded_by);
CREATE INDEX IF NOT EXISTS idx_exam_templates_source_exam_id ON public.exam_templates(source_exam_id);
CREATE INDEX IF NOT EXISTS idx_fee_heads_created_by ON public.fee_heads(created_by);
CREATE INDEX IF NOT EXISTS idx_feedbacks_replied_by ON public.feedbacks(replied_by);
CREATE INDEX IF NOT EXISTS idx_homerooms_created_by ON public.homerooms(created_by);
CREATE INDEX IF NOT EXISTS idx_leave_application_views_user_id ON public.leave_application_views(user_id);
CREATE INDEX IF NOT EXISTS idx_leave_approvals_team_id ON public.leave_approvals(team_id);
CREATE INDEX IF NOT EXISTS idx_projects_created_by ON public.projects(created_by);
CREATE INDEX IF NOT EXISTS idx_report_card_remarks_author_id ON public.report_card_remarks(author_id);
CREATE INDEX IF NOT EXISTS idx_report_card_titles_created_by ON public.report_card_titles(created_by);
CREATE INDEX IF NOT EXISTS idx_salary_cycles_created_by ON public.salary_cycles(created_by);
CREATE INDEX IF NOT EXISTS idx_salary_records_created_by ON public.salary_records(created_by);
CREATE INDEX IF NOT EXISTS idx_school_fee_payments_payer_id ON public.school_fee_payments(payer_id);
CREATE INDEX IF NOT EXISTS idx_school_fee_payments_verified_by ON public.school_fee_payments(verified_by);
CREATE INDEX IF NOT EXISTS idx_school_fees_created_by ON public.school_fees(created_by);
CREATE INDEX IF NOT EXISTS idx_smartboard_tasks_created_by ON public.smartboard_tasks(created_by);
CREATE INDEX IF NOT EXISTS idx_staff_attendance_records_leave_application_id ON public.staff_attendance_records(leave_application_id);
CREATE INDEX IF NOT EXISTS idx_staff_attendance_records_marked_by ON public.staff_attendance_records(marked_by);
CREATE INDEX IF NOT EXISTS idx_staff_bank_accounts_created_by ON public.staff_bank_accounts(created_by);
CREATE INDEX IF NOT EXISTS idx_staff_salary_base_created_by ON public.staff_salary_base(created_by);
CREATE INDEX IF NOT EXISTS idx_subtask_comments_author_id ON public.subtask_comments(author_id);
CREATE INDEX IF NOT EXISTS idx_subtasks_created_by ON public.subtasks(created_by);
CREATE INDEX IF NOT EXISTS idx_task_comments_user_id ON public.task_comments(user_id);
CREATE INDEX IF NOT EXISTS idx_tasks_completed_by ON public.tasks(completed_by);
CREATE INDEX IF NOT EXISTS idx_teacher_unavailability_slot_id ON public.teacher_unavailability(slot_id);
CREATE INDEX IF NOT EXISTS idx_timetable_combined_classes_created_by ON public.timetable_combined_classes(created_by);
CREATE INDEX IF NOT EXISTS idx_timetable_combined_classes_room_id ON public.timetable_combined_classes(room_id);
CREATE INDEX IF NOT EXISTS idx_timetable_combined_classes_subject_id ON public.timetable_combined_classes(subject_id);
CREATE INDEX IF NOT EXISTS idx_timetable_combined_classes_teacher_id ON public.timetable_combined_classes(teacher_id);
CREATE INDEX IF NOT EXISTS idx_timetable_configs_created_by ON public.timetable_configs(created_by);
CREATE INDEX IF NOT EXISTS idx_timetable_constraints_created_by ON public.timetable_constraints(created_by);
CREATE INDEX IF NOT EXISTS idx_timetable_constraints_homeroom_id ON public.timetable_constraints(homeroom_id);
CREATE INDEX IF NOT EXISTS idx_timetable_constraints_slot_id ON public.timetable_constraints(slot_id);
CREATE INDEX IF NOT EXISTS idx_timetable_entries_group_id ON public.timetable_entries(group_id);
CREATE INDEX IF NOT EXISTS idx_timetable_entries_room_id ON public.timetable_entries(room_id);
CREATE INDEX IF NOT EXISTS idx_timetable_entries_slot_id ON public.timetable_entries(slot_id);
CREATE INDEX IF NOT EXISTS idx_timetable_entries_subject_id ON public.timetable_entries(subject_id);
CREATE INDEX IF NOT EXISTS idx_timetable_homeroom_groups_created_by ON public.timetable_homeroom_groups(created_by);
CREATE INDEX IF NOT EXISTS idx_timetable_homeroom_groups_subject_id ON public.timetable_homeroom_groups(subject_id);
CREATE INDEX IF NOT EXISTS idx_timetable_requirements_subject_id ON public.timetable_requirements(subject_id);
CREATE INDEX IF NOT EXISTS idx_timetable_rooms_created_by ON public.timetable_rooms(created_by);
CREATE INDEX IF NOT EXISTS idx_timetable_subjects_created_by ON public.timetable_subjects(created_by);
CREATE INDEX IF NOT EXISTS idx_timetables_created_by ON public.timetables(created_by);
CREATE INDEX IF NOT EXISTS idx_trip_attendance_marked_by ON public.trip_attendance(marked_by);
CREATE INDEX IF NOT EXISTS idx_trip_driver_overrides_created_by ON public.trip_driver_overrides(created_by);

NOTIFY pgrst, 'reload schema';
