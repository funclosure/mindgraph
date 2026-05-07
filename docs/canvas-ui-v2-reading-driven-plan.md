# Canvas UI v2 — Reading-Driven Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reshape mindgraph from a fixed-grid layout (canvas + sidebar + bottom timeline panel) into a full-window canvas with three floating overlays — topbar pill, right prose panel, bottom chapter strip — and bind the user's prose scrolling to the playhead so reading drives the experience.

**Architecture:** Keep the v1.5 canvas pipeline (state → buildGraphRenderState → animator → draw). Add a pure prose-chunking helper in the view-model that turns the document into chapter + paragraph structure with concept-mention markup. Render the prose as plain DOM into a right-side overlay panel. A scroll-binding listener reads the centered paragraph each frame and updates `state.playheadTime`. Click-bidirectional linking ties graph concepts to prose mentions.

**Tech Stack:** Vanilla JavaScript (ES modules, no bundler), HTML5 Canvas 2D for the graph, plain DOM + CSS for the prose, the existing pure view-model in `src/view-model/`. No new dependencies.

**Spec:** `docs/canvas-ui-v2-reading-driven-spec.md` (commit `f6fbf6b`).

---

## Pre-flight

The dev server (`npm run ui:dev`) must be running at `http://127.0.0.1:4173`. The current UI (v1.5) is reachable at the root.

There is no automated test runner for this project. Verification is visual: load the dev URL in a browser (Playwright if no real browser), exercise the changed feature, take a screenshot. For the view-model task, `npm run vm:example` is the verification command.

**Do NOT run `npm run test:smoke`** — its first action is `rm -f examples/out/*.json`, which deletes the canonical UI sample. If a sample is wiped accidentally, restore with `git checkout HEAD -- examples/out/<file>.json`.

Each task is self-contained. Read the file path notes, do the steps in order, run the verification, then commit.

---

## File Structure

**Files created:**

- `src/view-model/buildProseChunks.js` — pure helper. Takes a view-model, returns an ordered array of chunks: chapter headings (from macro frames), paragraphs (joined micro segments split on speaker change or ~150-word run), each paragraph carrying a `timeSpan = { start, end }` and a list of `conceptMentions = [{ start, end, conceptId }]` (character offsets within the paragraph text where each mention sits).
- `ui/panels/prose.js` — DOM renderer. Takes the prose chunks + selection state, returns the HTML string of the right overlay's content. Concept mentions become `<span class="concept" data-concept-id="...">…</span>`. Active concepts get `.concept--active`; selected concept gets `.concept--selected`.
- `ui/panels/chapter-strip.js` — DOM renderer for the bottom overlay's chapter pill. Macro segments + the drift-forward button. Replaces the old `ui/panels/timeline.js`.
- `ui/panels/topbar.js` — DOM renderer for the top overlay pill. Small (title + speaker + duration). Replaces the inline `updateTopbar()` block in `ui/app.js`.
- `ui/panels/view-popover.js` — DOM renderer for the corner View popover (level toggle).
- `ui/scroll-binding.js` — sets up a scroll listener on the prose container. On every scroll, finds the paragraph closest to the vertical center, looks up its `timeSpan.start`, sets `state.playheadTime`, calls `render()`. Throttled via rAF.
- `ui/drift.js` — small module owning a per-tick auto-scroll loop. `startDrift(state, scrollContainer)` begins; `stopDrift(state)` ends. While active, it advances scrollTop at the document's speech rate.

**Files modified:**

- `ui/index.html` — strip the old grid layout, replace with `<canvas id="stage">` plus four absolute-positioned overlay containers (`#topbar-overlay`, `#prose-overlay`, `#chapter-strip-overlay`, `#view-popover-overlay`).
- `ui/styles.css` — replace the workspace/main-row/grid rules with full-window absolute-positioning rules. Add prose styling (chapter heading, paragraph, concept span, active/selected states), topbar pill, chapter strip pill, view popover. Drop dead rules (.inspector-panel, .timeline-panel, .stage-column, etc.).
- `ui/app.js` — restructure `render()` to call the new panel modules; introduce scroll-binding init in `bootstrap()`; remove the inline `updateTopbar`/`updateInspectorPanel`/`updateTimelinePanel` functions in favor of imported renderers.
- `ui/events.js` — add prose-click handler (concept span → select), chapter-strip click handler (segment → jump), drift-forward button handler. Remove playback-control wiring (Play/Step) since v2 has no play button. Remove playback exports (`startPlayback`, `stopPlayback`, `togglePlayback`, `stepFrame`) — they're dead in v2.

**Files deleted:**

- `ui/panels/inspector.js` — replaced by the prose panel.
- `ui/panels/timeline.js` — replaced by `ui/panels/chapter-strip.js`.

---

## Task 1: Pure prose-chunking helper

Add a pure helper that converts the view-model into an ordered array of chapter + paragraph chunks, each annotated with time-span and concept-mention positions. This is the single source of truth for what the right-side panel renders.

**Files:**
- Create: `src/view-model/buildProseChunks.js`

- [ ] **Step 1: Sketch the chunk data shape**

```js
/**
 * @typedef {Object} ChapterChunk
 * @property {'chapter'} kind
 * @property {string} title          - From macro frame title
 * @property {Object} macroFrameRef  - { level: 'macro', index: number }
 * @property {Object} timeSpan       - { start: number, end: number }
 *
 * @typedef {Object} ParagraphChunk
 * @property {'paragraph'} kind
 * @property {string} text                              - Joined paragraph prose
 * @property {string} [speaker]                         - Speaker name if known
 * @property {string[]} segmentIds                      - Source transcript segment ids
 * @property {Object} timeSpan                          - { start, end } union of segments
 * @property {Array<{start: number, end: number, conceptId: string}>} conceptMentions
 */
```

- [ ] **Step 2: Write the helper**

Create `src/view-model/buildProseChunks.js` with this content:

```js
// Pure helper — no DOM. Returns an array of { kind: 'chapter' | 'paragraph', ... }.

const PARAGRAPH_WORD_TARGET = 150;

export function buildProseChunks(vm) {
  const macro = vm.frames?.macro ?? [];
  const segments = vm.transcript?.segments ?? [];
  const chunks = [];
  if (!segments.length) return chunks;

  // Sort macro by start time so chapters are in narrative order.
  const macroSorted = [...macro].sort((a, b) => a.span.start - b.span.start);
  let macroCursor = 0;

  let para = newParagraph();

  for (let i = 0; i < segments.length; i += 1) {
    const seg = segments[i];

    // Emit chapter heading for any macro chunk whose start ≤ seg.start.
    while (macroCursor < macroSorted.length && macroSorted[macroCursor].span.start <= seg.start) {
      // Flush the in-progress paragraph before the chapter heading.
      if (para.segmentIds.length) {
        chunks.push(finalizeParagraph(para, vm));
        para = newParagraph();
      }
      const macroFrame = macroSorted[macroCursor];
      chunks.push({
        kind: 'chapter',
        title: macroFrame.title || `Chapter ${macroCursor + 1}`,
        macroFrameRef: macroFrame.ref,
        timeSpan: { start: macroFrame.span.start, end: macroFrame.span.end },
      });
      macroCursor += 1;
    }

    // Paragraph break on speaker change.
    if (
      para.segmentIds.length &&
      seg.speaker &&
      para.speaker &&
      seg.speaker !== para.speaker
    ) {
      chunks.push(finalizeParagraph(para, vm));
      para = newParagraph();
    }

    // Append this segment to the current paragraph.
    if (!para.speaker && seg.speaker) para.speaker = seg.speaker;
    if (!para.segmentIds.length) para.timeSpan.start = seg.start;
    para.timeSpan.end = seg.end;
    para.segmentIds.push(seg.id);
    para.text = (para.text ? para.text + ' ' : '') + (seg.text || '').trim();

    // Length-based break: if running paragraph has accumulated ~150 words AND
    // the segment ends with a sentence terminator, close the paragraph.
    if (countWords(para.text) >= PARAGRAPH_WORD_TARGET && /[.!?]\s*$/.test(para.text)) {
      chunks.push(finalizeParagraph(para, vm));
      para = newParagraph();
    }
  }

  if (para.segmentIds.length) chunks.push(finalizeParagraph(para, vm));

  return chunks;
}

function newParagraph() {
  return {
    kind: 'paragraph',
    text: '',
    speaker: undefined,
    segmentIds: [],
    timeSpan: { start: 0, end: 0 },
    conceptMentions: [],
  };
}

function finalizeParagraph(para, vm) {
  para.conceptMentions = computeMentions(para.text, para.segmentIds, vm);
  return para;
}

function countWords(text) {
  return (text.match(/\S+/g) ?? []).length;
}

// Find concept mentions inside the paragraph text. We use the document's
// existing conceptToTranscriptSegmentIds index: for each concept that
// references at least one of this paragraph's source segments, scan the
// paragraph text for occurrences of the concept label and any aliases.
function computeMentions(text, segmentIds, vm) {
  const segmentIdSet = new Set(segmentIds);
  const candidateIds = new Set();
  for (const [conceptId, refIds] of Object.entries(vm.indexes?.conceptToTranscriptSegmentIds ?? {})) {
    if (refIds.some((id) => segmentIdSet.has(id))) candidateIds.add(conceptId);
  }
  const mentions = [];
  for (const conceptId of candidateIds) {
    const concept = vm.concepts.byId?.[conceptId];
    if (!concept) continue;
    const phrases = [concept.label, ...(concept.aliases ?? [])].filter(Boolean);
    for (const phrase of phrases) {
      const re = new RegExp(`\\b${escapeRegExp(phrase)}\\b`, 'gi');
      let match;
      while ((match = re.exec(text)) !== null) {
        mentions.push({
          start: match.index,
          end: match.index + match[0].length,
          conceptId,
        });
      }
    }
  }
  // Sort by start, then prefer earlier-ending (longer specificity).
  mentions.sort((a, b) => a.start - b.start || a.end - b.end);
  // Deduplicate overlaps: keep the first; drop any that overlap with it.
  const deduped = [];
  let lastEnd = -1;
  for (const m of mentions) {
    if (m.start >= lastEnd) {
      deduped.push(m);
      lastEnd = m.end;
    }
  }
  return deduped;
}

function escapeRegExp(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
```

