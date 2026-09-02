import type { SupabaseClient } from '@supabase/supabase-js'

/**
 * The full server-side procedure for removing a staff/student account:
 * clear every foreign key that would otherwise block the profile delete,
 * delete the profile, then delete the auth user. Shared by the plain
 * "delete user" route and the "convert to support staff" route — the second
 * ends the same way the first does (the account is gone either way), and the
 * FK cleanup list is exactly the kind of thing that silently drifts if kept
 * in two places.
 *
 * Callers are expected to have already done anything account-specific that
 * has to happen BEFORE the account disappears (e.g. copying details into
 * support_staff) — this function only ever removes.
 */
export async function deleteUserAccountServerSide(
  adminClient: SupabaseClient,
  userId: string,
  reassignCreatedByTo: string,
  serviceRoleKey: string | undefined,
): Promise<{ success: boolean; error?: string }> {
  // Tasks this user created are deleted outright rather than handed to
  // whoever is performing the removal — reassigning created_by used to dump
  // the departed staffer's entire task backlog (including anything awaiting
  // verification or overdue) onto them. task_assignees, task_checklist_items
  // and task_comments all cascade-delete with the task.
  const { error: taskDeleteError } = await adminClient.from('tasks').delete().eq('created_by', userId)
  if (taskDeleteError) {
    console.error('Failed to delete tasks created by removed user:', taskDeleteError.message)
  }

  // Reassign remaining records created by this user to satisfy NOT NULL
  // foreign key constraints on created_by/user_id columns before the profile
  // row can go.
  const reassignTables: { table: string; column: string }[] = [
    { table: 'classrooms', column: 'created_by' },
    { table: 'classroom_folders', column: 'created_by' },
    { table: 'classroom_files', column: 'created_by' },
    { table: 'classroom_assessments', column: 'created_by' },
    { table: 'task_comments', column: 'user_id' },
    { table: 'projects', column: 'created_by' },
    { table: 'announcements', column: 'created_by' },
  ]

  for (const { table, column } of reassignTables) {
    const { error } = await adminClient
      .from(table)
      .update({ [column]: reassignCreatedByTo })
      .eq(column, userId)
    if (error) {
      console.error(`Failed to reassign ${table}.${column}:`, error.message)
    }
  }

  // Nullify nullable FK references to this profile that have no ON DELETE
  // action. These columns reference profiles without CASCADE or SET NULL, so
  // they must be cleared before the profile row can be deleted.
  const nullifyTables: { table: string; column: string }[] = [
    { table: 'subtasks', column: 'assignee_id' },
    { table: 'subtasks', column: 'created_by' },
    { table: 'feedbacks', column: 'replied_by' },
  ]

  for (const { table, column } of nullifyTables) {
    const { error } = await adminClient
      .from(table)
      .update({ [column]: null })
      .eq(column, userId)
    if (error) {
      console.error(`Failed to nullify ${table}.${column}:`, error.message)
    }
  }

  const { error: profileDeleteError } = await adminClient.from('profiles').delete().eq('id', userId)
  if (profileDeleteError) {
    return { success: false, error: `Failed to delete profile: ${profileDeleteError.message}` }
  }

  if (serviceRoleKey) {
    const { error } = await adminClient.auth.admin.deleteUser(userId)
    if (error) {
      // Profile is already gone; auth user removal failed — not critical.
      console.error('Auth user deletion failed:', error.message)
    }
  }

  return { success: true }
}
