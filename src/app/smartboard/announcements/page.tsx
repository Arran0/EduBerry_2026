'use client'

import { useEffect } from 'react'
import { useRouter } from 'next/navigation'

export default function SmartboardAnnouncementsRedirect() {
  const router = useRouter()
  useEffect(() => { router.replace('/announcements') }, [router])
  return null
}
