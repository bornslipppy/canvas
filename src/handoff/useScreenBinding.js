/**
 * useScreenBinding.js — Tier-1 (screen-level) binding, route AND state.
 *
 * Handles both prototype paradigms:
 *   - routed prototypes emit PROTOTYPE_ROUTE (via snippet-for-prototypes.js);
 *     screens are matched by their `routeMatch` regex.
 *   - state-machine prototypes emit PROTOTYPE_STATE {sid} (via
 *     snippet-state-for-prototypes.js); screens are matched by `stateMatch`
 *     (falling back to `sid`).
 *
 * Both messages are matched to the prototype's own iframe by contentWindow —
 * the same source-matching the comments layer already uses. No Blackbird-core
 * changes required; purely additive.
 */

import { useEffect, useMemo, useState } from 'react'

/**
 * @param {object|null} manifest         parsed canvas-manifest.json
 * @param {string|null} prototypeFrameId the frame id returned by placeNewFrame
 * @returns {{ route: string|null, sid: string|null, screen: object|null }}
 */
export function useScreenBinding(manifest, prototypeFrameId) {
  const [route, setRoute] = useState(null)
  const [sid, setSid] = useState(null)

  const screens = useMemo(() => {
    if (!manifest?.screens) return []
    return manifest.screens.map((s) => ({
      ...s,
      _re: s.routeMatch ? safeRegExp(s.routeMatch) : null,
    }))
  }, [manifest])

  useEffect(() => {
    if (!prototypeFrameId) return
    const fromPrototype = (e) => {
      const iframe = document.querySelector(
        `iframe[data-frame-id="${cssEscape(prototypeFrameId)}"]`
      )
      return iframe && iframe.contentWindow === e.source
    }
    const onMessage = (e) => {
      if (!e.data || typeof e.data !== 'object') return
      if (e.data.type === 'PROTOTYPE_ROUTE') {
        if (!fromPrototype(e)) return
        setRoute(typeof e.data.route === 'string' ? e.data.route : null)
      } else if (e.data.type === 'PROTOTYPE_STATE') {
        if (!fromPrototype(e)) return
        setSid(typeof e.data.sid === 'string' ? e.data.sid : null)
      }
    }
    window.addEventListener('message', onMessage)
    return () => window.removeEventListener('message', onMessage)
  }, [prototypeFrameId])

  const screen = useMemo(() => {
    // State signal wins when present (more specific than a single-route '/').
    if (sid != null) {
      const byState = screens.find((s) => (s.stateMatch ?? s.sid) === sid)
      if (byState) return byState
    }
    if (route != null) {
      const byRoute = screens.find((s) => s._re && s._re.test(route))
      if (byRoute) return byRoute
    }
    return null
  }, [sid, route, screens])

  return { route, sid, screen }
}

function safeRegExp(src) {
  try {
    return new RegExp(src)
  } catch {
    console.warn(`[handoff] invalid routeMatch: ${src}`)
    return null
  }
}

function cssEscape(s) {
  return typeof CSS !== 'undefined' && CSS.escape ? CSS.escape(s) : String(s).replace(/"/g, '\\"')
}
