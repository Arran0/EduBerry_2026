'use client'

import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react'
import {
  MessageSquare, Send, Trash2, Paperclip,
  Link2, Image as ImageIcon, FileText, ExternalLink, X, Plus, Download,
} from 'lucide-react'
import {
  DiscussionPost, createDiscussionPost, fetchDiscussionPosts, deleteDiscussionPost,
  uploadDiscussionFile,
} from '@/lib/classrooms'
import { UserRole } from '@/lib/supabase'
import Avatar from '@/components/Avatar'
import { useAuth } from '@/contexts/AuthContext'
import { useBottomNav } from '@/contexts/BottomNavContext'
import { safeHref } from '@/lib/safeUrl'
import { askConfirm, tellUser } from '@/components/ui/sheet'
import { DiscussionSkeleton } from '@/components/classrooms/ClassroomSkeletons'

const ATTACH_MARKER = '__ATTACH__'

type AttachInfo = { url: string; name: string; type: 'image' | 'document' | 'link' }
type AttachMode  = 'none' | 'link' | 'file'

function encodeAttach(info: AttachInfo): string {
  return `${ATTACH_MARKER}${JSON.stringify(info)}`
}

function parsePost(raw: string): { text: string; attach: AttachInfo | null } {
  const idx = raw.indexOf(ATTACH_MARKER)
  if (idx === -1) return { text: raw, attach: null }
  const text = raw.slice(0, idx).trimEnd()
  try {
    const attach = JSON.parse(raw.slice(idx + ATTACH_MARKER.length)) as AttachInfo
    return { text, attach }
  } catch {
    return { text: raw, attach: null }
  }
}

interface DiscussionTabProps {
  classroomId: string
  userId: string
  userRole: UserRole
}

// ── Time helpers ──
function timeShort(dateStr: string): string {
  return new Date(dateStr).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
}

function fullStamp(dateStr: string): string {
  const d = new Date(dateStr)
  const now = new Date()
  const sameDay = d.toDateString() === now.toDateString()
  const yest = new Date(now); yest.setDate(now.getDate() - 1)
  const isYest = d.toDateString() === yest.toDateString()
  const t = timeShort(dateStr)
  if (sameDay) return `Today at ${t}`
  if (isYest) return `Yesterday at ${t}`
  return `${d.toLocaleDateString([], { month: 'short', day: 'numeric' })} at ${t}`
}

function dayLabel(dateStr: string): string {
  const d = new Date(dateStr)
  const now = new Date()
  if (d.toDateString() === now.toDateString()) return 'Today'
  const yest = new Date(now); yest.setDate(now.getDate() - 1)
  if (d.toDateString() === yest.toDateString()) return 'Yesterday'
  return d.toLocaleDateString([], { weekday: 'long', month: 'long', day: 'numeric' })
}

