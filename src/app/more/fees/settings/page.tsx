import { redirect } from 'next/navigation'

// This screen is now the popup behind the Fee page's Settings button rather
// than a page of its own. The route is kept so existing links still work.

export default function FeeSettingsRedirect() {
  redirect('/more/fees?tool=settings')
}
