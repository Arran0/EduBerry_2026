/**
 * Which tiles the transport map draws.
 *
 * The deployment's own Mapbox token when one is configured, OpenStreetMap's
 * tiles otherwise. A school's own token, set in Configuration, comes first —
 * see ./settings.ts for the full order. The map component also falls back to OpenStreetMap on its own if
 * Mapbox starts refusing tiles (a revoked or URL-restricted token), so a bad
 * key degrades to a plainer map rather than a grey box.
 *
 * The map used to draw CARTO's "voyager" tiles with no key at all. CARTO now
 * answers keyless requests with an "API KEY REQUIRED" placeholder image —
 * served as a perfectly valid tile, so nothing errored and the map simply
 * filled with watermarks. That is why the fallback is OpenStreetMap, which
 * needs no key (attribution only), and not CARTO.
 *
 * Next.js only inlines a `NEXT_PUBLIC_` variable it can see written out in
 * full, so each accepted name is spelled out rather than looked up by key. Any
 * of them works; NEXT_PUBLIC_MAPBOX_TOKEN is the documented one. The value is
 * read at build time — after adding it in the hosting provider's environment
 * settings, the site has to be redeployed for the map to pick it up.
 */

export const MAPBOX_TOKEN: string =
  process.env.NEXT_PUBLIC_MAPBOX_TOKEN
  || process.env.NEXT_PUBLIC_MAPBOX_ACCESS_TOKEN
  || process.env.NEXT_PUBLIC_MAPBOX_API_KEY
  || process.env.NEXT_PUBLIC_MAPBOX_KEY
  || ''

export interface TileSource {
  provider: 'mapbox' | 'osm'
  url: string
  attribution: string
  tileSize: number
  zoomOffset: number
  subdomains?: string
  maxZoom: number
}

export const OSM_TILES: TileSource = {
  provider: 'osm',
  url: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
  attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
  tileSize: 256,
  zoomOffset: 0,
  maxZoom: 19,
}

export function mapboxTiles(token: string, style = 'mapbox/streets-v12'): TileSource {
  return {
    provider: 'mapbox',
    url: `https://api.mapbox.com/styles/v1/${style}/tiles/512/{z}/{x}/{y}@2x?access_token=${encodeURIComponent(token)}`,
    attribution: '&copy; <a href="https://www.mapbox.com/about/maps/">Mapbox</a> &copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
    tileSize: 512,
    zoomOffset: -1,
    maxZoom: 22,
  }
}

export function defaultTiles(): TileSource {
  return MAPBOX_TOKEN ? mapboxTiles(MAPBOX_TOKEN) : OSM_TILES
}
