import { redirect } from 'next/navigation'

/**
 * Routes are worked on inside Transport → Configuration now, so this page only
 * forwards old links and bookmarks to the same route there.
 */
export default async function RouteDetailRedirect(props: { params: Promise<{ routeId: string }> }) {
 const params = await props.params;
 redirect(`/more/bus?tab=config&route=${encodeURIComponent(params.routeId)}`)
}