- [ ] **Step 3: Verify with a one-liner**

Run:

```bash
node -e "import('./src/view-model/buildMindgraphViewModel.js').then(({ buildMindgraphViewModel }) => import('./src/view-model/buildProseChunks.js').then(({ buildProseChunks }) => { const fs = require('fs'); const d = JSON.parse(fs.readFileSync('./examples/out/episode-1-built.mindgraph.json')); const vm = buildMindgraphViewModel(d); const chunks = buildProseChunks(vm); console.log('total chunks:', chunks.length); console.log('chapters:', chunks.filter(c => c.kind === 'chapter').length); console.log('paragraphs:', chunks.filter(c => c.kind === 'paragraph').length); console.log('first 6 chunks:'); chunks.slice(0, 6).forEach((c, i) => { if (c.kind === 'chapter') console.log(\`  [\${i}] CHAPTER: \${c.title}\`); else console.log(\`  [\${i}] PARA \${Math.round(c.timeSpan.start)}-\${Math.round(c.timeSpan.end)}s, \${c.text.split(/\\s+/).length} words, \${c.conceptMentions.length} mentions: \${c.text.slice(0, 80)}…\`); }); }));"
```

Expected output: `total chunks` ≥ 50 (about 5 macro chapters + 40-50 paragraphs for Episode 1). The first chunk should be a chapter heading ("Opening Convergences and the Search for Meaning" or similar). Paragraph word counts should hover around 100-200. At least some paragraphs should have nonzero `conceptMentions`.

If output looks wrong (e.g., no concept mentions or all paragraphs empty), check that `vm.indexes.conceptToTranscriptSegmentIds` is populated — that's where the helper looks up which concepts reference which segment ids.

- [ ] **Step 4: Commit**

```bash
git add src/view-model/buildProseChunks.js
git commit -m "feat(view-model): pure helper that chunks the document into chapters and paragraphs" -m "$(cat <<'EOF'
buildProseChunks turns the view-model into an ordered sequence of
chapter and paragraph chunks. Chapters come from macro frames;
paragraphs join contiguous transcript segments and break on speaker
change or after ~150 words at a sentence boundary. Each paragraph
carries its time span and a list of concept-mention positions
(character offsets) so the renderer can wrap mentions in spans
without re-scanning the text. Pure function; no DOM, no fetch.
EOF
)"
```

---

## Task 2: Prose panel renderer

A pure DOM-string renderer that takes the chunks and selection state and returns the HTML for the prose overlay's content.

**Files:**
- Create: `ui/panels/prose.js`

- [ ] **Step 1: Add the renderer**

Create `ui/panels/prose.js` with:

```js
// ---------------------------------------------------------------------------
// Prose panel renderer — chapters + paragraphs + concept-mention spans
// ---------------------------------------------------------------------------

import { escapeHtml } from '../util.js';

// Render the full prose panel HTML.
//
// chunks  — output of buildProseChunks(vm)
// state   — { selectedConceptId, graphRenderState: { activeNodeIds } }
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

// Build the paragraph's inner HTML by interleaving plain-text and mention spans.
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

- [ ] **Step 2: Verify with `npm run ui:check`**

Run:

```bash
npm run ui:check
```

Expected: clean, no syntax errors. The renderer is not yet mounted; this just confirms the file parses.

- [ ] **Step 3: Commit**

```bash
git add ui/panels/prose.js
git commit -m "feat(ui): prose panel renderer for chapters, paragraphs, concept mentions" -m "$(cat <<'EOF'
Pure DOM-string renderer. Takes the chunks from buildProseChunks plus
selection state (selectedConceptId, graphRenderState.activeNodeIds)
and returns the prose HTML. Chapters are h2; paragraphs are p with
data-time-start/end attributes (used later by the scroll-to-playhead
binding). Concept mentions are spans with data-concept-id and
.concept--active / .concept--selected modifier classes for emphasis.
EOF
)"
```

---

## Task 3: Layout restructure + mount static prose

Switch the page from a fixed grid (workspace > topbar / main-row / inspector / timeline-panel) to a full-window canvas with absolute-positioned overlay containers. Mount the prose renderer into the right overlay so the new prose is visible. Topbar still shows the existing content but as a floating pill. Bottom strip is an empty placeholder for now; chapter content is added in Task 7.

**Files:**
- Modify: `ui/index.html`
- Modify: `ui/styles.css`
- Modify: `ui/app.js`
- Delete: `ui/panels/inspector.js`
- Delete: `ui/panels/timeline.js`

- [ ] **Step 1: Rewrite `ui/index.html`**

Replace the current body content with:

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
      <canvas id="stage"></canvas>
      <div class="overlay overlay--topbar" id="topbar-overlay"></div>
      <aside class="overlay overlay--prose" id="prose-overlay"></aside>
      <div class="overlay overlay--chapter-strip" id="chapter-strip-overlay"></div>
      <div class="overlay overlay--view-popover" id="view-popover-overlay"></div>
    </div>
    <script type="module" src="/ui/app.js"></script>
  </body>
</html>
```

- [ ] **Step 2: Replace `ui/styles.css`**

Open `ui/styles.css` and replace its content with:

```css
/* mindgraph v2 — full-window canvas + floating overlays */

:root {
  color-scheme: dark;
  --bg: #0d0e12;
  --panel: rgba(20, 21, 26, 0.92);
  --panel-thin: rgba(20, 21, 26, 0.78);
  --border: rgba(214, 176, 109, 0.12);
  --text: #ece6d7;
  --muted: #a9a18f;
  --quiet: #7f7769;
  --gold: #d6b06d;
  --gold-soft: #b89461;
  --gold-bright: #f4cf86;
  --shadow: 0 16px 44px rgba(0, 0, 0, 0.40);
}

* { box-sizing: border-box; }

html, body {
  margin: 0;
  padding: 0;
  height: 100%;
  background: #0d0e12;
  color: var(--text);
  font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
  overflow: hidden;
}

button, input, select { font: inherit; }
button { cursor: pointer; color: inherit; }

.app {
  position: relative;
  width: 100vw;
  height: 100vh;
  overflow: hidden;
}

.app > canvas#stage {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  display: block;
  touch-action: none;
}

.overlay {
  position: absolute;
  z-index: 10;
}

.overlay--topbar {
  top: 14px;
  left: 14px;
  right: 14px;
  height: 38px;
  background: var(--panel-thin);
  -webkit-backdrop-filter: blur(8px);
  backdrop-filter: blur(8px);
  border: 1px solid var(--border);
  border-radius: 999px;
  padding: 0 16px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  font-size: 0.78rem;
  color: rgba(245, 234, 210, 0.85);
}
.overlay--topbar h1 {
  margin: 0;
  font-size: 0.82rem;
  font-weight: 600;
}
.overlay--topbar .meta {
  color: var(--muted);
  font-size: 0.74rem;
}

.overlay--prose {
  top: 60px;
  bottom: 60px;
  right: 14px;
  width: min(620px, 44vw);
  background: var(--panel);
  -webkit-backdrop-filter: blur(8px);
  backdrop-filter: blur(8px);
  border: 1px solid var(--border);
  border-radius: 14px;
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

.overlay--chapter-strip {
  bottom: 14px;
  left: 14px;
  right: 14px;
  height: 38px;
  background: var(--panel-thin);
  -webkit-backdrop-filter: blur(8px);
  backdrop-filter: blur(8px);
  border: 1px solid var(--border);
  border-radius: 999px;
  padding: 0 14px;
  display: flex;
  align-items: center;
  gap: 10px;
  font-size: 0.74rem;
  color: rgba(245, 234, 210, 0.6);
}

.overlay--view-popover {
  top: 60px;
  right: calc(14px + min(620px, 44vw) + 8px);
  /* Anchor to the left edge of the prose panel; will be repositioned later if prose is collapsed. */
}
```

