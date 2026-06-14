/**
 * HandoffPanel.jsx — the spec drawer. A tabbed side panel:
 *
 *   - Spec / Screens tab:
 *       FOLLOW mode (single-frame layout): follows the live prototype's
 *       navigation and shows the current screen's spec.
 *       LIST mode (per-screen layout): lists every screen; pick one to see its
 *       spec. The canvas holds the live screens; the drawer holds what to know.
 *   - One tab per artifact (Inspect, Flow, Intent, Verification): rendered inline
 *       in an iframe, so spec docs live in the drawer instead of as canvas frames.
 *
 * Rule of thumb the layout expresses: frames = "what it is" (live screens),
 * drawer = "what to know about it" (spec + inspect + docs).
 */

import { useState } from 'react'
import { useScreenBinding } from './useScreenBinding'

const S = {
  panel: {
    position: 'fixed', top: 0, right: 0, width: 400, height: '100vh',
    display: 'flex', flexDirection: 'column',
    background: '#262626', borderLeft: '1px solid #3c3c3c', boxShadow: '-2px 0 16px rgba(0,0,0,.35)',
    zIndex: 10000, font: '13px/1.5 ui-sans-serif,system-ui', color: '#a8a8a8',
  },
  head: { display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', padding: '14px 16px 8px' },
  kicker: { fontSize: 11, letterSpacing: '.04em', textTransform: 'uppercase', color: '#7a7a7a', margin: 0 },
  x: { border: 'none', background: 'none', cursor: 'pointer', color: '#7a7a7a', fontSize: 18, lineHeight: 1 },
  tabs: { display: 'flex', gap: 4, padding: '4px 10px 8px', overflowX: 'auto', borderBottom: '1px solid #313131', flexShrink: 0 },
  tab: { padding: '5px 10px', borderRadius: 7, cursor: 'pointer', whiteSpace: 'nowrap', fontSize: 12, color: '#a8a8a8', border: '1px solid transparent' },
  tabOn: { background: '#3c3c3c', color: '#fff' },
  body: { flex: 1, overflow: 'auto', padding: '14px 16px' },
  frameWrap: { flex: 1, minHeight: 0 },
  iframe: { width: '100%', height: '100%', border: 'none' },
  h: { font: '600 16px/1.3 ui-sans-serif,system-ui', margin: '0 0 10px', color: '#ffffff' },
  route: { font: '11px/1.4 ui-monospace,Menlo,monospace', color: '#c8c8c8', background: '#313131', padding: '4px 7px', borderRadius: 6, display: 'inline-block', marginBottom: 14, wordBreak: 'break-all' },
  sec: { margin: '16px 0 6px', font: '600 12px/1.3 ui-sans-serif,system-ui', color: '#e8e8e8' },
  chip: { display: 'inline-block', fontSize: 12, padding: '2px 8px', borderRadius: 999, marginRight: 6, marginBottom: 6 },
  present: { background: '#16361f', color: '#6bd998' },
  missing: { background: '#3a2f12', color: '#f0c060' },
  id: { background: '#232a4d', color: '#aebfff', fontFamily: 'ui-monospace,Menlo,monospace', fontSize: 11 },
  code: { font: '11px/1.4 ui-monospace,Menlo,monospace', color: '#a8a8a8', wordBreak: 'break-all' },
  comp: { border: '1px solid #3c3c3c', borderRadius: 8, padding: '10px 12px', margin: '8px 0', background: '#2c2c2b' },
  compName: { font: '600 13px/1.3 ui-sans-serif,system-ui', margin: '0 0 6px', color: '#ffffff' },
  empty: { color: '#7a7a7a', marginTop: 24, textAlign: 'center', fontSize: 13, whiteSpace: 'pre-line' },
  pill: { display: 'inline-block', padding: '3px 9px', margin: '0 6px 6px 0', borderRadius: 999, border: '1px solid #3c3c3c', color: '#a8a8a8', cursor: 'pointer', fontSize: 12 },
  pillOn: { background: '#3c3c3c', color: '#fff', borderColor: '#5a5a5a' },
  copyBtn: { fontSize: 11, padding: '3px 8px', borderRadius: 6, border: '1px solid #3c3c3c', background: '#2c2c2b', cursor: 'pointer', color: '#c8c8c8' },
  pre: { margin: '6px 0 0', padding: '10px 12px', background: '#1e1e1e', borderRadius: 8, font: '11px/1.5 ui-monospace,Menlo,monospace', whiteSpace: 'pre-wrap', wordBreak: 'break-word', color: '#e6e6e6' },
  docRow: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '9px 11px', margin: '4px 0', border: '1px solid #3c3c3c', borderRadius: 8, cursor: 'pointer', fontSize: 13, background: '#2c2c2b' },
  resize: { position: 'absolute', left: -3, top: 0, width: 8, height: '100%', cursor: 'ew-resize', zIndex: 3 },
  dsBox: { border: '1px solid #3f5d78', background: '#1b2530', borderRadius: 8, padding: '10px 12px', margin: '4px 0 8px' },
  dsName: { font: '600 14px/1.3 ui-sans-serif,system-ui', color: '#aebfff', margin: '0 0 6px' },
  crit: { background: '#3a1718', color: '#f08a8a' },
  driftRow: { borderLeft: '3px solid', borderRadius: 4, padding: '6px 8px', margin: '6px 0', background: '#241f12', fontSize: 12 },
}

