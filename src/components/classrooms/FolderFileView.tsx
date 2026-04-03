'use client'

import React, { useState, useEffect, useCallback, useRef } from 'react'
import { createPortal } from 'react-dom'
import { motion, AnimatePresence } from 'framer-motion'
import {
  Folder, File, Plus, Trash2, ChevronRight, ChevronDown, Clock,
  X, Circle, CircleDot, CheckCircle2, Users, Link2, FileText,
  Youtube, Upload, BarChart2, ExternalLink, Play, Edit3, Check, Eye,
} from 'lucide-react'
import {
  ClassroomFolder, ClassroomFile, FileProgress, FileSubmission,
  FolderType, FileStatus, SubmissionType, ClassroomWithDetails,
  createFolder, fetchFolders, deleteFolder, updateFolder,
  createFile, fetchFilesForFolder, deleteFile,
  updateFileProgress, fetchFileProgress, fetchProgressForStudent,
  fetchProgressForFiles,
  submitWork, fetchSubmissions, fetchStudentSubmission, fetchStudentMembers,
  ClassroomMember,
  extractYouTubeEmbedUrl, uploadClassroomFile, uploadSubmissionFile,
} from '@/lib/classrooms'
import { UserRole, UserProfile } from '@/lib/supabase'
import Avatar from '@/components/Avatar'

interface FolderFileViewProps {
  classroomId: string
  userId: string
  userRole: UserRole
  type: FolderType
  classroom: ClassroomWithDetails
}

// ─── Status config ────────────────────────────────────────────────────────────

const STATUS_ICON: Record<FileStatus, React.ReactNode> = {
  not_done:  <Circle      size={18} className="text-red-400" />,
  partial:   <CircleDot   size={18} className="text-amber-500" />,
  done:      <CheckCircle2 size={18} className="text-yellow-500" />,
  completed: <CheckCircle2 size={18} className="text-green-500" />,
}

const STATUS_LABEL: Record<FileStatus, string> = {
  not_done: 'Not Done',
  partial:  'Partial',
  done:     'Checking',
  completed:'Completed',
}

const STATUS_BG: Record<FileStatus, string> = {
  not_done: 'bg-red-50 text-red-600 border-red-200',
  partial:  'bg-amber-50 text-amber-600 border-amber-200',
  done:     'bg-yellow-50 text-yellow-600 border-yellow-200',
  completed:'bg-green-50 text-green-600 border-green-200',
}

function getNextStatus(
  current: FileStatus,
  isStaff: boolean,
  requiresCheck: boolean,
): FileStatus {
  if (isStaff) {
    const cycle: FileStatus[] = requiresCheck
      ? ['not_done', 'partial', 'done', 'completed']
      : ['not_done', 'partial', 'completed']
    return cycle[(cycle.indexOf(current) + 1) % cycle.length]
  }
  // Student — can never reach 'completed' on a requires_check file
  const cycle: FileStatus[] = requiresCheck
    ? ['not_done', 'partial', 'done']
    : ['not_done', 'partial', 'completed']
  return cycle[(cycle.indexOf(current) + 1) % cycle.length]
}

type AttachmentType = 'youtube' | 'image' | 'doc' | 'other'

