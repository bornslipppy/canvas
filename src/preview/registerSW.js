/**
 * Service Worker registration for the preview virtual filesystem.
 *
 * Idempotent — call this on app mount. Returns a promise that resolves
 * when the SW is registered AND controlling the current page, so it's
 * safe to start uploading bundles afterward.
 */

let readyPromise = null

export function registerPreviewSW() {
  if (readyPromise) return readyPromise
  if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) {
    readyPromise = Promise.reject(new Error('Service Workers not supported in this browser'))
    return readyPromise
  }

  readyPromise = (async () => {
    // Register at root scope so /preview/* paths are interceptable.
    // (The scope of the SW is implied by its URL, but we set it explicitly.)
    await navigator.serviceWorker.register('/preview-sw.js', { scope: '/' })

    // navigator.serviceWorker.ready resolves once the active SW is installed.
    // We additionally wait for the controller to be set, because the FIRST
    // page-load after install doesn't have one yet (the SW activates but
    // hasn't claimed the page — clients.claim() in the SW handles that, but
    // there's still a tick of delay).
    const registration = await navigator.serviceWorker.ready

    if (!navigator.serviceWorker.controller) {
      await new Promise((resolve) => {
        navigator.serviceWorker.addEventListener('controllerchange', resolve, { once: true })
      })
    }

    return registration
  })()
  return readyPromise
}

/** Send a message to the active SW and await a typed reply over MessageChannel. */
export function postToSW(message, expectedReplyType) {
  return new Promise((resolve, reject) => {
    const sw = navigator.serviceWorker.controller
    if (!sw) {
      reject(new Error('No active service worker — call registerPreviewSW() first'))
      return
    }
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