- [ ] **Step 3: Update `ui/app.js`**

Replace the entire `render()` and panel-updater section. Open `ui/app.js`. Replace the current `import { renderTimeline } from './panels/timeline.js';` and `import { renderInspector } from './panels/inspector.js';` lines with:

```js
import { buildProseChunks } from '../src/view-model/buildProseChunks.js';
import { renderProse } from './panels/prose.js';
```

Drop the `escapeHtml, formatTime` import — it's used by the old `updateTopbar` we're about to replace. Add it back if any new code needs it (the topbar update below still uses both).

In `state`, add:

```js
  proseChunks: undefined,
```

In `bootstrap()`, after `state.viewModel = buildMindgraphViewModel(state.document);`, add:

```js
  state.proseChunks = buildProseChunks(state.viewModel);
```

Replace the three panel-updater functions. Find:

```js
function updateTopbar() {
  // ...full body...
}

function updateInspectorPanel() {
  // ...full body...
}

function updateTimelinePanel() {
  // ...full body...
}
```

Replace **all three** with:

```js
function updateTopbar() {
  const el = document.getElementById('topbar-overlay');
  if (!el) return;
  const vm = state.viewModel;
  const speakers = (state.document.transcript?.speakers ?? []).join(', ') || 'Unknown speaker';
  el.innerHTML =
    `<div><h1>${escapeHtml(vm.documentMeta.title)}</h1></div>` +
    `<div class="meta">${escapeHtml(speakers)} · ${formatTime(vm.documentMeta.durationSeconds)}</div>`;
}

function updateProsePanel() {
  const el = document.getElementById('prose-overlay');
  if (!el) return;
  el.innerHTML = renderProse(state.proseChunks ?? [], state);
}

function updateChapterStrip() {
  // Filled in by Task 7. Leave the overlay empty for now.
  const el = document.getElementById('chapter-strip-overlay');
  if (el && !el.dataset.chapterStripBound) el.innerHTML = '';
}

function updateViewPopover() {
  // Filled in by Task 9.
  const el = document.getElementById('view-popover-overlay');
  if (el && !el.dataset.viewPopoverBound) el.innerHTML = '';
}
```

Update `render()`:

```js
function render() {
  if (!state.viewModel) return;
  state.graphRenderState = computeGraphRenderState();
  updateTopbar();
  updateProsePanel();
  updateChapterStrip();
  updateViewPopover();
  kickAnimationLoop();
  bindEvents(state, render, kickAnimationLoop);
}
```

- [ ] **Step 4: Delete the obsolete panels**

```bash
git rm ui/panels/inspector.js ui/panels/timeline.js
```

`ui/events.js` may still import `startPlayback`/`stopPlayback`/`togglePlayback` from itself — those will be cleaned up in Task 9. For now, the old playback handlers in `events.js` will look for DOM nodes that no longer exist (`[data-action="toggle-play"]`, etc.); their `?.addEventListener` calls become no-ops. That's fine until Task 9.

- [ ] **Step 5: Verify in browser**

Run `npm run ui:check`.

Reload `http://127.0.0.1:4173/`. Expected:

- Full-window dark canvas with the graph (clusters + concepts) drawn behind everything.
- A thin floating topbar pill at the top showing the document title and speaker.
- A right-side overlay (~620 px wide) showing the prose: chapter headings + paragraphs. Concept mentions are styled as muted gold underlined text. The prose is scrollable.
- An empty thin pill at the bottom (placeholder for the chapter strip).
- No old inspector panel, no old bottom timeline panel.
- The graph still responds to drag/wheel/click — v1.5 camera behavior is intact.

If layout looks broken (overflowing, panels stacked, wrong sizes), check that `body` is `overflow: hidden`, `.app` is `100vw/100vh`, and the overlays use `position: absolute` with the offsets in the CSS above.

Take a Playwright screenshot for the record.

- [ ] **Step 6: Commit**

```bash
git add ui/index.html ui/styles.css ui/app.js
git rm ui/panels/inspector.js ui/panels/timeline.js
git commit -m "feat(ui): full-window canvas + prose overlay layout (v2 scaffolding)" -m "$(cat <<'EOF'
Replaces the v1.5 grid layout with a full-window canvas plus four
absolute-positioned overlay containers (topbar pill, prose panel,
chapter strip placeholder, view popover placeholder). Mounts the
new prose renderer into the right overlay so chapters and paragraphs
are visible. The old inspector and timeline panels are deleted; their
playback-control DOM nodes are gone. Graph rendering and camera
behavior unchanged. Chapter strip and view popover are empty
placeholders for later tasks.
EOF
)"
```

---

## Task 4: Active concept emphasis in prose

When a concept is in the active frame's foreground at the current playhead time, its mentions in the prose get a brighter style. This is already accounted for in the renderer (`.concept--active`); we just need to make sure `state.graphRenderState.activeNodeIds` is being computed and that `updateProsePanel()` runs on every render so the spans get rebuilt as the playhead moves.

**Files:**
- Verify only — no code changes expected.

- [ ] **Step 1: Confirm renderer wiring**

Open `ui/panels/prose.js` and re-read `renderProse(chunks, state)`. Confirm:
- It reads `state.graphRenderState?.activeNodeIds`.
- It applies `.concept--active` to spans whose `conceptId` is in that set.
- The renderer is called from `updateProsePanel()` which runs on every `render()` invocation (Task 3).

- [ ] **Step 2: Verify in browser**

Reload `http://127.0.0.1:4173/`.

Drag the playhead via the dev-tools console (this will be the only way until scroll binding lands in Task 5 — the v1.5 scrubber is gone):

```js
window.__mindgraph_set_playhead = (t) => { /* exposed for testing */ };
```

For this verification step, **temporarily** add to `ui/app.js`'s `bootstrap()`:

```js
  window.__mindgraph_set_playhead = (t) => { state.playheadTime = t; render(); };
```

(This is a temporary debug hook — remove in Task 10. Note its presence here.)

Reload, then in the browser console:

```js
window.__mindgraph_set_playhead(0);    // seed concepts only
window.__mindgraph_set_playhead(600);  // ~10 minutes into the lecture
```

Expected: at t=0, the prose's first chapter is visible; mentions of concepts present in the active frame's foreground at t=0 (Cultural Convergences, Meaning in Life, Meaning Crisis Core for the macro-level frame at t=0) appear with the brighter `.concept--active` style. Other mentions stay at the default muted gold.

After setting t=600, scroll the prose down to the relevant chapter (Chapter 2 — "Dark Factors..."); active concepts should now be cultural-pathologies, meaning-crisis-core, wisdom-response (the foreground of macro frame 1 at t=600). Other mentions revert to the default style.

If active styling never appears, check that `state.graphRenderState.activeNodeIds` is populated (log it from the temp hook).

- [ ] **Step 3: Commit (with the temporary debug hook)**

```bash
git add ui/app.js
git commit -m "feat(ui): expose temporary playhead debug hook for v2 scaffolding" -m "$(cat <<'EOF'
Adds window.__mindgraph_set_playhead so subsequent tasks can verify
the prose's active-concept emphasis until the scroll-to-playhead
binding lands. Removed in the final integration polish task.
EOF
)"
```

---

## Task 5: Scroll-to-playhead binding

