/**
 * tokens.test.mjs — run: node src/handoff/tokens.test.mjs (from canvas/)
 * Exercises the real resolution logic used by the live inspector.
 */
import { resolveSpace, resolveRadius, resolveType, readMetrics } from './tokens.js'

let pass = 0, fail = 0
const eq = (name, got, want) => {
  const g = JSON.stringify(got), w = JSON.stringify(want)
  if (g === w) { pass++ } else { fail++; console.error(`✗ ${name}\n   got:  ${g}\n   want: ${w}`) }
}

// A package that ships an authoritative spacing/radius/type map.
const ds = {
  tokens: {
    spacing: { 4: '--gst-spacing-1', 8: '--gst-spacing-2', 16: '--gst-spacing-4' },
    radius: { 8: '--gst-radius-lg' },
    type: [{ size: 14, line: 20, weight: 400, name: 'Text/Base/Regular' }],
  },
}

// 1. Authoritative map hit → verified token.
eq('spacing map hit', resolveSpace(8, ds), { px: 8, token: '--gst-spacing-2', source: 'map' })

// 2. Map miss → off-grid with nearest tokens FROM THE MAP (not the 4px guess).
eq('spacing map miss → nearest', resolveSpace(12, ds), {
  px: 12, token: null, source: 'off-grid',
  nearest: { lo: { px: 8, token: '--gst-spacing-2' }, hi: { px: 16, token: '--gst-spacing-4' } },
})

// 3. No map → on-grid value inferred against the 4px scale (labeled inferred).
eq('spacing inferred on-grid', resolveSpace(8, {}), { px: 8, token: 'spacing/2', source: 'inferred' })

// 4. No map → off-grid value reports nearest inferred steps.
eq('spacing inferred off-grid', resolveSpace(6, {}), {
  px: 6, token: null, source: 'off-grid',
  nearest: { lo: { px: 4, token: 'spacing/1' }, hi: { px: 8, token: 'spacing/2' } },
})

// 5. Radius + type resolution.
eq('radius map hit', resolveRadius(8, ds), { px: 8, token: '--gst-radius-lg', source: 'map' })
eq('radius unmapped', resolveRadius(6, ds), { px: 6, token: null, source: 'unmapped' })
eq('type map hit', resolveType(14, 20, 400, ds), { token: 'Text/Base/Regular', size: 14, line: 20, weight: 400, source: 'map' })
eq('type unmapped', resolveType(13, 18, 400, ds).token, null)

// 6. readMetrics prefers structured metrics.
eq('metrics structured', readMetrics({ metrics: { paddingTop: 8, gap: 4 } }), { paddingTop: 8, gap: 4 })

// 7. readMetrics falls back to parsing strings (old packages). Shorthand padding expands.
const parsed = readMetrics({
  layout: 'display: flex;\npadding: 8px 16px;\ngap: 8px;',
  style: 'border-radius: 8px;',
  typography: 'font-size: 14px;\nline-height: 20px;\nfont-weight: 400;',
})
eq('metrics parsed', parsed, {
  paddingTop: 8, paddingRight: 16, paddingBottom: 8, paddingLeft: 16,
  gap: 8, borderRadius: 8, fontSize: 14, lineHeight: 20, fontWeight: 400,
})

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
