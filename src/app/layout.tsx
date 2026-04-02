import type { Metadata } from 'next'
import './globals.css'
import { AuthProvider } from '@/contexts/AuthContext'
import { PageConfigProvider } from '@/contexts/PageConfigContext'

export const metadata: Metadata = {
  title: 'MPS Web - Muthamil Public School',
  description: 'Educational management system for Muthamil Public School',
  keywords: ['school', 'education', 'management', 'MPS', 'Muthamil Public School'],
  icons: {
    // /api/favicon serves an SVG with the uploaded logo cropped into a circle.
    // Falls back to /favicon.ico when no custom icon is configured.
    icon: { url: '/api/favicon', type: 'image/svg+xml' },
    apple: '/api/favicon',
  },
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
            {children}
          </PageConfigProvider>
        </AuthProvider>
      </body>
    </html>
  )
}
