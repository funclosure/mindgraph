# Canvas UI v3 — Flex Layout + Icon Refresh Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace v2's floating-overlay layout with a CSS grid (header on top, graph + chapter strip stacked in the left column, prose as a fixed-width right column), and swap all emoji / text glyphs (`⚙ ✕ ▶ ⌄ ●`) for inline SVG icons in a new `ui/icons.js` module.

**Architecture:** All v2 behaviour (state pipeline, animator, draw, scroll-binding, prose chunks, click-bidirectional linking, drift, chapter jump, view popover, cumulative reveal, bloom, camera lerp) carries through unchanged. v3 changes only the **layout** (grid replaces absolute-positioned overlays) and the **chrome rendering** (SVG replaces emoji glyphs, single thin header row replaces the floating pill). The graph canvas becomes a real grid cell, so its `getBoundingClientRect()` already equals the visible region — fixing v2's camera-behind-prose misalignment without any viewport math.

**Tech Stack:** Vanilla JavaScript (ES modules, no bundler), HTML5 Canvas 2D, plain DOM + CSS for the chrome and prose. Inline SVG icons; no external icon library. SVG paths borrowed from Lucide (MIT licensed).

**Spec:** `docs/canvas-ui-v3-flex-layout-spec.md` (commit `b2b67ad`).

---

## Pre-flight

The dev server (`npm run ui:dev`) must be running at `http://127.0.0.1:4173`. The current UI is v2.

There is no automated test runner. Verification is visual via browser (Playwright if no real browser).

**Do NOT run `npm run test:smoke`** — its first action is `rm -f examples/out/*.json`, which deletes the canonical UI sample. If a sample is wiped accidentally, restore with `git checkout HEAD -- examples/out/<file>.json`.

Each task is self-contained. Read the file path notes, do the steps in order, run the verification, then commit.

---

## File Structure

**Files created:**

- `ui/icons.js` — exports inline SVG strings for the chrome icons. Five icons: `settings`, `panelRightClose`, `panelRightOpen`, `play`, `pause`. Each export is a function `icon({ size, className })` returning an SVG string with `currentColor` stroke. Style: 18 × 18 viewport, 1.5-stroke, line-based, Lucide-style.

**Files modified:**

- `ui/index.html` — drop the four `.overlay--*` containers. Add a single `.app` grid container with named areas: `header`, `graph`, `strip`, `prose`. The `<canvas id="stage">` lives in the `graph` area; the prose `<aside>` in the `prose` area; the topbar `<header>` in the `header` area; the chapter strip `<div>` in the `strip` area. The prose-handle (`📖` re-expand) is removed — its function moves to a button in the header.
- `ui/styles.css` — replace overlay rules with grid rules. Header is a flat thin row (no pill, no backdrop blur, ~40 px). Chapter strip same. Prose column is `auto`-sized via CSS variable, default `min(620px, 44vw)`. When prose is collapsed (`display: none`), the grid's right column collapses to 0 width and the left column expands.
- `ui/panels/topbar.js` — render `<div class="topbar-title">…</div><div class="topbar-meta">…</div><div class="topbar-actions">…</div>` where `.topbar-actions` contains two icon-only buttons: settings (toggles the view popover) and prose-toggle (icon depends on `state.prosCollapsed`).
- `ui/panels/view-popover.js` — render only the popover panel (when `state.viewPopoverOpen` is true). The settings button itself is rendered by `topbar.js`.
- `ui/panels/prose.js` — drop the sticky `<header class="prose-header">` containing the close button. The prose returns just `<article class="prose-article">…</article>`. Toggle-prose moves to the topbar's prose-toggle icon.
- `ui/panels/chapter-strip.js` — replace `▶` text with the `play` / `pause` SVG icon (depending on `isDriftActive()`). Drop the `⌄` collapse button entirely (chapter-strip collapse is removed in v3).
- `ui/app.js` — drop `topbarCollapsed` and `chapterStripCollapsed` from state. Drop the conditional rendering branches in `updateTopbar` and `updateChapterStrip` that handled the collapsed state. The prose-collapsed branch stays. Drop the bootstrap line that sets `data-prose-collapsed` on `.app` (it stays as a way to gate prose visibility via CSS, but the toggle button now lives in the header so we read `state.prosCollapsed` from there).
- `ui/events.js` — drop the `[data-action="toggle-topbar"]` and `[data-action="toggle-chapter-strip"]` handlers. Update the `[data-action="toggle-prose"]` handler to also need to update the icon swap (handled automatically because the topbar re-renders on each `render()`).

**Files deleted:** none.

---

## Task 1: Inline SVG icons module

