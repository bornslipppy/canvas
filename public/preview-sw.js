/**
 * preview-sw.js
 * --------------
 * Service Worker that serves uploaded folder bundles from a virtual
 * filesystem. Used by the canvas to embed local prototype folders as
 * iframe sources without needing a dev server.
 *
 * URL scheme: /preview/<bundle-uuid>/<path-inside-bundle>
 *
 * Path resolution:
 *   - Direct requests to /preview/<uuid>/... → serve from cache
 *   - "Escaped" absolute-path requests (e.g. /assets/foo.css) from a
 *     preview iframe → rewrite to /preview/<uuid>/assets/foo.css and try
 *     the bundle cache. If the file isn't there, fall through to network.
 *     This handles the common case where prototype HTML uses absolute
 *     paths like <link href="/assets/styles.css"> that the <base> tag
 *     can't help with (per HTML spec, <base> only affects relative URLs).
 *
 * Storage: Cache API, namespaced by bundle UUID. We use Cache (not an
 * in-memory Map) because Service Workers are killed and restarted by the
 * browser between events — any global state in the worker is volatile.
 * Cache API entries survive restarts AND page refreshes.
 */

const CACHE_PREFIX = 'preview-'

self.addEventListener('install', (event) => {
  event.waitUntil(self.skipWaiting())
})

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim())
})

self.addEventListener('message', (event) => {
  const data = event.data
  if (!data || typeof data !== 'object') return

  const port = event.ports[0]

  if (data.type === 'UPLOAD_BUNDLE') {
    event.waitUntil(handleUpload(data, port))
  } else if (data.type === 'DELETE_BUNDLE') {
    event.waitUntil(handleDelete(data, port))
  } else if (data.type === 'PING') {
    port?.postMessage({ type: 'PONG' })
  }
})

async function handleUpload({ uuid, files }, port) {
  try {
    const cacheName = CACHE_PREFIX + uuid
    await caches.delete(cacheName)
    const cache = await caches.open(cacheName)
    for (const file of files) {
      const url = `/preview/${uuid}/${file.path}`
      const res = new Response(file.blob, {
        headers: {
          'Content-Type': file.mime || 'application/octet-stream',
          'Cache-Control': 'no-store',
        },
      })
      await cache.put(url, res)
    }
    port?.postMessage({ type: 'UPLOAD_DONE', uuid })
  } catch (err) {
    port?.postMessage({
      type: 'UPLOAD_ERROR',
      uuid,
      message: err?.message || String(err),
    })
  }
}

async function handleDelete({ uuid }, port) {
  await caches.delete(CACHE_PREFIX + uuid)
  port?.postMessage({ type: 'DELETE_DONE', uuid })
}

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url)
  if (url.origin !== self.location.origin) return

  if (url.pathname.startsWith('/preview/')) {
    event.respondWith(handlePreviewRequest(url))
    return
  }

  // Not under /preview/ — but might be an absolute-path asset that escaped
  // its iframe scope. Look up the originating client and check.
  event.respondWith(handlePossibleEscape(event, url))
})

async function handlePreviewRequest(url) {
  const match = url.pathname.match(/^\/preview\/([^/]+)\/(.*)$/)
  if (!match) return new Response('Bad preview URL', { status: 400 })
  const uuid = match[1]
  const path = match[2] === '' ? 'index.html' : match[2]
  return serveFromBundle(uuid, path)
}

async function handlePossibleEscape(event, url) {
  let client = null
  try {
    if (event.clientId) client = await self.clients.get(event.clientId)
  } catch {
    /* ignore */
  }
  if (!client) return fetch(event.request)

  let clientURL
  try {
    clientURL = new URL(client.url)
  } catch {
    return fetch(event.request)
  }
  if (clientURL.origin !== self.location.origin) return fetch(event.request)
  const m = clientURL.pathname.match(/^\/preview\/([^/]+)\//)
  if (!m) return fetch(event.request)

  // Request came from a preview iframe. Try the bundle's virtual root.
  const uuid = m[1]
  const rewrittenURL = `/preview/${uuid}${url.pathname}`
  const cache = await caches.open(CACHE_PREFIX + uuid)
  const cached = await cache.match(rewrittenURL)
  if (cached) return cached

  // Not in the bundle — fall through to the real network. This keeps
  // canvas-app's own /assets/* etc. accessible (when accessed from the
  // canvas-app itself, which is the more common case) and lets prototypes
  // hit external APIs by absolute URL if they want.
  return fetch(event.request)
}

async function serveFromBundle(uuid, path) {
  const cacheName = CACHE_PREFIX + uuid
  const cache = await caches.open(cacheName)
  const requestURL = `/preview/${uuid}/${path}`

  let res = await cache.match(requestURL)
  if (res) return res

  // SPA fallback: extension-less paths fall through to index.html so
  // client-side routers work for routes that don't exist as real files.
  if (!path.includes('.')) {
    res = await cache.match(`/preview/${uuid}/index.html`)
    if (res) return res
  }

  return new Response(`Not found in bundle: ${path}`, {
    status: 404,
    headers: { 'Content-Type': 'text/plain' },
  })
}
