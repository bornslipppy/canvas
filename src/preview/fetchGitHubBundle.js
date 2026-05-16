/**
 * GitHub repo fetcher for the preview pipeline.
 *
 * Takes a GitHub URL, lists the repo's files via the Git Tree API,
 * fetches each file via raw.githubusercontent.com, and returns an
 * array of File objects shaped like what <input webkitdirectory>
 * produces — so the existing `uploadFolderBundle()` consumes it
 * unchanged.
 *
 * Why not zipball? GitHub's zipball endpoints (both codeload and the
 * REST API's /zipball, which 302s through codeload) return CORS
 * headers tied to render.githubusercontent.com and reject browser
 * fetch() calls from any other origin. This has been a known issue
 * since 2020 and GitHub has not fixed it.
 *
 * The Tree API + raw approach works because:
 *   - api.github.com sets Access-Control-Allow-Origin: * properly
 *   - raw.githubusercontent.com responds 200 with CORS for simple GETs
 *     on public repos (no custom headers, no preflight)
 *
 * Tradeoffs:
 *   - N+1 requests instead of 1 zip. Parallelized, still fast.
 *   - Burns 1 request against the 60/hr api.github.com unauth budget
 *     per repo load. raw.githubusercontent.com fetches don't count.
 *
 * No build step runs in the browser. Tier-A detection (refusing
 * Module Federation, Next, CRA, Vue, Svelte, Angular, Vite-source,
 * etc.) happens AFTER the tree listing but BEFORE any blob fetches,
 * so disqualified repos don't waste bandwidth.
 */

const MAX_BUNDLE_BYTES = 50 * 1024 * 1024 // match processBundle.js cap
const MAX_FILE_COUNT = 2000 // sanity cap
const PARALLEL_FETCHES = 8 // tune for typical prototype size

/**
 * Cheap pre-filter: does this URL string even look like a GitHub repo
 * URL? Used by the UI to decide which code path to take BEFORE calling
 * the full parser.
 */
export function isGithubRepoUrl(input) {
  if (!input || typeof input !== 'string') return false
  const trimmed = input.trim()
  const withScheme = /^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//.test(trimmed)
    ? trimmed
    : `https://${trimmed}`
  let url
  try {
    url = new URL(withScheme)
  } catch {
    return false
  }
  if (url.hostname !== 'github.com' && url.hostname !== 'www.github.com') {
    return false
  }
  const segments = url.pathname.replace(/^\/+|\/+$/g, '').split('/')
  if (segments.length < 2 || !segments[0] || !segments[1]) return false
  const reserved = new Set([
    'orgs', 'settings', 'marketplace', 'notifications', 'pulls', 'issues',
    'discussions', 'sponsors', 'topics', 'trending', 'collections',
    'features', 'security', 'enterprise', 'about', 'pricing', 'login',
    'join', 'new', 'codespaces',
  ])
  if (reserved.has(segments[0])) return false
  return true
}

function parseGithubUrl(input) {
  const trimmed = input.trim()
  const withScheme = /^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//.test(trimmed)
    ? trimmed
    : `https://${trimmed}`

  let parsed
  try {
    parsed = new URL(withScheme)
  } catch {
    throw new Error('That doesn\'t look like a valid URL.')
  }

  if (parsed.hostname !== 'github.com' && parsed.hostname !== 'www.github.com') {
    throw new Error('Only github.com URLs are supported.')
  }

  const segments = parsed.pathname.replace(/^\/+|\/+$/g, '').split('/')
  if (segments.length < 2 || !segments[0] || !segments[1]) {
    throw new Error('URL must point to a repo, e.g. https://github.com/owner/repo.')
  }

  const [owner, rawRepo, kind, ...rest] = segments
  const repo = rawRepo.replace(/\.git$/, '')

  if (kind && kind !== 'tree') {
    throw new Error(
      `URL points to /${kind}/ — paste the repo root or a /tree/{branch} URL.`
    )
  }
  const branch = kind === 'tree' && rest.length > 0 ? rest.join('/') : null
  return { owner, repo, branch }
}

/**
 * Fetch repo metadata to learn the default branch (and confirm the repo
 * exists and is public). Returns { default_branch } on success.
 *
 * Throws with a friendly message on 404/network failure. This is the
 * first network call we make, so it's where private/non-existent repos
 * get caught.
 */
async function fetchRepoMeta(owner, repo) {
  const url = `https://api.github.com/repos/${owner}/${repo}`
  let response
  try {
    response = await fetch(url, {
      mode: 'cors',
      headers: { Accept: 'application/vnd.github+json' },
    })
  } catch {
    throw new Error(
      `Couldn't reach GitHub. Check your connection and try again.`
    )
  }
  if (response.status === 404) {
    throw new Error(
      `Couldn't fetch this repo. It's either private or doesn't exist — the canvas only loads public repos right now.`
    )
  }
  if (response.status === 403) {
    throw new Error(
      `GitHub rate-limited the request (60/hr for unauthenticated). Try again in an hour.`
    )
  }
  if (!response.ok) {
    throw new Error(`GitHub returned ${response.status}.`)
  }
  return response.json()
}