A small icons module exporting five icon SVGs as functions returning strings. No external dependency; SVG paths sourced from Lucide (MIT licensed, https://lucide.dev).

**Files:**
- Create: `ui/icons.js`

- [ ] **Step 1: Create `ui/icons.js`**

```js
// ---------------------------------------------------------------------------
// Icons — small inline SVG set, Lucide-style (MIT-licensed paths).
// ---------------------------------------------------------------------------
//
// Each export is a function returning an SVG string. They use currentColor
// for stroke so they tint with surrounding text colour. Default size 18 px,
// stroke-width 1.5. Pass { size, className } to override.
//
// Source paths from https://lucide.dev (MIT). Reproduced inline so the
// project keeps its zero-dependency policy.

function svg({ size = 18, className = '' }, body) {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" class="${className}" aria-hidden="true">${body}</svg>`;
}

export function settingsIcon(opts = {}) {
  return svg(opts, `
    <path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z"/>
    <circle cx="12" cy="12" r="3"/>
  `);
}

export function panelRightCloseIcon(opts = {}) {
  return svg(opts, `
    <rect width="18" height="18" x="3" y="3" rx="2"/>
    <path d="M15 3v18"/>
    <path d="m8 9 3 3-3 3"/>
  `);
}

export function panelRightOpenIcon(opts = {}) {
  return svg(opts, `
    <rect width="18" height="18" x="3" y="3" rx="2"/>
    <path d="M15 3v18"/>
    <path d="m10 15-3-3 3-3"/>
  `);
}

export function playIcon(opts = {}) {
  return svg(opts, `
    <polygon points="6 3 20 12 6 21 6 3"/>
  `);
}

export function pauseIcon(opts = {}) {
  return svg(opts, `
    <rect x="6" y="4" width="4" height="16" rx="1"/>
    <rect x="14" y="4" width="4" height="16" rx="1"/>
  `);
}
```

- [ ] **Step 2: Verify `npm run ui:check`**

```bash
npm run ui:check
```

Expected: clean. The icons module is not yet mounted; this just confirms the file parses.

- [ ] **Step 3: Commit**

```bash
git add ui/icons.js
git commit -m "feat(ui): inline SVG icons module (Lucide-style, no dep)" -m "$(cat <<'EOF'
ui/icons.js exports five SVG icons used in the v3 chrome: settings,
panelRightClose, panelRightOpen, play, pause. Each is a function
returning an SVG string with currentColor stroke and a default 18 px
size. Paths borrowed from Lucide (MIT licensed) so the project keeps
its zero-runtime-dependency policy.
EOF
)"
```

---

## Task 2: HTML + CSS grid restructure

Switch the page from absolute-positioned overlays to a CSS grid. The graph canvas becomes a real grid cell. Prose, topbar, and chapter strip are real grid cells too.

**Files:**
- Modify: `ui/index.html`
- Modify: `ui/styles.css`

- [ ] **Step 1: Rewrite `ui/index.html`**

Replace the body with:

```html
<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>mindgraph</title>
    <link rel="stylesheet" href="/ui/styles.css" />
  </head>
  <body>
    <div class="app">
      <header class="topbar" id="topbar"></header>
      <div class="graph-cell">
        <canvas id="stage"></canvas>
      </div>
      <div class="strip" id="chapter-strip"></div>
      <aside class="prose" id="prose"></aside>
      <div class="view-popover" id="view-popover"></div>
    </div>
    <script type="module" src="/ui/app.js"></script>
  </body>
</html>
```

The previous `.overlay--*` containers and the `prose-handle` button are gone. The `view-popover` container stays as a lightweight DOM node where the popover renders when open; it has no special positioning until CSS anchors it.

- [ ] **Step 2: Rewrite `ui/styles.css`**

Open `ui/styles.css` and replace its **entire content** with:

```css
/* mindgraph v3 — CSS grid layout, flat chrome, SVG icons. */

:root {
  color-scheme: dark;
  --bg: #0d0e12;
  --panel: #14161c;
  --panel-soft: #161821;
  --border: rgba(214, 176, 109, 0.12);
  --text: #ece6d7;
  --muted: #a9a18f;
  --quiet: #7f7769;
  --gold: #d6b06d;
  --gold-soft: #b89461;
  --gold-bright: #f4cf86;
  --prose-width: min(620px, 44vw);
  --header-height: 44px;
  --strip-height: 44px;
}

* { box-sizing: border-box; }

html, body {
  margin: 0;
  padding: 0;
  height: 100%;
  background: var(--bg);
  color: var(--text);
  font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
  overflow: hidden;
}

button, input, select { font: inherit; }
button { cursor: pointer; color: inherit; }

