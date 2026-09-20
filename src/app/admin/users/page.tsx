'use client'

import { useEffect } from 'react'
import { useRouter } from 'next/navigation'

// The combined user manager that used to live here was superseded by the two
// dedicated managers under /more/profiles (linked from Admin Space); nothing in
// the app pointed at this route any more. Kept as a redirect for old bookmarks,
// the same way /admin/staff already is.
export default function UsersDirectoryRedirect() {
  const router = useRouter()
  useEffect(() => {
    router.replace('/more/profiles')
  }, [router])
  return null
}