/**
 * Fetch the recursive Git Tree for a branch. Returns the API's tree
 * response, which is { sha, tree: [{path, type, size, sha}], truncated }.
 *
 * Resolves a branch name to its commit SHA via the branches endpoint
 * first (the tree endpoint takes a commit SHA, not a branch name —
 * sort of; it accepts branch names but only some edge cases).
 */
async function fetchTree(owner, repo, branch) {
  // The trees endpoint takes a "tree SHA" — but conveniently, GitHub
  // also accepts a branch name and resolves it to the latest tree on
  // that branch. So we can pass the branch directly.
  const url = `https://api.github.com/repos/${owner}/${repo}/git/trees/${encodeURIComponent(branch)}?recursive=1`
  const response = await fetch(url, {
    mode: 'cors',
    headers: { Accept: 'application/vnd.github+json' },
  })
  if (response.status === 404) {
    throw new Error(`Branch '${branch}' not found in this repo.`)
  }
  if (!response.ok) {
    throw new Error(`Couldn't list repo files (HTTP ${response.status}).`)
  }
  const tree = await response.json()
  if (tree.truncated) {
    // Real prototypes won't hit this — GitHub truncates at 100k entries
    // or 7MB of response, way beyond any reasonable Tier-A repo.
    throw new Error(
      `Repo file tree is too large to list. The canvas can only load smaller repos.`
    )
  }
  return tree
}

/**
 * Tier-A detector. Same logic as before, but operates on the file
 * paths from the tree listing rather than unzipped content. For
 * package.json and PRODUCT.md we DO need their content to inspect
 * deps and StackHint, so the detector fetches those two files inline
 * (cheap — they're both tiny raw fetches).
 *
 * Returns null if the repo is a runnable static prototype, or an
 * error string explaining why it isn't.
 */
async function detectStaticPrototypeFromTree(tree, owner, repo, branch) {
  const paths = tree.tree.filter((e) => e.type === 'blob').map((e) => e.path)
  const lowerPaths = paths.map((p) => p.toLowerCase())

  // Read root package.json if present.
  let rootPkg = null
  if (paths.includes('package.json')) {
    try {
      const text = await fetchRawText(owner, repo, branch, 'package.json')
      rootPkg = JSON.parse(text)
    } catch {
      // Malformed or unreachable — treat as absent.
    }
  }

  const allDeps = rootPkg
    ? { ...rootPkg.dependencies, ...rootPkg.devDependencies }
    : {}

  // --- Disqualifiers ---
  const hasGuestyCi = Object.keys(allDeps).some((d) => d.startsWith('@guestyci/'))
  if (hasGuestyCi) {
    return `This is a Guesty production frontend. It uses private packages and Module Federation — it can't run on the canvas. Paste a deployed URL instead.`
  }

  const bannedFrameworks = [
    ['next', 'Next.js'],
    ['react-scripts', 'Create React App'],
    ['@remix-run/react', 'Remix'],
    ['@remix-run/node', 'Remix'],
    ['@angular/core', 'Angular'],
    ['vue', 'Vue'],
    ['nuxt', 'Nuxt'],
    ['svelte', 'Svelte'],
    ['@sveltejs/kit', 'SvelteKit'],
    ['gatsby', 'Gatsby'],
    ['parcel', 'Parcel'],
    ['webpack', 'webpack'],
  ]
  for (const [dep, label] of bannedFrameworks) {
    if (allDeps[dep]) {
      return `This repo needs a build step (${label} was detected). The canvas only runs static prototypes. Paste a deployed URL instead.`
    }
  }

  // --- Qualifiers ---
  const hasIndexHtml = lowerPaths.some(
    (p) => p === 'index.html' || p.endsWith('/index.html')
  )
  if (!hasIndexHtml) {
    return `No index.html found. This doesn't look like a runnable prototype.`
  }

  // Read PRODUCT.md if present for StackHint override.
  if (paths.includes('PRODUCT.md')) {
    try {
      const text = await fetchRawText(owner, repo, branch, 'PRODUCT.md')
      if (/^StackHint:\s*vite-react-babel-browser\s*$/m.test(text)) {
        return null
      }
    } catch {
      // Best-effort; fall through to the rest of detection.
    }
  }

  // Plain static site (no package.json at root).
  if (!rootPkg) return null

  // Vite-source detection.
  const hasVite = !!(allDeps.vite || allDeps['@vitejs/plugin-react'])
  if (hasVite && paths.includes('index.html')) {
    try {
      const html = await fetchRawText(owner, repo, branch, 'index.html')
      if (/<script[^>]*type=["']module["'][^>]*src=["']\/src\//i.test(html)) {
        return `This is a Vite source repo — it needs a dev server to resolve imports under /src/. Run \`npm run build\` and upload the dist/ folder, or paste a deployed URL instead.`
      }
    } catch {
      // If we can't read the index, fall through and let it try.
    }
  }

  return null
}