.app {
  display: grid;
  grid-template-columns: minmax(0, 1fr) var(--prose-width);
  grid-template-rows: var(--header-height) minmax(0, 1fr) var(--strip-height);
  grid-template-areas:
    "header  prose"
    "graph   prose"
    "strip   prose";
  width: 100vw;
  height: 100vh;
  background: var(--bg);
}
.app[data-prose-collapsed="true"] {
  grid-template-columns: minmax(0, 1fr) 0;
}
.app[data-prose-collapsed="true"] .prose { display: none; }

.topbar {
  grid-area: header;
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 0 16px;
  background: var(--panel-soft);
  border-bottom: 1px solid var(--border);
  font-size: 0.78rem;
  color: rgba(245, 234, 210, 0.85);
}
.topbar h1 {
  margin: 0;
  font-size: 0.84rem;
  font-weight: 600;
}
.topbar .topbar-meta {
  color: var(--muted);
  font-size: 0.74rem;
}
.topbar-actions {
  margin-left: auto;
  display: flex;
  gap: 6px;
}
.topbar-actions button {
  background: transparent;
  border: 1px solid transparent;
  color: rgba(245, 234, 210, 0.7);
  width: 30px;
  height: 30px;
  border-radius: 6px;
  display: grid;
  place-items: center;
  padding: 0;
}
.topbar-actions button:hover {
  background: rgba(255, 255, 255, 0.04);
  border-color: var(--border);
  color: var(--text);
}
.topbar-actions button.is-active {
  background: rgba(214, 176, 109, 0.14);
  border-color: rgba(214, 176, 109, 0.32);
  color: var(--gold-bright);
}

.graph-cell {
  grid-area: graph;
  position: relative;
  overflow: hidden;
}
.graph-cell canvas {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  display: block;
  touch-action: none;
}

.strip {
  grid-area: strip;
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 0 14px;
  background: var(--panel-soft);
  border-top: 1px solid var(--border);
  font-size: 0.74rem;
  color: rgba(245, 234, 210, 0.6);
}
.strip .strip-label {
  color: var(--muted);
  font-size: 0.7rem;
  letter-spacing: 0.05em;
  text-transform: uppercase;
}
.strip .strip-track {
  position: relative;
  flex: 1;
  height: 8px;
  background: rgba(255, 255, 255, 0.06);
  border-radius: 4px;
  overflow: hidden;
}
.strip .strip-seg {
  position: absolute;
  top: 0;
  bottom: 0;
  background: rgba(184, 148, 97, 0.32);
  border: none;
  border-right: 1px solid rgba(0, 0, 0, 0.32);
  padding: 0;
  transition: background-color 120ms ease;
}
.strip .strip-seg:last-child { border-right: none; }
.strip .strip-seg:hover { background: rgba(214, 176, 109, 0.55); }
.strip .strip-seg.is-active {
  background: rgba(231, 203, 141, 0.85);
  box-shadow: 0 0 12px rgba(231, 203, 141, 0.4);
}
.strip .strip-drift {
  background: transparent;
  border: 1px solid var(--border);
  color: rgba(245, 234, 210, 0.7);
  width: 28px;
  height: 28px;
  border-radius: 999px;
  display: grid;
  place-items: center;
  padding: 0;
}
.strip .strip-drift:hover { color: var(--text); }
.strip .strip-drift.is-on {
  background: rgba(244, 207, 134, 0.18);
  border-color: rgba(244, 207, 134, 0.45);
  color: var(--gold-bright);
}

.prose {
  grid-area: prose;
  background: var(--panel);
  border-left: 1px solid var(--border);
  padding: 18px 24px;
  overflow-y: auto;
  overflow-x: hidden;
  font-size: 0.92rem;
  line-height: 1.62;
  color: rgba(232, 226, 211, 0.9);
}
.prose-article > :first-child { margin-top: 0; }
.prose-chapter {
  font-size: 1.08rem;
  font-weight: 600;
  color: var(--gold-bright);
  margin: 28px 0 10px;
  letter-spacing: 0.01em;
}
.prose-chapter:first-child { margin-top: 0; }
.prose-para {
  margin: 0 0 16px;
}
.concept {
  color: var(--gold);
  border-bottom: 1px dotted rgba(214, 176, 109, 0.45);
  cursor: pointer;
  transition: color 120ms ease, background-color 120ms ease;
}
.concept:hover {
  color: var(--gold-bright);
  border-bottom-color: rgba(214, 176, 109, 0.7);
}
.concept--active {
  color: var(--gold-bright);
  background: rgba(244, 207, 134, 0.10);
  border-bottom-color: rgba(244, 207, 134, 0.6);
  border-radius: 3px;
  padding: 0 2px;
}
.concept--selected {
  color: #fff4db;
  background: rgba(244, 207, 134, 0.18);
  border-bottom: 1px solid rgba(244, 207, 134, 0.85);
  border-radius: 3px;
  padding: 0 2px;
}

