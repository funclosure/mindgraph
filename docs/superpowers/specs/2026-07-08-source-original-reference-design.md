# Source original reference — design

**Date:** 2026-07-08
**Status:** Approved (design), pending implementation
**Branch:** `feat/source-original-reference`

## Problem

A `.mindgraph.md` records what material was digested (`@source` with `type`,
`title`, `path`) but has no place for the original's **URL**, and nothing about
the origin reaches the reader. When you open a graph in the UI you cannot get
back to the article it came from. We want each source to carry an optional
link, and the reading pane to surface it so the reader can open the original.

## Approach (chosen: A)

Add an optional `url:` field to `@source`, thread it (plus the existing `path`)
through compile → view model → UI, and render a small reference line in the
source pane that reflects the **active** source. Clickable for a URL; a muted,
non-clickable filename for a local path only (browsers block `file://`
navigation from an `http` page, so a dead link would be worse than quiet text).

Rejected alternatives: a per-source `references:` list (more expressive —
paper + demo + commentary — but needs list parsing and multi-link rendering we
have no concrete need for yet; A doesn't preclude adding it later); a
document-level `source_url:` in frontmatter (wrong layer — documents already
have plural sources once Ask crystallizes a discussion).

## Layer-by-layer changes

Each layer change is small and follows the existing `path` field's path through
the code.

### 1. Authoring parse — `src/core/authoring/parse.js`
`DIRECTIVE_FIELDS.source` gains `'url'` (line 14: `Set(['type','title','path'])`
→ add `'url'`). Nothing else; the generic field parser already carries it.

### 2. Authoring/runtime schema — `src/core/authoring/schema.js`
In `validateSourceFirstDocument`'s source loop (~line 77), if a source has a
`url` present it must be a non-empty `http(s)://` string; otherwise push an
error. Absent `url` is valid (field is optional). This fires at both
`authoring validate` and `authoring compile` (compile validates the built
model). `path` needs no new validation — it's a free-form provenance string.

### 3. Compile — `src/core/authoring/compile.js`
`sourceFrom()` (line 16) passes `url` through exactly like `path`:
`...(entry.fields.url ? { url: String(entry.fields.url) } : {})`.

### 4. View model — `src/view-model/buildMindgraphViewModel.js`
`buildDocumentMetaVM` maps sources to `{id, title, type}` (line 619). Add
`url` and `path` so the shell can render provenance:
`{ id, title, type, ...(s.url ? {url} : {}), ...(s.path ? {path} : {}) }`.
Pure pass-through, no derivation.

### 5. UI — `ui/index.html`, `ui/app.js`, `ui/styles.css`
- `index.html`: add `<div id="source-reference" class="source-reference"></div>`
  between `#source-switcher` and `#prose-source` inside `.prose-pane--source`.
- `app.js`: add `renderSourceReference()` mirroring `renderSourceSwitcher()`'s
  active-source resolution (`sources.find(s => s.id === activeSourceId) ??
  sources[0]`, handling the single-source `activeSourceId === null` case). Call
  it from `render()` right after `renderSourceSwitcher()` (≈ line 184) and after
  a source switch. Behavior:
  - active source has `url` → `<a class="source-reference__link" target="_blank"
    rel="noopener" href="…">↗ <hostname + pathname></a>` (display strips the
    scheme for legibility; `href` is the full URL).
  - else has `path` → `<span class="source-reference__file" title="<full path>">
    <basename></span>` (muted, not a link).
  - else → empty string (no line). Discussions (Ask-woven) have neither, so they
    stay clean automatically.
  - All interpolated values escaped via the existing `escapeHtml`.
- `styles.css`: `.source-reference` (small, muted, padding matching the
  switcher) and `.source-reference__link` (accent color, underline on hover).

### 6. Draft scaffold — `src/core/authoring/draft.js` + `src/cli/index.js`
- `createAuthoringDraftFromText` writes a `url:` line when `opts.sourceUrl` is
  set (mirrors the `opts.sourcePath` line at draft.js:307).
- `authoring draft` CLI gains `--url <url>`, plumbed into `opts.sourceUrl`, and
  the usage/help string is updated.

### 7. Backfill the live sample — `graphs/global-workspace.mindgraph.md`
Add `url: https://www.anthropic.com/research/global-workspace` to its `@source`
and recompile. This graph becomes the working demonstration.

## Placement refinement (deviation from the ASCII mockup)

The approved mockup drew the link *under the gold title*, which lives inside the
scrolling prose and would scroll away. Instead the reference is a **pinned row**
in the source-pane header zone (same band as the multi-source switcher), so it
stays reachable and updates when you switch sources. Same information, more
useful position; flagged here because it differs from the sketch.

## Data flow

```
@source url: …            (authoring .md)
  → parse.js               field whitelisted
  → schema.js              url format validated
  → compile.js sourceFrom  → sources[i].url in runtime JSON
  → buildDocumentMetaVM    → documentMeta.sources[i].url
  → app.js renderSourceReference → pinned link in source pane
```

## Error handling

- `url` present but not `http(s)://` → validation error naming the source id,
  surfaced by `authoring validate`/`compile` (blocks a bad compile).
- `url` absent → valid; UI falls back to `path`, then to nothing.
- Malformed URL that still parses as `http(s)` but breaks `new URL()` in the UI
  display helper → fall back to showing the raw (escaped) href rather than
  throwing; the link still works.

## Testing

- `test/authoring-parse.test.js` — `url` on `@source` survives parsing.
- `test/authoring-schema.test.js` — non-`http` url rejected; valid url and
  absent url accepted.
- `test/authoring-compile.test.js` — `url` reaches compiled `sources[i]`.
- `test/view-model-sources.test.js` — `documentMeta.sources[i]` carries `url`
  and `path`.
- `test/authoring-draft.test.js` — `--url`/`sourceUrl` writes the `url:` line.
- UI (`prose`/switcher have render tests): add a focused unit test for the
  `renderSourceReference` string if it's extractable as a pure helper; otherwise
  verify in the browser (link renders, opens in a new tab, path-only shows muted
  filename). Run `npm run ui:check` for syntax.
- Full: `npm run test:authoring`, `test:view-model`, `test:smoke`, and a browser
  pass on the backfilled `global-workspace` graph.

## Out of scope

- Multi-reference lists (`references:`) — future, if a real need appears.
- `source import` auto-recording the URL it fetched — natural follow-up; noted,
  not built here.
- Top-bar link — decided against (only room for one; awkward with plural
  sources).
```