/** matched=green, variant-gap=amber, custom=blue */
const clsStyle = (c) => (c === 'matched' ? S.present : c === 'variant-gap' ? S.missing : S.id)
/** drift severity → colour */
const sevColor = (s) => (s === 'critical' ? '#f08a8a' : s === 'warning' ? '#f0c060' : '#9db4ff')

const MIN_W = 320
const MAX_W = 760
const clampW = (w) => Math.max(MIN_W, Math.min(MAX_W, w))

export function HandoffPanel({ manifest, prototypeFrameId, artifacts = [], activeSid = null, onSelectSid, onFocusScreen, inspect = null, liveDriftCounts = {}, onClearInspect, onClose }) {
  const followMode = !!prototypeFrameId
  const [tab, setTab] = useState('spec')
  const [width, setWidth] = useState(420)
  const [dragging, setDragging] = useState(false)
  // Adjust-state-during-render (no effect): jump to the right tab when the canvas
  // pushes a new selection — a clicked screen → Spec, an Alt-clicked element → Element.
  const [prevSid, setPrevSid] = useState(activeSid)
  if (activeSid !== prevSid) {
    setPrevSid(activeSid)
    if (activeSid != null) setTab('spec')
  }
  const [prevInspect, setPrevInspect] = useState(inspect)
  if (inspect !== prevInspect) {
    setPrevInspect(inspect)
    if (inspect != null) setTab('element')
  }
  // Group artifacts by their package layer (Flow, Components & states, …),
  // preserving manifest order — one tab per group.
  const groups = []
  for (const a of artifacts) {
    const g = a.group || 'Docs'
    let b = groups.find((x) => x.name === g)
    if (!b) { b = { name: g, items: [] }; groups.push(b) }
    b.items.push(a)
  }
  const tabs = [
    ...(inspect ? [{ id: 'element', title: 'Element' }] : []),
    { id: 'spec', title: followMode ? 'Spec' : 'Screens' },
    ...groups.map((g) => ({ id: g.name, title: g.name })),
  ]
  const group = groups.find((g) => g.name === tab)

  return (
    <>
      {/* Full-screen capture overlay while dragging — needed because mousemove
          over the live prototype iframes wouldn't otherwise reach the window. */}
      {dragging && (
        <div
          style={{ position: 'fixed', inset: 0, zIndex: 10001, cursor: 'ew-resize' }}
          onMouseMove={(e) => setWidth(clampW(window.innerWidth - e.clientX))}
          onMouseUp={() => setDragging(false)}
        />
      )}
      <div style={{ ...S.panel, width }}>
        <style>{MD_CSS}</style>
        <div
          onMouseDown={(e) => { e.preventDefault(); setDragging(true) }}
          title="Drag to resize"
          style={S.resize}
        />
        <div style={S.head}>
        <p style={S.kicker}>Handoff · {manifest.package?.name} · {manifest.package?.tier}</p>
        {onClose && <button onClick={onClose} style={S.x}>×</button>}
      </div>

      {tabs.length > 1 && (
        <div style={S.tabs}>
          {tabs.map((t) => (
            <span key={t.id} onClick={() => setTab(t.id)} style={{ ...S.tab, ...(t.id === tab ? S.tabOn : {}) }}>
              {t.title}
            </span>
          ))}
        </div>
      )}

      {tab === 'element' && inspect ? (
        <div style={S.body}><ElementInspect info={inspect} designSystem={manifest.designSystem} onClear={onClearInspect} /></div>
      ) : tab === 'spec' ? (
        <div style={S.body}>
          {followMode
            ? <FollowSpec manifest={manifest} prototypeFrameId={prototypeFrameId} liveDriftCounts={liveDriftCounts} />
            : <ListSpec manifest={manifest} activeSid={activeSid} onSelectSid={onSelectSid} onFocusScreen={onFocusScreen} liveDriftCounts={liveDriftCounts} />}
        </div>
      ) : group ? (
        <GroupTab docs={group.items} />
      ) : null}
      </div>
    </>
  )
}

