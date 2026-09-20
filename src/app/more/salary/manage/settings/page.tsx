import { redirect } from 'next/navigation'

// This screen was the staff payout settings page, reached from nothing: no link
// in the app pointed at it. Its content — the bank payout form and the default
// payroll calibration — is now Payroll Settings in Admin Space, alongside the
// hidden-members list that used to sit in App Settings.
//
// Kept as a redirect rather than deleted so an admin's bookmark still lands
// somewhere useful.
export default function SalaryPayoutSettingsRedirect() {
  redirect('/admin/payroll-settings')
}