/**
 * Fetch a file's raw text content via raw.githubusercontent.com.
 * Used by the detector for small text files (package.json, PRODUCT.md,
 * index.html).
 */
async function fetchRawText(owner, repo, branch, path) {
  const url = `https://raw.githubusercontent.com/${owner}/${repo}/${encodeURIComponent(branch)}/${path.split('/').map(encodeURIComponent).join('/')}`
  const response = await fetch(url) // no headers — keep this a "simple request" to avoid preflight
  if (!response.ok) {
    throw new Error(`Couldn't fetch ${path} (HTTP ${response.status}).`)
  }
  return response.text()
}

/**
 * Fetch a file's raw bytes via raw.githubusercontent.com.
 */
async function fetchRawBytes(owner, repo, branch, path) {
  const url = `https://raw.githubusercontent.com/${owner}/${repo}/${encodeURIComponent(branch)}/${path.split('/').map(encodeURIComponent).join('/')}`
  const response = await fetch(url)
  if (!response.ok) {
    throw new Error(`Couldn't fetch ${path} (HTTP ${response.status}).`)
  }
  return new Uint8Array(await response.arrayBuffer())
}

/**
 * Wrap bytes as a File with webkitRelativePath set.
 */
function fileFromBytes(bytes, relativePath, rootName) {
  const name = relativePath.split('/').pop()
  const file = new File([bytes], name)
  Object.defineProperty(file, 'webkitRelativePath', {
    value: `${rootName}/${relativePath}`,
    writable: false,
    configurable: false,
  })
  return file
}

/**
 * Fetch a list of paths in parallel batches. Returns an array of
 * { path, bytes } in the same order as input. Throws on the first
 * failure (we don't want a half-populated bundle).
 */
async function fetchAllFiles(owner, repo, branch, paths) {
  const results = new Array(paths.length)
  let totalBytes = 0
  let index = 0

  async function worker() {
    while (index < paths.length) {
      const myIndex = index++
      const path = paths[myIndex]
      const bytes = await fetchRawBytes(owner, repo, branch, path)
      totalBytes += bytes.byteLength
      if (totalBytes > MAX_BUNDLE_BYTES) {
        throw new Error(
          `Repo is too large (>${MAX_BUNDLE_BYTES / 1024 / 1024} MB).`
        )
      }
      results[myIndex] = { path, bytes }
    }
  }

  const workers = Array.from({ length: Math.min(PARALLEL_FETCHES, paths.length) }, worker)
  await Promise.all(workers)
  return results
}

/**
 * Public entry point.
 *
 * Returns { files, owner, repo, branch } on success. `files` is
 * consumable by `uploadFolderBundle(files)` directly.
 */
export async function fetchGitHubBundle(url) {
  const { owner, repo, branch: requestedBranch } = parseGithubUrl(url)

  // Resolve the branch. If the user gave one, use it. Otherwise hit
  // the repo metadata for default_branch. This also catches
  // private/missing repos with a friendly message.
  const meta = await fetchRepoMeta(owner, repo)
  const branch = requestedBranch || meta.default_branch
  if (!branch) {
    throw new Error(`Couldn't determine which branch to load.`)
  }

  // List the tree.
  const tree = await fetchTree(owner, repo, branch)

  // Filter to file blobs only (skip directories, submodules, symlinks).
  const filePaths = tree.tree
    .filter((e) => e.type === 'blob')
    .map((e) => e.path)

  if (filePaths.length === 0) {
    throw new Error(`This repo is empty on branch '${branch}'.`)
  }
  if (filePaths.length > MAX_FILE_COUNT) {
    throw new Error(
      `Repo has ${filePaths.length} files (max ${MAX_FILE_COUNT}). Too large to load on the canvas.`
    )
  }

  // Tier-A gate. Refuses production frontends, Vite-source repos, etc.
  // Happens before we fetch any file bytes (other than the inline
  // package.json / PRODUCT.md / index.html the detector needs).
  const disqualification = await detectStaticPrototypeFromTree(tree, owner, repo, branch)
  if (disqualification) {
    throw new Error(disqualification)
  }

  // Fetch all file bytes in parallel.
  const fetched = await fetchAllFiles(owner, repo, branch, filePaths)

  // Convert to File[] with webkitRelativePath set.
  const files = fetched.map(({ path, bytes }) =>
    fileFromBytes(bytes, path, repo)
  )

  return { files, repo, branch, owner }
}