/** Group tab — stacks every doc in a package layer vertically. Markdown renders
 *  inline as styled HTML (with copy buttons on code blocks); html docs
 *  (flow.html / inspect.html) embed as live iframes. */
function GroupTab({ docs }) {
  return (
    <div style={S.body}>
      {docs.map((d) => (
        <section key={d.id} style={{ marginBottom: 22 }}>
          <div style={{ ...S.sec, marginTop: 0, color: '#ffffff', fontSize: 13 }}>{d.title}</div>
          {d.type === 'html'
            ? <iframe title={d.title} srcDoc={d.content} style={{ width: '100%', height: 380, border: '1px solid #3c3c3c', borderRadius: 8, background: '#262626' }} />
            : <MarkdownDoc text={d.content} />}
        </section>
      ))}
    </div>
  )
}

/** Inline markdown → styled HTML, with click-to-copy on fenced code blocks. */
function MarkdownDoc({ text }) {
  const onClick = (e) => {
    const btn = e.target.closest?.('.cbtn')
    if (!btn) return
    const pre = btn.parentElement.querySelector('pre')
    if (pre) { try { navigator.clipboard?.writeText(pre.textContent) } catch { /* noop */ } btn.textContent = 'Copied'; setTimeout(() => { btn.textContent = 'Copy' }, 900) }
  }
  return <div className="hd-md" onClick={onClick} dangerouslySetInnerHTML={{ __html: mdToHtml(text) }} />
}