const IMAGE_EXTS = ['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'bmp']
function isImageUrl(url: string): boolean {
  const ext = (url.split('.').pop() || '').toLowerCase().split('?')[0]
  return IMAGE_EXTS.includes(ext)
}

function AttachDisplay({ attach }: { attach: AttachInfo }) {
  const isImage = attach.type === 'image' || (attach.type === 'document' && isImageUrl(attach.url))
  if (isImage) {
    return (
      <a href={safeHref(attach.url)} target="_blank" rel="noopener noreferrer" className="block mt-1.5 w-fit">
        <img
          src={attach.url}
          alt={attach.name}
          className="max-h-64 max-w-full rounded-lg border border-slate-200 object-cover hover:brightness-95 transition cursor-pointer"
        />
      </a>
    )
  }
  if (attach.type === 'link') {
    return (
      <a
        href={safeHref(attach.url)}
        target="_blank"
        rel="noopener noreferrer"
        className="inline-flex items-center gap-1.5 mt-1.5 px-3 py-1.5 bg-blue-50 rounded-lg text-xs text-blue-600 hover:bg-blue-100 transition-colors border border-blue-100 max-w-full"
      >
        <ExternalLink size={12} className="flex-shrink-0" />
        <span className="min-w-0 break-words">{attach.name || attach.url}</span>
      </a>
    )
  }
  return (
    <a
      href={safeHref(attach.url)}
      target="_blank"
      rel="noopener noreferrer"
      className="group/file inline-flex items-center gap-2.5 mt-1.5 pl-2.5 pr-3 py-2 bg-slate-50 rounded-xl text-slate-700 hover:bg-slate-100 transition-colors border border-slate-200 max-w-full"
    >
      <span className="flex-shrink-0 w-8 h-8 rounded-lg bg-teal-100 flex items-center justify-center">
        <FileText size={15} className="text-teal-600" />
      </span>
      <span className="min-w-0">
        <span className="min-w-0 block text-xs font-medium break-words max-w-[200px]">{attach.name || 'Document'}</span>
        <span className="block text-[10px] text-slate-400">Tap to open</span>
      </span>
      <Download size={13} className="flex-shrink-0 text-slate-300 group-hover/file:text-teal-600 transition-colors" />
    </a>
  )
}

function MessageBody({ content }: { content: string }) {
  const { text, attach } = parsePost(content)
  return (
    <>
      {text && (
        <span className="min-w-0 text-[15px] text-slate-700 whitespace-pre-wrap break-words leading-snug">{text}</span>
      )}
      {attach && <AttachDisplay attach={attach} />}
    </>
  )
}

// A render unit: consecutive messages from the same author within the window.
type MsgGroup = { key: string; user_id: string; user?: DiscussionPost['user']; messages: DiscussionPost[] }

const GROUP_WINDOW_MS = 5 * 60 * 1000

export default function DiscussionTab({ classroomId, userId, userRole }: DiscussionTabProps) {
  const { profile: currentUserProfile } = useAuth()
  const { setBottomNavHidden }          = useBottomNav()
  const [posts, setPosts]               = useState<DiscussionPost[]>([])
  const [loading, setLoading]           = useState(true)
  const [newPostContent, setNewPostContent] = useState('')
  const [posting, setPosting]           = useState(false)
  const bottomRef    = useRef<HTMLDivElement>(null)
  // Message input is a contentEditable div (not a <textarea>) so iOS Safari does
  // not show its form-accessory bar (the prev/next/Done toolbar above the
  // keyboard), which the Form Assistant only attaches to real form controls.
  const editorRef    = useRef<HTMLDivElement>(null)

  const [attachMode, setAttachMode]         = useState<AttachMode>('none')
  const [attachLinkUrl, setAttachLinkUrl]   = useState('')
  const [attachLinkName, setAttachLinkName] = useState('')
  const [attachFile, setAttachFile]         = useState<File | null>(null)
  const [filePreview, setFilePreview]       = useState<string | null>(null)
  const [uploading, setUploading]           = useState(false)
  const [showAttachMenu, setShowAttachMenu] = useState(false)
  const [dragOver, setDragOver]             = useState(false)
  // Height the soft keyboard occludes — the fixed compose bar's `bottom` tracks
  // this so it rides above the keyboard (positioned against the visual viewport).
  const [kbHeight, setKbHeight]             = useState(0)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const canModerate = ['coordinator', 'principal', 'admin'].includes(userRole)

  // ── Flatten the threaded tree into a single chronological stream (Discord-style). ──
  const messages = useMemo(() => {
    const flat: DiscussionPost[] = []
    for (const p of posts) {
      flat.push(p)
      if (p.replies?.length) flat.push(...p.replies)
    }
    return flat.sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime())
  }, [posts])

  // ── Group consecutive messages by the same author within a short window. ──
  const groups = useMemo<MsgGroup[]>(() => {
    const out: MsgGroup[] = []
    for (const m of messages) {
      const last = out[out.length - 1]
      const prevTime = last ? new Date(last.messages[last.messages.length - 1].created_at).getTime() : 0
      const sameAuthor = last && last.user_id === m.user_id
      const inWindow = new Date(m.created_at).getTime() - prevTime < GROUP_WINDOW_MS
      // Don't merge across day boundaries.
      const sameDay = last && new Date(last.messages[0].created_at).toDateString() === new Date(m.created_at).toDateString()
      if (sameAuthor && inWindow && sameDay) {
        last.messages.push(m)
      } else {
        out.push({ key: m.id, user_id: m.user_id, user: m.user, messages: [m] })
      }
    }
    return out
  }, [messages])

  // Initial load (shows the skeleton once)
  const loadPosts = useCallback(async () => {
    setLoading(true)
    const data = await fetchDiscussionPosts(classroomId)
    setPosts(data)
    setLoading(false)
  }, [classroomId])

  // Silent background refresh — never sets loading, no flash
  const refreshPosts = useCallback(async () => {
    const data = await fetchDiscussionPosts(classroomId)
    setPosts(data)
  }, [classroomId])

  useEffect(() => { loadPosts() }, [loadPosts])

  // Hide the global mobile BottomNav while the discussion is open so the
  // fixed compose bar owns the bottom of the screen; restore it on unmount.
  useEffect(() => {
    setBottomNavHidden(true)
    return () => setBottomNavHidden(false)
  }, [setBottomNavHidden])

  // Position the compose bar against the *visual* viewport so it sits directly
  // above the soft keyboard instead of being hidden behind it. The keyboard
  // height is the slice of the layout viewport the visual viewport no longer
  // covers (`innerHeight − vv.height − vv.offsetTop`).
  useEffect(() => {
    const vv = window.visualViewport
    if (!vv) return
    let raf = 0
    const update = () => {
      raf = 0
      const keyboardHeight = window.innerHeight - vv.height - vv.offsetTop
      setKbHeight(Math.max(keyboardHeight, 0))
    }
    const schedule = () => { if (!raf) raf = requestAnimationFrame(update) }
    vv.addEventListener('resize', schedule)
    vv.addEventListener('scroll', schedule)
    update()
    return () => {
      if (raf) cancelAnimationFrame(raf)
      vv.removeEventListener('resize', schedule)
      vv.removeEventListener('scroll', schedule)
    }
  }, [])

  // Keep the latest message visible above the bar as the keyboard opens/closes.
  useEffect(() => {
    if (kbHeight > 0) {
      const t = setTimeout(() => bottomRef.current?.scrollIntoView({ behavior: 'smooth' }), 80)
      return () => clearTimeout(t)
    }
  }, [kbHeight])

  useEffect(() => {
    if (!loading) bottomRef.current?.scrollIntoView({ behavior: 'auto' })
  }, [loading])

  // Local preview for an image file attachment.
  useEffect(() => {
    if (attachFile && attachFile.type.startsWith('image/')) {
      const url = URL.createObjectURL(attachFile)
      setFilePreview(url)
      return () => URL.revokeObjectURL(url)
    }
    setFilePreview(null)
  }, [attachFile])

  const resetAttach = () => {
    setAttachMode('none')
    setAttachLinkUrl('')
    setAttachLinkName('')
    setAttachFile(null)
    setShowAttachMenu(false)
  }

  const pickFile = (mode: 'image' | 'any') => {
    setShowAttachMenu(false)
    setAttachMode('file')
    if (fileInputRef.current) {
      fileInputRef.current.accept = mode === 'image'
        ? 'image/*'
        : 'image/*,.pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.txt'
      fileInputRef.current.click()
    }
  }

  const attachDroppedFile = (file: File) => {
    setAttachMode('file')
    setAttachFile(file)
    setShowAttachMenu(false)
    editorRef.current?.focus()
  }

  const buildContent = async (): Promise<string | null> => {
    let attachInfo: AttachInfo | null = null
    if (attachMode === 'file' && attachFile) {
      setUploading(true)
      const res = await uploadDiscussionFile(attachFile, classroomId, userId)
      setUploading(false)
      if (!res) { tellUser('Upload failed', 'The file did not upload. Try again.'); return null }
      attachInfo = res
    } else if (attachMode === 'link' && attachLinkUrl.trim()) {
      if (!safeHref(attachLinkUrl)) { tellUser('That link cannot be shared', 'Use a web address that starts with https://.'); return null }
      attachInfo = { url: attachLinkUrl.trim(), name: attachLinkName.trim() || attachLinkUrl.trim(), type: 'link' }
    }
    const base = newPostContent.trim()
    if (!base && !attachInfo) return null
    return base + (attachInfo ? (base ? '\n' : '') + encodeAttach(attachInfo) : '')
  }

  const handlePost = async (e?: React.FormEvent) => {
    e?.preventDefault()
    const content = await buildContent()
    if (!content) return

    // ── Optimistic update: message appears instantly ──
    const tempId = `opt-${Date.now()}`
    const optimisticPost: DiscussionPost = {
      id: tempId,
      classroom_id: classroomId,
      user_id: userId,
      content,
      parent_id: null,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      user: currentUserProfile ?? undefined,
      replies: [],
    }
    setPosts(prev => [...prev, optimisticPost])
    setNewPostContent('')
    resetAttach()
    // Clear the contentEditable (uncontrolled) and keep focus for the next message.
    if (editorRef.current) editorRef.current.innerHTML = ''
    setTimeout(() => bottomRef.current?.scrollIntoView({ behavior: 'smooth' }), 30)
    editorRef.current?.focus()

    // ── Background API call ──
    setPosting(true)
    const result = await createDiscussionPost(classroomId, userId, content)
    setPosting(false)
    if (result) {
      await refreshPosts()
    } else {
      setPosts(prev => prev.filter(p => p.id !== tempId))
    }
  }

  const handleDelete = async (postId: string) => {
    if (!(await askConfirm({ title: 'Delete this message?', danger: true, body: 'It is removed for everyone in the classroom.' }))) return
    // Optimistic delete (top-level or reply)
    setPosts(prev =>
      prev.filter(p => p.id !== postId).map(p =>
        ({ ...p, replies: (p.replies ?? []).filter(r => r.id !== postId) })
      )
    )
    await deleteDiscussionPost(postId)
    await refreshPosts()
  }

  // ── Paste an image straight into the composer → upload it. ──
  const handlePaste = (e: React.ClipboardEvent) => {
    const file = Array.from(e.clipboardData.files).find(f => f.type.startsWith('image/'))
    if (file) {
      e.preventDefault()
      attachDroppedFile(file)
      return
    }
    // Otherwise keep pasted content plain text (no rich HTML in the bubble).
    e.preventDefault()
    const text = e.clipboardData.getData('text/plain')
    document.execCommand('insertText', false, text)
  }

  // The BottomNav is already hidden above, so the skeleton draws the compose
  // bar in its place — the screen is the right shape before a message lands.
  if (loading) return <DiscussionSkeleton withComposer />

  const canSubmit =
    (newPostContent.trim() || attachMode !== 'none') &&
    !(attachMode === 'link' && !attachLinkUrl.trim()) &&
    !(attachMode === 'file' && !attachFile) &&
    !posting && !uploading

  return (
    <div
      className="relative pb-24"
      onDragOver={(e) => { if (e.dataTransfer.types.includes('Files')) { e.preventDefault(); setDragOver(true) } }}
      onDragLeave={(e) => { if (e.currentTarget === e.target) setDragOver(false) }}
      onDrop={(e) => {
        if (e.dataTransfer.files.length) {
          e.preventDefault()
          setDragOver(false)
          attachDroppedFile(e.dataTransfer.files[0])
        }
      }}
    >
      {/* ── Drag-and-drop overlay ── */}
      {dragOver && (
        <div className="absolute inset-0 z-40 rounded-2xl border-2 border-dashed border-teal-400 bg-teal-50/80 backdrop-blur-sm flex flex-col items-center justify-center pointer-events-none">
          <Paperclip size={26} className="text-teal-500 mb-2" />
          <p className="text-sm font-semibold text-teal-700">Drop to share a file</p>
        </div>
      )}

      {/* ── Header ── */}
      <div className="flex items-center gap-2.5 mb-4 ">
        <div className="p-2 bg-teal-100 rounded-xl">
          <MessageSquare size={16} className="text-teal-600" />
        </div>
        <div>
          <h2 className="font-semibold text-slate-800 text-sm leading-tight">Discussion</h2>
          <p className="text-xs text-slate-500 leading-tight">
            {messages.length} {messages.length === 1 ? 'message' : 'messages'}
          </p>
        </div>
      </div>

      {/* ── Chat stream ── */}
      <div className="bg-white border border-slate-200 rounded-2xl shadow-sm">
        <div className="px-2.5 sm:px-3 py-3">

          {/* Empty state */}
          {groups.length === 0 && (
            <div className="flex flex-col items-center justify-center py-16 text-center">
              <div className="w-16 h-16 bg-teal-50 rounded-2xl flex items-center justify-center mb-4">
                <MessageSquare size={28} className="text-teal-300" />
              </div>
              <p className="text-slate-700 font-semibold mb-1">No messages yet</p>
              <p className="text-slate-600 text-sm">Start the conversation — share a note, file or link.</p>
            </div>
          )}

          {groups.map((group, gi) => {
            const first = group.messages[0]
            const prev = groups[gi - 1]
            const showDayDivider =
              !prev || new Date(prev.messages[0].created_at).toDateString() !== new Date(first.created_at).toDateString()
            const isMine = group.user_id === userId

            return (
              <React.Fragment key={group.key}>
                {showDayDivider && (
                  <div className="flex items-center gap-3 px-2 my-3 select-none">
                    <div className="flex-1 h-px bg-slate-100" />
                    <span className="text-[11px] font-semibold text-slate-600 uppercase tracking-wide">
                      {dayLabel(first.created_at)}
                    </span>
                    <div className="flex-1 h-px bg-slate-100" />
                  </div>
                )}

                <div className="group/grp flex items-start gap-3 px-2 pt-2.5 pb-1 rounded-xl hover:bg-slate-50/70 transition-colors">
                  <Avatar
                    avatarUrl={group.user?.avatar_url}
                    name={group.user?.full_name}
                    size={38}
                    userId={group.user?.id}
                    className="flex-shrink-0 mt-0.5"
                  />
                  <div className="flex-1 min-w-0">
                    {/* Author + first timestamp */}
                    <div className="flex items-baseline gap-2">
                      <span className="text-sm font-semibold text-slate-800 leading-tight">
                        {group.user?.full_name || 'Unknown'}
                        {isMine && <span className="ml-1.5 text-[10px] font-semibold text-teal-600">you</span>}
                      </span>
                      <span className="text-[11px] text-slate-500">{fullStamp(first.created_at)}</span>
                    </div>

                    {/* Stacked messages in this group */}
                    <div className="mt-0.5 space-y-0.5">
                      {group.messages.map((m) => {
                        const canDelete = m.user_id === userId || canModerate
                        const sending = m.id.startsWith('opt-')
                        return (
                          <div
                            key={m.id}
                            className={`group/msg relative flex items-start ${sending ? 'opacity-60' : ''}`}
                          >
                            <div className="flex-1 min-w-0 pr-7">
                              <MessageBody content={m.content} />
                            </div>
                            {canDelete && !sending && (
                              <button
                                onClick={() => handleDelete(m.id)}
                                title="Delete message"
                                className="absolute right-0 top-0 p-1.5 rounded-lg text-slate-300 hover:text-red-500 hover:bg-red-50 transition md:opacity-0 md:group-hover/msg:opacity-100"
                              >
                                <Trash2 size={13} />
                              </button>
                            )}
                          </div>
                        )
                      })}
                    </div>
                  </div>
                </div>
              </React.Fragment>
            )
          })}

          <div ref={bottomRef} />
        </div>
      </div>

      {/* ── Compose bar — fixed and positioned against the visual viewport so it
            rides above the soft keyboard; aligned to the page's content column. ── */}
      <div
        className="fixed inset-x-0 z-30 pointer-events-none transition-[bottom] duration-150 ease-out"
        style={{ bottom: kbHeight }}
      >
        <div
          className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 pt-2"
          style={{ paddingBottom: kbHeight > 0 ? '0.5rem' : 'max(env(safe-area-inset-bottom), 0.5rem)' }}
        >
        <div
          className="pointer-events-auto rounded-3xl overflow-visible"
          style={{
            background: '#ffffff',
            boxShadow: '0 2px 16px -4px rgba(0,0,0,0.12), 0 0 0 1px rgba(148,163,184,0.16)',
          }}
        >
          <form onSubmit={handlePost} className="px-3 pt-3 pb-3.5">

            {/* Link attachment row */}
            {attachMode === 'link' && (
              <div className="flex gap-2 mb-2.5">
                <input
                  type="url"
                  inputMode="url"
                  autoComplete="off"
                  autoCorrect="off"
                  autoCapitalize="off"
                  spellCheck={false}
                  value={attachLinkUrl}
                  onChange={e => setAttachLinkUrl(e.target.value)}
                  placeholder="https://…"
                  autoFocus
                  className="flex-1 border border-slate-200 rounded-2xl px-3.5 py-2 text-xs focus:outline-none focus:ring-2 focus:ring-teal-400/30 bg-slate-50"
                />
                <input
                  type="text"
                  inputMode="text"
                  autoComplete="off"
                  value={attachLinkName}
                  onChange={e => setAttachLinkName(e.target.value)}
                  placeholder="Label (optional)"
                  className="w-28 border border-slate-200 rounded-2xl px-3.5 py-2 text-xs focus:outline-none focus:ring-2 focus:ring-teal-400/30 bg-slate-50"
                />
                <button type="button" onClick={resetAttach} className="px-2 text-slate-300 hover:text-rose-400 transition-colors">
                  <X size={15} />
                </button>
              </div>
            )}

            {/* File attachment preview chip */}
            {attachMode === 'file' && attachFile && (
              <div className="flex items-center gap-2.5 mb-2.5 p-2 bg-slate-50 border border-slate-200 rounded-2xl">
                {filePreview
                  ? <img src={filePreview} alt="" className="w-10 h-10 rounded-lg object-cover flex-shrink-0" />
                  : <span className="w-10 h-10 rounded-lg bg-teal-100 flex items-center justify-center flex-shrink-0">
                      <FileText size={16} className="text-teal-600" />
                    </span>
                }
                <span className="flex-1 min-w-0">
                  <span className="min-w-0 block text-xs font-medium text-slate-700 break-words">{attachFile.name}</span>
                  <span className="block text-[10px] text-slate-400">{(attachFile.size / 1024).toFixed(0)} KB</span>
                </span>
                <button type="button" onClick={resetAttach} className="p-1.5 text-slate-400 hover:text-rose-500 hover:bg-rose-50 rounded-lg transition-colors">
                  <X size={15} />
                </button>
              </div>
            )}

            {/* Main input row */}
            <div className="flex items-end gap-2">

              {/* Attach (+) button with popover menu */}
              <div className="relative flex-shrink-0">
                {showAttachMenu && (
                  <>
                    <div className="fixed inset-0 z-10" onClick={() => setShowAttachMenu(false)} />
                    <div className="absolute bottom-11 left-0 z-20 w-44 bg-white !rounded-2xl border border-slate-100 shadow-lg overflow-hidden py-1">
                      <button type="button" onClick={() => pickFile('image')} className="w-full flex items-center gap-2.5 px-3.5 py-2.5 text-sm text-slate-700 hover:bg-slate-50 transition-colors">
                        <ImageIcon size={15} className="text-teal-500" /> Photo
                      </button>
                      <button type="button" onClick={() => pickFile('any')} className="w-full flex items-center gap-2.5 px-3.5 py-2.5 text-sm text-slate-700 hover:bg-slate-50 transition-colors">
                        <FileText size={15} className="text-blue-500" /> Document
                      </button>
                      <button type="button" onClick={() => { setShowAttachMenu(false); setAttachMode('link') }} className="w-full flex items-center gap-2.5 px-3.5 py-2.5 text-sm text-slate-700 hover:bg-slate-50 transition-colors">
                        <Link2 size={15} className="text-indigo-500" /> Link
                      </button>
                    </div>
                  </>
                )}
                <button
                  type="button"
                  onClick={() => setShowAttachMenu(s => !s)}
                  className={`w-9 h-9 flex items-center justify-center !rounded-full transition-all ${
 showAttachMenu || attachMode !== 'none'
 ? 'bg-teal-100 text-teal-600'
 : 'bg-slate-100 text-slate-400 hover:bg-slate-200 hover:text-slate-600'
 }`}
                  title="Share a file or link"
                >
                  <Plus size={18} className={`transition-transform ${showAttachMenu ? 'rotate-45' : ''}`} />
                </button>
              </div>

              <input
                ref={fileInputRef}
                type="file"
                className="hidden"
                onChange={e => setAttachFile(e.target.files?.[0] || null)}
              />

              {/* Input bubble */}
              <div className="flex-1 min-w-0 bg-slate-50/90 border border-slate-200/70 !rounded-[22px] px-4 py-2 focus-within:border-teal-400/60 focus-within:ring-2 focus-within:ring-teal-400/15 focus-within:bg-white transition-all">
                <div
                  ref={editorRef}
                  role="textbox"
                  aria-multiline="true"
                  aria-label="Message"
                  contentEditable
                  suppressContentEditableWarning
                  data-placeholder="Message…"
                  inputMode="text"
                  enterKeyHint="enter"
                  autoCapitalize="sentences"
                  autoCorrect="on"
                  onInput={(e) => {
                    const el = e.currentTarget
                    // Safari leaves a lone <br> after a full delete; normalise it
                    // so the `:empty` placeholder shows again.
                    if (!el.innerText.trim() && el.innerHTML !== '') el.innerHTML = ''
                    setNewPostContent(el.innerText)
                  }}
                  onPaste={handlePaste}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && !e.shiftKey) {
                      e.preventDefault()
                      if (e.currentTarget.innerText.trim() || attachMode === 'file' || attachMode === 'link') handlePost()
                    }
                  }}
                  className="discussion-editor flex-1 bg-transparent text-[15px] focus:outline-none leading-relaxed text-slate-800 min-w-0 overflow-y-auto whitespace-pre-wrap break-words"
                  style={{ maxHeight: '120px', minHeight: '24px' }}
                />
              </div>

              {/* Send button */}
              <button
                type="submit"
                disabled={!canSubmit}
                className="flex-shrink-0 w-9 h-9 flex items-center justify-center bg-gradient-to-br from-teal-400 to-teal-600 hover:from-teal-500 hover:to-teal-700 active:scale-95 text-white !rounded-full transition-all disabled:opacity-30 shadow-md shadow-teal-200/60"
              >
                {posting || uploading
                  ? <div className="w-4 h-4 border-2 border-white/40 border-t-white rounded-full animate-spin" />
                  : <Send size={15} className="-translate-x-px" />
                }
              </button>
            </div>

          </form>
        </div>
        </div>
      </div>
    </div>
  )
}
