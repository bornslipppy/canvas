/**
 * localStorage-backed comment store.
 *
 * Matches the shape of the server contract from prototype-comments package
 * (full-array read + full-array write). This means swapping to a real backend
 * later is a one-file change: replace `loadAll` and `saveAll` with `fetch`
 * calls to GET/PUT /api/comments.
 */

const STORAGE_KEY = 'canvas-comments-v1'
const AUTHOR_KEY = 'canvas-comment-author'

function loadAll() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

function saveAll(comments) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(comments))
  } catch (e) {
    // Quota or disabled — fail loud in dev, swallow in prod-y.
    console.error('Failed to save comments', e)
  }
}

export function listComments() {
  return loadAll()
}

export function createComment(fields) {
  const comment = {
    id: crypto.randomUUID(),
    frameId: fields.frameId,
    route: fields.route ?? '',
    x: fields.x,
    y: fields.y,
    body: fields.body,
    author: (fields.author?.trim() || 'Anonymous'),
    status: 'open',
    createdAt: new Date().toISOString(),
  }
  const all = loadAll()
  saveAll([...all, comment])
  return comment
}

export function updateComment(id, patch) {
  const all = loadAll()
  const i = all.findIndex((c) => c.id === id)
  if (i === -1) return null
  const updated = { ...all[i], ...patch }
  const next = [...all]
  next[i] = updated
  saveAll(next)
  return updated
}

export function deleteComment(id) {
  const all = loadAll()
  const next = all.filter((c) => c.id !== id)
  if (next.length === all.length) return false
  saveAll(next)
  return true
}

export function getStoredAuthor() {
  try {
    return localStorage.getItem(AUTHOR_KEY) ?? ''
  } catch {
    return ''
  }
}

export function setStoredAuthor(name) {
  try {
    localStorage.setItem(AUTHOR_KEY, name)
  } catch {
    /* ignore */
  }
}
