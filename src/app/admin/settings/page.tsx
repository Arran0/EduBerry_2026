import { redirect } from 'next/navigation'

// App Settings was split up: its look-and-feel tabs are the Design page,
// Geofencing and Attendance are Admin Space pages of their own, and Bus Finance
// lives in the Transport module. The route is kept so old links still land on
// the thing they named.

const MOVED: Record<string, string> = {
  geofence: '/admin/geofencing',
  attendance: '/admin/attendance',
  bus: '/more/bus',
  'school-profile': '/admin/design?tab=school-profile',
  'page-themes': '/admin/design?tab=page-themes',
  login: '/admin/design?tab=login',
  banners: '/admin/design?tab=banners',
}

export default async function AppSettingsRedirect({ searchParams }: { searchParams: Promise<{ tab?: string }> }) {
  const { tab } = await searchParams
  redirect(MOVED[tab ?? ''] ?? '/admin/design')
}