.view-popover {
  position: absolute;
  top: calc(var(--header-height) + 6px);
  right: calc(var(--prose-width) + 12px);
  z-index: 20;
}
.app[data-prose-collapsed="true"] .view-popover { right: 12px; }
.view-popover__panel {
  background: var(--panel);
  border: 1px solid var(--border);
  border-radius: 10px;
  padding: 10px 12px;
  font-size: 0.78rem;
  min-width: 220px;
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.32);
}
.view-popover__row { display: flex; flex-direction: column; gap: 6px; }
.view-popover__label { color: var(--muted); font-size: 0.72rem; text-transform: uppercase; letter-spacing: 0.06em; }
.view-popover__levels { display: inline-flex; gap: 4px; }
.vp-level {
  padding: 4px 10px;
  border-radius: 999px;
  border: 1px solid var(--border);
  background: rgba(255, 255, 255, 0.03);
  color: rgba(245, 234, 210, 0.85);
}
.vp-level.is-active {
  background: rgba(214, 176, 109, 0.18);
  border-color: rgba(214, 176, 109, 0.42);
}
```

- [ ] **Step 3: Verify in browser**

Run `npm run ui:check`.

Reload `http://127.0.0.1:4173/`. The chrome will look broken in this intermediate state — that's expected. You should see:

- Three flat thin rows / regions visible: header on top, graph area in the middle-left, chapter strip below the graph.
- Prose column on the right.
- The header is empty (still rendering v2 markup which expects different classes — fixes in Task 3).
- The chapter strip is empty (same reason — fixes in Task 4).
- The graph still draws clusters but the camera fit is now correct (no behind-prose offset).

Console errors are expected — the panel renderers from v2 still output v2 chrome that doesn't match the new CSS classes. Tasks 3-5 fix this. Don't worry about the intermediate visuals.

- [ ] **Step 4: Commit**

```bash
git add ui/index.html ui/styles.css
git commit -m "feat(ui): grid layout replaces floating overlays" -m "$(cat <<'EOF'
The .app container is now a CSS grid: header on top, graph + chapter
strip stacked in the left column, prose as a fixed-width right column.
The graph canvas is a real grid cell — its getBoundingClientRect now
equals the visible area, so the camera math fits the canvas correctly
without compensating for prose width. Panel renderers still output v2
chrome temporarily; tasks 3-5 update them to the new layout.
EOF
)"
```

---

## Task 3: Topbar header with icons + view popover panel-only

The topbar moves from a floating pill to a flat thin row. It now contains: title, speaker + duration meta, and on the right two icon-only buttons (settings, prose-toggle). The view popover renders only the panel (the trigger button is in the topbar).

**Files:**
- Modify: `ui/panels/topbar.js`
- Modify: `ui/panels/view-popover.js`
- Modify: `ui/app.js`
- Modify: `ui/events.js`

- [ ] **Step 1: Rewrite `ui/panels/topbar.js`**

Replace the file content with:

```js
// ---------------------------------------------------------------------------
// Topbar — single thin header row: title, meta, action icons.
// ---------------------------------------------------------------------------

import { escapeHtml, formatTime } from '../util.js';
import {
  settingsIcon,
  panelRightCloseIcon,
  panelRightOpenIcon,
} from '../icons.js';

export function renderTopbar(vm, document_, state) {
  const speakers = (document_.transcript?.speakers ?? []).join(', ') || 'Unknown speaker';
  const settingsActive = state.viewPopoverOpen ? 'is-active' : '';
  const proseIcon = state.prosCollapsed ? panelRightOpenIcon() : panelRightCloseIcon();
  const proseTitle = state.prosCollapsed ? 'Show reading panel' : 'Hide reading panel';
  return (
    `<h1>${escapeHtml(vm.documentMeta.title)}</h1>` +
    `<span class="topbar-meta">${escapeHtml(speakers)} · ${formatTime(vm.documentMeta.durationSeconds)}</span>` +
    `<div class="topbar-actions">` +
      `<button type="button" data-action="toggle-view-popover" class="${settingsActive}" title="View settings" aria-label="View settings">${settingsIcon()}</button>` +
      `<button type="button" data-action="toggle-prose" title="${proseTitle}" aria-label="${proseTitle}">${proseIcon}</button>` +
    `</div>`
  );
}
```

- [ ] **Step 2: Rewrite `ui/panels/view-popover.js`**

The popover module now renders only the panel (when open). The trigger button moved to the topbar.