When the user scrolls the prose container, find the paragraph closest to the vertical center, read its `data-time-start`, set `state.playheadTime`, call `render()`. Throttled via rAF so it fires at most once per animation frame.

**Files:**
- Create: `ui/scroll-binding.js`
- Modify: `ui/app.js`

- [ ] **Step 1: Create the binding module**

Create `ui/scroll-binding.js`:

```js
// ---------------------------------------------------------------------------
// scroll-binding — reads the prose's centered paragraph and writes playhead
// ---------------------------------------------------------------------------
//
// Attach once during bootstrap. The listener is throttled to one update per
// animation frame to avoid spamming render() during fast scroll.

export function attachScrollBinding({ container, getState, onChange }) {
  if (!container || container.dataset.scrollBindingAttached) return;
  container.dataset.scrollBindingAttached = '1';

  let queued = false;
  container.addEventListener('scroll', () => {
    if (queued) return;
    queued = true;
    requestAnimationFrame(() => {
      queued = false;
      const t = computeCenteredPlayhead(container);
      if (t == null) return;
      const state = getState();
      // Only write if the playhead actually moves; avoids re-render storms.
      if (Math.abs((state.playheadTime ?? 0) - t) < 0.05) return;
      state.playheadTime = t;
      onChange();
    });
  });
}

// Find the paragraph whose box overlaps the vertical center of the
// container's viewport. Falls back to the paragraph above if the center
// lands in a gap.
function computeCenteredPlayhead(container) {
  const containerRect = container.getBoundingClientRect();
  const centerY = containerRect.top + containerRect.height / 2;
  const paras = container.querySelectorAll('.prose-para[data-time-start]');
  if (!paras.length) return null;

  let chosen = paras[0];
  for (const p of paras) {
    const r = p.getBoundingClientRect();
    if (r.top > centerY) break; // paragraph starts below the center; stop — chosen is the one above.
    chosen = p;
  }
  const startStr = chosen.getAttribute('data-time-start');
  const start = Number(startStr);
  return Number.isFinite(start) ? start : null;
}
```

- [ ] **Step 2: Wire the binding from `ui/app.js`**

At the top of `ui/app.js`, add the import:

```js
import { attachScrollBinding } from './scroll-binding.js';
```

In `bootstrap()`, just before the existing `console.info('mindgraph canvas POC ready', ...)` line, add:

```js
  attachScrollBinding({
    container: document.getElementById('prose-overlay'),
    getState: () => state,
    onChange: render,
  });
```

- [ ] **Step 3: Verify in browser**

Run `npm run ui:check`.

Reload `http://127.0.0.1:4173/`. Expected:

- At first load, prose is at the top; playhead = 0; only seed concepts visible on the graph.
- Scroll the prose down a few paragraphs. The graph should bloom in concepts as new `firstSeenAt` thresholds are crossed. The camera should lerp between cluster regions.
- Scroll back up. Concepts fade out.
- Scroll to a chapter heading roughly midway down. The graph state should reflect that part of the document.

You can confirm by reading `state.playheadTime` in the console (via the debug hook from Task 4): scroll, then `window.__mindgraph_set_playhead && state.playheadTime` (or instrument). The value should change with scroll.

If the graph doesn't react to scroll, check that the listener fires (console.log inside the rAF callback) and that `state.playheadTime` is being updated.

- [ ] **Step 4: Commit**

```bash
git add ui/scroll-binding.js ui/app.js
git commit -m "feat(ui): scroll-to-playhead binding (reading drives time)" -m "$(cat <<'EOF'
Attaches a scroll listener to the prose overlay. On every scroll
event (throttled via rAF), the binding finds the paragraph closest to
the vertical center, reads its data-time-start attribute, and writes
that into state.playheadTime — then calls render(). Tiny (≤0.05s)
movements are skipped so identical scroll positions don't churn
render. The graph's bloom, fade, and camera lerp respond as in v1.5.
EOF
)"
```

---

## Task 6: Click-bidirectional linking (graph ↔ prose)

Click a concept span in the prose → select that concept (camera flies on graph). Click a concept on the graph → smooth-scroll the prose to its first mention.

**Files:**
- Modify: `ui/events.js`

- [ ] **Step 1: Wire prose-span click → select concept**

The prose renderer already emits `<span class="concept" data-concept-id="..." data-action="select-concept">`. The existing `bindEvents` already has a `[data-action="select-concept"]` handler from v1.5 (it auto-advances playhead and sets selection). That handler still works — `data-action="select-concept"` is the same on the span. **Nothing to change in events.js for this direction**, but verify the existing handler now also picks up prose spans.

In `ui/events.js`, locate this block (carried from v1.5):

```js
  document.querySelectorAll('[data-action="select-concept"]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const conceptId = btn.dataset.conceptId;
      const concept = state.viewModel.concepts.byId?.[conceptId];
      const firstSeen = concept?.firstSeenAt;
      if (typeof firstSeen === 'number' && firstSeen > state.playheadTime) {
        state.playheadTime = firstSeen;
      }
      state.selectedConceptId = conceptId;
      state.selectedFrameRef = undefined;
      state.cameraMode = 'selection';
      render();
    });
  });
```

For prose spans, we **don't** want auto-advance to firstSeenAt (the user clicked a word IN the visible prose; teleporting is wrong). Update the handler to differentiate:

```js
  document.querySelectorAll('[data-action="select-concept"]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const conceptId = btn.dataset.conceptId;
      const concept = state.viewModel.concepts.byId?.[conceptId];
      const firstSeen = concept?.firstSeenAt;
      const isProseSpan = btn.classList.contains('concept');
      // Auto-advance the playhead only when the click did NOT come from a prose
      // mention (e.g., it came from the canvas inspector path, which we don't
      // ship in v2 but the path is preserved). Prose-span clicks should never
      // teleport — the user clicked a word in their current view.
      if (!isProseSpan && typeof firstSeen === 'number' && firstSeen > state.playheadTime) {
        state.playheadTime = firstSeen;
      }
      state.selectedConceptId = conceptId;
      state.selectedFrameRef = undefined;
      state.cameraMode = 'selection';
      render();
    });
  });
```

- [ ] **Step 2: Wire graph-concept click → smooth-scroll prose to first mention**

Currently the canvas click handler in `bindEvents` sets selection. Add a smooth-scroll side effect when a concept is selected via canvas click. Locate the existing canvas click handler (the one that calls `hitTestAt`). Just before the final `render();` inside the `if (hit)` branch, insert:

```js
        // Smooth-scroll the prose to the first occurrence of this concept's
        // mention so the user sees it in context. The scroll-to-playhead
        // binding will pick up the new position and update graph state.
        scrollProseToConcept(state.selectedConceptId);
```

Add the helper at the top of `ui/events.js` (below the imports):

```js
function scrollProseToConcept(conceptId) {
  if (!conceptId) return;
  const container = document.getElementById('prose-overlay');
  if (!container) return;
  const span = container.querySelector(`.concept[data-concept-id="${cssEscape(conceptId)}"]`);
  if (!span) return;
  const containerRect = container.getBoundingClientRect();
  const spanRect = span.getBoundingClientRect();
  // Target: scroll so the span sits at the vertical center of the container.
  const offset = (spanRect.top + spanRect.height / 2) - (containerRect.top + containerRect.height / 2);
  container.scrollBy({ top: offset, left: 0, behavior: 'smooth' });
}

function cssEscape(s) {
  // Defensive escape for selectors. Modern browsers have CSS.escape; fall back.
  if (typeof CSS !== 'undefined' && typeof CSS.escape === 'function') return CSS.escape(s);
  return String(s).replace(/[^a-zA-Z0-9_-]/g, (ch) => `\\${ch.charCodeAt(0).toString(16)} `);
}
```

`querySelector` returns the first matching span — that's the first mention. Good.

- [ ] **Step 3: Verify in browser**

Run `npm run ui:check`.

Reload `http://127.0.0.1:4173/`. Test both directions:

- Click a concept word in the prose (e.g., "wisdom" if visible). Camera should lerp to the wisdom-response cluster on the graph; the concept's mentions in the prose should show the bright `.concept--selected` style. Playhead does NOT teleport.
- Click a cluster body or atomic dot on the graph. Prose should smooth-scroll so the first mention of that concept is centered. The active styling updates accordingly.
- Click empty graph area. Selection clears. Mentions revert to default style.

Take Playwright screenshots if useful.

- [ ] **Step 4: Commit**

