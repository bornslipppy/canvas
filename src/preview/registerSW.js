/**
 * Service Worker registration for the preview virtual filesystem.
 *
 * Idempotent — call this on app mount. Returns a promise that resolves
 * to the SW registration once it's active and ready to receive messages.
 *
 * v2 note: this no longer waits for `navigator.serviceWorker.controller`
 * to be set, because that observation is racy on first page-load (the SW
 * activates and calls clients.claim(), but the `controllerchange` event
 * can fire before any listener is attached, causing a forever-hang).
 *
 * Instead, we wait for `navigator.serviceWorker.ready` (which guarantees
 * an active SW exists in scope), and send messages directly to
 * `registration.active`. Fetch interception works for any in-scope
 * navigation regardless of whether the original document is "controlled"
 * — the iframe's first request loads under the SW automatically.
 */

let readyPromise = null

export function registerPreviewSW() {
  if (readyPromise) return readyPromise
  if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) {
    readyPromise = Promise.reject(
      new Error('Service Workers not supported in this browser')
    )
    return readyPromise
  }

  readyPromise = (async () => {
    // Register at root scope so /preview/* paths are interceptable.
    await navigator.serviceWorker.register('/preview-sw.js', { scope: '/' })
    // navigator.serviceWorker.ready resolves once an SW is installed and
    // active in scope. We do NOT additionally wait for `.controller`.
    const registration = await navigator.serviceWorker.ready
    if (!registration.active) {
      throw new Error(
        'Service Worker registered but registration.active is null. This shouldn\'t happen.'
      )
    }
    return registration
  })()
  return readyPromise
}

/**
 * Send a message to the active SW and await a typed reply over MessageChannel.
 *
 * Uses `registration.active` rather than `navigator.serviceWorker.controller`
 * so it works on the very first page-load (before the SW has claimed the
 * document) as well as on subsequent loads.
 */
export async function postToSW(message, expectedReplyType) {
  const registration = await registerPreviewSW()
  const sw = registration.active
  if (!sw) {
    throw new Error('No active service worker — registration is broken')
  }

  return new Promise((resolve, reject) => {
    const channel = new MessageChannel()
    const timeout = setTimeout(() => {
      reject(new Error(`SW did not reply with ${expectedReplyType} within 30s`))
    }, 30_000)

    channel.port1.onmessage = (e) => {
      clearTimeout(timeout)
      if (e.data?.type === expectedReplyType) {
        resolve(e.data)
      } else if (e.data?.type === 'UPLOAD_ERROR') {
        reject(new Error(e.data.message))
      } else {
        reject(new Error(`Unexpected SW reply: ${e.data?.type}`))
      }
    }

    sw.postMessage(message, [channel.port2])
  })
}
