import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import type { SupabaseClient } from '@supabase/supabase-js'
import webpush from 'web-push'
import { adminClient, callerUserId } from '@/lib/serverAuth'

/**
 * Send the Web Push notification for a newly created announcement.
 *
 * Called by the create form right after the announcement lands. Runs with the
 * service role because it has to look up recipients across every profile — but
 * only after checking that the caller actually authored this announcement (or
 * is a principal/admin), so this cannot be used to spam the school.
 */

const STAFF_ROLES = ['teacher', 'coordinator', 'principal', 'admin']

interface AudienceRow {
  grade: number | null
  section: string | null
  all_students: boolean
  team_id: string | null
  all_teams: boolean
  user_id: string | null
}

/** Resolve audience rows to the set of user ids that should be notified. */
async function resolveRecipients(
  client: SupabaseClient,
  audiences: AudienceRow[],
): Promise<Set<string>> {
  const recipients = new Set<string>()
  const add = (ids: { id: string }[] | null) => (ids ?? []).forEach(r => recipients.add(r.id))

  const wantsAllStudents = audiences.some(a => a.all_students)
  const wantsAllStaff    = audiences.some(a => a.all_teams)

  if (wantsAllStudents) {
    const { data } = await client.from('profiles').select('id').eq('role', 'student').neq('is_banned', true)
    add(data)
  }

  if (wantsAllStaff) {
    const { data } = await client.from('profiles').select('id').in('role', STAFF_ROLES).neq('is_banned', true)
    add(data)
  }

  // Grade / section targeting — only for rows that aren't already covered
  if (!wantsAllStudents) {
    for (const aud of audiences) {
      if (aud.grade == null) continue
      let q = client.from('profiles').select('id').eq('role', 'student').eq('grade', aud.grade)
      if (aud.section) q = q.eq('section', aud.section)
      const { data } = await q
      add(data)
    }
  }

  // Team targeting
  if (!wantsAllStaff) {
    const teamIds = audiences.map(a => a.team_id).filter((id): id is string => !!id)
    if (teamIds.length > 0) {
      const { data } = await client.from('team_members').select('user_id').in('team_id', teamIds)
      ;(data ?? []).forEach(r => recipients.add(r.user_id))
    }
  }

  // Individually addressed members
  for (const aud of audiences) {
    if (aud.user_id) recipients.add(aud.user_id)
  }

  return recipients
}

/** One-line preview of the announcement body for the notification. */
function preview(content: string, max = 140): string {
  const flat = content.replace(/\s+/g, ' ').trim()
  return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat
}

export async function POST(request: NextRequest) {
  const publicKey  = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY
  const privateKey = process.env.VAPID_PRIVATE_KEY
  const subject    = process.env.VAPID_SUBJECT || 'mailto:admin@eduberry.app'

  const client = adminClient()
  if (!client) {
    return NextResponse.json({ success: false, error: 'Server configuration error' }, { status: 500 })
  }

  const callerId = await callerUserId(client, request)
  if (!callerId) {
    return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 })
  }

  const body = await request.json().catch(() => null)
  const announcementId = body?.announcementId
  if (typeof announcementId !== 'string' || !announcementId) {
    return NextResponse.json({ success: false, error: 'Missing announcementId' }, { status: 400 })
  }

  // ── Authorise: only the author, or a principal/admin, may notify ──
  const { data: announcement } = await client
    .from('announcements')
    .select('id, title, content, created_by')
    .eq('id', announcementId)
    .single()

  if (!announcement) {
    return NextResponse.json({ success: false, error: 'Announcement not found' }, { status: 404 })
  }

  const { data: callerProfile } = await client
    .from('profiles')
    .select('role, full_name')
    .eq('id', callerId)
    .single()

  const isPrivileged = callerProfile?.role === 'principal' || callerProfile?.role === 'admin'
  if (announcement.created_by !== callerId && !isPrivileged) {
    return NextResponse.json({ success: false, error: 'Not your announcement' }, { status: 403 })
  }

  // Push is optional infrastructure — without keys the announcement itself is
  // still fine, so report the skip rather than failing the caller.
  if (!publicKey || !privateKey) {
    return NextResponse.json({ success: true, sent: 0, skipped: 'VAPID keys not configured' })
  }
  webpush.setVapidDetails(subject, publicKey, privateKey)

  // ── Who should hear about it ──
  const { data: audiences } = await client
    .from('announcement_audiences')
    .select('grade, section, all_students, team_id, all_teams, user_id')
    .eq('announcement_id', announcementId)

  const recipients = await resolveRecipients(client, (audiences ?? []) as AudienceRow[])
  recipients.delete(announcement.created_by)   // never notify the author of their own notice

  if (recipients.size === 0) {
    return NextResponse.json({ success: true, sent: 0 })
  }

  const { data: subscriptions } = await client
    .from('push_subscriptions')
    .select('id, endpoint, p256dh, auth')
    .in('user_id', [...recipients])

  if (!subscriptions || subscriptions.length === 0) {
    return NextResponse.json({ success: true, sent: 0 })
  }

  const payload = JSON.stringify({
    title: announcement.title,
    body: preview(announcement.content),
    url: `/announcements#announcement-${announcement.id}`,
    tag: `announcement-${announcement.id}`,
  })

  const staleIds: string[] = []
  let sent = 0

  await Promise.all(subscriptions.map(async sub => {
    try {
      await webpush.sendNotification(
        { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
        payload,
      )
      sent++
    } catch (err) {
      // 404/410 mean the browser threw the subscription away — prune it so the
      // table doesn't fill with devices that can never be reached again.
      const status = (err as { statusCode?: number }).statusCode
      if (status === 404 || status === 410) staleIds.push(sub.id)
      else console.warn('Push send failed:', status, (err as Error).message)
    }
  }))

  if (staleIds.length > 0) {
    await client.from('push_subscriptions').delete().in('id', staleIds)
  }

  return NextResponse.json({ success: true, sent, pruned: staleIds.length })
}
