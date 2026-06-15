/**
 * tokens.js — pure (React-free) token resolution for the live inspector.
 *
 * Resolves a coded prototype's *computed* layout values to the design system's
 * token names — the non-color half of "Dev Mode for live prototypes". Colors
 * resolve via designSystem.tokens.byHex (see tokenFor in HandoffPanel); spacing,
 * radius and type resolve here. Kept dependency-free so it's unit-testable.
 */

export const SPACING_STEP = 4 // ARC 4px grid — fallback scale when no spacing map ships.

/**
 * Resolve a computed spacing value (px) to a DS spacing token.
 * Prefers the package's authoritative `tokens.spacing` map; when absent, infers
 * against the 4px ARC scale (labeled 'inferred', never posing as verified).
 * @returns {null | { px, token, source, nearest }} source ∈ map|inferred|off-grid|zero,
 *          nearest = { lo:{px,token}|null, hi:{px,token}|null }
 */
export function resolveSpace(px, designSystem) {
  if (px == null || isNaN(px)) return null
  const map = designSystem?.tokens?.spacing
  if (map) {
    if (map[px] != null) return { px, token: map[px], source: 'map' }
    const keys = Object.keys(map).map(Number).filter((n) => !isNaN(n)).sort((a, b) => a - b)
    let lo = null, hi = null
    for (const k of keys) { if (k <= px) lo = k; if (k >= px && hi == null) hi = k }
    return {
      px, token: null, source: 'off-grid',
      nearest: { lo: lo != null ? { px: lo, token: map[lo] } : null, hi: hi != null ? { px: hi, token: map[hi] } : null },
    }
  }
  if (px === 0) return { px, token: null, source: 'zero' }
  if (px % SPACING_STEP === 0) return { px, token: `spacing/${px / SPACING_STEP}`, source: 'inferred' }
  const lo = Math.floor(px / SPACING_STEP) * SPACING_STEP
  const hi = lo + SPACING_STEP
  return {
    px, token: null, source: 'off-grid',
    nearest: { lo: { px: lo, token: `spacing/${lo / SPACING_STEP}` }, hi: { px: hi, token: `spacing/${hi / SPACING_STEP}` } },
  }
}

/** Resolve a corner radius (px) to a DS radius token via `tokens.radius`. */
export function resolveRadius(px, designSystem) {
  if (px == null || isNaN(px) || px === 0) return null
  const map = designSystem?.tokens?.radius
  if (map && map[px] != null) return { px, token: map[px], source: 'map' }
  return { px, token: null, source: 'unmapped' }
}

/** Resolve font size/line/weight to a named text style via `tokens.type`. */
export function resolveType(size, line, weight, designSystem) {
  if (size == null || isNaN(size)) return null
  const list = designSystem?.tokens?.type
  if (Array.isArray(list)) {
    const hit = list.find((t) =>
      Number(t.size) === Number(size) &&
      (t.line == null || Number(t.line) === Number(line)) &&
      (t.weight == null || Number(t.weight) === Number(weight)))
    if (hit) return { token: hit.name, size, line, weight, source: 'map' }
  }
  return { token: null, size, line, weight, source: 'unmapped' }
}

export const expandBox = (p) =>
  p.length === 1 ? [p[0], p[0], p[0], p[0]]
  : p.length === 2 ? [p[0], p[1], p[0], p[1]]
  : p.length === 3 ? [p[0], p[1], p[2], p[1]]
  : [p[0], p[1], p[2], p[3]]

/**
 * Numeric layout metrics for an inspected element. Prefers the structured
 * `info.metrics` object (emitted by newer snippets); falls back to parsing the
 * layout/style/typography strings so packages built before that still resolve.
 */
export function readMetrics(info) {
  if (info?.metrics && typeof info.metrics === 'object') return info.metrics
  const m = {}
  const grab = (re, src) => { const x = (src || '').match(re); return x ? x[1] : null }
  const padStr = grab(/padding:\s*([^;]+);/, info?.layout)
  if (padStr) {
    const [t, r, b, l] = expandBox(padStr.trim().split(/\s+/).map((v) => parseFloat(v)))
    Object.assign(m, { paddingTop: t, paddingRight: r, paddingBottom: b, paddingLeft: l })
  }
  const gap = grab(/(?:^|\n)gap:\s*([\d.]+)px/, info?.layout); if (gap != null) m.gap = parseFloat(gap)
  const rad = grab(/border-radius:\s*([\d.]+)px/, info?.style); if (rad != null) m.borderRadius = parseFloat(rad)
  const fs = grab(/font-size:\s*([\d.]+)px/, info?.typography); if (fs != null) m.fontSize = parseFloat(fs)
  const lh = grab(/line-height:\s*([\d.]+)px/, info?.typography); if (lh != null) m.lineHeight = parseFloat(lh)
  const fw = grab(/font-weight:\s*([\d.]+)/, info?.typography); if (fw != null) m.fontWeight = parseFloat(fw)
  return m
}
