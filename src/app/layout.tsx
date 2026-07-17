import type { Metadata, Viewport } from 'next'
import './globals.css'
import { AuthProvider } from '@/contexts/AuthContext'
import { PageConfigProvider } from '@/contexts/PageConfigContext'
import { ProfileCardProvider } from '@/contexts/ProfileCardContext'
import { BottomNavProvider } from '@/contexts/BottomNavContext'
import ProfileCard from '@/components/ProfileCard'
import BottomNav from '@/components/BottomNav'

export const metadata: Metadata = {
  title: 'EduBerry',
  description: 'Education system for modern schools',
  keywords: ['school', 'education', 'management', 'EduBerry'],
  manifest: '/manifest.json',
  appleWebApp: {
    capable: true,
    title: 'EduBerry',
    // black-translucent makes the web app run under the status bar (true
    // fullscreen on iOS, paired with viewportFit:'cover' below).
    statusBarStyle: 'black-translucent',
  },
  // Non-deprecated counterpart to apple-mobile-web-app-capable (Android/Chrome).
  other: {
    'mobile-web-app-capable': 'yes',
  },
  icons: {
    // /api/favicon serves an SVG with the uploaded logo cropped into a circle.
    // Falls back to /favicon.ico when no custom icon is configured.
    icon: { url: '/api/favicon', type: 'image/svg+xml' },
    apple: '/apple-touch-icon.png',
  },
}

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  // Lock the scale so the browser never auto-zooms when a field is focused
  // (iOS Safari honours `maximumScale` for that). Trade-off: this also disables
  // pinch-to-zoom app-wide, which is the behaviour requested.
  maximumScale: 1,
  userScalable: false,
  // Allows content to extend into the notch/home-bar area so the app
  // fills the full screen when used as a PWA or in standalone mode.
  viewportFit: 'cover',
  // Drives the status-bar tint (iOS) and the browser theme bar (Android).
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#ffffff' },
    { media: '(prefers-color-scheme: dark)',  color: '#0f172a' },
  ],
  interactiveWidget: 'resizes-visual',
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
              {/*
                BottomNavProvider/BottomNav live here — at the persistent root —
                rather than inside per-page ProtectedLayout, so the nav bar is a
                single element that survives client-side navigation instead of
                unmounting and remounting on every route change. A fresh mount
                can't animate (there's no previous state to transition from),
                which is what made the collapse/expand snap instead of easing.
              */}
              <BottomNavProvider>
                {children}
                <BottomNav />
              </BottomNavProvider>
              {/* Global profile card portal — renders on top of everything */}
              <ProfileCard />
            </ProfileCardProvider>
          </PageConfigProvider>
        </AuthProvider>
      </body>
    </html>
  )
}
