/**
 * Folder-upload bundle processor.
 *
 * Takes a FileList from <input webkitdirectory>, figures out the virtual
 * root (the directory containing index.html), strips that prefix off all
 * file paths so they're served at clean URLs, injects a <base> tag into
 * every HTML file so Vite-style absolute asset paths resolve under our
 * /preview/<uuid>/ scope, and sends everything to the Service Worker.
 *
 * Returns the URL to use as the iframe `src`.
 */

import { postToSW } from './registerSW'

/** Filename extension → MIME type. Extensible. */
const MIME_BY_EXT = {
  html: 'text/html',
  htm: 'text/html',
  js: 'application/javascript',
  mjs: 'application/javascript',
  css: 'text/css',
  json: 'application/json',
  xml: 'application/xml',
  svg: 'image/svg+xml',
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  avif: 'image/avif',
  ico: 'image/x-icon',
  woff: 'font/woff',
  woff2: 'font/woff2',
  ttf: 'font/ttf',
  otf: 'font/otf',
  eot: 'application/vnd.ms-fontobject',
  txt: 'text/plain',
  md: 'text/markdown',
  map: 'application/json',
  mp4: 'video/mp4',
  webm: 'video/webm',
  mp3: 'audio/mpeg',
  wav: 'audio/wav',
}

const MAX_TOTAL_BYTES = 50 * 1024 * 1024 // 50 MB total bundle cap
const SKIP_PATTERNS = [
  /(^|\/)\.DS_Store$/i,
  /(^|\/)Thumbs\.db$/i,
  /(^|\/)\.git\//i,
  /(^|\/)node_modules\//i,
  /(^|\/)\.idea\//i,
  /(^|\/)\.vscode\//i,
]

function mimeFor(path) {
  const ext = path.split('.').pop().toLowerCase()
  return MIME_BY_EXT[ext] || 'application/octet-stream'
}

function shouldSkip(path) {
  return SKIP_PATTERNS.some((re) => re.test(path))
}

/**
 * Inject `<base href="<baseHref>">` into <head>. This makes absolute paths
 * inside the HTML resolve under our preview scope — critical for Vite
 * production builds, which emit `<script src="/assets/index-XYZ.js">` and
 * would otherwise hit the canvas's origin root.
 *
 * Naive regex parser is fine for build-tool output (which always has a
 * well-formed <head>). Hand-rolled malformed HTML may not match — in that
 * case we fall through and prepend.
 */
function injectBase(html, baseHref) {
  // Idempotency: if the HTML already has a <base>, leave it alone.
  if (/<base\s[^>]*href=/i.test(html)) return html

  const baseTag = `<base href="${baseHref}">`

  if (/<head[^>]*>/i.test(html)) {
    return html.replace(/<head([^>]*)>/i, `<head$1>\n  ${baseTag}`)
  }
  if (/<html[^>]*>/i.test(html)) {
    return html.replace(/<html([^>]*)>/i, `<html$1>\n<head>${baseTag}</head>`)
  }
  return baseTag + '\n' + html
}

/**
 * Find the virtual root (the directory that should map to /preview/<uuid>/).
 *
 * Strategy: pick the shallowest index.html. Its parent directory is the
 * root. If no index.html exists, fall back to the shallowest .html file.
 *
 * The folder picker gives us paths like `myFolder/dist/index.html`. The
 * user typically picks the project folder, not the dist subfolder — so we
 * need to detect "actual web root" inside the upload.
 */
function findVirtualRoot(paths) {
  const htmlFiles = paths.filter((p) => /\.html?$/i.test(p))
  if (htmlFiles.length === 0) return null

  const indexFiles = htmlFiles.filter((p) => /\/index\.html?$|^index\.html?$/i.test(p))
  const candidates = indexFiles.length > 0 ? indexFiles : htmlFiles

  // Shortest path = closest to root
  candidates.sort((a, b) => a.length - b.length)
  const entry = candidates[0]
  const lastSlash = entry.lastIndexOf('/')
  return {
    rootPrefix: lastSlash >= 0 ? entry.slice(0, lastSlash + 1) : '',
    entryPath: lastSlash >= 0 ? entry.slice(lastSlash + 1) : entry,
  }
}

/**
 * Process the FileList from <input webkitdirectory> into a bundle ready
 * to send to the Service Worker.
 *
 * Returns { uuid, entryPath, fileCount, totalBytes, displayTitle } —
 * caller uses uuid+entryPath to compute the iframe URL after the SW
 * confirms upload.
 */
export async function uploadFolderBundle(fileList) {
  if (!fileList || fileList.length === 0) {
    throw new Error('No files selected')
  }

  const files = Array.from(fileList)
  const paths = files.map((f) => f.webkitRelativePath || f.name)

  const root = findVirtualRoot(paths)
  if (!root) {
    throw new Error('No HTML files found in the folder')
  }

  // Total size pre-check
  const totalBytes = files.reduce((sum, f) => sum + f.size, 0)
  if (totalBytes > MAX_TOTAL_BYTES) {
    throw new Error(
      `Bundle is ${(totalBytes / 1024 / 1024).toFixed(1)} MB — limit is ${MAX_TOTAL_BYTES / 1024 / 1024} MB`
    )
  }

  const uuid = crypto.randomUUID()
  const baseHref = `/preview/${uuid}/`

  // The user-facing title comes from the top-level folder name. The folder
  // picker always prefixes paths with the picked folder's name.
  const firstSlash = paths[0].indexOf('/')
  const displayTitle = firstSlash > 0 ? paths[0].slice(0, firstSlash) : 'Untitled'

  const bundleFiles = []
  let skipped = 0

  for (let i = 0; i < files.length; i++) {
    const file = files[i]
    const fullPath = paths[i]

    if (shouldSkip(fullPath)) {
      skipped++
      continue
    }
    if (!fullPath.startsWith(root.rootPrefix)) {
      // File outside the chosen virtual root (e.g., README at the picked
      // folder's level when the entry is in dist/). Skip.
      skipped++
      continue
    }

    const relPath = fullPath.slice(root.rootPrefix.length)
    if (!relPath) continue // the rootPrefix itself

    let blob = file
    const mime = mimeFor(relPath)

    // For HTML, inject <base> so absolute asset paths resolve under /preview/<uuid>/.
    if (mime === 'text/html') {
      const text = await file.text()
      const patched = injectBase(text, baseHref)
      blob = new Blob([patched], { type: 'text/html' })
    }

    bundleFiles.push({ path: relPath, blob, mime })
  }

  if (bundleFiles.length === 0) {
    throw new Error('Bundle is empty after filtering')
  }

  // Send to Service Worker. The SW writes everything into a Cache,
  // then replies UPLOAD_DONE.
  await postToSW({ type: 'UPLOAD_BUNDLE', uuid, files: bundleFiles }, 'UPLOAD_DONE')

  return {
    uuid,
    entryPath: root.entryPath,
    fileCount: bundleFiles.length,
    totalBytes,
    displayTitle,
    skipped,
    previewURL: `${baseHref}${root.entryPath}`,
  }
}

/** Tell the SW to drop a bundle's cache. Best-effort; safe to ignore failures. */
export async function deleteBundle(uuid) {
  try {
    await postToSW({ type: 'DELETE_BUNDLE', uuid }, 'DELETE_DONE')
  } catch {
    /* ignore */
  }
}
