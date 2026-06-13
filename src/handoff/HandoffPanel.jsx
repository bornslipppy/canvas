/**
 * HandoffPanel.jsx — the "spec follows the live prototype" surface.
 *
 * Fixed panel on the right. As you navigate the live prototype frame, it
 * resolves the current screen and surfaces that screen's governed spec:
 * its states (present + the valuable MISSING ones), business-rule ids,
 * interview-gap ids, code entry point, and the components it renders (with
 * their own states + implementation pointers).
 *
 * Phase-0 deliberately SURFACES the spec inline rather than deep-linking
 * into inspect.html/flow.html (that needs those viewers to accept a scroll
 * message — a Phase-1 add). This panel is the core Tier-1 value: you stop
 * grepping five files to understand one screen.
 *
 * Self-contained inline styles so it doesn't depend on Blackbird's tokens.
 */

import { useScreenBinding } from './useScreenBinding'

const S = {
  panel: {
    position: 'fixed', top: 0, right: 0, width: 360, height: '100vh',
    background: '#fff', borderLeft: '1px solid #e8eaed', boxShadow: '-2px 0 12px rgba(0,0,0,.04)',
    font: '13px/1.5 ui-sans-serif,system-ui', color: '#1a191e', overflowY: 'auto',
    zIndex: 10000, padding: '16px 18px', boxSizing: 'border-box',
  },
  kicker: { fontSize: 11, letterSpacing: '.04em', textTransform: 'uppercase', color: '#9a9aa2', margin: '0 0 2px' },
  h: { font: '600 16px/1.3 ui-sans-serif,system-ui', margin: '0 0 10px' },
  route: { font: '11px/1.4 ui-monospace,Menlo,monospace', color: '#6b6b73', background: '#f4f4f5', padding: '4px 7px', borderRadius: 6, display: 'inline-block', marginBottom: 14, wordBreak: 'break-all' },
  sec: { margin: '16px 0 6px', font: '600 12px/1.3 ui-sans-serif,system-ui', color: '#3a3a42' },
  chip: { display: 'inline-block', fontSize: 12, padding: '2px 8px', borderRadius: 999, marginRight: 6, marginBottom: 6 },
  present: { background: '#e7f6e9', color: '#0f7a3d' },
  missing: { background: '#fef3c7', color: '#9a6b00' },
  id: { background: '#eef1ff', color: '#3a51c2', fontFamily: 'ui-monospace,Menlo,monospace', fontSize: 11 },
  code: { font: '11px/1.4 ui-monospace,Menlo,monospace', color: '#6b6b73', wordBreak: 'break-all' },
  comp: { border: '1px solid #ececef', borderRadius: 8, padding: '10px 12px', margin: '8px 0' },
  compName: { font: '600 13px/1.3 ui-sans-serif,system-ui', margin: '0 0 6px' },
  empty: { color: '#9a9aa2', marginTop: 24, textAlign: 'center', fontSize: 13 },
}

export function HandoffPanel({ manifest, prototypeFrameId, onClose }) {
  const { route, screen } = useScreenBinding(manifest, prototypeFrameId)
  if (!manifest) return null

  const components = (manifest.components || [])
  const screenComponents = screen
    ? components.filter((c) => (screen.renders || []).includes(c.cid))
    : []

  return (
    <div style={S.panel}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
        <p style={S.kicker}>Handoff · {manifest.package?.name} · {manifest.package?.tier}</p>
        {onClose && (
          <button onClick={onClose} style={{ border: 'none', background: 'none', cursor: 'pointer', color: '#9a9aa2', fontSize: 18, lineHeight: 1 }}>×</button>
        )}
      </div>

      {!screen && (
        <p style={S.empty}>
          {route == null
            ? 'Navigate the live prototype. Its spec will appear here.\n\n(If nothing shows on navigation, the prototype is missing the route snippet — screen binding falls back to overview.)'
            : `No screen in the package matches route "${route}". Add or fix a routeMatch in canvas-manifest.json.`}
        </p>
      )}

      {screen && (
        <>
          <h2 style={S.h}>{screen.title || screen.sid}</h2>
          {route && <span style={S.route}>{route}</span>}

          <SidSpec screen={screen} />

          {screenComponents.length > 0 && (
            <>
              <div style={S.sec}>Components on this screen</div>
              {screenComponents.map((c) => <ComponentCard key={c.cid} c={c} />)}
            </>
          )}
        </>
      )}
    </div>
  )
}

function SidSpec({ screen }) {
  const refs = screen.specRefs || {}
  return (
    <>
      {refs.codeEntry && (
        <>
          <div style={S.sec}>Code entry</div>
          <div style={S.code}>{refs.codeEntry}</div>
        </>
      )}
      {Array.isArray(refs.brIds) && refs.brIds.length > 0 && (
        <>
          <div style={S.sec}>Business rules</div>
          {refs.brIds.map((b) => <span key={b} style={{ ...S.chip, ...S.id }}>{b}</span>)}
        </>
      )}
      {Array.isArray(refs.gIds) && refs.gIds.length > 0 && (
        <>
          <div style={S.sec}>Open interview gaps</div>
          {refs.gIds.map((g) => <span key={g} style={{ ...S.chip, ...S.id }}>{g}</span>)}
        </>
      )}
      {Array.isArray(refs.captures) && refs.captures.length > 0 && (
        <>
          <div style={S.sec}>Captures</div>
          <div style={S.code}>{refs.captures.join('\n')}</div>
        </>
      )}
    </>
  )
}

function ComponentCard({ c }) {
  return (
    <div style={S.comp}>
      <p style={S.compName}>{c.name || c.cid}</p>
      {Array.isArray(c.statesPresent) && c.statesPresent.map((s) => (
        <span key={s} style={{ ...S.chip, ...S.present }}>{s}</span>
      ))}
      {Array.isArray(c.statesMissing) && c.statesMissing.map((s) => (
        <span key={s} style={{ ...S.chip, ...S.missing }} title="Missing state — most valuable rows">⚠ {s}</span>
      ))}
      {c.implPointer && <div style={{ ...S.code, marginTop: 6 }}>{c.implPointer}</div>}
    </div>
  )
}
