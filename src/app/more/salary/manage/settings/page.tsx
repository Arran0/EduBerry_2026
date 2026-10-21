import { redirect } from 'next/navigation'

// This screen was the staff payout settings page, reached from nothing: no link
// in the app pointed at it. Its content — the bank payout form and the default
// payroll calibration — is now Payroll Settings, the popup behind the Salary
// page's Settings button.
//
// Kept as a redirect rather than deleted so an admin's bookmark still lands
// somewhere useful.
export default function SalaryPayoutSettingsRedirect() {
  redirect('/more/salary?panel=settings')
}
