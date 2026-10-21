import { redirect } from 'next/navigation'

// Payroll Settings left Admin Space: it opens from the Settings button on the
// Salary page's banner. The route is kept so existing links and bookmarks
// still work.

export default function PayrollSettingsRedirect() {
  redirect('/more/salary?panel=settings')
}
