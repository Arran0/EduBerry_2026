'use client'

import React, { useEffect, useMemo, useState, useCallback } from 'react'
import ProtectedLayout from '@/components/ProtectedLayout'
import { useRouter } from 'next/navigation'
import dynamic from 'next/dynamic'
import { Users, Search, X, ChevronLeft, Loader2, Pencil, Briefcase } from 'lucide-react'
import { fetchAllProfiles, ProfileWithTeams } from '@/lib/admin'
import { fetchStaffDetailsMap, StaffDetails } from '@/lib/staffDetails'
import { getRoleDisplayName, UserRole } from '@/lib/supabase'

const EditStaffDetailsModal = dynamic(() => import('@/components/certificates/EditStaffDetailsModal'))

const STAFF_ROLES: UserRole[] = ['teacher', 'coordinator', 'principal', 'admin', 'driver']

export default function StaffDirectoryPage() {
  const router = useRouter()
  const [staff, setStaff] = useState<ProfileWithTeams[]>([])
  const [details, setDetails] = useState<Record<string, StaffDetails>>({})
  const [loading, setLoading] = useState(true)
  const [query, setQuery] = useState('')
  const [editing, setEditing] = useState<ProfileWithTeams | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    const profiles = await fetchAllProfiles()
    const staffList = profiles.filter(p => STAFF_ROLES.includes(p.role))
    setStaff(staffList)
    const map = await fetchStaffDetailsMap(staffList.map(s => s.id))
    setDetails(map)
    setLoading(false)
  }, [])

  useEffect(() => { load() }, [load])

  const filtered = useMemo(() => {
    if (!query.trim()) return staff
    const q = query.toLowerCase()
    return staff.filter(s => {
      const d = details[s.id]
      return (
        s.full_name?.toLowerCase().includes(q) ||
        s.email?.toLowerCase().includes(q) ||
        s.role?.toLowerCase().includes(q) ||
        d?.employee_id?.toLowerCase().includes(q) ||
        d?.designation?.toLowerCase().includes(q) ||
        d?.department?.toLowerCase().includes(q)
      )
    })
  }, [query, staff, details])

  return (
    <ProtectedLayout adminOnly>
      <div className="w-full px-4 sm:px-6 lg:px-8 py-8 min-h-screen" data-page-theme="admin" style={{ backgroundColor: '#FDFCF9' }}>
        <div className="max-w-5xl mx-auto">
          {/* Header */}
          <div className="mb-5 flex items-center gap-3">
            <button onClick={() => router.back()} className="w-9 h-9 bg-white border border-[#D4D4D8] flex items-center justify-center hover:bg-[#F4F4F5] transition-colors">
              <ChevronLeft size={18} className="text-[#18181B]" />
            </button>
            <div className="w-9 h-9 bg-[#27272A] flex items-center justify-center flex-shrink-0">
              <Briefcase className="text-[#B8983C]" size={18} />
            </div>
            <div>
              <h1 className="text-xl font-bold text-[#18181B]">Staff Directory</h1>
              <p className="text-xs text-[#71717A]">Maintain employee records — designation, department, joining date &amp; contact</p>
            </div>
          </div>

          <div className="border border-[#D4D4D8] bg-white">
            {/* Search */}
            <div className="border-b border-[#E4E4E7] p-4 bg-[#F5F5F5]">
              <div className="relative">
                <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-[#71717A] pointer-events-none" />
                <input
                  type="text"
                  value={query}
                  onChange={e => setQuery(e.target.value)}
                  placeholder="Search by name, email, employee ID, designation, department…"
                  className="w-full border border-[#D4D4D8] bg-white pl-10 pr-9 py-2.5 text-sm focus:outline-none focus:border-[#27272A] transition-colors"
                />
                {query && (
                  <button onClick={() => setQuery('')} className="absolute right-3 top-1/2 -translate-y-1/2 text-[#71717A] hover:text-[#27272A]">
                    <X size={14} />
                  </button>
                )}
              </div>
            </div>

            {/* Table */}
            {loading ? (
              <div className="flex items-center justify-center py-16 gap-2 text-sm text-[#71717A]">
                <Loader2 size={16} className="animate-spin" /> Loading staff…
              </div>
            ) : filtered.length === 0 ? (
              <div className="py-16 text-center">
                <Users size={32} className="text-[#D4D4D8] mx-auto mb-2" />
                <p className="text-sm text-[#71717A]">{query ? 'No staff match your search.' : 'No staff found.'}</p>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="bg-[#F5F5F5] border-b border-[#E4E4E7] text-left">
                      <th className="px-4 py-2.5 text-[10px] font-bold uppercase tracking-widest text-[#525252]">Name</th>
                      <th className="px-4 py-2.5 text-[10px] font-bold uppercase tracking-widest text-[#525252]">Role</th>
                      <th className="px-4 py-2.5 text-[10px] font-bold uppercase tracking-widest text-[#525252]">Emp. ID</th>
                      <th className="px-4 py-2.5 text-[10px] font-bold uppercase tracking-widest text-[#525252]">Designation</th>
                      <th className="px-4 py-2.5 text-[10px] font-bold uppercase tracking-widest text-[#525252]">Department</th>
                      <th className="px-4 py-2.5 text-[10px] font-bold uppercase tracking-widest text-[#525252] text-right">Action</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filtered.map(s => {
                      const d = details[s.id]
                      return (
                        <tr key={s.id} className="border-b border-[#F4F4F5] hover:bg-[#FAFAFA] transition-colors">
                          <td className="px-4 py-3">
                            <p className="font-semibold text-[#18181B]">{s.full_name || '(no name)'}</p>
                            <p className="text-xs text-[#71717A]">{s.email}</p>
                          </td>
                          <td className="px-4 py-3 text-[#52525B]">{getRoleDisplayName(s.role)}</td>
                          <td className="px-4 py-3 text-[#52525B]">{d?.employee_id || <span className="text-[#C4C4C8]">—</span>}</td>
                          <td className="px-4 py-3 text-[#52525B]">{d?.designation || <span className="text-[#C4C4C8]">—</span>}</td>
                          <td className="px-4 py-3 text-[#52525B]">{d?.department || <span className="text-[#C4C4C8]">—</span>}</td>
                          <td className="px-4 py-3 text-right">
                            <button onClick={() => setEditing(s)}
                              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium bg-white border border-[#D4D4D8] hover:bg-[#F4F4F5] transition-colors text-[#18181B]">
                              <Pencil size={12} /> Edit
                            </button>
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>

        {editing && (
          <EditStaffDetailsModal
            staffId={editing.id}
            staffName={editing.full_name || editing.email}
            onClose={() => setEditing(null)}
            onSaved={load}
          />
        )}
      </div>
    </ProtectedLayout>
  )
}
