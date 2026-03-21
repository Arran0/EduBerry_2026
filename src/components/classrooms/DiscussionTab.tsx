'use client'

import React, { useState, useEffect, useCallback, useRef } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { MessageSquare, Send, Reply, Trash2, Paperclip, Link2, Image as ImageIcon, FileText, ExternalLink, X } from 'lucide-react'
import {
  DiscussionPost, createDiscussionPost, fetchDiscussionPosts, deleteDiscussionPost,
  uploadDiscussionFile,
} from '@/lib/classrooms'
import { UserRole } from '@/lib/supabase'
import Avatar from '@/components/Avatar'
import { useAuth } from '@/contexts/AuthContext'

// Attachment embedded in content: __ATTACH__{...json...}
const ATTACH_MARKER = '__ATTACH__'

type AttachInfo = { url: string; name: string; type: 'image' | 'document' | 'link' }

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

function AttachDisplay({ attach }: { attach: AttachInfo }) {
  if (attach.type === 'image') {
    return (
      <a href={attach.url} target="_blank" rel="noopener noreferrer" className="block mt-2">
        <img
          src={attach.url}
          alt={attach.name}
          className="max-h-48 rounded-xl border border-slate-200 object-cover hover:opacity-90 transition-opacity cursor-pointer"
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
        className="inline-flex items-center gap-1.5 mt-2 px-3 py-1.5 bg-mps-blue-50 rounded-lg text-xs text-mps-blue-600 hover:bg-mps-blue-100 transition-colors border border-mps-blue-100"
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
      {text && <p className="text-sm text-slate-600 mt-1 whitespace-pre-wrap">{text}</p>}
      {attach && <AttachDisplay attach={attach} />}
    </div>
  )
}

type AttachMode = 'none' | 'link' | 'file'

export default function DiscussionTab({ classroomId, userId, userRole }: DiscussionTabProps) {
  const { profile: currentUserProfile } = useAuth()
  const [posts, setPosts] = useState<DiscussionPost[]>([])
  const [loading, setLoading] = useState(true)
  const [newPostContent, setNewPostContent] = useState('')
  const [replyTo, setReplyTo] = useState<string | null>(null)
  const [replyContent, setReplyContent] = useState('')
  const [posting, setPosting] = useState(false)
  const bottomRef = useRef<HTMLDivElement>(null)

  // Attachment state for new post
  const [attachMode, setAttachMode]     = useState<AttachMode>('none')
  const [attachLinkUrl, setAttachLinkUrl]   = useState('')
  const [attachLinkName, setAttachLinkName] = useState('')
  const [attachFile, setAttachFile]     = useState<File | null>(null)
  const [uploading, setUploading]       = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const canDelete = ['coordinator', 'principal', 'admin'].includes(userRole)

  const loadPosts = useCallback(async () => {
    setLoading(true)
    const data = await fetchDiscussionPosts(classroomId)
    setPosts(data)
    setLoading(false)
  }, [classroomId])

  useEffect(() => { loadPosts() }, [loadPosts])

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

  const handlePost = async (e: React.FormEvent) => {
    e.preventDefault()
    const content = await buildContent()
    if (!content) return
    setPosting(true)
    const result = await createDiscussionPost(classroomId, userId, content)
    if (result) {
      setNewPostContent('')
      resetAttach()
      await loadPosts()
      bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
    }
    setPosting(false)
  }

  const handleReply = async (parentId: string) => {
    if (!replyContent.trim()) return
    setPosting(true)
    const result = await createDiscussionPost(classroomId, userId, replyContent.trim(), parentId)
    if (result) {
      setReplyContent('')
      setReplyTo(null)
      await loadPosts()
    }
    setPosting(false)
  }

  const handleDelete = async (postId: string) => {
    if (!confirm('Delete this post?')) return
    const success = await deleteDiscussionPost(postId)
    if (success) {
      await loadPosts()
    }
  }

  if (loading) {
    return (
      <div className="text-center py-12">
        <div className="spinner mx-auto mb-3" />
        <p className="text-sm text-slate-500">Loading discussion...</p>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      {/* Posts */}
      {posts.length === 0 ? (
        <div className="glass rounded-2xl p-8 text-center">
          <MessageSquare size={36} className="text-slate-300 mx-auto mb-3" />
          <p className="text-slate-500 text-sm">No discussions yet. Start the conversation!</p>
        </div>
      ) : (
        <div className="space-y-3">
          {posts.map((post) => (
            <div key={post.id} className="glass rounded-2xl p-4">
              {/* Post */}
              <div className="flex items-start gap-3">
                <Avatar avatarUrl={post.user?.avatar_url} name={post.user?.full_name} size={36} />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium text-slate-800">{post.user?.full_name || 'Unknown'}</span>
                    <span className="text-xs text-slate-400">{timeAgo(post.created_at)}</span>
                  </div>
                  <PostContent content={post.content} />
                  <div className="flex items-center gap-3 mt-2">
                    <button
                      onClick={() => setReplyTo(replyTo === post.id ? null : post.id)}
                      className="text-xs text-slate-400 hover:text-mps-blue-600 flex items-center gap-1 transition-colors"
                    >
                      <Reply size={12} /> Reply
                    </button>
                    {(post.user_id === userId || canDelete) && (
                      <button
                        onClick={() => handleDelete(post.id)}
                        className="text-xs text-slate-300 hover:text-red-500 flex items-center gap-1 transition-colors"
                      >
                        <Trash2 size={12} /> Delete
                      </button>
                    )}
                  </div>
                </div>
              </div>

              {/* Replies */}
              {post.replies && post.replies.length > 0 && (
                <div className="ml-12 mt-3 space-y-3 border-l-2 border-slate-100 pl-4">
                  {post.replies.map((reply) => (
                    <div key={reply.id} className="flex items-start gap-3">
                      <Avatar avatarUrl={reply.user?.avatar_url} name={reply.user?.full_name} size={28} />
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="text-sm font-medium text-slate-700">{reply.user?.full_name || 'Unknown'}</span>
                          <span className="text-xs text-slate-400">{timeAgo(reply.created_at)}</span>
                        </div>
                        <PostContent content={reply.content} />
                        {(reply.user_id === userId || canDelete) && (
                          <button
                            onClick={() => handleDelete(reply.id)}
                            className="text-xs text-slate-300 hover:text-red-500 flex items-center gap-1 mt-1 transition-colors"
                          >
                            <Trash2 size={10} /> Delete
                          </button>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}

              {/* Reply Form */}
              <AnimatePresence>
                {replyTo === post.id && (
                  <motion.div
                    initial={{ opacity: 0, height: 0 }}
                    animate={{ opacity: 1, height: 'auto' }}
                    exit={{ opacity: 0, height: 0 }}
                    className="ml-12 mt-3"
                  >
                    <div className="flex items-center gap-2">
                      <input
                        type="text"
                        value={replyContent}
                        onChange={(e) => setReplyContent(e.target.value)}
                        placeholder="Write a reply..."
                        className="flex-1 border border-slate-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-purple-500/50"
                        autoFocus
                        onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleReply(post.id) } }}
                      />
                      <button
                        onClick={() => handleReply(post.id)}
                        disabled={!replyContent.trim() || posting}
                        className="p-2 text-mps-blue-600 hover:bg-mps-blue-50 rounded-lg transition-colors disabled:opacity-50"
                      >
                        <Send size={16} />
                      </button>
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          ))}
        </div>
      )}

      {/* New Post Form */}
      <div className="glass rounded-2xl p-4">
        <form onSubmit={handlePost} className="flex items-start gap-3">
          <Avatar avatarUrl={currentUserProfile?.avatar_url} name={currentUserProfile?.full_name} size={36} />
          <div className="flex-1 min-w-0">
            <textarea
              value={newPostContent}
              onChange={(e) => setNewPostContent(e.target.value)}
              placeholder="Start a discussion..."
              rows={2}
              className="w-full border border-slate-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-purple-500/50 resize-none"
            />

            {/* Attachment inputs */}
            {attachMode === 'link' && (
              <div className="flex gap-2 mt-2">
                <input
                  type="url"
                  value={attachLinkUrl}
                  onChange={e => setAttachLinkUrl(e.target.value)}
                  placeholder="https://..."
                  className="flex-1 border border-slate-200 rounded-lg px-2.5 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-purple-400"
                />
                <input
                  type="text"
                  value={attachLinkName}
                  onChange={e => setAttachLinkName(e.target.value)}
                  placeholder="Label (optional)"
                  className="w-28 border border-slate-200 rounded-lg px-2.5 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-purple-400"
                />
              </div>
            )}
            {attachMode === 'file' && (
              <div className="mt-2">
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  className="w-full flex items-center gap-2 px-3 py-2 border border-dashed border-slate-300 rounded-lg text-xs text-slate-500 hover:border-purple-400 hover:text-purple-600 transition-colors"
                >
                  {attachFile
                    ? <><ImageIcon size={12} className="flex-shrink-0" />{attachFile.name}</>
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

            <div className="flex items-center gap-2 mt-2">
              {/* Attachment toggle buttons */}
              <button
                type="button"
                onClick={() => setAttachMode(m => m === 'link' ? 'none' : 'link')}
                className={`p-1.5 rounded-lg transition-colors ${attachMode === 'link' ? 'bg-mps-blue-100 text-mps-blue-600' : 'text-slate-400 hover:text-purple-500 hover:bg-slate-100'}`}
                title="Attach link"
              >
                <Link2 size={14} />
              </button>
              <button
                type="button"
                onClick={() => setAttachMode(m => m === 'file' ? 'none' : 'file')}
                className={`p-1.5 rounded-lg transition-colors ${attachMode === 'file' ? 'bg-purple-100 text-purple-600' : 'text-slate-400 hover:text-purple-500 hover:bg-slate-100'}`}
                title="Attach photo or document"
              >
                <Paperclip size={14} />
              </button>

              <div className="flex-1" />

              {attachMode !== 'none' && (
                <button type="button" onClick={resetAttach} className="text-xs text-slate-400 hover:text-slate-600">
                  <X size={14} />
                </button>
              )}

              <button
                type="submit"
                disabled={(!newPostContent.trim() && attachMode === 'none') || (attachMode === 'link' && !attachLinkUrl.trim()) || (attachMode === 'file' && !attachFile) || posting || uploading}
                className="btn-primary text-sm px-4 py-2 flex items-center gap-2 disabled:opacity-50"
              >
                <Send size={14} /> {uploading ? 'Uploading…' : posting ? 'Posting…' : 'Post'}
              </button>
            </div>
          </div>
        </form>
      </div>

      <div ref={bottomRef} />
    </div>
  )
}
