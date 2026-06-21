'use client'

import React, { useState, useEffect, useCallback, useRef } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import {
  MessageSquare, Send, Reply, Trash2, Paperclip,
  Link2, Image as ImageIcon, FileText, ExternalLink, X, ChevronDown,
} from 'lucide-react'
import {
  DiscussionPost, createDiscussionPost, fetchDiscussionPosts, deleteDiscussionPost,
  uploadDiscussionFile,
} from '@/lib/classrooms'
import { UserRole } from '@/lib/supabase'
import Avatar from '@/components/Avatar'
import { useAuth } from '@/contexts/AuthContext'
import { useKeyboardInset } from '@/hooks/useKeyboardInset'

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

function timeAgo(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime()
  const mins = Math.floor(diff / 60000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins}m ago`
  const hours = Math.floor(mins / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.floor(hours / 24)
  if (days < 7) return `${days}d ago`
  return new Date(dateStr).toLocaleDateString()
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
      <a href={attach.url} target="_blank" rel="noopener noreferrer" className="block mt-2">
        <img
          src={attach.url}
          alt={attach.name}
          className="max-h-52 rounded-xl border border-slate-200 object-cover hover:opacity-90 transition-opacity cursor-pointer shadow-sm"
        />
      </a>
    )
  }
  if (attach.type === 'link') {
    return (
      <a
        href={attach.url}
        target="_blank"
        rel="noopener noreferrer"
        className="inline-flex items-center gap-1.5 mt-2 px-3 py-1.5 bg-blue-50 rounded-lg text-xs text-blue-600 hover:bg-blue-100 transition-colors border border-blue-100"
      >
        <ExternalLink size={11} /> {attach.name || attach.url}
      </a>
    )
  }
  return (
    <a
      href={attach.url}
      target="_blank"
      rel="noopener noreferrer"
      className="inline-flex items-center gap-1.5 mt-2 px-3 py-1.5 bg-slate-100 rounded-lg text-xs text-slate-600 hover:bg-slate-200 transition-colors border border-slate-200"
    >
      <FileText size={11} /> {attach.name || 'Document'}
    </a>
  )
}

function PostContent({ content }: { content: string }) {
  const { text, attach } = parsePost(content)
  return (
    <div>
      {text && <p className="text-sm text-slate-700 mt-1 whitespace-pre-wrap leading-relaxed">{text}</p>}
      {attach && <AttachDisplay attach={attach} />}
    </div>
  )
}

export default function DiscussionTab({ classroomId, userId, userRole }: DiscussionTabProps) {
  const { profile: currentUserProfile } = useAuth()
  const [posts, setPosts]               = useState<DiscussionPost[]>([])
  const [loading, setLoading]           = useState(true)
  const [newPostContent, setNewPostContent] = useState('')
  const [replyTo, setReplyTo]           = useState<string | null>(null)
  const [replyContent, setReplyContent] = useState('')
  const [posting, setPosting]           = useState(false)
  const [expandedReplies, setExpandedReplies] = useState<Set<string>>(new Set())
  const bottomRef    = useRef<HTMLDivElement>(null)
  // Message input is a contentEditable div (not a <textarea>) so iOS Safari does
  // not show its form-accessory bar (the prev/next/Done toolbar above the
  // keyboard), which the Form Assistant only attaches to real form controls.
  const editorRef    = useRef<HTMLDivElement>(null)
  const composeRef   = useRef<HTMLDivElement>(null)

  // Soft-keyboard tracking (shared hook — also keeps `--keyboard-inset` live).
  const { open: keyboardOpen, isMobile } = useKeyboardInset()
  const kbOpen = isMobile && keyboardOpen
  const [composeH, setComposeH] = useState(0)

  const [attachMode, setAttachMode]         = useState<AttachMode>('none')
  const [attachLinkUrl, setAttachLinkUrl]   = useState('')
  const [attachLinkName, setAttachLinkName] = useState('')
  const [attachFile, setAttachFile]         = useState<File | null>(null)
  const [uploading, setUploading]           = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const canDelete = ['coordinator', 'principal', 'admin'].includes(userRole)

  // Initial load (shows spinner once)
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

  useEffect(() => {
    if (!loading) {
      bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
    }
  }, [loading])

  // ── Keyboard-aware compose bar ──
  // iOS Safari (esp. iOS 26) shifts `position: fixed; bottom: 0` elements
  // unpredictably once the keyboard opens — they drift up and leave a gap. The
  // robust fix is to anchor the bar to the *visual* viewport instead: when the
  // keyboard is open the bar is `fixed`, its `top` set to the live
  // `--keyboard-anchor` (the visual-viewport bottom edge in layout coords) and
  // then lifted by its own height via `translateY(-100%)`, so its bottom edge
  // sits exactly on the keyboard. We also hide the BottomNav while typing so it
  // doesn't ride up into the bar. At rest the bar is inline in the message flow.
  //
  // When the bar becomes `fixed` it leaves the document flow, so we reserve an
  // equal-height spacer below the messages — that keeps the latest message
  // scrollable into view above the bar instead of being covered by it.
  useEffect(() => {
    if (!kbOpen) return
    setComposeH(composeRef.current?.offsetHeight ?? 0)
    // Keep the latest message visible above the freshly pinned bar.
    const t = setTimeout(() => bottomRef.current?.scrollIntoView({ behavior: 'smooth' }), 80)
    return () => clearTimeout(t)
  }, [kbOpen])

  const buildContent = async (): Promise<string | null> => {
    let attachInfo: AttachInfo | null = null
    if (attachMode === 'file' && attachFile) {
      setUploading(true)
      const res = await uploadDiscussionFile(attachFile, classroomId, userId)
      setUploading(false)
      if (!res) { alert('Upload failed, please try again.'); return null }
      attachInfo = res
    } else if (attachMode === 'link' && attachLinkUrl.trim()) {
      attachInfo = { url: attachLinkUrl.trim(), name: attachLinkName.trim() || attachLinkUrl.trim(), type: 'link' }
    }
    const base = newPostContent.trim()
    if (!base && !attachInfo) return null
    return base + (attachInfo ? (base ? '\n' : '') + encodeAttach(attachInfo) : '')
  }

  const resetAttach = () => {
    setAttachMode('none')
    setAttachLinkUrl('')
    setAttachLinkName('')
    setAttachFile(null)
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
      // Silently replace optimistic post with real data
      await refreshPosts()
    } else {
      // Roll back
      setPosts(prev => prev.filter(p => p.id !== tempId))
    }
  }

  const handleReply = async (parentId: string) => {
    if (!replyContent.trim()) return
    const content = replyContent.trim()

    // ── Optimistic update ──
    const tempId = `opt-reply-${Date.now()}`
    const optimisticReply: DiscussionPost = {
      id: tempId,
      classroom_id: classroomId,
      user_id: userId,
      content,
      parent_id: parentId,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      user: currentUserProfile ?? undefined,
      replies: [],
    }
    setReplyContent('')
    setReplyTo(null)
    setExpandedReplies(prev => new Set([...prev, parentId]))
    setPosts(prev => prev.map(p =>
      p.id === parentId ? { ...p, replies: [...(p.replies ?? []), optimisticReply] } : p
    ))

    // ── Background API call ──
    setPosting(true)
    const result = await createDiscussionPost(classroomId, userId, content, parentId)
    setPosting(false)
    if (result) {
      await refreshPosts()
    } else {
      // Roll back the reply
      setPosts(prev => prev.map(p =>
        p.id === parentId
          ? { ...p, replies: (p.replies ?? []).filter(r => r.id !== tempId) }
          : p
      ))
    }
  }

  const handleDelete = async (postId: string) => {
    if (!confirm('Delete this post?')) return
    // Optimistic delete
    setPosts(prev =>
      prev.filter(p => p.id !== postId).map(p =>
        ({ ...p, replies: (p.replies ?? []).filter(r => r.id !== postId) })
      )
    )
    await deleteDiscussionPost(postId)
    // Silent sync (in case of failure, this restores the post)
    await refreshPosts()
  }

  const toggleReplies = (postId: string) => {
    setExpandedReplies(prev => {
      const next = new Set(prev)
      if (next.has(postId)) next.delete(postId)
      else next.add(postId)
      return next
    })
  }

  if (loading) {
    return (
      <div className="text-center py-16">
        <div className="spinner mx-auto mb-3" />
        <p className="text-sm text-slate-500">Loading discussion…</p>
      </div>
    )
  }

  const canSubmit =
    (newPostContent.trim() || attachMode !== 'none') &&
    !(attachMode === 'link' && !attachLinkUrl.trim()) &&
    !(attachMode === 'file' && !attachFile) &&
    !posting && !uploading

  return (
    <div className="relative">

      {/* ── Header ── */}
      <div className="flex items-center gap-2.5 mb-4">
        <div className="p-2 bg-teal-100 rounded-xl">
          <MessageSquare size={16} className="text-teal-600" />
        </div>
        <div>
          <h2 className="font-semibold text-slate-800 text-sm leading-tight">Discussion</h2>
          <p className="text-xs text-slate-400 leading-tight">{posts.length} {posts.length === 1 ? 'post' : 'posts'}</p>
        </div>
      </div>

      {/* ── Posts + inline compose ── */}
      <div className="space-y-3">

        {/* Empty state */}
        {posts.length === 0 && (
          <div className="flex flex-col items-center justify-center py-16 text-center">
            <div className="w-16 h-16 bg-teal-50 rounded-2xl flex items-center justify-center mb-4">
              <MessageSquare size={28} className="text-teal-300" />
            </div>
            <p className="text-slate-600 font-medium mb-1">No discussions yet</p>
            <p className="text-slate-400 text-sm">Be the first to start a conversation!</p>
          </div>
        )}

        {posts.map((post) => {
          const replyCount = post.replies?.length ?? 0
          const showReplies = expandedReplies.has(post.id)

          return (
            <div
              key={post.id}
              className="bg-white rounded-2xl border border-slate-100 shadow-sm overflow-hidden"
            >
              {/* ── Post body ── */}
              <div className="p-4">
                <div className="flex items-start gap-3">
                  <Avatar
                    avatarUrl={post.user?.avatar_url}
                    name={post.user?.full_name}
                    size={36}
                    userId={post.user?.id}
                    className="flex-shrink-0 ring-2 ring-white shadow-sm"
                  />
                  <div className="flex-1 min-w-0">
                    {/* Name + time */}
                    <div className="flex items-baseline gap-2 flex-wrap">
                      <span className="text-sm font-semibold text-slate-800 leading-tight">
                        {post.user?.full_name || 'Unknown'}
                      </span>
                      <span className="text-[11px] text-slate-400">{timeAgo(post.created_at)}</span>
                    </div>

                    <PostContent content={post.content} />

                    {/* Action bar */}
                    <div className="flex items-center gap-1.5 mt-3">
                      <button
                        onClick={() => setReplyTo(replyTo === post.id ? null : post.id)}
                        className={`text-xs flex items-center gap-1.5 px-2.5 py-1 rounded-lg transition-colors font-medium ${
                          replyTo === post.id
                            ? 'bg-teal-100 text-teal-600'
                            : 'text-slate-400 hover:text-teal-600 hover:bg-teal-50'
                        }`}
                      >
                        <Reply size={12} /> Reply
                      </button>

                      {replyCount > 0 && (
                        <button
                          onClick={() => toggleReplies(post.id)}
                          className="text-xs flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-slate-400 hover:text-blue-600 hover:bg-blue-50 transition-colors font-medium"
                        >
                          <ChevronDown size={12} className={`transition-transform ${showReplies ? 'rotate-180' : ''}`} />
                          {replyCount} {replyCount === 1 ? 'reply' : 'replies'}
                        </button>
                      )}

                      {(post.user_id === userId || canDelete) && (
                        <button
                          onClick={() => handleDelete(post.id)}
                          className="text-xs text-slate-300 hover:text-red-500 hover:bg-red-50 flex items-center gap-1 px-2 py-1 rounded-lg transition-colors ml-auto"
                        >
                          <Trash2 size={11} />
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              </div>

              {/* ── Reply compose ── */}
              <AnimatePresence>
                {replyTo === post.id && (
                  <motion.div
                    initial={{ opacity: 0, height: 0 }}
                    animate={{ opacity: 1, height: 'auto' }}
                    exit={{ opacity: 0, height: 0 }}
                    className="border-t border-slate-100 bg-gradient-to-b from-slate-50/80 to-white/60 px-4 py-3"
                  >
                    <div className="flex items-center gap-2 pl-10">
                      <div className="flex-1 flex items-center bg-white border border-slate-200/80 rounded-[20px] px-3.5 py-2 focus-within:border-teal-400/60 focus-within:ring-2 focus-within:ring-teal-400/15 transition-all shadow-sm">
                        <input
                          type="text"
                          value={replyContent}
                          onChange={(e) => setReplyContent(e.target.value)}
                          placeholder="Write a reply…"
                          className="flex-1 bg-transparent text-sm focus:outline-none text-slate-800 placeholder:text-slate-400 min-w-0"
                          autoFocus
                          onKeyDown={(e) => {
                            if (e.key === 'Enter' && !e.shiftKey) {
                              e.preventDefault()
                              handleReply(post.id)
                            }
                          }}
                        />
                      </div>
                      <button
                        onClick={() => handleReply(post.id)}
                        disabled={!replyContent.trim() || posting}
                        className="flex-shrink-0 w-8 h-8 flex items-center justify-center bg-gradient-to-br from-teal-400 to-teal-600 hover:from-teal-500 hover:to-teal-700 text-white rounded-full transition-all disabled:opacity-35 shadow-sm shadow-teal-200/60 active:scale-95"
                      >
                        <Send size={13} />
                      </button>
                      <button
                        onClick={() => setReplyTo(null)}
                        className="flex-shrink-0 w-8 h-8 flex items-center justify-center text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded-full transition-colors"
                      >
                        <X size={13} />
                      </button>
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>

              {/* ── Replies list ── */}
              <AnimatePresence>
                {showReplies && post.replies && post.replies.length > 0 && (
                  <motion.div
                    initial={{ opacity: 0, height: 0 }}
                    animate={{ opacity: 1, height: 'auto' }}
                    exit={{ opacity: 0, height: 0 }}
                    className="border-t border-slate-100 bg-slate-50/40"
                  >
                    <div className="px-4 py-3 space-y-3">
                      {post.replies.map((reply) => (
                        <div key={reply.id} className="flex items-start gap-3 pl-6 border-l-2 border-teal-100">
                          <Avatar
                            avatarUrl={reply.user?.avatar_url}
                            name={reply.user?.full_name}
                            size={28}
                            userId={reply.user_id}
                            className="flex-shrink-0"
                          />
                          <div className="flex-1 min-w-0">
                            <div className="flex items-baseline gap-2">
                              <span className="text-sm font-semibold text-slate-700">{reply.user?.full_name || 'Unknown'}</span>
                              <span className="text-[11px] text-slate-400">{timeAgo(reply.created_at)}</span>
                            </div>
                            <PostContent content={reply.content} />
                            {(reply.user_id === userId || canDelete) && (
                              <button
                                onClick={() => handleDelete(reply.id)}
                                className="text-xs text-slate-300 hover:text-red-500 flex items-center gap-1 mt-1.5 transition-colors"
                              >
                                <Trash2 size={10} /> Delete
                              </button>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          )
        })}

        {/* ── Compose bar — inline at rest, pinned flush above the keyboard when open ── */}
        <div
          ref={composeRef}
          className={
            kbOpen
              ? 'fixed inset-x-0 z-50 max-w-5xl mx-auto px-4 sm:px-6 lg:px-8'
              : 'mx-1 mt-1'
          }
          style={
            kbOpen
              ? {
                  // Pin the bar's bottom edge flush to the top of the keyboard:
                  // top = visual-viewport bottom, then lift by the bar's own height.
                  top: 'var(--keyboard-anchor)',
                  transform: 'translateY(-100%)',
                  willChange: 'top',
                }
              : undefined
          }
        >
          <div
            className="rounded-3xl overflow-hidden"
            style={{
              background: '#ffffff',
              boxShadow: '0 2px 16px -4px rgba(0,0,0,0.09), 0 0 0 1px rgba(148,163,184,0.13)',
            }}
          >
          <form onSubmit={handlePost} className="px-4 pt-3 pb-4">

            {/* Attachment extras */}
            {attachMode === 'link' && (
              <div className="flex gap-2 mb-2">
                <input
                  type="url"
                  value={attachLinkUrl}
                  onChange={e => setAttachLinkUrl(e.target.value)}
                  placeholder="https://…"
                  className="flex-1 border border-slate-200 rounded-2xl px-3.5 py-2 text-xs focus:outline-none focus:ring-2 focus:ring-teal-400/30 bg-slate-50"
                />
                <input
                  type="text"
                  value={attachLinkName}
                  onChange={e => setAttachLinkName(e.target.value)}
                  placeholder="Label (optional)"
                  className="w-28 border border-slate-200 rounded-2xl px-3.5 py-2 text-xs focus:outline-none focus:ring-2 focus:ring-teal-400/30 bg-slate-50"
                />
              </div>
            )}
            {attachMode === 'file' && (
              <div className="mb-2">
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  className="w-full flex items-center gap-2 px-3 py-2 border border-dashed border-slate-200 rounded-2xl text-xs text-slate-400 hover:border-teal-400 hover:text-teal-600 transition-colors bg-slate-50/60"
                >
                  {attachFile
                    ? <><ImageIcon size={12} className="flex-shrink-0 text-teal-500" /><span className="truncate">{attachFile.name}</span></>
                    : <><Paperclip size={12} className="flex-shrink-0" />Choose photo or document</>
                  }
                </button>
                <input
                  ref={fileInputRef}
                  type="file"
                  className="hidden"
                  accept="image/*,.pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.txt"
                  onChange={e => setAttachFile(e.target.files?.[0] || null)}
                />
              </div>
            )}

            {/* Main input row */}
            <div className="flex items-end gap-2">
              <Avatar
                avatarUrl={currentUserProfile?.avatar_url}
                name={currentUserProfile?.full_name}
                size={32}
                className="flex-shrink-0 mb-0.5 ring-2 ring-white shadow-sm"
              />

              {/* Input bubble */}
              <div className="flex-1 flex items-end gap-1.5 min-w-0 bg-slate-50/90 border border-slate-200/70 rounded-[22px] px-3.5 py-2 focus-within:border-teal-400/60 focus-within:ring-2 focus-within:ring-teal-400/15 focus-within:bg-white transition-all shadow-sm">
                <div
                  ref={editorRef}
                  role="textbox"
                  aria-multiline="true"
                  aria-label="Message"
                  contentEditable
                  suppressContentEditableWarning
                  data-placeholder="Message…"
                  onInput={(e) => {
                    const el = e.currentTarget
                    // Safari leaves a lone <br> after a full delete; normalise it
                    // so the `:empty` placeholder shows again. innerText (not
                    // textContent) keeps Shift+Enter line breaks.
                    if (!el.innerText.trim() && el.innerHTML !== '') el.innerHTML = ''
                    setNewPostContent(el.innerText)
                  }}
                  onPaste={(e) => {
                    // Keep pasted content plain text (no rich HTML in the bubble).
                    e.preventDefault()
                    const text = e.clipboardData.getData('text/plain')
                    document.execCommand('insertText', false, text)
                  }}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && !e.shiftKey) {
                      e.preventDefault()
                      if (e.currentTarget.innerText.trim()) handlePost()
                    }
                  }}
                  className="discussion-editor flex-1 bg-transparent text-sm focus:outline-none leading-relaxed text-slate-800 min-w-0 overflow-y-auto whitespace-pre-wrap break-words"
                  style={{ maxHeight: '100px', minHeight: '22px' }}
                />

                {/* Inline attach toggles inside the bubble */}
                <div className="flex items-center gap-0.5 flex-shrink-0 mb-0.5">
                  <button
                    type="button"
                    onClick={() => setAttachMode(m => m === 'link' ? 'none' : 'link')}
                    className={`p-1 rounded-full transition-colors ${attachMode === 'link' ? 'text-teal-600 bg-teal-100' : 'text-slate-300 hover:text-slate-500'}`}
                    title="Attach link"
                  >
                    <Link2 size={14} />
                  </button>
                  <button
                    type="button"
                    onClick={() => setAttachMode(m => m === 'file' ? 'none' : 'file')}
                    className={`p-1 rounded-full transition-colors ${attachMode === 'file' ? 'text-teal-600 bg-teal-100' : 'text-slate-300 hover:text-slate-500'}`}
                    title="Attach file"
                  >
                    <Paperclip size={14} />
                  </button>
                  {attachMode !== 'none' && (
                    <button type="button" onClick={resetAttach} className="p-1 text-slate-300 hover:text-rose-400 transition-colors rounded-full">
                      <X size={14} />
                    </button>
                  )}
                </div>
              </div>

              {/* Send button */}
              <button
                type="submit"
                disabled={!canSubmit}
                className="flex-shrink-0 w-9 h-9 flex items-center justify-center bg-gradient-to-br from-teal-400 to-teal-600 hover:from-teal-500 hover:to-teal-700 active:scale-95 text-white rounded-full transition-all disabled:opacity-30 shadow-md shadow-teal-200/60 mb-0.5"
              >
                {posting || uploading
                  ? <div className="w-4 h-4 border-2 border-white/40 border-t-white rounded-full animate-spin" />
                  : <Send size={14} className="-translate-x-px" />
                }
              </button>
            </div>

          </form>
          </div>
        </div>

        {/* Reserve the pinned bar's footprint so the last message can scroll
            clear of it (the bar is removed from flow while fixed). */}
        {kbOpen && composeH > 0 && <div aria-hidden style={{ height: composeH }} />}

        <div ref={bottomRef} />
      </div>

    </div>
  )
}
