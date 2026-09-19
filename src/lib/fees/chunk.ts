// Batching for `.in(…)` lists.
//
// PostgREST puts an `.in()` list into the request URL, so a query filtered by
// a few thousand ids builds a request line past what a proxy or the server
// will accept — it fails with a 414 rather than returning fewer rows, and it
// only starts failing once a school has enough data to matter.
//
// 300 uuids is roughly 11 KB of URL, comfortably inside every limit.

export const CHUNK = 300

/**
 * Run `query` over `ids` in batches and concatenate the results.
 *
 * Sequential rather than parallel on purpose: these run against one Supabase
 * project from a browser, and firing twenty requests at once to save a few
 * hundred milliseconds is how a fee screen ends up rate-limited mid-render.
 */
export async function inChunks<T>(
  ids: string[],
  query: (batch: string[]) => Promise<T[]>,
  size = CHUNK,
): Promise<T[]> {
  if (ids.length === 0) return []
  if (ids.length <= size) return query(ids)

  const out: T[] = []
  for (let i = 0; i < ids.length; i += size) {
    out.push(...await query(ids.slice(i, i + size)))
  }
  return out
}
