'use client'

import React, { useEffect, useRef, useState } from 'react'
import { MessageSquare, Save, Loader2, Trash2 } from 'lucide-react'
import { ReportCardRemark, upsertRemark, deleteRemark } from '@/lib/classrooms'
import { UserProfile } from '@/lib/supabase'
import Avatar from '@/components/Avatar'
import { useKeyboardInset } from '@/hooks/useKeyboardInset'

/**
 * The remarks a report card carries, and the box for writing one.
 *
 * Shared by the Academics report card and the full-page academic record, which
 * had byte-similar copies of this whole panel.
 *
 * On a phone the composer docks directly above the soft keyboard while it is
 * focused, the way the classroom discussion's compose bar does. The app runs
 * with `interactiveWidget: 'resizes-visual'`, so the keyboard shrinks only the
 * visual viewport and a box sitting in the page flow is simply covered by it —
 * you end up typing into something you cannot see. `--keyboard-anchor` (see
 * useKeyboardInset) is the visual-viewport bottom edge in the coordinates a
 * fixed element's `top` is measured against, so pinning `top` there and pulling
 * back a full height puts the box's bottom edge exactly on the keyboard.
 */

interface RemarksPanelProps {
  remarks: ReportCardRemark[]
  studentId: string
  reportCardTitle: string
  viewerId: string
  viewer?: UserProfile
  canEdit: boolean
  onChanged: () => void
}