```js
// ---------------------------------------------------------------------------
// View popover — panel only. The trigger button lives in the topbar.
// ---------------------------------------------------------------------------

export function renderViewPopover(state) {
  if (!state.viewPopoverOpen) return '';
  const levelButtons = ['macro', 'meso', 'micro']
    .map((level) => {
      const active = state.activeLevel === level;
      return `<button type="button" class="vp-level ${active ? 'is-active' : ''}" data-action="set-level" data-level="${level}">${level}</button>`;
    })
    .join('');
  return `
    <div class="view-popover__panel">
      <div class="view-popover__row">
        <div class="view-popover__label">Camera level</div>
        <div class="view-popover__levels">${levelButtons}</div>
      </div>
    </div>
  `;
}
```

- [ ] **Step 3: Update `ui/app.js`**

Find the existing `updateTopbar` function and replace it with:

```js
function updateTopbar() {
  const el = document.getElementById('topbar');
  if (!el) return;
  el.innerHTML = renderTopbar(state.viewModel, state.document, state);
}
```

Find the existing `updateViewPopover` function and replace it with:

```js
function updateViewPopover() {
  const el = document.getElementById('view-popover');
  if (!el) return;
  el.innerHTML = renderViewPopover(state);
}
```

Note: the DOM element ids changed from `topbar-overlay` and `view-popover-overlay` (v2) to `topbar` and `view-popover` (v3 HTML). Confirm the new ids match Task 2 step 1's HTML.

In `bootstrap()`, find the line that sets `data-prose-collapsed` on `.app`:

```js
  document.querySelector('.app').dataset.proseCollapsed = String(state.prosCollapsed);
```

Keep this line — the grid CSS uses it to collapse the prose column. The toggle handler in `events.js` (Task 5 step 1) updates the same attribute.

- [ ] **Step 4: Verify in browser**

Run `npm run ui:check`. Reload `http://127.0.0.1:4173/`. Expected:

- Header row at the top now shows: title (left), speaker + duration (next), two SVG icon buttons on the right (settings ⚙ as line-art and panel-right-close as a panel icon).
- Click the prose-toggle button → prose hides; the icon swaps to panel-right-open. Click again → prose returns.
- Click the settings button → view popover opens below it as a small panel with the macro/meso/micro level toggle. Click again → closes.
- No emoji glyphs in the header.
- Take a Playwright screenshot for the record.

- [ ] **Step 5: Commit**

```bash
git add ui/panels/topbar.js ui/panels/view-popover.js ui/app.js
git commit -m "feat(ui): topbar with SVG icons + view popover panel-only" -m "$(cat <<'EOF'
Topbar renders title + meta + two SVG icon buttons (settings,
panel-right-close/open). The settings button toggles the view
popover; the prose-toggle button hides/shows the prose column. The
view popover renders only the panel — the trigger lives in the
topbar. All emoji glyphs (⚙) are replaced with inline SVG.
EOF
)"
```

---

## Task 4: Chapter strip with SVG icons

The chapter strip drops the chapter-strip collapse button (chrome is already minimal) and replaces the `▶` text with the `play` / `pause` SVG icon depending on drift state.

**Files:**
- Modify: `ui/panels/chapter-strip.js`
- Modify: `ui/app.js`
- Modify: `ui/events.js`

- [ ] **Step 1: Rewrite `ui/panels/chapter-strip.js`**

Replace the file content with:

```js
// ---------------------------------------------------------------------------
// Chapter strip — proportional macro segments + drift-forward button.
// ---------------------------------------------------------------------------

import { escapeHtml } from '../util.js';
import { playIcon, pauseIcon } from '../icons.js';
import { isDriftActive } from '../drift.js';

export function renderChapterStrip(vm, state) {
  const macros = vm.frames.macro ?? [];
  const total = Math.max(1, vm.documentMeta.durationSeconds);
  const activeMacro = vm.selectors.getActiveFrameAtTime('macro', state.playheadTime);
  const activeIdx = activeMacro?.ref.index ?? -1;

  const segments = macros
    .map((frame) => {
      const leftPct = (frame.span.start / total) * 100;
      const widthPct = ((frame.span.end - frame.span.start) / total) * 100;
      const isActive = frame.ref.index === activeIdx;
      const cls = ['strip-seg'];
      if (isActive) cls.push('is-active');
      const title = escapeHtml(frame.title || `Chapter ${frame.ref.index + 1}`);
      return `<button type="button" class="${cls.join(' ')}" data-action="jump-chapter" data-macro-index="${frame.ref.index}" title="${title}" style="left:${leftPct}%;width:${widthPct}%"></button>`;
    })
    .join('');

  const driftOn = isDriftActive();
  const driftIcon = driftOn ? pauseIcon() : playIcon();
  const driftClass = driftOn ? 'strip-drift is-on' : 'strip-drift';
  const driftTitle = driftOn ? 'Stop auto-scroll' : 'Auto-scroll forward';

  return (
    `<span class="strip-label">chapters</span>` +
    `<div class="strip-track">${segments}</div>` +
    `<button type="button" class="${driftClass}" data-action="toggle-drift" title="${driftTitle}" aria-label="${driftTitle}">${driftIcon}</button>`
  );
}
```

