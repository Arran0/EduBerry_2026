import { redirect } from 'next/navigation'

/**
 * Routes are worked on inside Transport → Configuration now, so this page only
 * forwards old links and bookmarks to the same route there.
 */
export default function RouteDetailRedirect({ params }: { params: { routeId: string } }) {
  redirect(`/more/bus?tab=config&route=${encodeURIComponent(params.routeId)}`)
}
