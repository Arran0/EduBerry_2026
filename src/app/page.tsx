'use client'

import { useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { useAuth } from '@/contexts/AuthContext'
import { usePageConfig } from '@/contexts/PageConfigContext'

export default function RootPage() {
  const { user, loading } = useAuth()
  const { branding, brandingLoaded } = usePageConfig()
  const router = useRouter()

  useEffect(() => {
    if (!loading) {
      if (user) {
        router.push('/home')
      } else {
        router.push('/login')
      }
    }
  }, [user, loading, router])

  return (
    <div className="min-h-screen flex items-center justify-center bg-white">
      <div className="text-center">
        {brandingLoaded && branding.logoUrl && (
          <div className="w-24 h-24 mx-auto mb-6 rounded-full overflow-hidden shadow-xl ring-4 ring-white/80">
            <img
              src={branding.logoUrl}
              alt="Logo"
              className="object-cover w-full h-full"
            />
          </div>
        )}
        <div className="spinner mx-auto" />
      </div>
    </div>
  )
}