function mdToHtml(md) {
  const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  const inline = (t) => esc(t)
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" target="_blank" rel="noreferrer">$1</a>')
  const lines = md.replace(/\r/g, '').split('\n')
  const cells = (r) => r.trim().replace(/^\||\|$/g, '').split('|').map((c) => c.trim())
  let html = '', i = 0
  while (i < lines.length) {
    const line = lines[i]
    if (/^```/.test(line)) {
      const buf = []; i++
      while (i < lines.length && !/^```/.test(lines[i])) { buf.push(lines[i]); i++ }
      i++
      html += `<div class="cb"><button class="cbtn" type="button">Copy</button><pre>${esc(buf.join('\n'))}</pre></div>`
      continue
    }
    const h = line.match(/^(#{1,6})\s+(.*)$/)
    if (h) { const l = h[1].length; html += `<h${l}>${inline(h[2])}</h${l}>`; i++; continue }
    if (/^---+$/.test(line)) { html += '<hr/>'; i++; continue }
    if (/^\s*\|.*\|\s*$/.test(line) && i + 1 < lines.length && /^\s*\|?[\s:|-]+\|/.test(lines[i + 1])) {
      const header = line; i += 2
      let t = '<table><thead><tr>' + cells(header).map((c) => `<th>${inline(c)}</th>`).join('') + '</tr></thead><tbody>'
      while (i < lines.length && /^\s*\|.*\|\s*$/.test(lines[i])) { t += '<tr>' + cells(lines[i]).map((c) => `<td>${inline(c)}</td>`).join('') + '</tr>'; i++ }
      html += t + '</tbody></table>'; continue
    }
    if (/^\s*[-*]\s+/.test(line)) {
      let it = ''; while (i < lines.length && /^\s*[-*]\s+/.test(lines[i])) { it += `<li>${inline(lines[i].replace(/^\s*[-*]\s+/, ''))}</li>`; i++ }
      html += `<ul>${it}</ul>`; continue
    }
    if (/^\s*\d+\.\s+/.test(line)) {
      let it = ''; while (i < lines.length && /^\s*\d+\.\s+/.test(lines[i])) { it += `<li>${inline(lines[i].replace(/^\s*\d+\.\s+/, ''))}</li>`; i++ }
      html += `<ol>${it}</ol>`; continue
    }
    if (/^\s*$/.test(line)) { i++; continue }
    const para = [line]; i++
    while (i < lines.length && !/^\s*$/.test(lines[i]) && !/^(#{1,6})\s|^```|^\s*[-*]\s|^\s*\d+\.\s|^\s*\|/.test(lines[i])) { para.push(lines[i]); i++ }
    html += `<p>${inline(para.join(' '))}</p>`
  }
  return html
}

const MD_CSS = `
.hd-md{font:13px/1.55 ui-sans-serif,system-ui;color:#a8a8a8}
.hd-md h1,.hd-md h2{font-size:15px;font-weight:600;margin:14px 0 8px;color:#fff}
.hd-md h3{font-size:13px;font-weight:600;margin:12px 0 6px;color:#e8e8e8}
.hd-md p{margin:8px 0}
.hd-md ul,.hd-md ol{margin:8px 0;padding-left:20px}
.hd-md li{margin:3px 0}
.hd-md a{color:#d8d8d8;text-decoration:underline}
.hd-md hr{border:none;border-top:1px solid #3c3c3c;margin:14px 0}
.hd-md code{background:#313131;color:#c8c8c8;padding:1px 5px;border-radius:4px;font:11px ui-monospace,Menlo,monospace}
.hd-md table{border-collapse:collapse;width:100%;font-size:12px;margin:8px 0}
.hd-md th,.hd-md td{border:1px solid #3c3c3c;padding:5px 8px;text-align:left;vertical-align:top}
.hd-md th{background:#2c2c2b;font-weight:600;color:#fff}
.hd-md td{color:#a8a8a8}
.hd-md .cb{position:relative;margin:8px 0}
.hd-md .cb pre{margin:0;padding:10px 12px;background:#1e1e1e;color:#e6e6e6;border-radius:8px;overflow:auto;font:11px/1.5 ui-monospace,Menlo,monospace}
.hd-md .cbtn{position:absolute;top:6px;right:6px;font-size:10px;padding:2px 7px;border-radius:5px;border:1px solid #3c3c3c;background:#313131;color:#c8c8c8;cursor:pointer}
`

/** FOLLOW mode body — single live prototype frame drives the spec. */
function FollowSpec({ manifest, prototypeFrameId, liveDriftCounts = {} }) {
  const { route, screen } = useScreenBinding(manifest, prototypeFrameId)
  const components = manifest.components || []
  const screenComponents = screen ? components.filter((c) => (screen.renders || []).includes(c.cid)) : []
  if (!screen) {
    return (
      <p style={S.empty}>
        {route == null
          ? 'Navigate the live prototype. Its spec will appear here.'
          : `No screen matches "${route}". Fix a routeMatch/stateMatch in canvas-manifest.json.`}
      </p>
    )
  }
  // Single prototype reports under '_proto' (it repaints in place per screen).
  return <ScreenSpec screen={screen} route={route} components={screenComponents} live={liveDriftCounts._proto} />
}

/** LIST mode body — per-screen layout. Selection is controlled by App so that
 *  clicking a live screen frame on the canvas selects it here too. The pills
 *  remain a manual fallback. */
function ListSpec({ manifest, activeSid, onSelectSid, onFocusScreen, liveDriftCounts = {} }) {
  const screens = manifest.screens || []
  const [localSel, setLocalSel] = useState(screens[0]?.sid ?? null)
  const sel = activeSid ?? localSel
  const select = (sid) => { setLocalSel(sid); onSelectSid?.(sid); onFocusScreen?.(sid) }
  const screen = screens.find((s) => s.sid === sel) || null
  const components = manifest.components || []
  const screenComponents = screen ? components.filter((c) => (screen.renders || []).includes(c.cid)) : []
  return (
    <>
      <div style={{ ...S.sec, marginTop: 0 }}>Screens ({screens.length})</div>
      <div>
        {screens.map((s) => {
          const lc = liveDriftCounts[s.sid]
          const n = lc ? (lc.critical || 0) + (lc.warning || 0) : 0
          return (
            <span key={s.sid} onClick={() => select(s.sid)} style={{ ...S.pill, ...(s.sid === sel ? S.pillOn : {}) }} title={s.title}>
              {s.sid}{n > 0 ? <span style={{ color: lc.critical ? '#f08a8a' : '#f0c060', marginLeft: 5 }}>⚑{n}</span> : null}
            </span>
          )
        })}
      </div>
      {screen && <div style={{ marginTop: 8 }}><ScreenSpec screen={screen} components={screenComponents} live={liveDriftCounts[sel]} /></div>}
    </>
  )
}

function ScreenSpec({ screen, route, components, live }) {
  const refs = screen.specRefs || {}
  const driftCount = (components || []).reduce((n, c) => n + (c.drift?.length || 0), 0)
  const liveN = live ? (live.critical || 0) + (live.warning || 0) : 0
  return (
    <>
      <h2 style={S.h}>{screen.title || screen.sid}</h2>
      {route && <span style={S.route}>{route}</span>}
      {driftCount > 0 && (
        <span style={{ ...S.chip, ...S.missing, marginLeft: route ? 8 : 0 }} title="Authored design-system drift on this screen">
          ⚑ {driftCount} DS drift
        </span>
      )}
      {live && (
        <span
          style={{ ...S.chip, ...(live.critical ? S.crit : liveN ? S.missing : S.present), marginLeft: 8 }}
          title={`Live arc-drift over ${live.total} DS elements: ${live.critical} hardcoded-color (2.1), ${live.warning} off-grid (2.3)`}
        >
          {liveN > 0 ? `◉ ${liveN} live drift` : `◉ clean · ${live.total} DS`}
        </span>
      )}
      {refs.codeEntry && (<><div style={S.sec}>Code entry</div><div style={S.code}>{refs.codeEntry}</div></>)}
      {arr(refs.brIds) && (<><div style={S.sec}>Business rules</div>{refs.brIds.map((b) => <span key={b} style={{ ...S.chip, ...S.id }}>{b}</span>)}</>)}
      {arr(refs.gIds) && (<><div style={S.sec}>Open interview gaps</div>{refs.gIds.map((g) => <span key={g} style={{ ...S.chip, ...S.id }}>{g}</span>)}</>)}
      {arr(components) && (
        <>
          <div style={S.sec}>Components on this screen</div>
          {components.map((c) => <ComponentCard key={c.cid} c={c} />)}
        </>
      )}
    </>
  )
}

function ComponentCard({ c }) {
  const ds = c.dsMatch
  return (
    <div style={S.comp}>
      <p style={S.compName}>{c.name || c.cid}</p>
      {ds && (
        <div style={S.dsBox}>
          <p style={{ ...S.dsName, fontSize: 13, marginBottom: 4 }}>
            → {ds.component}
            {ds.classification && <span style={{ ...S.chip, ...clsStyle(ds.classification), marginLeft: 8 }}>{ds.classification}</span>}
          </p>
          {ds.props && <div style={S.code}>{ds.props}</div>}
          {ds.import && <CopyBlock label="Import" code={ds.import} />}
          {ds.notes && <div style={{ ...S.code, color: '#8a8a92', marginTop: 6 }}>{ds.notes}</div>}
        </div>
      )}
      {arr(c.statesPresent) && c.statesPresent.map((s) => <span key={s} style={{ ...S.chip, ...S.present }}>{s}</span>)}
      {arr(c.statesMissing) && c.statesMissing.map((s) => <span key={s} style={{ ...S.chip, ...S.missing }} title="Missing state">⚠ {s}</span>)}
      {c.implPointer && <div style={{ ...S.code, marginTop: 6 }}>{c.implPointer}</div>}
      <DriftList drift={c.drift} />
    </div>
  )
}

/** Design-system drift: where the prototype diverges from the DS rules/composition.
 *  Powered by the skill's arc-drift / enforcement-rules pass. */
function DriftList({ drift }) {
  if (!arr(drift)) return null
  return (
    <>
      <div style={{ ...S.sec, marginTop: 10 }}>Design-system drift</div>
      {drift.map((d, i) => (
        <div key={i} style={{ ...S.driftRow, borderLeftColor: sevColor(d.severity) }}>
          <span style={{ color: sevColor(d.severity), fontWeight: 600, textTransform: 'uppercase', fontSize: 10, letterSpacing: '.04em' }}>
            {d.severity}
          </span>{d.rule ? <span style={{ color: '#7a7a7a' }}> · {d.rule}</span> : null}
          <div style={{ color: '#c8c8c8', marginTop: 3 }}>{d.message}</div>
          {d.fix && <div style={{ color: '#8a8a92', marginTop: 3 }}>→ {d.fix}</div>}
        </div>
      ))}
    </>
  )
}

/**
 * Live, computed DS drift for an inspected element — Atlas `arc-drift` framework
 * applied to a coded prototype. arc-drift itself evaluates the Figma file (Figma
 * MCP + variables); it can't run on a coded prototype, so we encode the subset of
 * its rules that ARE computable from real computed styles + the token map, keeping
 * Atlas's rule IDs, severities and Designer/System audience routing:
 *   - 2.1 hardcoded color, not an ARC token        (Critical · Designer)
 *   - 2.3 spacing off the 4px grid                 (Warning · Designer)
 * The behavioural Critical rules (Link-for-actions → Button, etc.) need design
 * intent, so those stay with a real Figma arc-drift run / human judgment.
 */
function liveDrift(info, designSystem) {
  const out = []
  const byHex = designSystem?.tokens?.byHex
  if (byHex) {
    [['text color', info.color], ['background', info.bg]].forEach(([k, v]) => {
      if (v && v !== 'transparent' && /^#[0-9a-f]{6}$/i.test(v) && !byHex[v.toUpperCase()]) {
        out.push({
          rule: 'arc-drift 2.1', audience: 'Designer', severity: 'critical',
          message: `Hardcoded ${k} ${v} — not an ARC color token.`,
          fix: 'Use the nearest ARC token (var(--gst-…)).',
        })
      }
    })
  }
  const sp = []
  ;(info.layout || '').split('\n').forEach((line) => {
    const m = line.match(/^(padding|gap):\s*(.+);$/)
    if (!m) return
    m[2].split(/\s+/).forEach((tok) => {
      const n = parseFloat(tok)
      if (/px$/.test(tok) && n > 0 && n % 4 !== 0 && !sp.includes(n)) sp.push(n)
    })
  })
  if (sp.length) {
    out.push({
      rule: 'arc-drift 2.3', audience: 'Designer', severity: 'warning',
      message: `Spacing off the 4px grid: ${sp.join('px, ')}px.`,
      fix: 'Snap to a 4/8px step on the ARC spacing scale.',
    })
  }
  return out
}

/** Renders live arc-drift findings with Atlas rule IDs + audience routing. */
function LiveDrift({ findings }) {
  if (!arr(findings)) return null
  return (
    <>
      <div style={{ ...S.sec, marginTop: 12 }}>
        Compliance <span style={{ color: '#7a7a7a', fontWeight: 400 }}>· ARC drift (live)</span>
      </div>
      {findings.map((d, i) => (
        <div key={i} style={{ ...S.driftRow, borderLeftColor: sevColor(d.severity) }}>
          <span style={{ color: sevColor(d.severity), fontWeight: 600, textTransform: 'uppercase', fontSize: 10, letterSpacing: '.04em' }}>
            {d.severity}
          </span>
          <span style={{ color: '#7a7a7a' }}> · {d.rule}</span>
          <span style={{ ...S.chip, ...(d.audience === 'Designer' ? S.missing : S.id), marginLeft: 8, fontSize: 10, padding: '1px 7px' }}>{d.audience}</span>
          <div style={{ color: '#c8c8c8', marginTop: 3 }}>{d.message}</div>
          {d.fix && <div style={{ color: '#8a8a92', marginTop: 3 }}>→ {d.fix}</div>}
        </div>
      ))}
    </>
  )
}

/** Design-system identity for an inspected element: real component name + import,
 *  plus the Figma Code Connect link when the DS maintains one. */
function DsBlock({ ds, designSystem }) {
  const reg = (designSystem?.components && designSystem.components[ds.component]) || {}
  const imp = reg.import || `import { ${ds.component} } from '${designSystem?.package || 'your-design-system'}'`
  // Live drift check: is the tagged variant actually a valid variant of this DS component?
  const variantInvalid = ds.variant && Array.isArray(reg.variants) && reg.variants.length && !reg.variants.includes(ds.variant)
  return (
    <div style={{ marginTop: 4 }}>
      <div style={{ ...S.sec, marginTop: 8 }}>Design system{designSystem?.name ? ` · ${designSystem.name}` : ''}</div>
      <div style={S.dsBox}>
        <p style={S.dsName}>{ds.component}{ds.variant ? <span style={{ color: '#8a9bd0', fontWeight: 400, fontSize: 13 }}> · {ds.variant}</span> : null}</p>
        <span style={{ ...S.chip, ...S.present }}>verified — tagged in source</span>
        {reg.codeConnect && <span style={{ ...S.chip, ...S.id }}>Figma Code Connect ✓</span>}
        {variantInvalid && (
          <div style={{ ...S.driftRow, borderLeftColor: '#f0c060', marginTop: 8 }}>
            <span style={{ color: '#f0c060', fontWeight: 600 }}>⚑ variant “{ds.variant}” is not an ARC {ds.component} variant</span>
            <div style={{ color: '#c8c8c8', marginTop: 3 }}>valid: {reg.variants.join(', ')}</div>
          </div>
        )}
        {reg.props && <div style={{ ...S.code, marginTop: 4 }}>props: {reg.props}</div>}
        {reg.figmaUrl && (
          <a href={reg.figmaUrl} target="_blank" rel="noreferrer"
            style={{ display: 'inline-block', marginTop: 8, fontSize: 12, color: '#aebfff', textDecoration: 'none' }}>
            View in Figma ↗
          </a>
        )}
      </div>
      <CopyBlock label="Import" code={imp} />
    </div>
  )
}

/** Chrome-style live element inspect: real computed styles, copyable like Figma,
 *  PLUS the real design-system component name (read from data-ds-component in source). */
function ElementInspect({ info, designSystem, onClear }) {
  return (
    <>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <h2 style={S.h}>&lt;{info.tag}&gt; <span style={{ color: '#9a9aa2', fontWeight: 400, fontSize: 13 }}>{info.size.w}×{info.size.h}</span></h2>
        {onClear && <button onClick={onClear} style={S.x} title="Clear selection">×</button>}
      </div>
      {info.ds && <DsBlock ds={info.ds} designSystem={designSystem} />}
      <LiveDrift findings={liveDrift(info, designSystem)} />
      {info.classes && <div style={S.code}>.{info.classes.split(/\s+/).filter(Boolean).join(' .')}</div>}
      <CopyBlock label="Layout" code={info.layout} />
      <CopyBlock label="Style" code={info.style} />
      <CopyBlock label="Typography" code={info.typography} />
      {info.text && <CopyBlock label="Text content" code={info.text} />}
      <div style={S.sec}>Colors</div>
      <Swatch label="text" value={info.color} token={tokenFor(info.color, designSystem)} />
      <Swatch label="bg" value={info.bg} token={tokenFor(info.bg, designSystem)} />
    </>
  )
}

/** Resolve a computed hex to its DS token (e.g. #007A68 → --gst-primary). */
function tokenFor(hex, designSystem) {
  const map = designSystem?.tokens?.byHex
  return hex && map ? map[hex.toUpperCase()] || null : null
}

function CopyBlock({ label, code }) {
  const [copied, setCopied] = useState(false)
  if (!code) return null
  const copy = () => { try { navigator.clipboard?.writeText(code) } catch { /* noop */ } setCopied(true); setTimeout(() => setCopied(false), 900) }
  return (
    <div style={{ marginTop: 12 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div style={{ ...S.sec, margin: 0 }}>{label}</div>
        <button onClick={copy} style={S.copyBtn}>{copied ? 'Copied' : 'Copy'}</button>
      </div>
      <pre style={S.pre}>{code}</pre>
    </div>
  )
}

function Swatch({ label, value, token }) {
  if (!value || value === 'transparent') return null
  // Prefer copying the token var() when the value maps to a DS token.
  const copyText = token ? `var(${token})` : value
  return (
    <span onClick={() => { try { navigator.clipboard?.writeText(copyText) } catch { /* noop */ } }}
      title={token ? `Click to copy var(${token})` : 'Click to copy'} style={{ ...S.pill, display: 'inline-flex', alignItems: 'center', gap: 6 }}>
      <span style={{ width: 12, height: 12, borderRadius: 3, border: '1px solid rgba(255,255,255,.18)', background: value }} />
      {label} {token
        ? <><span style={{ color: '#6bd998', fontFamily: 'ui-monospace,Menlo,monospace' }}>var({token})</span> <span style={{ color: '#7a7a7a' }}>{value}</span></>
        : value}
    </span>
  )
}

const arr = (x) => Array.isArray(x) && x.length > 0
