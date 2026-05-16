/**
 * canvas-comments-snippet.js
 * --------------------------
 * Drop-in snippet for ANY prototype you want to be commentable from the
 * Canvas tool. It tells the parent canvas which sub-page is currently
 * showing, so comments stay anchored to the right screen.
 *
 * USAGE
 *
 *   Option A — vanilla:
 *     <script src="/canvas-comments-snippet.js"></script>
 *
 *   Option B — bundled (Vite/Next/CRA):
 *     // In your prototype's app entry (e.g. src/main.jsx, src/index.tsx)
 *     import './canvas-comments-snippet.js'
 *
 *   Option C — inline:
 *     Just paste the IIFE below into a <script> tag in <head>.
 *
 * Works with: React Router, Vue Router, Next.js, plain anchor tags, hash
 * routes, history pushState/replaceState, popstate, hashchange. No framework
 * coupling.
 *
 * What it sends:
 *   parent.postMessage(
 *     { type: 'PROTOTYPE_ROUTE', route: '<pathname+search+hash>' },
 *     '*'
 *   )
 *
 * The route is the iframe's own `location.pathname + location.search +
 * location.hash`. The parent matches the message source (e.source) to the
 * specific <iframe> element by comparing contentWindow.
 *
 * NOTES
 * - No-op if the prototype isn't running inside an iframe.
 * - Idempotent: importing twice doesn't double-patch history.
 * - targetOrigin is '*' because canvas hostname is not known in advance.
 *   The message contents are non-sensitive (just a path). If you do want to
 *   restrict, set CANVAS_ORIGIN below to e.g. 'https://canvas.example.com'.
 */

(function () {
  if (typeof window === 'undefined') return
  if (window.parent === window) return // not inside an iframe
  if (window.__canvasCommentsSnippetInstalled) return
  window.__canvasCommentsSnippetInstalled = true

  var CANVAS_ORIGIN = '*' // tighten this in production if you know the canvas origin

  function currentRoute() {
    return (
      (window.location.pathname || '/') +
      (window.location.search || '') +
      (window.location.hash || '')
    )
  }

  function postRoute() {
    try {
      window.parent.postMessage(
        { type: 'PROTOTYPE_ROUTE', route: currentRoute() },
        CANVAS_ORIGIN
      )
    } catch (e) {
      // Silently ignore: postMessage to a cross-origin parent may throw in
      // unusual sandboxing scenarios. We don't want to break the prototype.
    }
  }

  // Initial post, slightly delayed so any boot-time route normalization has
  // settled by the time the parent records it.
  setTimeout(postRoute, 50)

  // Patch history API so SPA navigations fire a callback.
  var origPush = window.history.pushState
  var origReplace = window.history.replaceState
  window.history.pushState = function () {
    var r = origPush.apply(this, arguments)
    postRoute()
    return r
  }
  window.history.replaceState = function () {
    var r = origReplace.apply(this, arguments)
    postRoute()
    return r
  }

  // Browser back/forward, hash navigation, page show (back/forward cache).
  window.addEventListener('popstate', postRoute)
  window.addEventListener('hashchange', postRoute)
  window.addEventListener('pageshow', postRoute)
})()