- [ ] **Step 2: Update `ui/app.js`**

Find `updateChapterStrip` and replace with:

```js
function updateChapterStrip() {
  const el = document.getElementById('chapter-strip');
  if (!el) return;
  el.innerHTML = renderChapterStrip(state.viewModel, state);
}
```

The new id is `chapter-strip` (matches the HTML container in Task 2).

In `state` declaration, drop `topbarCollapsed` and `chapterStripCollapsed` properties — they are unused in v3. `prosCollapsed` stays.

- [ ] **Step 3: Drop dead toggle handlers in `ui/events.js`**

Find and remove these two handler blocks (added in v2 Task 10):

```js
  document.querySelectorAll('[data-action="toggle-topbar"]').forEach((btn) => {
    btn.addEventListener('click', () => {
      state.topbarCollapsed = !state.topbarCollapsed;
      render();
    });
  });
  document.querySelectorAll('[data-action="toggle-chapter-strip"]').forEach((btn) => {
    btn.addEventListener('click', () => {
      state.chapterStripCollapsed = !state.chapterStripCollapsed;
      render();
    });
  });
```

Both data-actions are no longer in any DOM in v3. Removing the handlers cleans up dead code.

The drift toggle reuses the existing `[data-action="toggle-drift"]` handler from v2 (Task 8) — no change needed there. After drift starts/stops, render() runs, which causes `renderChapterStrip` to re-emit with the right play/pause icon.

But there's one wrinkle: in v2, the drift module's onCancel callback called `updateDriftButton(false)` which manually toggled `is-on` on the button. In v3 the icon and the class are owned by `renderChapterStrip`. We need to call `render()` from drift's onCancel so the strip re-renders with the new state.

In `ui/events.js`, find the toggle-drift handler (from Task 8). It currently looks like this:

```js
  document.querySelectorAll('[data-action="toggle-drift"]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const container = document.getElementById('prose-overlay');  // OLD ID
      if (!container) return;
      if (isDriftActive()) {
        stopDrift();
        updateDriftButton(false);
        return;
      }
      const pps = computePixelsPerSecond(container, state.viewModel);
      startDrift({
        container,
        pixelsPerSecond: pps,
        onCancel: () => updateDriftButton(false),
      });
      updateDriftButton(true);
    });
  });
```

Update it to use the new prose container id and call `render()` instead of the manual `updateDriftButton`:

```js
  document.querySelectorAll('[data-action="toggle-drift"]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const container = document.getElementById('prose');
      if (!container) return;
      if (isDriftActive()) {
        stopDrift();
        render();
        return;
      }
      const pps = computePixelsPerSecond(container, state.viewModel);
      startDrift({
        container,
        pixelsPerSecond: pps,
        onCancel: () => render(),
      });
      render();
    });
  });
```

If the local `updateDriftButton(...)` helper is now unused, delete it from the file.

- [ ] **Step 4: Verify in browser**

Run `npm run ui:check`. Reload `http://127.0.0.1:4173/`. Expected:

- Bottom strip shows 6 chapter segments (proportional widths).
- A circular drift button on the right end shows a `play` SVG icon.
- Click drift → button highlights gold and the icon swaps to `pause`. Prose begins to scroll.
- Click drift again → returns to `play`. Prose stops.
- Manual scroll while drifting → drift cancels; icon returns to `play`.
- Click a chapter segment → playhead jumps; prose scrolls to chapter heading; active glow moves.
- No `▶` or `⌄` glyphs anywhere in the strip.

- [ ] **Step 5: Commit**

```bash
git add ui/panels/chapter-strip.js ui/app.js ui/events.js
git commit -m "feat(ui): chapter strip with SVG play/pause icon, drop collapse" -m "$(cat <<'EOF'
The chapter strip's drift button now uses inline SVG play / pause
icons. The strip-collapse button (⌄) is removed — chrome is already
minimal in v3 and adding/removing 44 px does not justify the
toggle. State fields topbarCollapsed and chapterStripCollapsed are
removed from the state object. The toggle-drift handler now updates
the strip via render() instead of a manual class toggle, so the play
↔ pause icon swap is driven by the same render path as everything
else.
EOF
)"
```

---

## Task 5: Drop prose internal close button + update prose-toggle handler

The prose's sticky internal header with the `✕` button is removed — the prose-toggle is now in the topbar (Task 3). Update the toggle handler to point to the new topbar button and the new prose container id.

**Files:**
- Modify: `ui/panels/prose.js`
- Modify: `ui/events.js`
- Modify: `ui/app.js`

- [ ] **Step 1: Rewrite `ui/panels/prose.js`**

