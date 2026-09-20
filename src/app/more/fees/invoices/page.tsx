import { redirect } from 'next/navigation'

// This screen is now a tab of /more/fees rather than a page of its own.
// The route is kept so existing links and bookmarks still work.

export default function FeeInvoicesRedirect() {
  redirect('/more/fees?tab=collection&sub=bills')
}