export default function RemarksPanel({
  remarks, studentId, reportCardTitle, viewerId, viewer, canEdit, onChanged,
}: RemarksPanelProps) {
  const myRemark = remarks.find(r => r.author_id === viewerId)
  const others = remarks.filter(r => r.author_id !== viewerId)

  const [draft, setDraft] = useState(myRemark?.remark ?? '')
  const [saving, setSaving] = useState(false)
  const [savedFlash, setSavedFlash] = useState(false)
  const [editing, setEditing] = useState(false)
  const [focused, setFocused] = useState(false)
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  const { open: keyboardOpen, isMobile } = useKeyboardInset()
  // Only while the box actually has the keyboard up: on a tablet or desktop it
  // stays exactly where it was written into the page.
  const docked = focused && keyboardOpen && isMobile

  useEffect(() => { setDraft(myRemark?.remark ?? '') }, [myRemark?.remark])

  const handleSave = async () => {
    if (saving) return
    setSaving(true)
    await upsertRemark(studentId, reportCardTitle, viewerId, draft)
    setSaving(false)
    setSavedFlash(true)
    setEditing(false)
    textareaRef.current?.blur()
    setTimeout(() => setSavedFlash(false), 1800)
    onChanged()
  }

  const handleDelete = async () => {
    if (!myRemark) return
    if (!confirm('Delete your remark?')) return
    setSaving(true)
    await deleteRemark(myRemark.id)
    setSaving(false)
    setDraft('')
    setEditing(false)
    onChanged()
  }

  const composer = (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        <Avatar avatarUrl={viewer?.avatar_url} name={viewer?.full_name ?? 'You'} size={24} userId={viewerId} />
        <p className="text-xs font-semibold text-slate-700 truncate">{viewer?.full_name ?? 'Your remark'}</p>
        <span className="text-[10px] px-1.5 py-0.5 bg-slate-100 text-slate-600 rounded-full uppercase tracking-wide font-bold">
          {viewer?.role ?? 'Staff'}
        </span>
        {docked && (
          <button
            onClick={() => textareaRef.current?.blur()}
            className="ml-auto text-[11px] font-semibold text-slate-500 hover:text-slate-800 px-1.5"
          >
            Done
          </button>
        )}
      </div>
      <textarea
        ref={textareaRef}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        placeholder={`Add a remark for ${reportCardTitle}…`}
        // Two lines while docked so the keyboard, the box and a little of the
        // card behind it all fit; the usual three when it sits in the page.
        rows={docked ? 2 : 3}
        className="w-full border border-slate-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-slate-300 resize-none"
      />
      <div className="flex items-center gap-2">
        <div className="flex-1" />
        {myRemark && (
          <button
            // onMouseDown, not onClick: a click would first blur the textarea,
            // undock the bar and move it out from under the finger.
            onMouseDown={(e) => { e.preventDefault(); setEditing(false); setDraft(myRemark.remark) }}
            className="text-xs text-slate-500 hover:text-slate-700 font-medium px-1.5"
          >
            Cancel
          </button>
        )}
        <button
          onMouseDown={(e) => e.preventDefault()}
          onClick={handleSave}
          disabled={saving || !draft.trim()}
          className="flex items-center gap-1.5 px-3 py-1.5 bg-slate-600 hover:bg-slate-700 text-white rounded-lg text-xs font-semibold transition-colors disabled:opacity-50"
        >
          {saving ? <Loader2 size={12} className="animate-spin" /> : <Save size={12} />}
          {saving ? 'Saving…' : myRemark ? 'Update remark' : 'Post remark'}
        </button>
      </div>
    </div>
  )

  return (
    <div className="px-3 py-3 sm:px-5 sm:py-4 bg-slate-50 border-t border-slate-200">
      <div className="flex items-center gap-2 mb-2.5">
        <MessageSquare size={13} className="text-slate-500" />
        <h4 className="text-[11px] font-bold uppercase tracking-widest text-slate-600">Remarks</h4>
        <span className="text-[10px] text-slate-400">
          {remarks.length} {remarks.length === 1 ? 'comment' : 'comments'}
        </span>
      </div>

      {others.length > 0 && (
        <div className="space-y-2 mb-2.5">
          {others.map(r => <RemarkBubble key={r.id} remark={r} />)}
        </div>
      )}

      {canEdit ? (
        !editing && myRemark ? (
          <div className="rounded-xl border border-slate-200 bg-white p-2.5">
            <RemarkBubble remark={myRemark} self />
            <div className="flex items-center gap-2 mt-2">
              <button
                onClick={() => setEditing(true)}
                className="text-xs text-slate-600 hover:text-slate-900 font-medium transition-colors"
              >
                Edit
              </button>
              <button
                onClick={handleDelete}
                disabled={saving}
                className="text-xs text-slate-400 hover:text-rose-500 font-medium flex items-center gap-1 disabled:opacity-60 transition-colors"
              >
                <Trash2 size={11} /> Delete
              </button>
              {savedFlash && <span className="text-xs text-slate-500 font-medium">Saved ✓</span>}
            </div>
          </div>
        ) : (
          <>
            {/* Holds the composer's place in the card while it is docked, so
                nothing below it jumps up and back. */}
            {docked && <div aria-hidden className="h-[132px]" />}
            {docked && (
              <div
                onMouseDown={() => textareaRef.current?.blur()}
                className="fixed inset-0 z-[60] bg-slate-900/25"
              />
            )}
            <div
              className={docked
                ? 'fixed left-0 right-0 z-[61] px-3 pt-2.5 pb-2 bg-white border-t border-slate-200 shadow-[0_-10px_30px_rgba(15,23,42,0.18)]'
                : 'rounded-xl border border-slate-200 bg-white p-2.5'}
              style={docked
                ? { top: 'var(--keyboard-anchor, 100%)', transform: 'translateY(-100%)' }
                : undefined}
            >
              {composer}
            </div>
          </>
        )
      ) : (
        remarks.length === 0 && <p className="text-xs text-slate-400 italic">No remarks yet.</p>
      )}
    </div>
  )
}

function RemarkBubble({ remark, self = false }: { remark: ReportCardRemark; self?: boolean }) {
  const author = remark.author
  const date = new Date(remark.updated_at || remark.created_at)
  return (
    <div className={`flex items-start gap-2.5 p-2.5 rounded-xl ${self ? 'bg-slate-100/70' : 'bg-white border border-slate-100'}`}>
      <Avatar avatarUrl={author?.avatar_url} name={author?.full_name ?? 'Staff'} size={26} userId={remark.author_id} />
      <div className="flex-1 min-w-0">
        <div className="flex items-baseline gap-2 flex-wrap">
          <p className="text-xs font-semibold text-slate-700 truncate">{author?.full_name ?? 'Staff'}</p>
          {author?.role && (
            <span className="text-[9px] px-1.5 py-0.5 bg-slate-100 text-slate-500 rounded-full uppercase tracking-wide font-bold">
              {author.role}
            </span>
          )}
          <span className="text-[10px] text-slate-400">
            {date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
          </span>
        </div>
        <p className="text-sm text-slate-700 mt-0.5 whitespace-pre-wrap leading-relaxed">{remark.remark}</p>
      </div>
    </div>
  )
}
