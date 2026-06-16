/** WCAG 2.1 relative-luminance helpers, shared across banner pages. */

export function sRGBToLinear(c: number): number {
  const v = c / 255
  return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4)
}

/** Compute relative luminance [0..1] of a CSS hex colour (#rrggbb or #rgb). */
export function hexToLuminance(hex: string): number {
  const h = hex.replace('#', '').padEnd(6, '0')
  const r = parseInt(h.slice(0, 2), 16)
  const g = parseInt(h.slice(2, 4), 16)
  const b = parseInt(h.slice(4, 6), 16)
  if (isNaN(r) || isNaN(g) || isNaN(b)) return 0.1
  return 0.2126 * sRGBToLinear(r) + 0.7152 * sRGBToLinear(g) + 0.0722 * sRGBToLinear(b)
}

/**
 * Samples the bottom `sampleFrac` of an image (scaled down for performance)
 * and returns the average relative luminance [0..1].
 * Falls back to 0.25 (dark → white text) on CORS or load errors.
 */
export function sampleImageLuminance(src: string, sampleFrac = 0.4): Promise<number> {
  return new Promise(resolve => {
    const img = new Image()
    img.crossOrigin = 'anonymous'
    img.onload = () => {
      try {
        const canvas = document.createElement('canvas')
        const w = Math.min(img.width, 160)
        const h = Math.round((img.height / img.width) * w)
        canvas.width = w
        canvas.height = h
        const ctx = canvas.getContext('2d')!
        ctx.drawImage(img, 0, 0, w, h)
        const sy = Math.floor(h * (1 - sampleFrac))
        const { data } = ctx.getImageData(0, sy, w, Math.max(1, h - sy))
        let sum = 0
        const n = data.length / 4
        for (let i = 0; i < data.length; i += 4) {
          sum += 0.2126 * sRGBToLinear(data[i]) +
                 0.7152 * sRGBToLinear(data[i + 1]) +
                 0.0722 * sRGBToLinear(data[i + 2])
        }
        resolve(sum / n)
      } catch {
        resolve(0.25)
      }
    }
    img.onerror = () => resolve(0.25)
    img.src = src
  })
}