Replace `renderProse` to drop the sticky header:

```js
// ---------------------------------------------------------------------------
// Prose panel renderer — chapters + paragraphs + concept-mention spans
// ---------------------------------------------------------------------------

import { escapeHtml } from '../util.js';

export function renderProse(chunks, state) {
  const activeIds = new Set(state.graphRenderState?.activeNodeIds ?? []);
  const selectedId = state.selectedConceptId;
  const html = chunks.map((chunk) => renderChunk(chunk, activeIds, selectedId)).join('');
  return `<article class="prose-article">${html}</article>`;
}

function renderChunk(chunk, activeIds, selectedId) {
  if (chunk.kind === 'chapter') {
    return `<h2 class="prose-chapter" data-time-start="${chunk.timeSpan.start}">${escapeHtml(chunk.title)}</h2>`;
  }
  return renderParagraph(chunk, activeIds, selectedId);
}

function renderParagraph(para, activeIds, selectedId) {
  const inner = renderParagraphInner(para.text, para.conceptMentions, activeIds, selectedId);
  return `<p class="prose-para" data-time-start="${para.timeSpan.start}" data-time-end="${para.timeSpan.end}">${inner}</p>`;
}

function renderParagraphInner(text, mentions, activeIds, selectedId) {
  if (!mentions.length) return escapeHtml(text);
  const parts = [];
  let cursor = 0;
  for (const m of mentions) {
    if (m.start > cursor) parts.push(escapeHtml(text.slice(cursor, m.start)));
    const phrase = text.slice(m.start, m.end);
    const isActive = activeIds.has(m.conceptId);
    const isSelected = selectedId === m.conceptId;
    const cls = ['concept'];
    if (isActive) cls.push('concept--active');
    if (isSelected) cls.push('concept--selected');
    parts.push(
      `<span class="${cls.join(' ')}" data-concept-id="${escapeHtml(m.conceptId)}" data-action="select-concept">${escapeHtml(phrase)}</span>`,
    );
    cursor = m.end;
  }
  if (cursor < text.length) parts.push(escapeHtml(text.slice(cursor)));
  return parts.join('');
}
```

- [ ] **Step 2: Update `ui/app.js`**

Find `updateProsePanel` and update the element id:

```js
function updateProsePanel() {
  const el = document.getElementById('prose');
  if (!el) return;
  // Save scrollTop across innerHTML replacement (carried from v2 Task 8 fix).
  const saved = el.scrollTop;
  el.innerHTML = renderProse(state.proseChunks ?? [], state);
  el.scrollTop = saved;
}
```

The id is `prose` (was `prose-overlay` in v2).

In `bootstrap()`, find the `attachScrollBinding(...)` call. Update the container id:

```js
  attachScrollBinding({
    container: document.getElementById('prose'),
    getState: () => state,
    onChange: render,
  });
```

- [ ] **Step 3: Update `ui/events.js`**

Find the existing `[data-action="toggle-prose"]` handler. The handler still does the right thing — flip `state.prosCollapsed`, set `data-prose-collapsed` on `.app`, render. Verify it reads/writes the same state, and update any container ids that might still be pointing at the old `prose-overlay` id:

```js
  document.querySelectorAll('[data-action="toggle-prose"]').forEach((btn) => {
    btn.addEventListener('click', () => {
      state.prosCollapsed = !state.prosCollapsed;
      const app = document.querySelector('.app');
      if (app) app.dataset.proseCollapsed = String(state.prosCollapsed);
      render();
    });
  });
```

In `ui/events.js`, find `scrollProseToConcept` and `scrollProseToChapter` helpers. Update the container id from `prose-overlay` to `prose`:

```js
function scrollProseToConcept(conceptId) {
  if (!conceptId) return;
  const container = document.getElementById('prose');
  if (!container) return;
  const span = container.querySelector(`.concept[data-concept-id="${cssEscape(conceptId)}"]`);
  if (!span) return;
  const containerRect = container.getBoundingClientRect();
  const spanRect = span.getBoundingClientRect();
  const offset = (spanRect.top + spanRect.height / 2) - (containerRect.top + containerRect.height / 2);
  container.scrollBy({ top: offset, left: 0, behavior: 'smooth' });
}

function scrollProseToChapter(macroIndex) {
  const container = document.getElementById('prose');
  if (!container) return;
  const headings = container.querySelectorAll('.prose-chapter');
  const heading = headings[macroIndex];
  if (!heading) return;
  const containerRect = container.getBoundingClientRect();
  const headingRect = heading.getBoundingClientRect();
  const offset = headingRect.top - (containerRect.top + 24);
  // Use instant scroll (avoids race with the scroll-binding's render path —
  // see v2 Task 11 finalization commit). The scroll-binding picks up the new
  // position and updates the playhead naturally.
  container.scrollTop += offset;
}
```