```bash
git add ui/events.js
git commit -m "feat(ui): bidirectional click linking between graph and prose" -m "$(cat <<'EOF'
Click a concept word in the prose — selection sets, camera flies to
the concept on the graph. Click a concept on the graph — prose
smooth-scrolls to the concept's first mention (the scroll-binding
then updates the playhead, so cumulative reveal catches up if needed).
Prose-span clicks are exempted from the auto-advance behaviour so the
user is not teleported away from where they were reading.
EOF
)"
```

---

## Task 7: Bottom chapter strip + chapter jump

A horizontal strip of macro-frame segments along the bottom of the window. Click a segment → playhead jumps to its `span.start`, prose smooth-scrolls to the matching chapter heading.

**Files:**
- Create: `ui/panels/chapter-strip.js`
- Modify: `ui/app.js`
- Modify: `ui/events.js`

- [ ] **Step 1: Create the renderer**

Create `ui/panels/chapter-strip.js`:

```js
// ---------------------------------------------------------------------------
// Chapter strip — proportional macro segments + drift-forward placeholder
// ---------------------------------------------------------------------------

import { escapeHtml } from '../util.js';

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
      const cls = ['chapter-seg'];
      if (isActive) cls.push('chapter-seg--active');
      const title = `${escapeHtml(frame.title || `Chapter ${frame.ref.index + 1}`)}`;
      return `<button type="button" class="${cls.join(' ')}" data-action="jump-chapter" data-macro-index="${frame.ref.index}" title="${title}" style="left:${leftPct}%;width:${widthPct}%"></button>`;
    })
    .join('');

  return `
    <div class="chapter-strip__label">chapters</div>
    <div class="chapter-strip__track">${segments}</div>
    <button type="button" class="chapter-strip__drift" data-action="toggle-drift" title="drift forward">▶</button>
  `;
}
```

- [ ] **Step 2: Add chapter-strip CSS to `ui/styles.css`**

Append to `ui/styles.css`:

```css
.chapter-strip__label {
  color: var(--muted);
  font-size: 0.7rem;
  letter-spacing: 0.04em;
  text-transform: uppercase;
}
.chapter-strip__track {
  position: relative;
  flex: 1;
  height: 8px;
  background: rgba(255, 255, 255, 0.06);
  border-radius: 4px;
  overflow: hidden;
}
.chapter-seg {
  position: absolute;
  top: 0;
  bottom: 0;
  background: rgba(184, 148, 97, 0.32);
  border: none;
  border-right: 1px solid rgba(0, 0, 0, 0.32);
  padding: 0;
  transition: background-color 120ms ease;
}
.chapter-seg:last-child { border-right: none; }
.chapter-seg:hover { background: rgba(214, 176, 109, 0.55); }
.chapter-seg--active { background: rgba(231, 203, 141, 0.85); box-shadow: 0 0 12px rgba(231, 203, 141, 0.4); }
.chapter-strip__drift {
  background: rgba(184, 148, 97, 0.12);
  border: 1px solid rgba(184, 148, 97, 0.32);
  color: var(--gold-bright);
  width: 28px;
  height: 24px;
  border-radius: 999px;
  display: grid;
  place-items: center;
  font-size: 0.78rem;
}
.chapter-strip__drift.is-on {
  background: rgba(244, 207, 134, 0.28);
  border-color: rgba(244, 207, 134, 0.68);
}
```

- [ ] **Step 3: Wire renderer into `ui/app.js`**

Add the import at the top:

```js
import { renderChapterStrip } from './panels/chapter-strip.js';
```

Replace the `updateChapterStrip()` placeholder body with:

```js
function updateChapterStrip() {
  const el = document.getElementById('chapter-strip-overlay');
  if (!el) return;
  el.innerHTML = renderChapterStrip(state.viewModel, state);
}
```

- [ ] **Step 4: Wire chapter-segment click in `ui/events.js`**

Inside `bindEvents(state, render, scheduleDraw)`, add a new handler block (before the toolbar block):

```js
  document.querySelectorAll('[data-action="jump-chapter"]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const idx = Number(btn.dataset.macroIndex);
      const frame = state.viewModel.frames.macro?.[idx];
      if (!frame) return;
      state.playheadTime = frame.span.start;
      state.selectedFrameRef = { level: 'macro', index: idx };
      state.selectedConceptId = undefined;
      state.cameraMode = 'selection';
      // Smooth-scroll the prose to the chapter heading. The scroll-binding
      // will then re-confirm the playhead from the centered paragraph.
      scrollProseToChapter(idx);
      render();
    });
  });
```

Add the `scrollProseToChapter` helper at the top of the file (next to `scrollProseToConcept`):

```js
function scrollProseToChapter(macroIndex) {
  const container = document.getElementById('prose-overlay');
  if (!container) return;
  const headings = container.querySelectorAll('.prose-chapter');
  const heading = headings[macroIndex];
  if (!heading) return;
  const containerRect = container.getBoundingClientRect();
  const headingRect = heading.getBoundingClientRect();
  const offset = headingRect.top - (containerRect.top + 24); // leave 24 px from top edge
  container.scrollBy({ top: offset, left: 0, behavior: 'smooth' });
}
```

- [ ] **Step 5: Verify in browser**

Run `npm run ui:check`.

Reload `http://127.0.0.1:4173/`. Expected:

