/**
 * Comment data model.
 *
 * @typedef {Object} Comment
 * @property {string} id          - uuid
 * @property {string} frameId     - which prototype frame this comment belongs to
 * @property {string} route       - the sub-page route the prototype was on when this
 *                                  comment was created. Empty string if the prototype
 *                                  hadn't reported a route yet (i.e. snippet not installed).
 * @property {number} x           - 0..1 horizontal position normalized to the iframe rect
 * @property {number} y           - 0..1 vertical position normalized to the iframe rect
 * @property {string} body        - comment text
 * @property {string} author      - display name; defaults to "Anonymous" when empty
 * @property {"open"|"resolved"} status
 * @property {string} createdAt   - ISO timestamp
 */

/**
 * Visible filter helpers.
 *
 * A comment is VISIBLE on the canvas iff:
 *   - it belongs to a frame that currently exists in `frames`, AND
 *   - the prototype in that frame is currently showing the same `route` as the
 *     one the comment was anchored to (or the comment's route is "" — see note).
 *
 * Note on empty-route comments: these come from times when the prototype hadn't
 * yet posted a route (snippet not installed, or before first navigation event).
 * We treat empty-route comments as visible whenever the current route is also
 * empty — i.e. they only show on prototypes still in the "unknown route" state.
 *
 * @param {Comment} comment
 * @param {string|undefined} currentFrameRoute
 * @returns {boolean}
 */
export function isCommentVisibleAtRoute(comment, currentFrameRoute) {
  const current = currentFrameRoute ?? ''
  return comment.route === current
}

export {}