Note: the chapter scroll uses instant (not smooth) per the v2 final fix.

- [ ] **Step 4: Verify in browser**

Run `npm run ui:check`. Reload `http://127.0.0.1:4173/`. Expected:

- Prose panel on the right has no internal close button — the close moved to the header.
- Click the prose-toggle icon in the header → prose hides; icon swaps to panel-right-open. Click again → prose returns; icon swaps back to panel-right-close.
- Concept words still styled with gold underline; click still flies the camera.
- Click a graph concept → prose scrolls to first mention (smooth-scroll preserved by the scrollProseToConcept helper).
- Click a chapter segment → prose snaps to chapter heading.
- No `✕` glyph anywhere.

- [ ] **Step 5: Commit**

```bash
git add ui/panels/prose.js ui/app.js ui/events.js
git commit -m "feat(ui): drop prose internal close, prose-toggle moves to header" -m "$(cat <<'EOF'
The prose panel no longer renders its own sticky close header — the
toggle moved to the topbar's prose-toggle icon. Container id renames
(prose-overlay → prose) propagate to scroll-binding, scrollProse-
ToConcept/Chapter helpers, and the updateProsePanel updater. The
scrollTop save/restore from v2 Task 8 is preserved so render() does
not reset the scroll on innerHTML replacement.
EOF
)"
```

---

## Task 6: Final integration polish + smoke test

Verify each spec scenario end-to-end. Fix any small surfacing issue.

**Files:**
- Modify (only if needed): `ui/app.js`, `ui/styles.css`, etc.

- [ ] **Step 1: Run `npm run ui:check`**

Expected: clean.

- [ ] **Step 2: Run the spec's verification checklist**

Reload `http://127.0.0.1:4173/`. For each scenario, write PASS / FAIL with one-line behavior:

1. **Reload at t=0** → header thin row at top with title + speaker + 2 icon buttons; graph fills the left middle area with seed clusters; chapter strip thin row below the graph; prose column on right with first chapter and paragraphs.
2. **Click the graph** → camera lerps to the cluster, and the cluster ends up centered in the *visible* graph area, not behind the prose. (The fix.)
3. **Scroll the prose down** → graph reveals concepts, camera follows, behaves like v2.
4. **Click prose-toggle in header** → prose hides; graph + strip expand to full width; icon swaps to panel-right-open. Click again → prose returns.
5. **Click drift `play` icon** → drift starts; icon swaps to `pause`; button highlights gold. Click again → stops; icon back to `play`.
6. **Click chapter segment** → playhead jumps; prose scrolls; camera lerps.
7. **Click view-settings icon** → popover anchored under the icon; macro/meso/micro toggle works; click level → camera cadence changes.
8. **Resize the window** → graph and strip reflow with the left column; prose stays at its fixed width.
9. **No emoji glyphs anywhere** — `⚙ ✕ ▶ ⌄ ●` are gone.

Take Playwright screenshots in `docs/screenshots/`:
- `v3-final-initial.png` — initial load
- `v3-final-prose-collapsed.png` — after collapsing prose
- `v3-final-drift-active.png` — drift button highlighted

- [ ] **Step 3: Commit any cleanup**

If you found and fixed minor issues during the smoke test:

```bash
git add ...
git commit -m "chore(ui): finalize v3 flex layout integration" -m "$(cat <<'EOF'
End-to-end smoke verification matches the spec. Any small fixes
found during the run are included here.
EOF
)"
```

If everything passed without changes, no commit is needed — simply report DONE.

---

## Self-Review Checklist (before declaring done)

- [ ] Every spec requirement maps to a task. Cross-check `docs/canvas-ui-v3-flex-layout-spec.md`.
- [ ] Each task's commit produces a runnable UI (Task 2's intermediate state is the only exception, and Tasks 3-5 fix it).
- [ ] No new dependency — `package.json` unchanged.
- [ ] No emoji glyphs anywhere in the chrome.
- [ ] The graph canvas's pixel size equals its grid cell size (verifiable via `document.getElementById('stage').getBoundingClientRect()`).
- [ ] `npm run ui:check` is clean.
- [ ] All v2 behaviors still work (cumulative reveal, bloom, scroll-binding, click-bidirectional, drift, chapter jump, view popover).

---

## Open Notes for Future Work

- **Drag-resize the prose column**: drag handle on the prose's left edge updates `--prose-width`. Spec calls it out of scope; spike when there's demand.
- **Polish on collapse**: currently `display: none` swap is instant. Slide / fade transitions are deferred polish.
- **Header zen mode**: shuttle hides the header on no-hover with `opacity` transition. Could be a small future polish.
- **More icons**: if future features need icons, extend `ui/icons.js` rather than reaching for a library.
