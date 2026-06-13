/**
 * renderMarkdown.js — deliberately minimal, zero-dependency.
 *
 * Phase-0 honesty: rather than ship a half-correct markdown parser, we escape
 * the source and present it in a styled <pre>. Spec tables (pipe syntax) stay
 * perfectly legible as monospace, and there are no rendering bugs to mislead a
 * developer reading a governed spec. Upgrade path: swap the body for `marked`
 * (one import) once the canvas earns its place — see the design doc §4 phasing.
 */

function escapeHtml(s) {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
}

/** Wrap raw markdown text in a self-contained, scrollable HTML document. */
export function renderMarkdownDoc(markdown, title = 'Spec') {
  return `<!doctype html><html><head><meta charset="utf-8">
<title>${escapeHtml(title)}</title>
<style>
  html,body{margin:0;background:#fff;color:#1a191e;
    font:13px/1.55 ui-monospace,SFMono-Regular,Menlo,monospace;}
  .doc{padding:20px 24px;white-space:pre-wrap;word-break:break-word;}
  .doc h1{position:sticky;top:0;background:#fff;margin:0 0 12px;padding:8px 0;
    font:600 14px/1.3 ui-sans-serif,system-ui;border-bottom:1px solid #eee;}
</style></head>
<body><div class="doc"><h1>${escapeHtml(title)}</h1>${escapeHtml(markdown)}</div></body></html>`
}