const DOC_EXTENSIONS = ['pdf', 'doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx', 'odt', 'ods', 'odp', 'txt', 'csv', 'rtf']
const IMAGE_EXTENSIONS = ['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'bmp', 'ico']

function getAttachmentType(url: string, name: string | null): AttachmentType {
  if (extractYouTubeEmbedUrl(url)) return 'youtube'
  const ext = ((name || url).split('.').pop() || '').toLowerCase().split('?')[0]
  if (IMAGE_EXTENSIONS.includes(ext)) return 'image'
  if (DOC_EXTENSIONS.includes(ext)) return 'doc'
  return 'other'
}

/** Wrap a public URL in Google Docs Viewer for in-app rendering */
function googleDocsViewerUrl(url: string): string {
  return `https://docs.google.com/viewer?url=${encodeURIComponent(url)}&embedded=true`
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function FolderFileView({
  classroomId, userId, userRole, type, classroom,
}: FolderFileViewProps) {
  const isStudent = userRole === 'student'
  const isStaff   = !isStudent
  const isHomework = type === 'homework'

  // Core data
  const [folders,           setFolders]           = useState<ClassroomFolder[]>([])
  const [expandedFolder,    setExpandedFolder]    = useState<string | null>(null)
  const [folderFiles,       setFolderFiles]       = useState<Record<string, ClassroomFile[]>>({})
  const [studentProgress,   setStudentProgress]   = useState<Record<string, FileStatus>>({})
  const [studentSubmissions,setStudentSubmissions]= useState<Record<string, FileSubmission>>({})
  const [loading,           setLoading]           = useState(true)

  // Staff per-folder progress
  const [students,              setStudents]              = useState<(ClassroomMember & { user: UserProfile })[]>([])
  const [folderAllProgress,     setFolderAllProgress]     = useState<Record<string, FileProgress[]>>({})
  const [showFolderProgress,    setShowFolderProgress]    = useState<string | null>(null)

  // Modals
  const [showNewFolder,   setShowNewFolder]   = useState(false)
  const [showNewFile,     setShowNewFile]     = useState<string | null>(null)
  const [showTracking,    setShowTracking]    = useState<string | null>(null)    // fileId
  const [trackingData,    setTrackingData]    = useState<{
    file: ClassroomFile | null
    progress: FileProgress[]
    submissions: FileSubmission[]
  }>({ file: null, progress: [], submissions: [] })
  const [trackingUpdating, setTrackingUpdating] = useState<string | null>(null)  // studentId
  const [showSubmit,      setShowSubmit]      = useState<string | null>(null)
  const [submitContent,   setSubmitContent]   = useState('')
  const [submitFile,      setSubmitFile]      = useState<File | null>(null)
  const [submittingWork,  setSubmittingWork]  = useState(false)
  const [videoUrl,        setVideoUrl]        = useState<string | null>(null)   // YouTube embed URL
  const [imageUrl,        setImageUrl]        = useState<string | null>(null)   // image lightbox
  const [docViewerUrl,    setDocViewerUrl]    = useState<string | null>(null)  // Google Docs viewer (PDFs, office docs)
  const [expandedSub, setExpandedSub] = useState<{ name: string; sub: FileSubmission } | null>(null)

  // Folder editing
  const [editingFolder,    setEditingFolder]    = useState<string | null>(null)
  const [editFolderTitle,  setEditFolderTitle]  = useState('')
  const [editFolderDesc,   setEditFolderDesc]   = useState('')
  const [editFolderDue,    setEditFolderDue]    = useState('')
  const [savingFolder,     setSavingFolder]     = useState(false)

  // New folder form
  const [newFolderTitle, setNewFolderTitle] = useState('')
  const [newFolderDesc,  setNewFolderDesc]  = useState('')
  const [newFolderDue,   setNewFolderDue]   = useState('')

  // New file form
  const [newFileTitle,               setNewFileTitle]               = useState('')
  const [newFileDesc,                setNewFileDesc]                = useState('')
  const [newFileDue,                 setNewFileDue]                 = useState('')
  const [newFileRequiresSubmission,  setNewFileRequiresSubmission]  = useState(false)
  const [newFileSubmissionType,      setNewFileSubmissionType]      = useState<SubmissionType>('text')
  const [newFileRequiresCheck,       setNewFileRequiresCheck]       = useState(false)
  const [newFileAttachmentMode,      setNewFileAttachmentMode]      = useState<'none' | 'youtube' | 'upload' | 'link'>('none')
  const [newFileYoutubeUrl,          setNewFileYoutubeUrl]          = useState('')
  const [newFileLinkUrl,             setNewFileLinkUrl]             = useState('')
  const [newFileUpload,              setNewFileUpload]              = useState<File | null>(null)
  const [uploadingFile,              setUploadingFile]              = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)

  // ─── Load ──────────────────────────────────────────────────────────────────

  const loadFolders = useCallback(async () => {
    setLoading(true)
    const data = await fetchFolders(classroomId, type)
    setFolders(data)
    setLoading(false)
  }, [classroomId, type])

  useEffect(() => { loadFolders() }, [loadFolders])

  // Load students once for staff
  useEffect(() => {
    if (isStaff) {
      fetchStudentMembers(classroomId).then(setStudents)
    }
  }, [isStaff, classroomId])

  const loadFiles = async (folderId: string) => {
    const files = await fetchFilesForFolder(folderId)
    setFolderFiles(prev => ({ ...prev, [folderId]: files }))

    if (files.length === 0) return

    if (isStudent) {
      const fileIds = files.map(f => f.id)
      const progress = await fetchProgressForStudent(userId, fileIds)
      const map: Record<string, FileStatus> = {}
      for (const p of progress) map[p.file_id] = p.status as FileStatus
      setStudentProgress(prev => ({ ...prev, ...map }))

      for (const f of files) {
        if (f.requires_submission) {
          const sub = await fetchStudentSubmission(f.id, userId)
          if (sub) setStudentSubmissions(prev => ({ ...prev, [f.id]: sub }))
        }
      }
    }

    if (isStaff) {
      const fileIds = files.map(f => f.id)
      const allProgress = await fetchProgressForFiles(fileIds)
      setFolderAllProgress(prev => ({ ...prev, [folderId]: allProgress }))
    }
  }

  const toggleFolder = (folderId: string) => {
    if (expandedFolder === folderId) {
      setExpandedFolder(null)
      setShowFolderProgress(null)
    } else {
      setExpandedFolder(folderId)
      setShowFolderProgress(null)
      if (!folderFiles[folderId]) {
        loadFiles(folderId)
      }
    }
  }

  // ─── CRUD ──────────────────────────────────────────────────────────────────

  const handleCreateFolder = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!newFolderTitle.trim()) return
    const result = await createFolder({
      classroom_id: classroomId, type,
      title: newFolderTitle.trim(),
      description: newFolderDesc.trim() || undefined,
      due_date: newFolderDue || undefined,
    }, userId)
    if (result) {
      setFolders(prev => [result, ...prev])
      setNewFolderTitle(''); setNewFolderDesc(''); setNewFolderDue('')
      setShowNewFolder(false)
    }
  }

  const resetNewFileForm = () => {
    setNewFileTitle(''); setNewFileDesc(''); setNewFileDue('')
    setNewFileRequiresSubmission(false); setNewFileSubmissionType('text')
    setNewFileRequiresCheck(false)
    setNewFileAttachmentMode('none'); setNewFileYoutubeUrl(''); setNewFileUpload(null); setNewFileLinkUrl('')
  }

  const handleCreateFile = async (e: React.FormEvent, folderId: string) => {
    e.preventDefault()
    if (!newFileTitle.trim()) return

    setUploadingFile(true)
    let attachmentUrl: string | undefined
    let attachmentName: string | undefined

    if (newFileAttachmentMode === 'youtube' && newFileYoutubeUrl.trim()) {
      const embed = extractYouTubeEmbedUrl(newFileYoutubeUrl.trim())
      if (!embed) {
        alert('Invalid YouTube URL. Please use a youtube.com or youtu.be link.')
        setUploadingFile(false)
        return
      }
      attachmentUrl = newFileYoutubeUrl.trim()
    } else if (newFileAttachmentMode === 'link' && newFileLinkUrl.trim()) {
      attachmentUrl = newFileLinkUrl.trim()
      attachmentName = 'Link'
    } else if (newFileAttachmentMode === 'upload' && newFileUpload) {
      const uploaded = await uploadClassroomFile(classroomId, newFileUpload)
      if ('error' in uploaded) {
        alert(uploaded.error)
        setUploadingFile(false)
        return
      }
      attachmentUrl = uploaded.url
      attachmentName = uploaded.name
    }

    const result = await createFile({
      folder_id: folderId,
      title: newFileTitle.trim(),
      description: newFileDesc.trim() || undefined,
      due_date: newFileDue || undefined,
      requires_submission: newFileRequiresSubmission,
      submission_type: newFileRequiresSubmission ? newFileSubmissionType : undefined,
      requires_check: newFileRequiresCheck,
      attachment_url: attachmentUrl,
      attachment_name: attachmentName,
    }, userId)

    setUploadingFile(false)

    if (result) {
      setFolderFiles(prev => ({
        ...prev,
        [folderId]: [result, ...(prev[folderId] || [])],
      }))
      resetNewFileForm()
      setShowNewFile(null)
    }
  }

  const handleDeleteFolder = async (folderId: string) => {
    if (!confirm('Delete this folder and all its files?')) return
    if (await deleteFolder(folderId)) {
      setFolders(prev => prev.filter(f => f.id !== folderId))
    }
  }

  const openEditFolder = (folder: ClassroomFolder) => {
    setEditingFolder(folder.id)
    setEditFolderTitle(folder.title)
    setEditFolderDesc(folder.description || '')
    setEditFolderDue(folder.due_date || '')
  }

  const handleSaveFolder = async (folderId: string) => {
    if (!editFolderTitle.trim()) return
    setSavingFolder(true)
    const ok = await updateFolder(folderId, {
      title: editFolderTitle.trim(),
      description: editFolderDesc.trim() || null,
      due_date: editFolderDue || null,
    })
    setSavingFolder(false)
    if (ok) {
      setFolders(prev => prev.map(f =>
        f.id === folderId
          ? { ...f, title: editFolderTitle.trim(), description: editFolderDesc.trim() || null, due_date: editFolderDue || null }
          : f
      ))
      setEditingFolder(null)
    }
  }

  const handleDeleteFile = async (fileId: string, folderId: string) => {
    if (!confirm('Delete this file?')) return
    if (await deleteFile(fileId)) {
      setFolderFiles(prev => ({
        ...prev,
        [folderId]: (prev[folderId] || []).filter(f => f.id !== fileId),
      }))
    }
  }

  // ─── Progress / Status ─────────────────────────────────────────────────────

  const handleStatusToggle = async (fileId: string, file: ClassroomFile) => {
    const current = studentProgress[fileId] || 'not_done'

    // Once submitted, student cannot change status — staff manages it
    if (file.requires_submission && studentSubmissions[fileId]) return

    // If requires submission and trying to advance past partial without submitting
    if (file.requires_submission && current === 'partial' && !studentSubmissions[fileId]) {
      setShowSubmit(fileId)
      return
    }

    // Students can't mark 'completed' on requires_check files
    const next = getNextStatus(current, false, file.requires_check)
    const success = await updateFileProgress(fileId, userId, next)
    if (success) setStudentProgress(prev => ({ ...prev, [fileId]: next }))
  }

  const handleTrackingStatusClick = async (
    fileId: string,
    studentId: string,
    currentStatus: FileStatus,
    requiresCheck: boolean,
  ) => {
    setTrackingUpdating(studentId)
    const next = getNextStatus(currentStatus, true, requiresCheck)
    const success = await updateFileProgress(fileId, studentId, next)
    if (success) {
      setTrackingData(prev => {
        const updated = prev.progress.filter(p => !(p.file_id === fileId && p.student_id === studentId))
        return {
          ...prev,
          progress: [...updated, { id: '', file_id: fileId, student_id: studentId, status: next, updated_at: new Date().toISOString() }],
        }
      })
      // Also refresh folder-level progress
      setFolderAllProgress(prev => {
        const folderId = Object.keys(folderFiles).find(fid =>
          (folderFiles[fid] || []).some(f => f.id === fileId)
        )
        if (!folderId) return prev
        const updated = (prev[folderId] || []).filter(
          p => !(p.file_id === fileId && p.student_id === studentId)
        )
        return {
          ...prev,
          [folderId]: [...updated, { id: '', file_id: fileId, student_id: studentId, status: next, updated_at: new Date().toISOString() }],
        }
      })
    }
    setTrackingUpdating(null)
  }

  const handleShowTracking = async (fileId: string) => {
    const file = Object.values(folderFiles).flat().find(f => f.id === fileId) ?? null
    setShowTracking(fileId)
    setTrackingData({ file, progress: [], submissions: [] })
    const [progress, submissions] = await Promise.all([
      fetchFileProgress(fileId),
      fetchSubmissions(fileId),
    ])
    setTrackingData({ file, progress, submissions })
  }

  const handleSubmitWork = async (fileId: string) => {
    const file = Object.values(folderFiles).flat().find(f => f.id === fileId)

    // Determine type and content from what the student filled in
    let subType: SubmissionType = 'text'
    let content = submitContent.trim()

    if (submitFile) {
      setSubmittingWork(true)
      const uploaded = await uploadSubmissionFile(fileId, userId, submitFile)
      if ('error' in uploaded) {
        setSubmittingWork(false)
        alert(uploaded.error)
        return
      }
      content = uploaded.url
      subType = 'file'
    } else if (submitContent.trim().match(/^https?:\/\//)) {
      subType = 'link'
    } else {
      if (!content) return
      subType = 'text'
    }

    setSubmittingWork(true)
    const success = await submitWork(fileId, userId, content, subType)
    setSubmittingWork(false)
    if (success) {
      setStudentSubmissions(prev => ({
        ...prev,
        [fileId]: {
          id: '', file_id: fileId, student_id: userId,
          content, submission_type: subType,
          submitted_at: new Date().toISOString(), updated_at: new Date().toISOString(),
        },
      }))
      const next = getNextStatus('partial', false, file?.requires_check || false)
      await updateFileProgress(fileId, userId, next)
      setStudentProgress(prev => ({ ...prev, [fileId]: next }))
      setSubmitContent('')
      setSubmitFile(null)
      setShowSubmit(null)
    }
  }

  // ─── Computed helpers ──────────────────────────────────────────────────────

  const isOverdue = (d: string | null) =>
    !!d && new Date(d) < new Date(new Date().toDateString())

  const getStudentFolderStats = (folderId: string, studentId: string) => {
    const files  = folderFiles[folderId] || []
    const allProg = folderAllProgress[folderId] || []
    if (files.length === 0) return null
    const getStatus = (fileId: string): FileStatus =>
      (allProg.find(p => p.file_id === fileId && p.student_id === studentId)?.status as FileStatus) || 'not_done'
    const completed = files.filter(f => getStatus(f.id) === 'completed').length
    const done      = files.filter(f => ['done', 'completed'].includes(getStatus(f.id))).length
    return { completed, done, total: files.length }
  }

  const getFolderSummary = (folderId: string) => {
    // For student: own progress
    if (isStudent) {
      const files = folderFiles[folderId] || []
      if (files.length === 0) return null
      const completed = files.filter(f => studentProgress[f.id] === 'completed').length
      const done      = files.filter(f => ['done', 'completed'].includes(studentProgress[f.id] || 'not_done')).length
      return { completed, done, total: files.length }
    }
    return null
  }

  // ─── Render ────────────────────────────────────────────────────────────────

  if (loading) {
    return (
      <div className="text-center py-12">
        <div className="spinner mx-auto mb-3" />
        <p className="text-sm text-slate-500">
          Loading {type === 'coursework' ? 'course work' : 'homework'}...
        </p>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      {/* Header row */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div className="p-2 rounded-xl bg-slate-100">
            <Folder size={16} className="text-slate-600" />
          </div>
          <div>
            <h2 className="font-semibold text-slate-800 text-sm">{isHomework ? 'Homework' : 'Course Work'}</h2>
            <p className="text-xs text-slate-400">{folders.length} folder{folders.length !== 1 ? 's' : ''}</p>
          </div>
        </div>
        {isStaff && (
          <button
            onClick={() => setShowNewFolder(!showNewFolder)}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold text-white transition-colors shadow-sm bg-slate-700 hover:bg-slate-900"
          >
            <Plus size={13} /> New Folder
          </button>
        )}
      </div>

      {/* New Folder Form */}
      <AnimatePresence>
        {showNewFolder && (
          <motion.form
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            onSubmit={handleCreateFolder}
            className="rounded-2xl p-4 space-y-3 overflow-hidden border bg-slate-50 border-slate-200"
          >
            <p className="text-xs font-semibold text-slate-600">New Folder</p>
            <input
              type="text" value={newFolderTitle}
              onChange={e => setNewFolderTitle(e.target.value)}
              placeholder="Folder title"
              className="w-full border border-slate-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-slate-400/50 bg-white"
              autoFocus
            />
            <textarea
              value={newFolderDesc}
              onChange={e => setNewFolderDesc(e.target.value)}
              placeholder="Description (optional)" rows={2}
              className="w-full border border-slate-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-slate-400/50 resize-none bg-white"
            />
            <div className="flex items-center gap-2">
              <input type="date" value={newFolderDue}
                onChange={e => setNewFolderDue(e.target.value)}
                className="border border-slate-200 rounded-xl px-3 py-1.5 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-slate-400/50"
              />
              <div className="flex-1" />
              <button type="button" onClick={() => setShowNewFolder(false)} className="text-xs text-slate-400 hover:text-slate-600 px-2">Cancel</button>
              <button type="submit" disabled={!newFolderTitle.trim()}
                className="text-xs font-semibold text-white px-3 py-1.5 rounded-lg transition-colors disabled:opacity-50 bg-slate-700 hover:bg-slate-900"
              >Create Folder</button>
            </div>
          </motion.form>
        )}
      </AnimatePresence>

      {/* Folders List */}
      {folders.length === 0 ? (
        <div className="rounded-2xl bg-white border border-slate-100 p-10 text-center">
          <div className="w-14 h-14 rounded-2xl flex items-center justify-center mx-auto mb-3 bg-slate-100">
            <Folder size={26} className="text-slate-400" />
          </div>
          <p className="text-slate-600 font-medium text-sm mb-1">No folders yet</p>
          <p className="text-slate-400 text-xs">
            {isStaff
              ? `Create the first ${type === 'coursework' ? 'course work' : 'homework'} folder above.`
              : `No ${type === 'coursework' ? 'course work' : 'homework'} has been added yet.`}
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {folders.map(folder => {
            const isExpanded = expandedFolder === folder.id
            const files      = folderFiles[folder.id] || []
            const overdue    = isOverdue(folder.due_date)
            const summary    = isExpanded ? getFolderSummary(folder.id) : null

            return (
              <div key={folder.id} className="rounded-2xl overflow-hidden border border-slate-200 bg-white shadow-sm">
                {/* Colored top accent */}
                <div className="h-1 bg-slate-200" />

                {/* Folder Header */}
                <button
                  onClick={() => toggleFolder(folder.id)}
                  className="w-full flex items-center gap-3 px-4 py-3 hover:bg-slate-50 transition-colors text-left"
                >
                  <div className="p-2 rounded-xl flex-shrink-0 bg-slate-100">
                    <Folder size={16} className="text-slate-600" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-semibold text-slate-800 text-sm">{folder.title}</span>
                      {overdue && (
                        <span className="text-[10px] px-1.5 py-0.5 bg-red-100 text-red-600 rounded-full font-semibold flex-shrink-0">Overdue</span>
                      )}
                    </div>
                    {folder.description && (
                      <p className="text-xs text-slate-500 truncate mt-0.5">{folder.description}</p>
                    )}
                    {isStudent && summary && (
                      <div className="flex items-center gap-2 mt-1">
                        <div className="flex-1 h-1.5 bg-slate-100 rounded-full overflow-hidden max-w-[80px]">
                          <div
                            className="h-full rounded-full transition-all bg-slate-400"
                            style={{ width: summary.total > 0 ? `${Math.round((summary.completed / summary.total) * 100)}%` : '0%' }}
                          />
                        </div>
                        <span className="text-[10px] text-slate-400">{summary.completed}/{summary.total}</span>
                      </div>
                    )}
                  </div>
                  {folder.due_date && (
                    <span className={`text-xs flex items-center gap-1 flex-shrink-0 font-medium ${overdue ? 'text-red-500 bg-red-50 px-2 py-0.5 rounded-lg' : 'text-slate-400'}`}>
                      <Clock size={11} /> {new Date(folder.due_date).toLocaleDateString()}
                    </span>
                  )}
                  {isExpanded
                    ? <ChevronDown size={16} className="text-slate-400 flex-shrink-0" />
                    : <ChevronRight size={16} className="text-slate-400 flex-shrink-0" />
                  }
                  {isStaff && (
                    <div className="flex items-center gap-0.5 flex-shrink-0" onClick={e => e.stopPropagation()}>
                      <button
                        onClick={() => openEditFolder(folder)}
                        className="p-1.5 text-slate-300 hover:text-slate-600 hover:bg-slate-100 rounded-lg transition-colors"
                        title="Edit folder"
                      >
                        <Edit3 size={13} />
                      </button>
                      <button
                        onClick={() => handleDeleteFolder(folder.id)}
                        className="p-1.5 text-slate-300 hover:text-red-500 hover:bg-red-50 rounded-lg transition-colors"
                      >
                        <Trash2 size={13} />
                      </button>
                    </div>
                  )}
                </button>

                {/* Inline folder edit form */}
                {isStaff && editingFolder === folder.id && (
                  <div className="px-4 py-3 border-b border-slate-100 bg-mps-blue-50/30 space-y-2">
                    <input
                      type="text"
                      value={editFolderTitle}
                      onChange={e => setEditFolderTitle(e.target.value)}
                      placeholder="Folder title"
                      className="w-full border border-slate-200 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-mps-blue-400/50 bg-white"
                      autoFocus
                    />
                    <textarea
                      value={editFolderDesc}
                      onChange={e => setEditFolderDesc(e.target.value)}
                      placeholder="Description (optional)"
                      rows={2}
                      className="w-full border border-slate-200 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-mps-blue-400/50 resize-none bg-white"
                    />
                    <div className="flex items-center gap-3">
                      <label className="text-xs text-slate-500 flex items-center gap-1.5">
                        <Clock size={12} /> Due:
                      </label>
                      <input
                        type="date"
                        value={editFolderDue}
                        onChange={e => setEditFolderDue(e.target.value)}
                        className="border border-slate-200 rounded-lg px-2 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-mps-blue-400/50 bg-white"
                      />
                      <div className="flex-1" />
                      <button
                        onClick={() => setEditingFolder(null)}
                        className="text-xs text-slate-500 hover:text-slate-700 px-2 py-1"
                      >Cancel</button>
                      <button
                        onClick={() => handleSaveFolder(folder.id)}
                        disabled={savingFolder || !editFolderTitle.trim()}
                        className="flex items-center gap-1 text-xs bg-mps-blue-500 text-white rounded-lg px-3 py-1.5 hover:bg-mps-blue-600 disabled:opacity-50 transition-colors"
                      >
                        <Check size={12} /> {savingFolder ? 'Saving…' : 'Save'}
                      </button>
                    </div>
                  </div>
                )}

                {/* Expanded Content */}
                <AnimatePresence>
                  {isExpanded && (
                    <motion.div
                      initial={{ height: 0, opacity: 0 }}
                      animate={{ height: 'auto', opacity: 1 }}
                      exit={{ height: 0, opacity: 0 }}
                      className="border-t border-slate-100 bg-slate-50/40 overflow-hidden"
                    >
                      {/* Staff: per-folder progress bar */}
                      {isStaff && students.length > 0 && (
                        <div className="px-4 pt-3 pb-1">
                          <button
                            onClick={() => setShowFolderProgress(
                              showFolderProgress === folder.id ? null : folder.id
                            )}
                            className="flex items-center gap-2 text-xs font-medium text-slate-500 hover:text-mps-blue-600 transition-colors mb-2"
                          >
                            <BarChart2 size={13} />
                            Student Progress
                            {showFolderProgress === folder.id
                              ? <ChevronDown size={13} />
                              : <ChevronRight size={13} />
                            }
                          </button>

                          <AnimatePresence>
                            {showFolderProgress === folder.id && (
                              <motion.div
                                initial={{ height: 0, opacity: 0 }}
                                animate={{ height: 'auto', opacity: 1 }}
                                exit={{ height: 0, opacity: 0 }}
                                className="overflow-hidden mb-3"
                              >
                                {files.length === 0 ? (
                                  <p className="text-xs text-slate-400 pb-2">No files in this folder yet.</p>
                                ) : students.length === 0 ? (
                                  <p className="text-xs text-slate-400 pb-2">No students enrolled.</p>
                                ) : (
                                  <div className="space-y-1.5 bg-slate-50 rounded-xl p-3">
                                    {students.map(s => {
                                      const stats = getStudentFolderStats(folder.id, s.user_id)
                                      const pct   = stats ? Math.round((stats.completed / stats.total) * 100) : 0
                                      return (
                                        <div key={s.user_id} className="flex items-center gap-3">
                                          <Avatar avatarUrl={s.user.avatar_url} name={s.user.full_name} size={28} />
                                          <span className="text-xs font-medium text-slate-700 w-32 truncate flex-shrink-0">
                                            {s.user.full_name}
                                          </span>
                                          <div className="flex-1 h-2 bg-slate-200 rounded-full overflow-hidden">
                                            <div
                                              className="h-full bg-slate-400 rounded-full transition-all"
                                              style={{ width: `${pct}%` }}
                                            />
                                          </div>
                                          <span className="text-xs text-slate-500 w-12 text-right flex-shrink-0">
                                            {stats ? `${stats.completed}/${stats.total}` : `0/${files.length}`}
                                          </span>
                                        </div>
                                      )
                                    })}
                                  </div>
                                )}
                              </motion.div>
                            )}
                          </AnimatePresence>
                        </div>
                      )}

                      <div className="px-3 pb-3 pt-1">
                        {/* Add File Button */}
                        {isStaff && (
                          <button
                            onClick={() => {
                              resetNewFileForm()
                              setShowNewFile(showNewFile === folder.id ? null : folder.id)
                            }}
                            className="flex items-center gap-1.5 text-xs font-semibold px-2.5 py-1.5 rounded-lg mb-2 transition-colors text-slate-600 bg-slate-100 hover:bg-slate-200"
                          >
                            <Plus size={12} /> Add File
                          </button>
                        )}

                        {/* New File Form */}
                        {showNewFile === folder.id && (
                          <form
                            onSubmit={e => handleCreateFile(e, folder.id)}
                            className="bg-white rounded-xl p-3 space-y-2.5 mb-3 border border-slate-200 shadow-sm"
                          >
                            <input
                              type="text" value={newFileTitle}
                              onChange={e => setNewFileTitle(e.target.value)}
                              placeholder="File title"
                              className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-slate-400/50"
                              autoFocus
                            />
                            <textarea
                              value={newFileDesc}
                              onChange={e => setNewFileDesc(e.target.value)}
                              placeholder="Description (optional)" rows={2}
                              className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-slate-400/50 resize-none"
                            />
                            <div className="flex flex-wrap items-center gap-3">
                              <input type="date" value={newFileDue}
                                onChange={e => setNewFileDue(e.target.value)}
                                className="border border-slate-200 rounded-lg px-3 py-2 text-sm"
                              />
                              {/* Requires check */}
                              <label className="flex items-center gap-2 text-sm text-slate-600 cursor-pointer">
                                <input
                                  type="checkbox"
                                  checked={newFileRequiresCheck}
                                  onChange={e => setNewFileRequiresCheck(e.target.checked)}
                                  className="rounded"
                                />
                                Requires staff check
                              </label>
                              {/* Requires submission */}
                              <label className="flex items-center gap-2 text-sm text-slate-600 cursor-pointer">
                                <input
                                  type="checkbox"
                                  checked={newFileRequiresSubmission}
                                  onChange={e => setNewFileRequiresSubmission(e.target.checked)}
                                  className="rounded"
                                />
                                Require submission
                              </label>
                            </div>

                            {/* Attachment */}
                            <div>
                              <p className="text-xs font-medium text-slate-500 mb-1.5">Attachment (optional)</p>
                              <div className="flex flex-wrap gap-2 mb-2">
                                {(['none', 'youtube', 'link', 'upload'] as const).map(mode => (
                                  <button
                                    key={mode}
                                    type="button"
                                    onClick={() => setNewFileAttachmentMode(mode)}
                                    className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors ${
                                      newFileAttachmentMode === mode
                                        ? 'bg-mps-blue-500 text-white border-mps-blue-500'
                                        : 'text-slate-600 border-slate-200 hover:bg-slate-100'
                                    }`}
                                  >
                                    {mode === 'none'    && 'None'}
                                    {mode === 'youtube' && <><Youtube size={13} /> YouTube</>}
                                    {mode === 'link'    && <><Link2 size={13} /> Link</>}
                                    {mode === 'upload'  && <><Upload size={13} /> Upload</>}
                                  </button>
                                ))}
                              </div>
                              {newFileAttachmentMode === 'youtube' && (
                                <input
                                  type="url" value={newFileYoutubeUrl}
                                  onChange={e => setNewFileYoutubeUrl(e.target.value)}
                                  placeholder="https://youtube.com/watch?v=..."
                                  className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-slate-400/50"
                                />
                              )}
                              {newFileAttachmentMode === 'link' && (
                                <input
                                  type="url" value={newFileLinkUrl}
                                  onChange={e => setNewFileLinkUrl(e.target.value)}
                                  placeholder="https://example.com/resource"
                                  className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-slate-400/50"
                                />
                              )}
                              {newFileAttachmentMode === 'upload' && (
                                <div>
                                  <input
                                    ref={fileInputRef}
                                    type="file"
                                    onChange={e => setNewFileUpload(e.target.files?.[0] || null)}
                                    className="hidden"
                                  />
                                  <button
                                    type="button"
                                    onClick={() => fileInputRef.current?.click()}
                                    className="flex items-center gap-2 px-3 py-2 border border-dashed border-slate-300 rounded-lg text-sm text-slate-500 hover:border-mps-blue-400 hover:text-mps-blue-600 transition-colors w-full"
                                  >
                                    <Upload size={14} />
                                    {newFileUpload ? newFileUpload.name : 'Choose file (max 20 MB)'}
                                  </button>
                                </div>
                              )}
                            </div>

                            <div className="flex justify-end gap-2">
                              <button type="button" onClick={() => setShowNewFile(null)} className="text-sm text-slate-500">Cancel</button>
                              <button
                                type="submit"
                                className="btn-primary text-sm px-3 py-1.5"
                                disabled={!newFileTitle.trim() || uploadingFile}
                              >
                                {uploadingFile ? 'Uploading...' : 'Add'}
                              </button>
                            </div>
                          </form>
                        )}

                        {/* File List */}
                        {files.length === 0 && (
                          <p className="text-xs text-slate-400 text-center py-4 italic">No files in this folder yet</p>
                        )}

                        <div className="space-y-2">
                        {files.map((file) => {
                          const status     = studentProgress[file.id] || 'not_done'
                          const submission = studentSubmissions[file.id]
                          const fileOverdue = isOverdue(file.due_date)
                          const hasAttachment = !!file.attachment_url
                          const attachType = hasAttachment ? getAttachmentType(file.attachment_url!, file.attachment_name) : 'other'
                          const embedUrl   = attachType === 'youtube' ? extractYouTubeEmbedUrl(file.attachment_url!) : null

                          // Left accent color based on status (student) or type (staff)
                          const accentClass = isStudent
                            ? status === 'completed' ? 'border-l-emerald-400'
                            : status === 'done'      ? 'border-l-yellow-400'
                            : status === 'partial'   ? 'border-l-amber-400'
                            :                          'border-l-slate-200'
                            :                          'border-l-slate-300'

                          return (
                            <div
                              key={file.id}
                              className={`bg-white rounded-xl border border-l-4 border-slate-100 shadow-sm hover:shadow-md transition-all group ${accentClass}`}
                            >
                              <div className="flex items-start gap-3 px-3 py-2.5">
                                {/* Student: Status Toggle */}
                                {isStudent && (() => {
                                  const lockedBySubmission = file.requires_submission && !!studentSubmissions[file.id]
                                  return (
                                    <button
                                      onClick={() => handleStatusToggle(file.id, file)}
                                      className={`flex-shrink-0 mt-0.5 transition-transform hover:scale-110 ${lockedBySubmission ? 'opacity-40 cursor-not-allowed' : ''}`}
                                      title={lockedBySubmission ? 'Status locked after submission' : STATUS_LABEL[status]}
                                      disabled={lockedBySubmission}
                                    >
                                      {STATUS_ICON[status]}
                                    </button>
                                  )
                                })()}

                                {/* Staff: File Icon */}
                                {isStaff && (
                                  <div className="flex-shrink-0 mt-0.5 p-1.5 rounded-lg bg-slate-100">
                                    <File size={13} className="text-slate-500" />
                                  </div>
                                )}

                                {/* File Info */}
                                <div className="flex-1 min-w-0">
                                  <div className="flex items-center gap-1.5 flex-wrap">
                                    <span className={`text-sm font-semibold ${
                                      status === 'completed' ? 'line-through text-slate-400' : 'text-slate-800'
                                    }`}>
                                      {file.title}
                                    </span>
                                    {isStudent && status !== 'not_done' && (
                                      <span className={`text-[10px] px-1.5 py-0.5 rounded-full border font-medium ${STATUS_BG[status]}`}>
                                        {STATUS_LABEL[status]}
                                      </span>
                                    )}
                                    {fileOverdue && (!isStudent || status !== 'completed') && (
                                      <span className="text-[10px] px-1.5 py-0.5 bg-red-100 text-red-600 rounded-full font-semibold">Overdue</span>
                                    )}
                                    {file.requires_submission && (
                                      <span className="text-[10px] px-1.5 py-0.5 bg-slate-100 text-slate-600 rounded-full font-medium flex items-center gap-0.5">
                                        <FileText size={9} />
                                        {isStudent && submission ? 'Submitted' : isStudent ? 'Submit required' : 'Submission'}
                                      </span>
                                    )}
                                    {file.requires_check && (
                                      <span className="text-[10px] px-1.5 py-0.5 bg-sky-100 text-sky-600 rounded-full font-medium">Staff check</span>
                                    )}
                                  </div>
                                  {file.description && (
                                    <p className="text-xs text-slate-500 mt-0.5 leading-relaxed">{file.description}</p>
                                  )}

                                  {/* Attachment */}
                                  {hasAttachment && (
                                    <div className="mt-2">
                                      {attachType === 'image' && (
                                        <button
                                          onClick={() => setImageUrl(file.attachment_url!)}
                                          className="block rounded-xl overflow-hidden border border-slate-200 hover:border-blue-300 transition-all shadow-sm hover:shadow-md max-w-[200px]"
                                        >
                                          <img src={file.attachment_url!} alt={file.attachment_name || 'Image'} className="w-full h-28 object-cover" />
                                        </button>
                                      )}
                                      {attachType === 'youtube' && (
                                        <button
                                          onClick={() => setVideoUrl(embedUrl)}
                                          className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-red-50 text-red-600 text-xs font-medium hover:bg-red-100 transition-colors border border-red-200"
                                        >
                                          <Play size={11} className="fill-current" /> Watch video
                                        </button>
                                      )}
                                      {attachType === 'doc' && (
                                        <button
                                          onClick={() => setDocViewerUrl(googleDocsViewerUrl(file.attachment_url!))}
                                          className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-slate-50 text-slate-600 text-xs font-medium hover:bg-slate-100 transition-colors border border-slate-200"
                                        >
                                          <FileText size={11} />
                                          {file.attachment_name ? file.attachment_name.split('.').slice(0, -1).join('.') || file.attachment_name : 'Open doc'}
                                        </button>
                                      )}
                                      {attachType === 'other' && (
                                        <a
                                          href={file.attachment_url!}
                                          target="_blank"
                                          rel="noopener noreferrer"
                                          className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-slate-50 text-slate-600 text-xs font-medium hover:bg-slate-100 transition-colors border border-slate-200"
                                        >
                                          <ExternalLink size={11} /> {file.attachment_name || 'Open link'}
                                        </a>
                                      )}
                                    </div>
                                  )}

                                  {/* Submit button */}
                                  {isStudent && file.requires_submission && !submission && (
                                    <button
                                      onClick={() => setShowSubmit(file.id)}
                                      className="mt-2 inline-flex items-center gap-1.5 px-3 py-1 rounded-lg bg-slate-700 text-white text-xs font-semibold hover:bg-slate-900 transition-colors shadow-sm"
                                    >
                                      <FileText size={11} /> Submit now
                                    </button>
                                  )}
                                </div>

                                {/* Right side: due date + staff actions */}
                                <div className="flex flex-col items-end gap-1.5 flex-shrink-0 self-start">
                                  {file.due_date && (
                                    <span className={`text-[10px] font-medium whitespace-nowrap ${
                                      fileOverdue && (!isStudent || status !== 'completed')
                                        ? 'text-red-500 bg-red-50 px-1.5 py-0.5 rounded-lg'
                                        : 'text-slate-400'
                                    }`}>
                                      {new Date(file.due_date).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}
                                    </span>
                                  )}
                                  {isStaff && (
                                    <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
                                      <button
                                        onClick={() => handleShowTracking(file.id)}
                                        className="p-1.5 text-slate-400 hover:text-slate-700 hover:bg-slate-100 rounded-lg transition-colors"
                                        title="Student tracking"
                                      >
                                        <Users size={13} />
                                      </button>
                                      <button
                                        onClick={() => handleDeleteFile(file.id, folder.id)}
                                        className="p-1.5 text-slate-300 hover:text-red-500 hover:bg-red-50 rounded-lg transition-colors"
                                      >
                                        <Trash2 size={13} />
                                      </button>
                                    </div>
                                  )}
                                </div>
                              </div>
                            </div>
                          )
                        })}
                        </div>
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>
            )
          })}
        </div>
      )}

      {/* ── Submit Modal ─────────────────────────────────────────────────────── */}
      <AnimatePresence>
        {showSubmit && (
          <motion.div
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm"
            onClick={() => { setShowSubmit(null); setSubmitContent('') }}
          >
            <motion.div
              initial={{ scale: 0.95 }} animate={{ scale: 1 }} exit={{ scale: 0.95 }}
              className="bg-white rounded-2xl shadow-2xl w-full max-w-md p-5 space-y-4"
              onClick={e => e.stopPropagation()}
            >
              <h3 className="text-lg font-bold text-slate-800">Submit Your Work</h3>
              <p className="text-sm text-slate-500">Write text, paste a link, or upload a file — choose whatever works for you.</p>
              <textarea
                value={submitContent}
                onChange={e => setSubmitContent(e.target.value)}
                placeholder="Type your answer or paste a link (https://...)…"
                rows={4}
                className="w-full border border-slate-200 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-slate-400/50 resize-none"
                autoFocus
              />
              <label className="flex items-center gap-3 p-3 border border-dashed border-slate-200 rounded-xl cursor-pointer hover:border-slate-400 hover:bg-slate-50 transition-colors bg-slate-50">
                <Upload size={18} className="text-slate-400 flex-shrink-0" />
                <span className="text-sm text-slate-600 flex-1">
                  {submitFile ? submitFile.name : 'Or upload a file (image, document…)'}
                </span>
                {submitFile && (
                  <span className="text-xs text-slate-400">{(submitFile.size / 1024 / 1024).toFixed(1)} MB</span>
                )}
                <input type="file" className="hidden" onChange={e => setSubmitFile(e.target.files?.[0] || null)} />
              </label>
              <div className="flex justify-end gap-2">
                <button
                  onClick={() => { setShowSubmit(null); setSubmitContent(''); setSubmitFile(null) }}
                  className="text-sm text-slate-500 px-4 py-2"
                >Cancel</button>
                <button
                  onClick={() => handleSubmitWork(showSubmit!)}
                  className="btn-primary text-sm px-4 py-2"
                  disabled={(!submitContent.trim() && !submitFile) || submittingWork}
                >{submittingWork ? 'Uploading…' : 'Submit'}</button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ── Tracking Modal ───────────────────────────────────────────────────── */}
      <AnimatePresence>
        {showTracking && (
          <motion.div
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm"
            onClick={() => setShowTracking(null)}
          >
            <motion.div
              initial={{ scale: 0.95 }} animate={{ scale: 1 }} exit={{ scale: 0.95 }}
              className="bg-white rounded-2xl shadow-2xl w-full max-w-lg max-h-[80vh] overflow-y-auto p-5"
              onClick={e => e.stopPropagation()}
            >
              <div className="flex items-center justify-between mb-1">
                <h3 className="text-lg font-bold text-slate-800">Student Tracking</h3>
                <button onClick={() => setShowTracking(null)} className="p-1 text-slate-400 hover:text-slate-600">
                  <X size={18} />
                </button>
              </div>
              {trackingData.file && (
                <p className="text-sm text-slate-500 mb-4">{trackingData.file.title}</p>
              )}

              {/* Status legend */}
              {trackingData.file && (
                <div className="flex flex-wrap gap-2 mb-4 text-xs">
                  {trackingData.file.requires_check ? (
                    <>
                      <span className="flex items-center gap-1"><Circle size={12} className="text-red-400" /> Not Done</span>
                      <span className="flex items-center gap-1"><CircleDot size={12} className="text-amber-500" /> Partial</span>
                      <span className="flex items-center gap-1"><CheckCircle2 size={12} className="text-yellow-500" /> Checking</span>
                      <span className="flex items-center gap-1"><CheckCircle2 size={12} className="text-green-500" /> Completed</span>
                    </>
                  ) : (
                    <>
                      <span className="flex items-center gap-1"><Circle size={12} className="text-red-400" /> Not Done</span>
                      <span className="flex items-center gap-1"><CircleDot size={12} className="text-amber-500" /> Partial</span>
                      <span className="flex items-center gap-1"><CheckCircle2 size={12} className="text-green-500" /> Completed</span>
                    </>
                  )}
                  <span className="text-slate-400 ml-auto">Click status to change</span>
                </div>
              )}

              {students.length === 0 ? (
                <p className="text-sm text-slate-400 text-center py-6">No students in this classroom</p>
              ) : (
                <div className="space-y-2">
                  {students.map(member => {
                    const prog   = trackingData.progress.find(p => p.student_id === member.user_id)
                    const sub    = trackingData.submissions.find(s => s.student_id === member.user_id)
                    const status : FileStatus = (prog?.status as FileStatus) || 'not_done'
                    const isUpdating = trackingUpdating === member.user_id
                    const requiresCheck = trackingData.file?.requires_check || false

                    return (
                      <div key={member.user_id} className="flex items-center gap-2 p-3 rounded-xl bg-slate-50">
                        <Avatar avatarUrl={member.user.avatar_url} name={member.user.full_name} size={32} />
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium text-slate-700">{member.user.full_name}</p>
                          {sub ? (
                            <p className="text-xs text-slate-500">Submitted</p>
                          ) : (
                            <p className="text-xs text-slate-400">No submission</p>
                          )}
                        </div>
                        {/* View submission button */}
                        {sub && (
                          <button
                            onClick={() => setExpandedSub({ name: member.user.full_name, sub })}
                            className="flex items-center gap-1 px-2 py-1 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-600 text-xs font-medium transition-colors"
                            title="View submission"
                          >
                            <Eye size={12} /> View
                          </button>
                        )}
                        {/* Interactive status button */}
                        <button
                          onClick={() => !isUpdating && handleTrackingStatusClick(
                            showTracking!, member.user_id, status, requiresCheck
                          )}
                          disabled={isUpdating}
                          className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border text-xs font-medium transition-all ${STATUS_BG[status]} hover:opacity-80 disabled:opacity-50`}
                          title="Click to change status"
                        >
                          {isUpdating
                            ? <span className="w-3 h-3 border border-current border-t-transparent rounded-full animate-spin" />
                            : STATUS_ICON[status]
                          }
                          {STATUS_LABEL[status]}
                        </button>
                      </div>
                    )
                  })}
                </div>
              )}
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ── Submission View Modal ────────────────────────────────────────────── */}
      <AnimatePresence>
        {expandedSub && (
          <motion.div
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm"
            onClick={() => setExpandedSub(null)}
          >
            <motion.div
              initial={{ scale: 0.95 }} animate={{ scale: 1 }} exit={{ scale: 0.95 }}
              className="bg-white rounded-2xl shadow-2xl w-full max-w-md p-5 space-y-3"
              onClick={e => e.stopPropagation()}
            >
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="font-bold text-slate-800">{expandedSub.name}</h3>
                  <p className="text-xs text-slate-400">Submission</p>
                </div>
                <button onClick={() => setExpandedSub(null)} className="p-1 text-slate-400 hover:text-slate-600">
                  <X size={18} />
                </button>
              </div>
              {expandedSub.sub.submission_type === 'text' && (
                <div className="bg-slate-50 rounded-xl p-4">
                  <p className="text-sm text-slate-700 whitespace-pre-wrap">{expandedSub.sub.content}</p>
                </div>
              )}
              {expandedSub.sub.submission_type === 'link' && (
                <a
                  href={expandedSub.sub.content}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center gap-2 px-4 py-3 bg-mps-blue-50 rounded-xl text-mps-blue-600 hover:bg-mps-blue-100 transition-colors text-sm font-medium"
                >
                  <ExternalLink size={14} />
                  {expandedSub.sub.content}
                </a>
              )}
              {expandedSub.sub.submission_type === 'file' && (() => {
                const url = expandedSub.sub.content
                const ext = (url.split('.').pop() || '').toLowerCase().split('?')[0]
                const isImg = IMAGE_EXTENSIONS.includes(ext)
                const isDoc = DOC_EXTENSIONS.includes(ext)
                if (isImg) {
                  return (
                    <a href={url} target="_blank" rel="noopener noreferrer" className="block">
                      <img
                        src={url}
                        alt="Submitted file"
                        className="w-full max-h-72 object-contain rounded-xl border border-slate-200 hover:opacity-90 transition-opacity"
                      />
                    </a>
                  )
                }
                if (isDoc) {
                  return (
                    <div className="space-y-2">
                      <iframe
                        src={`https://docs.google.com/viewer?url=${encodeURIComponent(url)}&embedded=true`}
                        className="w-full h-64 rounded-xl border border-slate-200"
                        title="Document preview"
                      />
                      <a
                        href={url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="flex items-center gap-2 px-3 py-2 bg-slate-50 rounded-lg text-slate-600 hover:bg-slate-100 transition-colors text-xs font-medium"
                      >
                        <ExternalLink size={12} /> Open in new tab
                      </a>
                    </div>
                  )
                }
                return (
                  <a
                    href={url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center gap-2 px-4 py-3 bg-slate-50 rounded-xl text-slate-600 hover:bg-slate-100 transition-colors text-sm font-medium"
                  >
                    <FileText size={14} />
                    View Submitted File
                  </a>
                )
              })()}
              <p className="text-xs text-slate-400">
                Submitted {new Date(expandedSub.sub.submitted_at).toLocaleString()}
              </p>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ── YouTube Video Modal ──────────────────────────────────────────────── */}
      {typeof document !== 'undefined' && createPortal(
        <AnimatePresence>
          {videoUrl && (
            <motion.div
              initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
              className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-black/85"
              onClick={() => setVideoUrl(null)}
            >
              <div className="relative w-full max-w-4xl" onClick={e => e.stopPropagation()}>
                <button
                  onClick={() => setVideoUrl(null)}
                  className="absolute -top-10 right-0 text-white/80 hover:text-white transition-colors"
                >
                  <X size={24} />
                </button>
                <div className="aspect-video w-full rounded-xl overflow-hidden shadow-2xl">
                  <iframe
                    src={videoUrl}
                    className="w-full h-full"
                    allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
                    allowFullScreen
                  />
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>,
        document.body
      )}

      {/* ── Image Lightbox ───────────────────────────────────────────────── */}
      {typeof document !== 'undefined' && createPortal(
        <AnimatePresence>
          {imageUrl && (
            <motion.div
              initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
              className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-black/85"
              onClick={() => setImageUrl(null)}
            >
              <div className="relative max-w-4xl w-full" onClick={e => e.stopPropagation()}>
                <button
                  onClick={() => setImageUrl(null)}
                  className="absolute -top-10 right-0 text-white/80 hover:text-white transition-colors"
                >
                  <X size={24} />
                </button>
                <img
                  src={imageUrl}
                  alt="Attachment"
                  className="w-full max-h-[80vh] object-contain rounded-xl shadow-2xl"
                />
              </div>
            </motion.div>
          )}
        </AnimatePresence>,
        document.body
      )}

      {/* ── Document Viewer (Google Docs — PDF, Word, PPT, Excel, etc.) ─── */}
      {typeof document !== 'undefined' && createPortal(
        <AnimatePresence>
          {docViewerUrl && (
            <motion.div
              initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
              className="fixed inset-0 z-[60] flex flex-col bg-black/90"
              onClick={() => setDocViewerUrl(null)}
            >
              <div className="flex items-center justify-between px-4 py-3 flex-shrink-0" onClick={e => e.stopPropagation()}>
                <p className="text-white/70 text-sm">Document Viewer</p>
                <button
                  onClick={() => setDocViewerUrl(null)}
                  className="text-white/80 hover:text-white transition-colors p-1"
                >
                  <X size={22} />
                </button>
              </div>
              <div className="flex-1 px-4 pb-4" onClick={e => e.stopPropagation()}>
                <iframe
                  src={docViewerUrl}
                  className="w-full h-full rounded-xl shadow-2xl bg-white"
                  title="Document Viewer"
                />
              </div>
            </motion.div>
          )}
        </AnimatePresence>,
        document.body
      )}
    </div>
  )
}
