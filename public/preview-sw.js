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

  // Everything below is a non-/preview/ request. The ONLY non-/preview case we
  // legitimately handle is an "escaped" absolute-path asset (e.g. /assets/app.js)
  // requested BY a preview iframe. We must NEVER touch the canvas's own traffic:
  // re-fetching the host app's navigation, dev-server, or HMR requests from
  // inside the SW can fail with opaque TypeErrors and blank the whole canvas.
  // (This guard was missing — the SW called respondWith() for every non-preview
  // request, which is what blanked the app shell on reload and stalled it.)
  const req = event.request
  const p = url.pathname

  // 1. Never intercept top-level / iframe navigations to non-preview URLs —
  //    that's the canvas app shell loading. (Preview iframes navigate to
  //    /preview/... which is handled by the branch above.)
  if (req.mode === 'navigate') return

  // 2. Never intercept Vite dev-server / HMR / module traffic.
  if (
    p.startsWith('/@') ||            // /@vite/client, /@react-refresh, /@id, /@fs
    p.startsWith('/src/') ||
    p.startsWith('/node_modules/') ||
    p.includes('/.vite/') ||
    p === '/preview-sw.js'
  ) return

  // 3. Only the remaining absolute-path asset requests can be iframe escapes.
  //    handlePossibleEscape confirms (async) the client really is a preview
  //    iframe and otherwise passes the request through untouched.
  const clientId = event.clientId || event.resultingClientId
  if (!clientId) return

  event.respondWith(handlePossibleEscape(event, url, clientId))
})

async function handlePreviewRequest(url) {
  const match = url.pathname.match(/^\/preview\/([^/]+)\/(.*)$/)
  if (!match) return new Response('Bad preview URL', { status: 400 })
  const uuid = match[1]
  const path = match[2] === '' ? 'index.html' : match[2]
  return serveFromBundle(uuid, path)
}

async function handlePossibleEscape(event, url, clientId) {
  let client = null
  try {
    client = await self.clients.get(clientId)
  } catch {
    /* ignore */
  }
  // If we can't identify the client, we shouldn't have been called —
  // but as a safety net, fall through to the default network behavior.
  // Do this by re-fetching with a fresh Request to avoid re-using the
  // original (which can cause TypeErrors in some browsers/modes).
  if (!client) {
    try {
      return await fetch(event.request)
    } catch {
      return new Response('Network error', { status: 502 })
    }
  }

  let clientURL
  try {
    clientURL = new URL(client.url)
  } catch {
    return fetch(event.request).catch(() => new Response('Network error', { status: 502 }))
  }
  if (clientURL.origin !== self.location.origin) {
    return fetch(event.request).catch(() => new Response('Network error', { status: 502 }))
  }
  const m = clientURL.pathname.match(/^\/preview\/([^/]+)\//)
  if (!m) {
    // Client isn't a preview iframe — pass through. (Strictly we
    // shouldn't have been called for this case, but guard anyway.)
    return fetch(event.request).catch(() => new Response('Network error', { status: 502 }))
  }

  // Request came from a preview iframe. Try the bundle's virtual root.
  const uuid = m[1]
  const cache = await caches.open(CACHE_PREFIX + uuid)
  const rewrittenURL = `/preview/${uuid}${url.pathname}`
  const cached = await cache.match(rewrittenURL)
  if (cached) return cached

  // Vite/CRA `public/` convention fallback — same as serveFromBundle().
  if (!url.pathname.startsWith('/public/')) {
    const publicFallback = await cache.match(`/preview/${uuid}/public${url.pathname}`)
    if (publicFallback) return publicFallback
  }

  // Not in the bundle — fall through to the real network.
  return fetch(event.request).catch(() => new Response('Network error', { status: 502 }))
}

async function serveFromBundle(uuid, path) {
  const cacheName = CACHE_PREFIX + uuid
  const cache = await caches.open(cacheName)
  const requestURL = `/preview/${uuid}/${path}`

  let res = await cache.match(requestURL)
  if (res) return res

  // Vite / CRA convention: files in `public/` are served at the root.
  // If a request for /preview/<uuid>/foo.jsx misses, try
  // /preview/<uuid>/public/foo.jsx. This lets repos with the standard
  // `public/` layout work without per-repo configuration.
  if (!path.startsWith('public/')) {
    res = await cache.match(`/preview/${uuid}/public/${path}`)
    if (res) return res
  }

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
