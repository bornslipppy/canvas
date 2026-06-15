/**
 * loadHandoffPackage.js — Phase-0 handoff loader
 * ----------------------------------------------
 * Reads a handoff package folder (picked via <input webkitdirectory>) and
 * turns it into a set of frame descriptors ready for Blackbird's existing
 * `placeNewFrame({ title, url, srcDoc })`.
 *
 * It reuses Blackbird's battle-tested prototype serving:
 *   - The PROTOTYPE is served through the existing Service-Worker bundle
 *     path (`uploadFolderBundle`) so its local assets resolve exactly as a
 *     normal folder upload would. It becomes a URL-mode frame.
 *   - The SPEC ARTIFACTS (flow.html, inspect.html, *.md) are self-contained,
 *     so they ride in as `srcDoc` frames — no asset resolution needed.
 *
 * The only new artifact this depends on is `canvas-manifest.json` at the
 * package root (see canvas-manifest.sample.json + the design doc §1).
 *
 * Returns: { manifest, frames } where frames is an ordered array of
 *   { role: 'prototype' | 'artifact', place: { title, url? , srcDoc? }, meta }
 * The caller places them with placeNewFrame and remembers the prototype's
 * returned frame id for screen binding.
 */

import { uploadFolderBundle } from '../preview/processBundle'
import { registerPreviewSW } from '../preview/registerSW'
import { renderMarkdownDoc } from './renderMarkdown'

/** Strip the top-level picked-folder segment: "MyPkg/a/b.md" -> "a/b.md". */
function packageRelPath(webkitRelativePath) {
  const i = webkitRelativePath.indexOf('/')
  return i >= 0 ? webkitRelativePath.slice(i + 1) : webkitRelativePath
}

/**
 * Tolerant artifact lookup. Tries the exact manifest path first, then a few
 * forgiving variants so a manifest authored with a slightly different base
 * (e.g. with/without a `package/` prefix, or relative to a nested dir) still
 * resolves: normalized `./`, suffix match, and basename match.
 */
