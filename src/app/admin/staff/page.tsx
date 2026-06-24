'use client'

import { useEffect } from 'react'
import { useRouter } from 'next/navigation'

export default function StaffDirectoryRedirect() {
  const router = useRouter()
  useEffect(() => {
    router.replace('/more/profiles/staff')
  }, [router])
  return null
}
