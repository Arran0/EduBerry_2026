import type { Metadata, Viewport } from 'next'
import './globals.css'
import { AuthProvider } from '@/contexts/AuthContext'
import { PageConfigProvider } from '@/contexts/PageConfigContext'
import { ProfileCardProvider } from '@/contexts/ProfileCardContext'
import ProfileCard from '@/components/ProfileCard'

export const metadata: Metadata = {
  title: 'EduBerry',
  description: 'Education system for modern schools',
  keywords: ['school', 'education', 'management', 'EduBerry'],
  icons: {
    // /api/favicon serves an SVG with the uploaded logo cropped into a circle.
    // Falls back to /favicon.ico when no custom icon is configured.
    icon: { url: '/api/favicon', type: 'image/svg+xml' },
    apple: '/api/favicon',
  },
}

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  // Keeps pinch-to-zoom working (good for accessibility) while
  // preventing the auto-zoom that fires when focusing a small input.
  // The actual auto-zoom is suppressed via CSS font-size ≥ 16 px on mobile.
  maximumScale: 5,
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="en">
      <body className="mesh-bg min-h-screen">
        <AuthProvider>
          <PageConfigProvider>
            <ProfileCardProvider>
              {children}
              {/* Global profile card portal — renders on top of everything */}
              <ProfileCard />
            </ProfileCardProvider>
          </PageConfigProvider>
        </AuthProvider>
      </body>
    </html>
  )
}