function findArtifactFile(byPath, artPath) {
  if (!artPath) return null
  const norm = artPath.replace(/^\.?\//, '')
  if (byPath.has(norm)) return byPath.get(norm)
  // suffix match: some key ends with the artifact path (or vice-versa)
  for (const [key, file] of byPath) {
    if (key === norm || key.endsWith('/' + norm) || norm.endsWith('/' + key)) return file
  }
  // last resort: unique basename match
  const base = norm.split('/').pop()
  const matches = [...byPath].filter(([k]) => k.split('/').pop() === base)
  return matches.length === 1 ? matches[0][1] : null
}

/**
 * @param {FileList|File[]} fileList  result of an <input webkitdirectory> pick
 * @returns {Promise<{manifest: object, frames: object[]}>}
 */
export async function loadHandoffPackage(fileList) {
  const files = Array.from(fileList || [])
  if (files.length === 0) throw new Error('No files selected')

  // Index every file by its package-relative path.
  const byPath = new Map()
  for (const f of files) byPath.set(packageRelPath(f.webkitRelativePath || f.name), f)

  // 1. Read the manifest (the one required new artifact).
  const manifestFile = byPath.get('canvas-manifest.json')
  if (!manifestFile) {
    throw new Error(
      'canvas-manifest.json not found at the package root. ' +
        'This folder is not a canvas handoff package (or the manifest was not generated).'
    )
  }
  let manifest
  try {
    manifest = JSON.parse(await manifestFile.text())
  } catch (e) {
    throw new Error('canvas-manifest.json is not valid JSON: ' + (e?.message || e), { cause: e })
  }

  const frames = []
  // The served base URL of the prototype, captured in whichever branch runs, so
  // componentVariants frames (step 4) can deep-link the SAME prototype to a
  // gallery state via `#sid=`.
  let protoBaseUrl = null
  let protoUuid = null

  // 2. Prototype frame.
  const proto = manifest.prototype || {}
  if (proto.mode === 'url') {
    // Hosted prototype — no bundling, just point a URL frame at it.
    protoBaseUrl = proto.entry
    frames.push({
      role: 'prototype',
      place: { title: manifest.package?.name || 'Prototype', url: proto.entry },
      meta: { emitsRoute: proto.emitsRoute !== false },
    })
  } else {
    // Bundle mode: serve the whole upload through the SW. `uploadFolderBundle`
    // picks the shallowest index.html as the virtual root — which is the
    // prototype's — and serves that subtree. Spec artifacts (not index.html)
    // fall outside that root and are simply not served here; we load them as
    // srcDoc below, so that's fine.
    await registerPreviewSW()
    // Honor the manifest's declared entry so a full project (source index.html
    // + built dist/) serves the built app rather than the shallowest index.html.
    const result = await uploadFolderBundle(files, { entryHint: proto.entry })
    const baseUrl = window.location.origin + result.previewURL
    protoBaseUrl = baseUrl
    protoUuid = result.uuid

    if (manifest.layout === 'per-screen' && Array.isArray(manifest.screens) && manifest.screens.length) {
      // Slice the prototype into one LIVE frame per screen. Each frame loads the
      // same served prototype but with `#sid=<id>` in the URL, so the prototype's
      // applySid() boots it straight into that state. The flow becomes a board of
      // live, interactive screens — Dev-Mode-for-live-prototypes.
      for (const s of manifest.screens) {
        frames.push({
          role: 'screen',
          place: {
            title: `${s.sid} · ${s.title || ''}`.trim(),
            url: `${baseUrl}#sid=${encodeURIComponent(s.stateMatch ?? s.sid)}`,
          },
          meta: { sid: s.sid, uuid: result.uuid },
        })
      }
    } else {
      frames.push({
        role: 'prototype',
        place: {
          title: manifest.package?.name || result.displayTitle || 'Prototype',
          url: baseUrl,
        },
        meta: { emitsRoute: proto.emitsRoute !== false, uuid: result.uuid },
      })
    }
  }

  // 3. Artifacts (flow.html, inspect.html, markdown specs). Always read their
  //    content; in single-frame layout they ride onto the canvas as frames, but
  //    in per-screen layout the canvas is reserved for the live screens, so the
  //    artifacts go into the side drawer as tabs instead (returned in `artifacts`).
  const perScreen = manifest.layout === 'per-screen'
  const artifacts = []
  for (const art of manifest.artifacts || []) {
    const file = findArtifactFile(byPath, art.path)
    if (!file) {
      console.warn(`[handoff] artifact missing from package: ${art.path}`)
      continue
    }
    const text = await file.text()
    if (perScreen) {
      // Per-screen: artifacts live in the drawer, grouped into tabs. Pass the RAW
      // content so the panel can render markdown inline as styled HTML (with copy
      // buttons) and embed html docs (flow/inspect) as live iframes.
      artifacts.push({ id: art.id, title: art.title || art.id, type: art.type, content: text, group: art.group || 'Docs' })
    } else {
      // Single-frame layout: artifacts ride onto the canvas as frames.
      const html = art.type === 'markdown' ? renderMarkdownDoc(text, art.title) : text
      frames.push({
        role: 'artifact',
        place: { title: art.title || art.id, srcDoc: html },
        meta: { id: art.id, path: art.path },
      })
    }
  }

  // 4. Component-variants frames — the detached "all variants of one component"
  //    boards (canvas-handoff-v1-design.md §1b). Unlike screens/artifacts, these
  //    ALWAYS ride onto the canvas as standalone frames (per-screen or single):
  //    they are the board-level "here is every variant this component must
  //    support" view a developer expects from Figma.
  //      - source 'prototype-gallery' → a LIVE frame, the same served prototype
  //        deep-linked via `#sid=<stateMatch>` to the gallery state.
  //      - source 'markdown'          → a static srcDoc frame rendered from the
  //        documented variants (the designer's text fallback, promoted to a frame).
  //      - fidelity 'missing'         → NO frame; surfaced as a flag instead
  //        (returned in `variantFlags` for the panel/inspector to render).
  const variantFlags = []
  for (const cv of manifest.componentVariants || []) {
    const title = cv.title || `${cv.component || 'Component'} — variants`
    if (cv.fidelity === 'missing' || cv.source === 'none') {
      variantFlags.push({
        cvid: cv.cvid,
        component: cv.component,
        selector: cv.selector,
        cid: cv.cid || null,
        reason: cv.note || 'Variants are known but no gallery state or doc exists yet — designer to author.',
        matrixRef: cv.matrixRef || null,
      })
      continue
    }
    if (cv.source === 'prototype-gallery' && protoBaseUrl && cv.stateMatch) {
      // Live gallery state — reuse the exact screen deep-link mechanism.
      frames.push({
        role: 'variants',
        place: { title, url: `${protoBaseUrl}#sid=${encodeURIComponent(cv.stateMatch)}` },
        meta: { cvid: cv.cvid, component: cv.component, selector: cv.selector, cid: cv.cid || null, fidelity: cv.fidelity || 'verified', uuid: protoUuid },
      })
      continue
    }
    // Markdown source (or a gallery with no served prototype): render the
    // documented variants as a self-contained srcDoc frame.
    const docFile = findArtifactFile(byPath, (cv.docPath || '').split('#')[0])
    if (docFile) {
      const md = await docFile.text()
      frames.push({
        role: 'variants',
        place: { title, srcDoc: renderMarkdownDoc(md, title) },
        meta: { cvid: cv.cvid, component: cv.component, selector: cv.selector, cid: cv.cid || null, fidelity: cv.fidelity || 'inferred' },
      })
    } else {
      // Documented as having variants but the doc is missing from the package —
      // degrade to a flag rather than a broken frame.
      variantFlags.push({
        cvid: cv.cvid,
        component: cv.component,
        selector: cv.selector,
        cid: cv.cid || null,
        reason: `Variants doc not found in package: ${cv.docPath || '(no docPath)'}`,
        matrixRef: cv.matrixRef || null,
      })
    }
  }

  return { manifest, frames, artifacts, variantFlags }
}
