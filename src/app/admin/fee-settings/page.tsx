import { redirect } from 'next/navigation'

// Fee Settings left Admin Space: it opens from the Settings button on the Fee
// page's banner. The route is kept so existing links and bookmarks still work.

export default function FeeSettingsRedirect() {
  redirect('/more/fees?tool=settings')
}
