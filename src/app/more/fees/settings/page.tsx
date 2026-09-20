import { redirect } from 'next/navigation'

// The fee payment settings moved into Admin Space as one tab of Fee Settings.
// Kept as a redirect so an old bookmark still lands somewhere useful, matching
// what src/app/more/salary/manage/settings/page.tsx already does.

export default function FeeSettingsRedirect() {
  redirect('/admin/fee-settings')
}