- Bottom strip shows 6 chapter segments (Episode 1 has 6 macros after v1.5's data fix). Hovering a segment highlights it.
- The active chapter (the macro frame containing the current playhead) glows brighter.
- Click a non-active segment → playhead jumps; prose smooth-scrolls to the chapter heading; camera lerps; active glow moves to the clicked segment.
- The drift-forward button (▶) is visible at the right end of the strip; clicking it doesn't do anything yet (Task 8 wires it).

- [ ] **Step 6: Commit**

```bash
git add ui/panels/chapter-strip.js ui/styles.css ui/app.js ui/events.js
git commit -m "feat(ui): bottom chapter strip with chapter-jump click handler" -m "$(cat <<'EOF'
Renders the bottom overlay as a horizontal strip of macro-frame
segments, sized proportionally to each chapter's duration. Active
chapter glows; hovering reveals the title. Click a segment → playhead
jumps to that macro frame's start, prose smooth-scrolls to the
heading, camera lerps to the chapter's foreground. Drift button is
present in the markup but inactive until the next task.
EOF
)"
```

---

## Task 8: Drift-forward button

The ▶ button at the right of the chapter strip toggles auto-scroll. While ON, the prose smooth-scrolls downward at the source's speech rate (real time for timed sources, `wordsPerMinute`-derived for untimed). Manual scroll cancels.

**Files:**
- Create: `ui/drift.js`
- Modify: `ui/app.js`
- Modify: `ui/events.js`

- [ ] **Step 1: Create the drift module**

Create `ui/drift.js`:

```js
// ---------------------------------------------------------------------------
// Drift — auto-scroll the prose at the source's speech rate
// ---------------------------------------------------------------------------
//
// Drift is a single rAF loop owned by the module. startDrift turns it on;
// stopDrift turns it off. Manual scroll cancels by listening for user-
// initiated scroll events (we mark our own programmatic scrolls with a flag).

let driftActive = false;
let driftRaf = null;
let lastT = 0;
let pixelsPerSecond = 0;

export function startDrift({ container, pixelsPerSecond: pps, onCancel }) {
  if (driftActive) return;
  driftActive = true;
  pixelsPerSecond = Math.max(8, pps);
  lastT = performance.now();

  function tick(now) {
    if (!driftActive) return;
    const dt = Math.min(0.1, (now - lastT) / 1000);
    lastT = now;
    container.scrollTop = container.scrollTop + pixelsPerSecond * dt;
    if (container.scrollTop + container.clientHeight >= container.scrollHeight - 1) {
      stopDrift(onCancel);
      return;
    }
    driftRaf = requestAnimationFrame(tick);
  }
  driftRaf = requestAnimationFrame(tick);
}

export function stopDrift(onCancel) {
  if (!driftActive) return;
  driftActive = false;
  if (driftRaf != null) cancelAnimationFrame(driftRaf);
  driftRaf = null;
  if (onCancel) onCancel();
}

export function isDriftActive() {
  return driftActive;
}
```

- [ ] **Step 2: Wire the drift button in `ui/events.js`**

Add the import at the top of `ui/events.js`:

```js
import { startDrift, stopDrift, isDriftActive } from './drift.js';
```

In `bindEvents`, add a handler for the drift button:

```js
  document.querySelectorAll('[data-action="toggle-drift"]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const container = document.getElementById('prose-overlay');
      if (!container) return;
      if (isDriftActive()) {
        stopDrift(() => updateDriftButton(false));
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

Add the helpers at the top of `ui/events.js` (next to `scrollProseToConcept`):

```js
function updateDriftButton(on) {
  const btn = document.querySelector('[data-action="toggle-drift"]');
  if (!btn) return;
  btn.classList.toggle('is-on', on);
}

function computePixelsPerSecond(container, vm) {
  // Pixels-per-second so the prose advances at speech rate. For timed
  // sources we use the document duration. For untimed sources the
  // producer's wordsPerMinute (default 150) yields synthetic spans whose
  // total still equals durationSeconds — same formula works.
  const totalSec = Math.max(1, vm.documentMeta.durationSeconds);
  const totalPx = Math.max(1, container.scrollHeight - container.clientHeight);
  return totalPx / totalSec;
}
```

Also wire **manual scroll cancels drift**: in `ui/scroll-binding.js`, add a hook to detect user-initiated scrolls. Replace its body's scroll-listener registration to:

```js
  let queued = false;
  let lastScrollTop = container.scrollTop;
  let lastWasUserGesture = false;
  container.addEventListener('scroll', () => {
    // Heuristic: if scrollTop jumped by more than ~5px without our drift
    // tick running, a user gesture caused it. The drift module advances
    // by ~pixelsPerSecond * dt per frame (~tens of px). Easier: just
    // record scrolls and let the drift module's onCancel fire only when
    // the user actually grabs the scroll. We delegate the cancel to
    // the drift module's own scroll observer below.
    queued = queued || (() => true)();
    if (queued) return; // ...
```

**Simpler:** in `ui/drift.js`, track whether the active tick caused the most recent scrolltop change. Update `tick` to remember the new value before yielding to the next frame, and add a `scroll` listener that compares `container.scrollTop` to the expected value. If they differ noticeably, the user moved it. Replace the contents of `ui/drift.js` with:

```js
// ---------------------------------------------------------------------------
// Drift — auto-scroll the prose at the source's speech rate
// ---------------------------------------------------------------------------

let driftActive = false;
let driftRaf = null;
let lastT = 0;
let lastScrollTop = 0;
let lastContainer = null;
let pixelsPerSecond = 0;
let onCancelCb = null;

export function startDrift({ container, pixelsPerSecond: pps, onCancel }) {
  if (driftActive) return;
  driftActive = true;
  pixelsPerSecond = Math.max(8, pps);
  lastT = performance.now();
  lastScrollTop = container.scrollTop;
  lastContainer = container;
  onCancelCb = onCancel;

  // User-scroll cancel: any scroll event whose new scrollTop differs from
  // our expected scrollTop by more than 4 px is treated as user input.
  container.addEventListener('scroll', userScrollGuard, { passive: true });

  function tick(now) {
    if (!driftActive) return;
    const dt = Math.min(0.1, (now - lastT) / 1000);
    lastT = now;
    const next = container.scrollTop + pixelsPerSecond * dt;
    container.scrollTop = next;
    lastScrollTop = container.scrollTop;
    if (container.scrollTop + container.clientHeight >= container.scrollHeight - 1) {
      stopDrift();
      return;
    }
    driftRaf = requestAnimationFrame(tick);
  }
  driftRaf = requestAnimationFrame(tick);
}

function userScrollGuard() {
  if (!driftActive || !lastContainer) return;
  const delta = Math.abs(lastContainer.scrollTop - lastScrollTop);
  if (delta > 4) {
    stopDrift();
  }
}

export function stopDrift() {
  if (!driftActive) return;
  driftActive = false;
  if (driftRaf != null) cancelAnimationFrame(driftRaf);
  driftRaf = null;
  if (lastContainer) lastContainer.removeEventListener('scroll', userScrollGuard);
  lastContainer = null;
  if (onCancelCb) {
    const cb = onCancelCb;
    onCancelCb = null;
    cb();
  }
}

export function isDriftActive() {
  return driftActive;
}
```

(Now `ui/events.js`'s scroll-binding modifications above are unnecessary — drift watches its own scroll. Revert any partial edits to `ui/scroll-binding.js`.)

- [ ] **Step 3: Verify in browser**

Run `npm run ui:check`.

Reload `http://127.0.0.1:4173/`. Click the ▶ drift button at the right of the bottom strip. Expected:

- Prose begins to scroll downward smoothly.
- Graph blooms in concepts as their thresholds are crossed.
- Camera lerps along.
- Drift button shows the `.is-on` highlight while active.
- Click drift button again → drift stops; button returns to default.
- While drifting, scroll the prose manually with the wheel or trackpad → drift cancels; button returns to default.

If drift never starts, check that `pixelsPerSecond` is non-zero (the prose container needs to be scrollable — `scrollHeight > clientHeight`). For a tall document this should always be true.

- [ ] **Step 4: Commit**

```bash
git add ui/drift.js ui/events.js
git commit -m "feat(ui): drift-forward button auto-scrolls the prose at speech rate" -m "$(cat <<'EOF'
The ▶ button on the chapter strip toggles drift. While on, the prose
container's scrollTop advances at pixelsPerSecond computed from the
document's duration vs. the prose's scrollable pixel height — i.e.,
the user's scroll position progresses through time at speech rate.
The scroll-to-playhead binding picks up the new position naturally.
Manual scroll (delta > 4 px from the last drift-set position) cancels
drift. End-of-prose also stops drift automatically.
EOF
)"
```

---

## Task 9: Topbar pill polish + view popover (level toggle) + cleanup

The topbar already shows minimal content. This task tightens it (adds a collapse affordance) and adds the View popover at the top-right, where the macro/meso/micro level toggle now lives. It also removes the now-dead playback exports and old DOM-action wiring from `ui/events.js`.

**Files:**
- Create: `ui/panels/view-popover.js`
- Modify: `ui/panels/topbar.js` — actually a new file extracted from inline `updateTopbar`
- Create: `ui/panels/topbar.js`
- Modify: `ui/styles.css`
- Modify: `ui/app.js`
- Modify: `ui/events.js`

- [ ] **Step 1: Extract `ui/panels/topbar.js`**

Create `ui/panels/topbar.js`:

```js
// ---------------------------------------------------------------------------
// Topbar — small floating pill with title, speaker, duration
// ---------------------------------------------------------------------------

import { escapeHtml, formatTime } from '../util.js';

export function renderTopbar(vm, document_) {
  const speakers = (document_.transcript?.speakers ?? []).join(', ') || 'Unknown speaker';
  return (
    `<div class="topbar-title"><h1>${escapeHtml(vm.documentMeta.title)}</h1></div>` +
    `<div class="topbar-meta meta">${escapeHtml(speakers)} · ${formatTime(vm.documentMeta.durationSeconds)}</div>`
  );
}
```

- [ ] **Step 2: Create the view popover**

Create `ui/panels/view-popover.js`:

```js
// ---------------------------------------------------------------------------
// View popover — small icon + popover with macro/meso/micro level toggle
// ---------------------------------------------------------------------------
//
// Controls camera cadence (which level's foreground concepts drive the
// camera target). Default: macro. Most users will not open this.

export function renderViewPopover(state) {
  const isOpen = !!state.viewPopoverOpen;
  const levelButtons = ['macro', 'meso', 'micro']
    .map((level) => {
      const active = state.activeLevel === level;
      return `<button type="button" class="vp-level ${active ? 'is-active' : ''}" data-action="set-level" data-level="${level}">${level}</button>`;
    })
    .join('');

  return `
    <button type="button" class="view-popover__toggle" data-action="toggle-view-popover" aria-expanded="${isOpen}" title="View settings">⚙</button>
    ${isOpen ? `
      <div class="view-popover__panel">
        <div class="view-popover__row">
          <div class="view-popover__label">Camera level</div>
          <div class="view-popover__levels">${levelButtons}</div>
        </div>
      </div>
    ` : ''}
  `;
}
```

- [ ] **Step 3: Add view-popover CSS**

Append to `ui/styles.css`:

```css
.overlay--view-popover {
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  gap: 8px;
  pointer-events: auto;
}
.view-popover__toggle {
  background: var(--panel-thin);
  -webkit-backdrop-filter: blur(8px);
  backdrop-filter: blur(8px);
  border: 1px solid var(--border);
  color: rgba(245, 234, 210, 0.85);
  width: 32px;
  height: 32px;
  border-radius: 999px;
  display: grid;
  place-items: center;
  font-size: 0.92rem;
}
.view-popover__panel {
  background: var(--panel);
  -webkit-backdrop-filter: blur(8px);
  backdrop-filter: blur(8px);
  border: 1px solid var(--border);
  border-radius: 12px;
  padding: 10px 12px;
  font-size: 0.78rem;
  min-width: 220px;
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

- [ ] **Step 4: Replace inline `updateTopbar` and `updateViewPopover` in `ui/app.js`**

Add imports at the top:

```js
import { renderTopbar } from './panels/topbar.js';
import { renderViewPopover } from './panels/view-popover.js';
```

In the `state` object literal, add `viewPopoverOpen: false,`. Then replace the existing `updateTopbar()` and `updateViewPopover()` functions:

```js
function updateTopbar() {
  const el = document.getElementById('topbar-overlay');
  if (!el) return;
  el.innerHTML = renderTopbar(state.viewModel, state.document);
}

function updateViewPopover() {
  const el = document.getElementById('view-popover-overlay');
  if (!el) return;
  el.innerHTML = renderViewPopover(state);
}
```

- [ ] **Step 5: Wire view-popover events in `ui/events.js`**

Inside `bindEvents`, add a handler for the popover toggle:

```js
  document.querySelectorAll('[data-action="toggle-view-popover"]').forEach((btn) => {
    btn.addEventListener('click', () => {
      state.viewPopoverOpen = !state.viewPopoverOpen;
      render();
    });
  });
```

The existing `[data-action="set-level"]` handler from v1.5 already updates `state.activeLevel` and calls `render()`. The buttons in the popover use the same `data-action`, so it works without change.

- [ ] **Step 6: Remove dead playback wiring + remove debug hook**

In `ui/events.js`:
- Delete the `togglePlayback`, `startPlayback`, `stopPlayback`, `stepFrame` exports (and any internal references from inside `bindEvents`).
- Delete the wiring blocks for `[data-action="toggle-play"]`, `[data-action="step-back"]`, `[data-action="step-forward"]`, and `[data-action="scrub-playhead"]` — those DOM nodes don't exist in v2.
- Delete the `[data-action="zoom-in"]`, `[data-action="zoom-out"]`, `[data-action="fit"]`, `[data-action="reset-camera"]` toolbar handlers (the toolbar is gone in v2; users can wheel/drag for camera).

In `ui/app.js`:
- Remove the `window.__mindgraph_set_playhead = ...` debug hook added in Task 4.
- Remove the unused `scheduleDraw` shim (everything calls `kickAnimationLoop` or `render` directly now).

Also drop the unused imports from `ui/events.js`:

```js
import { screenToWorld, zoomAround } from './camera.js';
import { hitTestAt } from './hit-test.js';
import { startDrift, stopDrift, isDriftActive } from './drift.js';
```

(Keep what's actually used; remove `zoomAroundCenter`, `fitCameraToLayout` if they're no longer referenced after the toolbar handler deletion.)

- [ ] **Step 7: Verify in browser**

Run `npm run ui:check`.

Reload `http://127.0.0.1:4173/`. Expected:

- Topbar pill at top: title + speaker + duration.
- A small ⚙ icon button at the top-right (next to the prose panel's left edge).
- Click ⚙ → popover opens with three buttons: macro / meso / micro. Clicking one updates the camera cadence (try macro vs meso while scrolling — micro will still feel smooth thanks to the v1.5 5-frame moving average).
- Click ⚙ again → popover closes.
- The graph still responds to drag/wheel; selection still works; drift still works.
- No console errors about missing DOM nodes.

- [ ] **Step 8: Commit**

```bash
git add ui/panels/topbar.js ui/panels/view-popover.js ui/styles.css ui/app.js ui/events.js
git commit -m "feat(ui): topbar pill, view popover, drop dead playback wiring" -m "$(cat <<'EOF'
Extracts the topbar into ui/panels/topbar.js and adds the view popover
at the top-right corner — a small ⚙ button that opens a panel
containing the macro/meso/micro camera-level toggle. Removes the
playback control wiring (Play, Step, scrub-playhead) and toolbar
handlers (Fit, Reset, zoom) since those DOM nodes are gone in v2.
Removes the temporary playhead debug hook from bootstrap. The
scheduleDraw shim is also gone — the rAF loop is the only redraw
path now.
EOF
)"
```

---

## Task 10: Collapse affordances for the prose, topbar, and chapter strip

The spec asks for each overlay to be collapsible. Default state is open (Task 3). This task adds simple toggles that hide / show each overlay, leaving a small re-expand handle. No fancy animations.

**Files:**
- Modify: `ui/index.html`
- Modify: `ui/styles.css`
- Modify: `ui/panels/topbar.js`
- Modify: `ui/panels/chapter-strip.js`
- Modify: `ui/app.js`
- Modify: `ui/events.js`

- [ ] **Step 1: Add collapse state to `state` in `ui/app.js`**

```js
  prosCollapsed: false,
  topbarCollapsed: false,
  chapterStripCollapsed: false,
```

(Note: I intentionally write `prosCollapsed` so it sorts visually next to `prose*` fields. Keep the spelling consistent across files.)

- [ ] **Step 2: Add a re-expand handle for the prose**

In `ui/index.html`, just before the `<aside class="overlay overlay--prose" id="prose-overlay">` line, add:

```html
      <button type="button" class="prose-handle" id="prose-handle" data-action="toggle-prose" title="Open reading panel">📖</button>
```

In `ui/styles.css`, append:

```css
.prose-handle {
  position: absolute;
  top: 50%;
  right: 0;
  transform: translateY(-50%);
  z-index: 11;
  width: 26px;
  height: 60px;
  background: var(--panel-thin);
  -webkit-backdrop-filter: blur(6px);
  backdrop-filter: blur(6px);
  border: 1px solid var(--border);
  border-right: none;
  border-radius: 6px 0 0 6px;
  color: var(--gold);
  display: none;
  align-items: center;
  justify-content: center;
}
.app[data-prose-collapsed="true"] .overlay--prose { display: none; }
.app[data-prose-collapsed="true"] .prose-handle { display: flex; }
.app[data-prose-collapsed="true"] .overlay--view-popover { right: 14px; }
```

- [ ] **Step 3: Add a collapse button INSIDE the prose panel**

Modify `ui/panels/prose.js`. At the top of the returned HTML in `renderProse`:

```js
export function renderProse(chunks, state) {
  const activeIds = new Set(state.graphRenderState?.activeNodeIds ?? []);
  const selectedId = state.selectedConceptId;
  const html = chunks.map((chunk) => renderChunk(chunk, activeIds, selectedId)).join('');
  return `
    <header class="prose-header">
      <button type="button" class="prose-collapse" data-action="toggle-prose" title="Hide reading panel">✕</button>
    </header>
    <article class="prose-article">${html}</article>
  `;
}
```

Append to `ui/styles.css`:

```css
.prose-header {
  position: sticky;
  top: -18px;
  margin: -18px -24px 8px;
  padding: 6px 14px;
  display: flex;
  justify-content: flex-end;
  background: linear-gradient(180deg, var(--panel) 0%, transparent 100%);
}
.prose-collapse {
  background: transparent;
  border: 1px solid var(--border);
  color: var(--muted);
  width: 26px;
  height: 26px;
  border-radius: 999px;
  display: grid;
  place-items: center;
  font-size: 0.74rem;
}
.prose-collapse:hover { color: var(--text); }
```

- [ ] **Step 4: Add collapse buttons for topbar and chapter strip**

In `ui/panels/topbar.js`, add a small ⌄ button:

```js
export function renderTopbar(vm, document_) {
  const speakers = (document_.transcript?.speakers ?? []).join(', ') || 'Unknown speaker';
  return (
    `<div class="topbar-title"><h1>${escapeHtml(vm.documentMeta.title)}</h1></div>` +
    `<div class="topbar-meta meta">${escapeHtml(speakers)} · ${formatTime(vm.documentMeta.durationSeconds)}</div>` +
    `<button type="button" class="topbar-collapse" data-action="toggle-topbar" title="Hide topbar">⌄</button>`
  );
}
```

Add the collapsed-state stub renderer for the topbar overlay, and update `updateTopbar()` in `ui/app.js`:

```js
function updateTopbar() {
  const el = document.getElementById('topbar-overlay');
  if (!el) return;
  if (state.topbarCollapsed) {
    el.innerHTML = `<button type="button" class="topbar-restore" data-action="toggle-topbar" title="Show topbar">●</button>`;
    el.classList.add('overlay--topbar-collapsed');
  } else {
    el.innerHTML = renderTopbar(state.viewModel, state.document);
    el.classList.remove('overlay--topbar-collapsed');
  }
}
```

Same pattern for chapter strip in `ui/panels/chapter-strip.js`. Add a hide button after the drift button:

```js
  return `
    <div class="chapter-strip__label">chapters</div>
    <div class="chapter-strip__track">${segments}</div>
    <button type="button" class="chapter-strip__drift" data-action="toggle-drift" title="drift forward">▶</button>
    <button type="button" class="chapter-strip__collapse" data-action="toggle-chapter-strip" title="Hide chapter strip">⌄</button>
  `;
```

Update `updateChapterStrip()` in `ui/app.js`:

```js
function updateChapterStrip() {
  const el = document.getElementById('chapter-strip-overlay');
  if (!el) return;
  if (state.chapterStripCollapsed) {
    el.innerHTML = `<button type="button" class="chapter-strip__restore" data-action="toggle-chapter-strip" title="Show chapters">●</button>`;
    el.classList.add('overlay--chapter-strip-collapsed');
  } else {
    el.innerHTML = renderChapterStrip(state.viewModel, state);
    el.classList.remove('overlay--chapter-strip-collapsed');
  }
}
```

- [ ] **Step 5: Append CSS for the collapsed states**

```css
.topbar-collapse, .chapter-strip__collapse {
  background: transparent;
  border: 1px solid var(--border);
  color: var(--muted);
  width: 26px;
  height: 26px;
  border-radius: 999px;
  display: grid;
  place-items: center;
  font-size: 0.74rem;
}
.overlay--topbar-collapsed {
  width: 36px;
  left: auto;
  right: auto;
  height: 16px;
  padding: 0;
  border-radius: 999px;
  display: grid;
  place-items: center;
}
.topbar-restore, .chapter-strip__restore {
  background: transparent;
  border: none;
  color: var(--gold);
  width: 100%;
  height: 100%;
  border-radius: 999px;
  font-size: 0.7rem;
}
.overlay--chapter-strip-collapsed {
  width: 36px;
  height: 16px;
  left: 50%;
  transform: translateX(-50%);
  right: auto;
  padding: 0;
  border-radius: 999px;
  display: grid;
  place-items: center;
}
```

- [ ] **Step 6: Wire toggle handlers in `ui/events.js`**

Inside `bindEvents`:

```js
  document.querySelectorAll('[data-action="toggle-prose"]').forEach((btn) => {
    btn.addEventListener('click', () => {
      state.prosCollapsed = !state.prosCollapsed;
      const app = document.querySelector('.app');
      if (app) app.dataset.proseCollapsed = String(state.prosCollapsed);
      render();
    });
  });
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

Sync the `data-prose-collapsed` attribute on initial bootstrap. In `ui/app.js`'s `bootstrap()`, after `render();`, add:

```js
  document.querySelector('.app').dataset.proseCollapsed = String(state.prosCollapsed);
```

- [ ] **Step 7: Verify in browser**

Run `npm run ui:check`. Reload `http://127.0.0.1:4173/`. Test:

- Click the ✕ at the top-right of the prose panel → prose hides; a small 📖 handle appears on the right edge. Click the handle → prose returns. Graph fills the whole window while collapsed.
- Click the ⌄ button at the right of the topbar pill → topbar shrinks to a small ● button. Click it → topbar returns.
- Click the ⌄ button at the right of the chapter strip → strip shrinks to a small ● button. Click it → strip returns.
- All collapse/restore buttons should be small and unobtrusive.

- [ ] **Step 8: Commit**

```bash
git add ui/index.html ui/styles.css ui/panels/topbar.js ui/panels/prose.js ui/panels/chapter-strip.js ui/app.js ui/events.js
git commit -m "feat(ui): collapsible prose, topbar, and chapter strip overlays" -m "$(cat <<'EOF'
Each overlay now has a small collapse button. Collapsed prose hides
the right panel and shows a thin re-expand handle on the edge of the
window. Collapsed topbar / chapter strip shrink to a small dot
button at the same edge. State lives on the state object
(prosCollapsed, topbarCollapsed, chapterStripCollapsed) so future
work can persist user preference. No animation; CSS swap.
EOF
)"
```

---

## Task 11: Final integration polish + smoke test

Verify the spec's full verification list end-to-end. Add small affordances if any are missing.

**Files:**
- Modify: `ui/app.js` (only if a missing piece surfaces)

- [ ] **Step 1: Run `npm run ui:check`**

Expected: clean.

- [ ] **Step 2: Run the spec's verification checklist**

Reload `http://127.0.0.1:4173/`. For each scenario, note PASS/FAIL with one-line behavior:

1. **Reload at t=0** → graph fills window; prose panel open on right; first chapter heading + opening paragraph visible; seed concepts visible on graph.
2. **Scroll the prose down** → graph reveals concepts as they appear in the text; bloom and fade animate as in v1.5; camera lerps between cluster regions.
3. **Scroll up** → concepts fade out below the new playhead.
4. **Click a concept word in the prose** → camera flies to it on the graph; all mentions of that concept glow brighter; playhead does NOT teleport.
5. **Click a concept on the graph** → prose smooth-scrolls to its first mention; mentions glow.
6. **Click a chapter segment in the bottom strip** → playhead jumps; prose scrolls to chapter heading; camera lerps.
7. **Click the drift ▶ button** → prose begins auto-scrolling; click again to stop; manual scroll cancels.
8. **Open the view popover (⚙)** → macro/meso/micro toggle visible; clicking changes camera cadence; popover closes when clicked again.
9. **Collapse the prose** (✕ in panel) → prose hides; small re-expand handle on the right edge; click handle → prose returns.
10. **Collapse the topbar / chapter strip** (⌄ in each) → each shrinks to a small dot button; click dot → restores.

Take a Playwright screenshot of (a) initial load, (b) after scrolling several chapters, (c) after clicking a concept word in the prose. Save under the project root with descriptive names (e.g., `v2-initial.png`, `v2-mid-scroll.png`, `v2-selected.png`). The project's `.gitignore` excludes `*.png`.

- [ ] **Step 3: Commit any cleanup**

If you found and fixed minor issues during the smoke test, commit them:

```bash
git add ...
git commit -m "chore(ui): finalize v2 reading-driven integration" -m "$(cat <<'EOF'
End-to-end smoke verification matches the spec. Any small fixes found
during the run are included here.
EOF
)"
```

If everything passed without changes, simply report DONE — no commit needed.

---

## Self-Review Checklist (before declaring done)

- [ ] Every spec requirement maps to a task. Cross-check `docs/canvas-ui-v2-reading-driven-spec.md`.
- [ ] No file is partially edited and committed in a non-working state — each task's commit produces a runnable UI.
- [ ] No magic numbers without a name — bloom/fade/camera time constants live near the top of `ui/animator.js` (carried from v1.5); the v2 constants (paragraph word target, drift heuristics) are named at the top of their respective modules.
- [ ] `ui/panels/prose.js` stays small (target ≤ 80 lines).
- [ ] `ui/scroll-binding.js` stays small (≤ 60 lines).
- [ ] `ui/drift.js` stays small (≤ 80 lines).
- [ ] No new dependency — `package.json` unchanged.
- [ ] Out-of-scope items from the spec did not creep in (no annotations, no search, no mobile layout, no hover preview).
- [ ] Old inspector / timeline panel code is fully gone (no orphan files, no orphan imports).
- [ ] `npm run ui:check` is clean.

---

## Open Notes for Future Work

These are *not* required by the spec and not in this plan, but landed adjacent and worth a follow-up issue:

- **Hover preview**: hover a concept word → highlight the matching graph dot (and vice versa) without committing to selection. Useful, low-risk.
- **Speaker chips**: when speaker changes inside a paragraph break, show a small speaker tag at the start of the new paragraph. Useful for Q&A transcripts.
- **Search**: type-to-find inside the prose; jump to occurrences. Useful, non-trivial.
- **Annotations**: per-paragraph or per-concept user notes. Bigger scope.
- **Collapse animations**: the plan delivers basic show/hide via CSS swap. Slide / fade transitions are deferred polish.
- **Mobile layout**: nothing in v2 is mobile-friendly. A separate spec when the use case arises.
- **Mid-paragraph highlight**: highlight the exact sentence at the playhead, not just the paragraph. Possible refinement.
