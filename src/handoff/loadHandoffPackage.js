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

  // 2. Prototype frame.
  const proto = manifest.prototype || {}
  if (proto.mode === 'url') {
    // Hosted prototype — no bundling, just point a URL frame at it.
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
    const result = await uploadFolderBundle(files)
    const baseUrl = window.location.origin + result.previewURL

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
    const file = byPath.get(art.path)
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

  return { manifest, frames, artifacts }
}
