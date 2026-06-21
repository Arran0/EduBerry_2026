/** Shared banner styling helpers — texture, dynamic text colour & swatch
 *  backgrounds — used by PageBanner and every bespoke banner editor. */

import { hexToLuminance } from './luminance'

/**
 * Subtle fractal-noise texture as an inline data-URI. Layered over banner
 * colours at low opacity (soft-light) for a mild, tactile grain that hides
 * gradient banding without hurting text contrast.
 */
export const BANNER_TEXTURE_URI =
  "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='160' height='160'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.85' numOctaves='2' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)'/%3E%3C/svg%3E\")"

/** Luminance threshold below which a banner is considered "dark" → white text. */
export const DARK_THRESHOLD = 0.45

/** Average relative luminance of a two-stop gradient. */
export function gradientLuminance(from: string, to: string): number {
  return (hexToLuminance(from) + hexToLuminance(to)) / 2
}

/** Whether white text should be used over the given luminance. */
export function isDarkLum(lum: number): boolean {
  return lum < DARK_THRESHOLD
}

/** Gradient + mild grain for a colour swatch / banner background. */
export function swatchBackground(from: string, to: string): string {
  return `${BANNER_TEXTURE_URI}, linear-gradient(135deg, ${from}, ${to})`
}
