# Canvas UI v1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extend `ui/canvas-poc.html` + `ui/canvas-poc.js` into a feature-parity canvas-only replacement for the cytoscape-based live UI (`ui/app.js`), then swap.

**Architecture:** Single HTML page with four DOM regions (topbar, canvas stage, right inspector sidebar, bottom timeline panel). One canvas, one draw loop. Single `state` object, single `render()` orchestrator that recomputes `graphRenderState`, updates DOM panels via `innerHTML` templates, schedules a canvas redraw, and rebinds event listeners. Same shape as the live UI; the graph layer is canvas, not cytoscape.

**Tech Stack:** Vanilla JavaScript (ES modules, no bundler), HTML5 Canvas 2D, plain CSS, the existing pure view-model + render-state functions in `src/view-model/`.

**Spec:** `docs/canvas-ui-v1-spec.md` (commit `79c2b75`).

---

## Pre-flight

The dev server (`npm run ui:dev`) must be running at `http://127.0.0.1:4173`. The current canvas POC is reachable at `http://127.0.0.1:4173/ui/canvas-poc.html`. The live UI for comparison is at `http://127.0.0.1:4173/`.

There is no automated test runner for the UI. Verification at the end of each task is visual: load the POC URL in a browser (use Playwright if a real browser is not available), take a screenshot, compare against the equivalent state in the live UI, and check the listed expected behaviors.

Each task is self-contained. Read the file path notes, do the steps in order, run the verification, then commit.

---

## Task 1: Layout scaffolding (CSS + HTML structure)

Bring the POC's HTML/CSS up to the live UI's overall layout: topbar, canvas stage that no longer fills the screen by itself, right sidebar inspector slot, bottom timeline slot. No state, no inspector content, no timeline content yet — just the skeleton.

**Files:**
- Create: `ui/canvas-poc.css`
- Modify: `ui/canvas-poc.html`
- Reference: `ui/styles.css` (source for variables and panel styles), `ui/index.html` (source for layout shape)

- [ ] **Step 1: Read the live UI's layout HTML and supporting CSS**

Open `ui/styles.css` and identify the rules covering: CSS variables (top of file), `.workspace`, `.topbar`, `.stage-column`, `.graph-panel`, `.inspector-panel`, `.timeline-panel`, `.panel`, `.muted`, `.frame-segment`, `.track`, `.track__bar`, `.track__label`, `.playhead`, plus the `--bg`, `--panel`, `--muted` color tokens. These will be copied into `ui/canvas-poc.css`.

Also open `ui/app.js` and locate `renderAppShell()` (around line 117) to see the parent layout structure.

- [ ] **Step 2: Create `ui/canvas-poc.css` with the layout rules**

Create the file. Copy from `ui/styles.css`:

- The `:root` variables block (color tokens, fonts).
- Body / global resets.
- `.workspace`, `.topbar`, `.topbar h1`, `.topbar p`.
- `.stage-column`, `.graph-panel` (the canvas's parent column).
- `.inspector-panel` and its sub-rules.
- `.timeline-panel` and its sub-rules including the just-patched `.track__bar`, `.frame-segment`, `.frame-segment.active-frame`, `.frame-segment.selected-frame`, `.playhead` rules.
- `.muted`, `.panel`, `.legend-dot`, `.frame-chip`, `.transcript-item`, `.stat-card`, button utility classes (`.chip`, `.playback-button`, `.level-toggle button`).

Skip cytoscape-specific rules (anything referencing `.cy-root` or cytoscape's generated containers — there shouldn't be any in `styles.css` since cytoscape draws to canvas, but double-check).

The exact rule list comes from `ui/styles.css`. Do not transform — copy verbatim — and only adjust color or sizing if needed for the canvas POC.

- [ ] **Step 3: Restructure `ui/canvas-poc.html`**

Replace the current `<body>` (the small centered canvas demo) with the parity layout. Reference shape (loosely follows `ui/index.html` + `renderAppShell()`):

```html
<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>mindgraph canvas POC</title>
    <link rel="stylesheet" href="/ui/canvas-poc.css" />
  </head>
  <body>
    <div class="workspace">
      <header class="topbar panel">
        <div id="topbar-title"></div>
        <div id="topbar-status" class="muted"></div>
      </header>
      <div class="main-row">
        <div class="stage-column" id="stage-column">
          <section class="graph-panel panel">
            <div class="graph-panel__header">
              <h2>Graph canvas</h2>
              <p class="muted">Single-canvas mindgraph render.</p>
            </div>
            <div class="graph-canvas-wrap">
              <canvas id="stage" width="1280" height="720"></canvas>
            </div>
            <div class="graph-panel__legend">
              <span class="legend-dot atomic">atomic concept</span>
              <span class="legend-dot active">active at playhead</span>
            </div>
          </section>
          <section class="timeline-panel panel" id="timeline-panel"></section>
        </div>
        <aside class="inspector-panel panel" id="inspector-panel"></aside>
      </div>
    </div>
    <script type="module" src="/ui/canvas-poc.js"></script>
  </body>
</html>
```

The `id="topbar-title"`, `id="topbar-status"`, `id="timeline-panel"`, `id="inspector-panel"` mount points are where future tasks will write innerHTML. The canvas keeps `id="stage"` (already used by `canvas-poc.js`).

- [ ] **Step 4: Verify layout in browser**

Visit `http://127.0.0.1:4173/ui/canvas-poc.html`. Expected:

- Topbar visible at top (empty content for now).
- Main row split: left column with the graph canvas at top + empty timeline panel below; right sidebar empty.
- The cluster-as-galaxy graph still draws from the existing POC code.
- No console errors (favicon 404 is fine).

If the canvas no longer draws or the layout breaks, revisit Step 3 (HTML structure) or Step 2 (CSS).

- [ ] **Step 5: Commit**

```bash
git add ui/canvas-poc.html ui/canvas-poc.css
git commit -m "feat(ui): scaffold canvas POC layout for parity build" -m "$(cat <<'EOF'
Adds the parity layout (topbar, canvas + inspector + timeline) and
brings the live UI's CSS into ui/canvas-poc.css. No state or panel
content yet; the static cluster-as-galaxy still renders.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 2: State + render orchestrator

Introduce a single `state` object and a `render()` function that runs every state change. `render()` orchestrates: recompute `graphRenderState`, update DOM panel innerHTML, schedule a canvas redraw, rebind events. Same pattern as the live UI.

**Files:**
- Modify: `ui/canvas-poc.js`

- [ ] **Step 1: Replace the loose top-of-file state with a single `state` object**

In `ui/canvas-poc.js`, replace any module-level mutable variables (none meaningful currently) with this object near the top, after the constants:

```js
const state = {
  document: undefined,
  viewModel: undefined,
  layout: undefined,
  graphRenderState: undefined,
  selectedConceptId: undefined,
  selectedFrameRef: undefined,
  playheadTime: 0,
  activeLevel: 'macro',
  isPlaying: false,
  camera: { zoom: 1, pan: { x: 0, y: 0 } },
  drawScheduled: false,
};
```

- [ ] **Step 2: Convert the existing bootstrap to populate `state`**

The current `bootstrap()` already loads the document and builds the VM + layout into local variables. Change it to write into `state`:

```js
async function bootstrap() {
  const response = await fetch(DOC_PATH);
  if (!response.ok) throw new Error(`HTTP ${response.status} loading ${DOC_PATH}`);
  state.document = await response.json();
  state.viewModel = buildMindgraphViewModel(state.document);
  state.layout = computeLayout(state.viewModel);
  state.playheadTime =
    state.viewModel.frames.macro[0]?.span.start ??
    state.viewModel.frames.meso[0]?.span.start ??
    0;
  applyDpr();
  render();
}
```

- [ ] **Step 3: Add `render()` and `scheduleDraw()`**

Add these two functions:

```js
function render() {
  if (!state.viewModel) return;
  state.graphRenderState = computeGraphRenderState();
  updateTopbar();
  updateInspectorPanel();
  updateTimelinePanel();
  scheduleDraw();
  bindEvents();
}

function scheduleDraw() {
  if (state.drawScheduled) return;
  state.drawScheduled = true;
  requestAnimationFrame(() => {
    state.drawScheduled = false;
    drawAll();
  });
}

function drawAll() {
  draw(state.viewModel, state.layout);
}
```

Add stub functions so the wiring works:

```js
function computeGraphRenderState() {
  return undefined; // wired in Task 6
}

function updateTopbar() {
  const titleEl = document.getElementById('topbar-title');
  const statusEl = document.getElementById('topbar-status');
  if (titleEl) titleEl.innerHTML =
    `<h1>${escapeHtml(state.viewModel.documentMeta.title)}</h1>` +
    `<p class="muted">${escapeHtml((state.document.transcript?.speakers || []).join(', ') || 'Unknown speaker')} · ${state.viewModel.documentMeta.counts.atomicConcepts} atomic concepts</p>`;
  if (statusEl) statusEl.textContent = '';
}

function updateInspectorPanel() {
  // wired in Task 4
}

function updateTimelinePanel() {
  // wired in Task 5
}

function bindEvents() {
  // wired progressively in later tasks
}
```

Add a small `escapeHtml` helper at the bottom of the file (mirror the live UI's version):

```js
function escapeHtml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}
```

- [ ] **Step 4: Verify in browser**

Visit `http://127.0.0.1:4173/ui/canvas-poc.html`. Expected:

- The topbar now shows the document title and atomic concept count.
- The graph canvas still renders.
- Inspector and timeline panel slots are empty (intentional, wired in Tasks 4–5).
- No console errors.

- [ ] **Step 5: Commit**

```bash
git add ui/canvas-poc.js
git commit -m "feat(ui): add state object and render orchestrator to canvas POC" -m "$(cat <<'EOF'
Single state object replaces loose top-of-file variables. render()
recomputes graphRenderState, updates DOM panels (stub for now),
schedules canvas redraw, rebinds events.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 3: Inspector panel (copy from live UI)

Wire the right-sidebar inspector. Copy the live UI's inspector templates (`renderInspectorChrome`, `renderConceptInspector`, `renderFrameInspector`, `renderInspector`, helper renderers) into `ui/canvas-poc.js`. They are pure templates — they take the view-model and current state and return an HTML string. `updateInspectorPanel()` writes that string into `#inspector-panel`.

**Files:**
- Modify: `ui/canvas-poc.js`
- Reference: `ui/app.js` (functions `renderInspector`, `renderConceptInspector`, `renderFrameInspector`, `renderInspectorChrome`, `renderFrameChip`, `renderTranscriptItem`, `renderStat`, plus helpers `frameLabel`, `numberOrDash`)

- [ ] **Step 1: Locate the inspector functions in `ui/app.js`**

Open `ui/app.js`. Find these functions and note their exact line ranges:

- `renderInspector(vm)` (around line 486)
- `renderConceptInspector(vm, conceptId)` (search for the function definition)
- `renderFrameInspector(vm, frameRef)`
- `renderInspectorChrome(activeTab, title, subtitle)` (around line 709)
- `renderFrameChip(frame, isLive)` (around line 722)
- `renderTranscriptItem(segment)` (around line 733)
- `renderStat(label, value)` (search)
- `frameLabel(frame)` (search)
- `numberOrDash(value, digits)` (search)

If any helper is unfound, search for the function name with grep — these are the names used in the inspector chain.

- [ ] **Step 2: Copy the inspector functions verbatim into `ui/canvas-poc.js`**

Paste each function into `ui/canvas-poc.js`, just below the existing draw helpers. Adjust nothing inside the function bodies — they reference the view-model API which is already imported.

If a copied function references `state.selectedConceptId` or `state.selectedFrameRef`, that already matches our state object (Task 2). If it references properties not in our state (e.g., `state.activeTab`), add them to the state object as `undefined`.

- [ ] **Step 3: Wire `updateInspectorPanel()` to call `renderInspector()`**

Replace the stub `updateInspectorPanel()` from Task 2 with:

```js
function updateInspectorPanel() {
  const el = document.getElementById('inspector-panel');
  if (!el) return;
  el.innerHTML = renderInspector(state.viewModel);
}
```

- [ ] **Step 4: Verify with stub selections**

To check both flavors (concept and frame inspector), temporarily set in code:

```js
// At top of bootstrap, after vm loads, before first render:
state.selectedConceptId = 'meaning-crisis';
```

Visit `http://127.0.0.1:4173/ui/canvas-poc.html`. Expected: right sidebar shows the Meaning Crisis concept inspector, with stats and grounding.

Then change to:

```js
state.selectedConceptId = undefined;
state.selectedFrameRef = { level: 'macro', index: 0 };
```

Reload. Expected: inspector shows macro 1's frame inspector with summary, active concepts, transcript excerpts.

Reload one more time with both `undefined` to see the live overview state.

Once each flavor renders correctly, **remove the temporary stub assignments**.

- [ ] **Step 5: Commit**

```bash
git add ui/canvas-poc.js
git commit -m "feat(ui): wire inspector panel into canvas POC" -m "$(cat <<'EOF'
Inspector templates copied verbatim from the live UI. The right
sidebar now renders concept, frame, or live-overview views based
on state.selectedConceptId / state.selectedFrameRef.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 4: Timeline panel (copy from live UI)

Wire the bottom timeline panel: tracks (macro / meso / micro), time scrubber, level toggle, play/pause/step controls. Copy the live UI's `renderTimeline` and `renderTrack` (the just-patched absolute-positioning version) into the POC. Bind scrubbing and level-toggle events.

**Files:**
- Modify: `ui/canvas-poc.js`
- Reference: `ui/app.js` (functions `renderTimeline` line 611, `renderTrack` line 644, `getVisibleTimelineLevels` line 638, `formatTime` helper)

- [ ] **Step 1: Copy `renderTimeline`, `renderTrack`, `getVisibleTimelineLevels`, `formatTime` into `ui/canvas-poc.js`**

Locate these in `ui/app.js` and paste them into `ui/canvas-poc.js`. Use the post-2026-05-04 patched version (`renderTrack` uses `left:${leftPct}%;width:${widthPct}%` not `width:${width}%`).

The `renderTimeline` signature is `renderTimeline(vm, activeFrames, graphRenderState)`. To call it from `updateTimelinePanel()`, we need `activeFrames` and `graphRenderState`.

- [ ] **Step 2: Wire `updateTimelinePanel()`**

Replace the stub `updateTimelinePanel()` with:

```js
function updateTimelinePanel() {
  const el = document.getElementById('timeline-panel');
  if (!el) return;
  const activeFrames = state.viewModel.selectors.getActiveFramesAtTime(state.playheadTime);
  el.innerHTML = renderTimeline(state.viewModel, activeFrames, state.graphRenderState ?? { viewportMode: 'overview', focusMode: 'none' });
}
```

The fallback object for `graphRenderState` keeps the template's header line working before Task 6 wires the real render-state.

- [ ] **Step 3: Wire timeline events in `bindEvents()`**

Replace the empty `bindEvents()` with this version:

```js
function bindEvents() {
  const range = document.querySelector('[data-action="scrub-playhead"]');
  if (range) {
    range.addEventListener('input', (e) => {
      state.playheadTime = Number(e.target.value);
      render();
    });
  }
  document.querySelectorAll('[data-action="set-level"]').forEach((btn) => {
    btn.addEventListener('click', () => {
      state.activeLevel = btn.dataset.level;
      render();
    });
  });
  document.querySelectorAll('[data-action="select-frame"]').forEach((btn) => {
    btn.addEventListener('click', () => {
      state.selectedFrameRef = { level: btn.dataset.level, index: Number(btn.dataset.index) };
      state.selectedConceptId = undefined;
      const frame = state.viewModel.selectors.getFrame(state.selectedFrameRef);
      if (frame) state.playheadTime = frame.span.start;
      render();
    });
  });
  document.querySelectorAll('[data-action="select-concept"]').forEach((btn) => {
    btn.addEventListener('click', () => {
      state.selectedConceptId = btn.dataset.conceptId;
      state.selectedFrameRef = undefined;
      render();
    });
  });
}
```

(The `select-concept` and `select-frame` handlers also serve the inspector's clickable items from Task 3.)

- [ ] **Step 4: Verify in browser**

Visit `http://127.0.0.1:4173/ui/canvas-poc.html`. Expected:

- Timeline appears at the bottom with the macro track visible (default level).
- Scrubbing the time slider moves the playhead and updates `0:00 / 59:26`.
- Clicking `meso` or `micro` adds those tracks (3 visible at micro level).
- Clicking a macro segment selects it, jumps the playhead to its start, and updates the right-side inspector to that frame.
- Clicking a concept link inside the inspector switches to the concept inspector.

Compare side by side with the live UI at `http://127.0.0.1:4173/`. Behavior should match.

- [ ] **Step 5: Commit**

```bash
git add ui/canvas-poc.js
git commit -m "feat(ui): wire timeline panel and selection events into canvas POC" -m "$(cat <<'EOF'
Timeline templates and selection event bindings copied from the
live UI. Scrubbing, level toggle, frame selection, and concept
selection all drive state changes and re-render.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 5: Status pill in topbar

Add the small status pill in the top-right that shows the current viewport / focus mode (e.g., `Live · macro 1 · overview · playhead`). Reads from `state.graphRenderState`.

**Files:**
- Modify: `ui/canvas-poc.js`

- [ ] **Step 1: Update `updateTopbar()` to also render the status pill**

Replace the existing `updateTopbar()` body so it also writes to `#topbar-status`:

```js
function updateTopbar() {
  const titleEl = document.getElementById('topbar-title');
  const statusEl = document.getElementById('topbar-status');
  const vm = state.viewModel;
  if (titleEl) titleEl.innerHTML =
    `<h1>${escapeHtml(vm.documentMeta.title)}</h1>` +
    `<p class="muted">${escapeHtml((state.document.transcript?.speakers || []).join(', ') || 'Unknown speaker')} · ${vm.documentMeta.counts.atomicConcepts} atomic concepts</p>`;
  if (statusEl) {
    const grs = state.graphRenderState;
    const activeFrame = vm.selectors.getActiveFrameAtTime(state.activeLevel, state.playheadTime);
    const levelLabel = activeFrame ? `${state.activeLevel} ${activeFrame.ref.index + 1}` : `${state.activeLevel} —`;
    const viewportMode = grs?.viewportMode ?? 'overview';
    const focusMode = grs?.focusMode ?? 'playhead';
    const liveOrFrame = state.selectedFrameRef ? 'Frame' : state.selectedConceptId ? 'Concept' : 'Live';
    statusEl.textContent = `${liveOrFrame} · ${levelLabel} · ${viewportMode} · ${focusMode}`;
  }
}
```

- [ ] **Step 2: Verify in browser**

Visit the POC. Expected: top-right shows a small status pill, e.g. `Live · macro 1 · overview · playhead`. Scrubbing the playhead updates the level label. Clicking a frame switches to `Frame · macro N · …`. Clicking a concept switches to `Concept · macro N · …`.

(The `viewportMode` and `focusMode` values will be placeholders until Task 6 wires the real render-state.)

- [ ] **Step 3: Commit**

```bash
git add ui/canvas-poc.js
git commit -m "feat(ui): render status pill in topbar based on selection state" -m "$(cat <<'EOF'
Top-right pill mirrors the live UI's 'Live · macro N · overview ·
playhead' indicator, computed from state and graphRenderState.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 6: Render-state integration

Wire `buildGraphRenderState` into `render()` and into the canvas draw. The canvas now reflects active / dim / focus visual states based on selection and playhead, just like the live UI.

**Files:**
- Modify: `ui/canvas-poc.js`
- Reference: `src/view-model/buildGraphRenderState.js` (already used by the live UI; signature and outputs documented inside)

- [ ] **Step 1: Import `buildGraphRenderState`**

At the top of `ui/canvas-poc.js`:

```js
import { buildMindgraphViewModel } from '../src/view-model/buildMindgraphViewModel.js';
import { buildGraphRenderState } from '../src/view-model/buildGraphRenderState.js';
```

- [ ] **Step 2: Replace the stub `computeGraphRenderState()`**

```js
function computeGraphRenderState() {
  return buildGraphRenderState(state.viewModel, {
    selectedConceptId: state.selectedConceptId,
    selectedFrameRef: state.selectedFrameRef,
    playheadTime: state.playheadTime,
    activeLevel: state.activeLevel,
    zoomLevel: state.camera.zoom,
  });
}
```

- [ ] **Step 3: Pass `graphRenderState` into `draw()`**

Update `drawAll()`:

```js
function drawAll() {
  draw(state.viewModel, state.layout, state.graphRenderState);
}
```

Update the `draw()` function signature and body so it accepts `graphRenderState`. Replace the existing static draw with a render-state-aware version. The render-state provides these sets (see `buildGraphRenderState.js` for shape):

- `visibleNodeIds`, `visibleEdgeIds`
- `activeNodeIds`, `activeEdgeIds`
- `dimmedNodeIds`, `dimmedRegionIds`
- `selectedNodeIds`
- `labelVisibleNodeIds` (used in Task 7)
- `regionEmphasis` (per-cluster emphasis 0..1)
- `nodeScores` (per-node importance for label/visibility weighting)
- `viewportMode`, `focusMode`

Update the existing `drawClusterBodies`, `drawEdges`, `drawAtomicNodes`, `drawClusterLabels` to read from the render-state. Example for `drawAtomicNodes` (replace the existing one):

```js
function drawAtomicNodes(vm, layout, grs) {
  const visible = new Set(grs?.visibleNodeIds ?? vm.graph.nodes.map((n) => n.id));
  const active = new Set(grs?.activeNodeIds ?? []);
  const dimmed = new Set(grs?.dimmedNodeIds ?? []);
  const selected = new Set(grs?.selectedNodeIds ?? []);

  for (const node of vm.graph.nodes) {
    if (node.level === 'clustered') continue;
    if (!visible.has(node.id)) continue;
    const pos = layout.nodes[node.id];
    if (!pos) continue;
    const radius = 3.2 + (node.visualWeight ?? 0.5) * 1.8;
    const isActive = active.has(node.id);
    const isDimmed = dimmed.has(node.id);
    const isSelected = selected.has(node.id);

    ctx.beginPath();
    ctx.fillStyle = isActive ? '#f4cf86' : '#b8a07a';
    ctx.globalAlpha = isSelected ? 1 : isActive ? 0.94 : isDimmed ? 0.28 : 0.7;
    ctx.arc(pos.x, pos.y, radius + (isSelected ? 1.5 : 0), 0, Math.PI * 2);
    ctx.fill();
    ctx.globalAlpha = 1;

    if (isSelected) {
      ctx.beginPath();
      ctx.strokeStyle = '#fff4db';
      ctx.lineWidth = 1.6;
      ctx.arc(pos.x, pos.y, radius + 4, 0, Math.PI * 2);
      ctx.stroke();
    }
  }
}
```

Replace `drawEdges`:

```js
function drawEdges(vm, layout, grs) {
  const visible = grs?.visibleEdgeIds ? new Set(grs.visibleEdgeIds) : null;
  const activeEdge = new Set(grs?.activeEdgeIds ?? []);
  const activeNode = new Set(grs?.activeNodeIds ?? []);
  const selectedNode = new Set(grs?.selectedNodeIds ?? []);

  ctx.lineCap = 'round';
  for (const edge of vm.graph.edges) {
    if (visible && !visible.has(edge.id)) continue;
    const from = layout.nodes[edge.from];
    const to = layout.nodes[edge.to];
    if (!from || !to) continue;

    const sameCluster = sharedCluster(vm, edge.from, edge.to);
    const isActive = activeEdge.has(edge.id) || (activeNode.has(edge.from) && activeNode.has(edge.to));
    const touchesSelection = selectedNode.has(edge.from) || selectedNode.has(edge.to);

    const dx = to.x - from.x;
    const dy = to.y - from.y;
    const norm = Math.max(1, Math.hypot(dx, dy));
    const lift = sameCluster ? 14 : 38;
    const cx = (from.x + to.x) / 2 - (dy / norm) * lift;
    const cy = (from.y + to.y) / 2 + (dx / norm) * lift;

    ctx.beginPath();
    ctx.moveTo(from.x, from.y);
    ctx.quadraticCurveTo(cx, cy, to.x, to.y);
    ctx.strokeStyle = touchesSelection || isActive
      ? 'rgba(218, 184, 116, 0.95)'
      : sameCluster
        ? 'rgba(212, 188, 135, 0.30)'
        : 'rgba(143, 183, 199, 0.22)';
    ctx.lineWidth = touchesSelection ? 2 : isActive ? 1.4 : 0.85;
    ctx.stroke();
  }
}
```

Replace `drawClusterBodies`:

```js
function drawClusterBodies(layout, grs) {
  const dimmedRegions = new Set(grs?.dimmedRegionIds ?? []);
  const emphasisByRegion = grs?.regionEmphasis ?? {};
  for (const cluster of layout.clusters) {
    const emphasis = emphasisByRegion[cluster.id] ?? 0.35;
    const isDimmed = dimmedRegions.has(cluster.id);
    const fillAlpha = isDimmed ? 0.06 : 0.10 + emphasis * 0.14;
    const strokeAlpha = isDimmed ? 0.16 : 0.28 + emphasis * 0.22;

    ctx.beginPath();
    ctx.fillStyle = hexToRgba(cluster.color, fillAlpha);
    ctx.strokeStyle = hexToRgba(cluster.color, strokeAlpha);
    ctx.lineWidth = 1.2;
    ctx.arc(cluster.x, cluster.y, cluster.radius, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();

    ctx.beginPath();
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.04)';
    ctx.arc(cluster.x, cluster.y, cluster.radius - 7, 0, Math.PI * 2);
    ctx.stroke();
  }
}
```

Also update `drawClusterLabels(layout)` and `drawAtomicLabels(vm, layout)` signatures to accept `grs` (Task 7 will use it for `drawAtomicLabels`; `drawClusterLabels` ignores `grs` for now since cluster labels always render). Update the calls inside `draw()`:

```js
drawClusterBodies(layout, grs);
drawEdges(vm, layout, grs);
drawAtomicNodes(vm, layout, grs);
drawClusterLabels(layout, grs);
drawAtomicLabels(vm, layout, grs);
```

- [ ] **Step 4: Verify in browser**

Visit the POC and try several interactions. Expected:

- With no selection (live overview), most atomic nodes appear at base opacity, active-at-playhead nodes are brighter.
- Click an atomic concept (via the inspector): canvas dims unrelated nodes, brightens the selected node, brightens its 1-hop neighborhood. Compare to the live UI doing the same on the cytoscape graph — the dim/highlight pattern should be the same.
- Click a frame in the timeline: canvas dims unrelated regions, brightens active concepts in that frame.
- Scrub the playhead: active concepts shift over time.

The exact visual is not pixel-identical to the live UI (cytoscape has its own styling). What matters is that the render-state drives canvas visuals consistently.

- [ ] **Step 5: Commit**

```bash
git add ui/canvas-poc.js
git commit -m "feat(ui): integrate graphRenderState into canvas draw" -m "$(cat <<'EOF'
Canvas now reads visibleNodeIds, activeNodeIds, dimmedNodeIds,
selectedNodeIds, regionEmphasis from buildGraphRenderState. Active
/ dim / focus visuals on canvas mirror what the live UI does on
cytoscape.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 7: Progressive label reveal

Honor `labelVisibleNodeIds` from the render-state when drawing atomic concept labels. Cluster labels always render. As zoom changes (Task 8 will wire this), the label set changes, producing the Google-Maps-style progressive reveal.

**Files:**
- Modify: `ui/canvas-poc.js`

- [ ] **Step 1: Update `drawAtomicLabels` to honor `labelVisibleNodeIds`**

Replace the existing `drawAtomicLabels`:

```js
function drawAtomicLabels(vm, layout, grs) {
  const labelVisible = new Set(grs?.labelVisibleNodeIds ?? vm.graph.nodes.map((n) => n.id));
  const active = new Set(grs?.activeNodeIds ?? []);
  const dimmed = new Set(grs?.dimmedNodeIds ?? []);

  ctx.font = "11px 'Inter', system-ui, sans-serif";
  ctx.textAlign = 'center';
  ctx.textBaseline = 'bottom';

  for (const node of vm.graph.nodes) {
    if (node.level === 'clustered') continue;
    if (!labelVisible.has(node.id)) continue;
    const pos = layout.nodes[node.id];
    if (!pos) continue;
    const isActive = active.has(node.id);
    const isDimmed = dimmed.has(node.id);
    ctx.fillStyle = `rgba(234, 227, 213, ${isDimmed ? 0.34 : isActive ? 0.92 : 0.7})`;
    ctx.fillText(node.label, pos.x, pos.y - 8);
  }
}
```

The cluster label drawing (`drawClusterLabels`) does not change — cluster labels always render.

- [ ] **Step 2: Verify in browser at default zoom**

Visit the POC. Expected: at the default zoom, only the higher-priority atomic concept labels show (around 10–15 of 60 atomic concepts). Cluster labels show on every cluster.

(Without zoom interaction yet, you cannot test the reveal-on-zoom behavior here — that comes in Task 8. The check is: fewer atomic labels are drawn than the total atomic count.)

To confirm: open devtools console and run:

```js
console.log('label visible:', state.graphRenderState.labelVisibleNodeIds.length, 'of', state.viewModel.graph.nodes.filter(n => n.level !== 'clustered').length);
```

The first number should be smaller than the second.

- [ ] **Step 3: Commit**

```bash
git add ui/canvas-poc.js
git commit -m "feat(ui): only render atomic labels in labelVisibleNodeIds" -m "$(cat <<'EOF'
Atomic labels respect graphRenderState.labelVisibleNodeIds, which
itself respects the zoom level. Cluster labels always render.
Sets up the progressive label reveal that Task 8's zoom event
will exercise.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 8: Camera transform (zoom + pan in draw)

Apply a camera transform inside `draw()` so zooming and panning shift the rendered scene. Add `screenToWorld` and `worldToScreen` helpers. No interaction yet — Task 9 will wire wheel and drag.

**Files:**
- Modify: `ui/canvas-poc.js`

- [ ] **Step 1: Apply the camera transform in `draw()`**

Find the `draw()` function. Wrap the existing background+layers draws so the world layers are inside a `ctx.save()` / `ctx.restore()` and a translate+scale for the camera. Background stays in screen space:

```js
function draw(vm, layout, grs) {
  ctx.save();
  ctx.setTransform(window.devicePixelRatio || 1, 0, 0, window.devicePixelRatio || 1, 0, 0);
  drawBackground();
  ctx.restore();

  ctx.save();
  const dpr = window.devicePixelRatio || 1;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.translate(state.camera.pan.x, state.camera.pan.y);
  ctx.scale(state.camera.zoom, state.camera.zoom);

  drawClusterBodies(layout, grs);
  drawEdges(vm, layout, grs);
  drawAtomicNodes(vm, layout, grs);
  drawClusterLabels(layout, grs);
  drawAtomicLabels(vm, layout, grs);

  ctx.restore();
}
```

- [ ] **Step 2: Add `screenToWorld` and `worldToScreen` helpers**

Below the camera-aware draw:

```js
function screenToWorld(point) {
  return {
    x: (point.x - state.camera.pan.x) / state.camera.zoom,
    y: (point.y - state.camera.pan.y) / state.camera.zoom,
  };
}

function worldToScreen(point) {
  return {
    x: point.x * state.camera.zoom + state.camera.pan.x,
    y: point.y * state.camera.zoom + state.camera.pan.y,
  };
}
```

- [ ] **Step 3: Add a fit() helper that frames all clusters with padding**

```js
function fitCameraToLayout(padding = 60) {
  const clusters = state.layout.clusters;
  if (!clusters.length) return;
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const c of clusters) {
    minX = Math.min(minX, c.x - c.radius);
    minY = Math.min(minY, c.y - c.radius);
    maxX = Math.max(maxX, c.x + c.radius);
    maxY = Math.max(maxY, c.y + c.radius);
  }
  const worldW = maxX - minX;
  const worldH = maxY - minY;
  const screenW = CANVAS_W - padding * 2;
  const screenH = CANVAS_H - padding * 2;
  const zoom = Math.min(screenW / worldW, screenH / worldH);
  state.camera.zoom = zoom;
  state.camera.pan.x = padding - minX * zoom + (screenW - worldW * zoom) / 2;
  state.camera.pan.y = padding - minY * zoom + (screenH - worldH * zoom) / 2;
}
```

- [ ] **Step 4: Call `fitCameraToLayout()` once after bootstrap**

In `bootstrap()`, after `state.layout = computeLayout(...)` and before `render()`:

```js
fitCameraToLayout();
```

- [ ] **Step 5: Verify in browser**

Visit the POC. Expected: the cluster-as-galaxy graph is framed nicely inside the canvas with comfortable padding. Visually similar to before Task 8 (since the default fit lands on a natural camera position), but the transform is now actually applied.

To confirm the transform works, open devtools and run:

```js
state.camera.zoom = 1.5;
state.camera.pan.x = 100;
render();
```

The graph should zoom and shift. Reset:

```js
fitCameraToLayout();
render();
```

- [ ] **Step 6: Commit**

```bash
git add ui/canvas-poc.js
git commit -m "feat(ui): apply camera transform in draw, add fit helper" -m "$(cat <<'EOF'
draw() now applies state.camera.zoom and state.camera.pan via
ctx.translate + ctx.scale. screenToWorld / worldToScreen helpers
support hit-testing later. fitCameraToLayout() frames the graph
on bootstrap.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 9: Pan + zoom interactions (wheel, drag, fit button)

Wire mouse interactions: drag to pan, wheel to zoom around cursor. Add Fit / Zoom +/- / Reset buttons in the graph panel header.

**Files:**
- Modify: `ui/canvas-poc.js`, `ui/canvas-poc.html` (add toolbar buttons)

- [ ] **Step 1: Add toolbar buttons to the graph panel header**

In `ui/canvas-poc.html`, change the `.graph-panel__header` block:

```html
<div class="graph-panel__header">
  <div>
    <h2>Graph canvas</h2>
    <p class="muted">Single-canvas mindgraph render.</p>
  </div>
  <div class="graph-toolbar">
    <button type="button" class="chip" data-action="zoom-out">−</button>
    <button type="button" class="chip" data-action="zoom-in">+</button>
    <button type="button" class="chip" data-action="fit">Fit</button>
    <button type="button" class="chip" data-action="reset-camera">Reset</button>
  </div>
</div>
```

- [ ] **Step 2: Wire button events in `bindEvents()`**

Add to `bindEvents()`:

```js
document.querySelector('[data-action="zoom-in"]')?.addEventListener('click', () => {
  zoomAroundCenter(1.2);
});
document.querySelector('[data-action="zoom-out"]')?.addEventListener('click', () => {
  zoomAroundCenter(1 / 1.2);
});
document.querySelector('[data-action="fit"]')?.addEventListener('click', () => {
  fitCameraToLayout();
  render();
});
document.querySelector('[data-action="reset-camera"]')?.addEventListener('click', () => {
  state.selectedConceptId = undefined;
  state.selectedFrameRef = undefined;
  fitCameraToLayout();
  render();
});
```

Add the `zoomAroundCenter` helper near the camera helpers:

```js
function zoomAroundCenter(factor) {
  const cx = CANVAS_W / 2;
  const cy = CANVAS_H / 2;
  zoomAround({ x: cx, y: cy }, factor);
  render();
}

function zoomAround(screenPoint, factor) {
  const before = screenToWorld(screenPoint);
  state.camera.zoom = clamp(state.camera.zoom * factor, 0.2, 4);
  const after = screenToWorld(screenPoint);
  state.camera.pan.x += (after.x - before.x) * state.camera.zoom;
  state.camera.pan.y += (after.y - before.y) * state.camera.zoom;
}

function clamp(v, lo, hi) {
  return Math.max(lo, Math.min(hi, v));
}
```

- [ ] **Step 3: Wire wheel and drag on the canvas**

Add to `bindEvents()` (canvas event handlers attach once but `bindEvents` is called every render — so guard with a flag):

```js
const canvasEl = document.getElementById('stage');
if (canvasEl && !canvasEl.dataset.boundCameraEvents) {
  canvasEl.dataset.boundCameraEvents = '1';

  canvasEl.addEventListener('wheel', (e) => {
    e.preventDefault();
    const rect = canvasEl.getBoundingClientRect();
    const point = { x: e.clientX - rect.left, y: e.clientY - rect.top };
    const factor = Math.exp(-e.deltaY * 0.0015);
    zoomAround(point, factor);
    render();
  }, { passive: false });

  let dragging = false;
  let lastX = 0;
  let lastY = 0;
  canvasEl.addEventListener('pointerdown', (e) => {
    dragging = true;
    lastX = e.clientX;
    lastY = e.clientY;
    canvasEl.setPointerCapture(e.pointerId);
    canvasEl.style.cursor = 'grabbing';
  });
  canvasEl.addEventListener('pointermove', (e) => {
    if (!dragging) return;
    state.camera.pan.x += e.clientX - lastX;
    state.camera.pan.y += e.clientY - lastY;
    lastX = e.clientX;
    lastY = e.clientY;
    scheduleDraw();
  });
  canvasEl.addEventListener('pointerup', (e) => {
    if (!dragging) return;
    dragging = false;
    try { canvasEl.releasePointerCapture(e.pointerId); } catch (_) {}
    canvasEl.style.cursor = 'grab';
    render(); // full re-render to pick up zoom-driven label changes if drag was a no-op
  });
  canvasEl.style.cursor = 'grab';
}
```

The guard `dataset.boundCameraEvents` prevents re-binding the same listeners every render. Other re-bindings (frame buttons, etc.) re-attach because the inner DOM is rebuilt; canvas-level events on the static `<canvas>` element are bound once.

- [ ] **Step 4: Verify in browser**

Visit the POC. Expected:

- Drag: cursor turns into grab, dragging the canvas pans the graph smoothly.
- Wheel: zooms in / out around the cursor position. Labels reveal progressively (as zoom in, more atomic labels appear).
- Zoom + button: zooms in around canvas center.
- Zoom − button: zooms out.
- Fit button: re-frames the graph.
- Reset button: clears selection AND fits.

Test progressive labels: zoom out — only cluster labels and a few atomic labels show. Zoom in — more atomic labels appear in importance order. Then zoom way in — all visible atomic labels show.

- [ ] **Step 5: Commit**

```bash
git add ui/canvas-poc.html ui/canvas-poc.js
git commit -m "feat(ui): wire pan, zoom, fit, reset on canvas" -m "$(cat <<'EOF'
Drag to pan, wheel to zoom around cursor, toolbar buttons for
zoom +/-, Fit, Reset. Zoom changes flow through render-state so
labels reveal progressively as the user zooms in.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 10: Hit-testing and click-to-select on canvas

Click anywhere on the canvas → distance check against atomic nodes (then cluster centers) → dispatch select. Empty-area click clears selection.

**Files:**
- Modify: `ui/canvas-poc.js`

- [ ] **Step 1: Add `hitTestAt(worldPoint)`**

Near the camera helpers:

```js
function hitTestAt(worldPoint) {
  // Atomic nodes win first (smaller hit zones, drawn on top conceptually).
  for (const node of state.viewModel.graph.nodes) {
    if (node.level === 'clustered') continue;
    const pos = state.layout.nodes[node.id];
    if (!pos) continue;
    const radius = 6 + (node.visualWeight ?? 0.5) * 1.8;
    const dx = worldPoint.x - pos.x;
    const dy = worldPoint.y - pos.y;
    if (dx * dx + dy * dy <= radius * radius) {
      return { kind: 'concept', id: node.id };
    }
  }
  // Cluster regions next.
  for (const cluster of state.layout.clusters) {
    const dx = worldPoint.x - cluster.x;
    const dy = worldPoint.y - cluster.y;
    if (dx * dx + dy * dy <= cluster.radius * cluster.radius) {
      return { kind: 'cluster', id: cluster.id };
    }
  }
  return null;
}
```

- [ ] **Step 2: Wire a click handler on the canvas**

Inside the `if (!canvasEl.dataset.boundCameraEvents)` block from Task 9, add (before the closing brace):

```js
let downAt = null;
canvasEl.addEventListener('pointerdown', (e) => {
  downAt = { x: e.clientX, y: e.clientY };
});
canvasEl.addEventListener('click', (e) => {
  // Suppress click if the pointer moved more than a few px (= drag, not click).
  if (downAt && Math.hypot(e.clientX - downAt.x, e.clientY - downAt.y) > 4) {
    downAt = null;
    return;
  }
  downAt = null;
  const rect = canvasEl.getBoundingClientRect();
  const screen = { x: e.clientX - rect.left, y: e.clientY - rect.top };
  const world = screenToWorld(screen);
  const hit = hitTestAt(world);
  if (hit && hit.kind === 'concept') {
    state.selectedConceptId = hit.id;
    state.selectedFrameRef = undefined;
  } else if (hit && hit.kind === 'cluster') {
    state.selectedConceptId = hit.id;
    state.selectedFrameRef = undefined;
  } else {
    state.selectedConceptId = undefined;
    state.selectedFrameRef = undefined;
  }
  render();
});
```

- [ ] **Step 3: Verify in browser**

Visit the POC. Expected:

- Click an atomic node on the canvas → inspector switches to that concept; canvas dims unrelated nodes; the clicked node gets a selection ring.
- Click an empty cluster region (not on any atomic node) → inspector switches to that cluster's concept inspector; canvas dims unrelated regions.
- Click empty space outside any cluster → selection clears; inspector goes back to the live overview.
- Drag to pan should NOT trigger a select (the 4px movement threshold filters this).

Compare with the live UI at `/`: clicking nodes there should produce the same dim/highlight pattern. The behaviors should match.

- [ ] **Step 4: Commit**

```bash
git add ui/canvas-poc.js
git commit -m "feat(ui): add hit-testing and click-to-select on canvas" -m "$(cat <<'EOF'
hitTestAt(worldPoint) checks atomic nodes first, then cluster
regions. Click handler converts screen to world, dispatches
select / cluster-select / clear. Drag movement above 4px
suppresses the click so panning does not trigger selection.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 11: Polish + parity check

Side-by-side comparison with the live UI. Fix small visual gaps, breathing room, alignment. No animation system in v1.

**Files:**
- Modify: `ui/canvas-poc.js`, `ui/canvas-poc.css` (as needed)

- [ ] **Step 1: Side-by-side comparison**

Open two browser windows: live UI at `http://127.0.0.1:4173/` and the canvas POC at `http://127.0.0.1:4173/ui/canvas-poc.html`. Walk through these states in both:

1. Initial load (no selection, playhead at 0:00).
2. Scrub playhead to 25:30.
3. Click a concept (e.g. "Meaning Crisis").
4. Click a frame in the meso track.
5. Toggle micro level.
6. Reset everything.

For each state, note any visual or behavior gap between the canvas POC and the live UI.

- [ ] **Step 2: Fix the gaps you found**

Apply small CSS or JS fixes for items in the gap list. Skip anything in the v1.5 parking lot (animation, typed-edge colors, topographic backdrop, filled cluster bodies in mockup style, focus reticle, hover preview, breathing labels, cluster collapse, search). Those are out of scope.

- [ ] **Step 3: Verify (final)**

Walk through the same states again. Confirm parity is acceptable.

- [ ] **Step 4: Commit**

```bash
git add ui/canvas-poc.js ui/canvas-poc.css
git commit -m "feat(ui): polish canvas POC for parity with live UI" -m "$(cat <<'EOF'
Closes the small visual and behavior gaps found in the
side-by-side comparison. v1 ready for swap.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 12: File swap

Replace the cytoscape live UI with the canvas POC. Archive the old `ui/app.js`. The dev server's default route picks up `ui/index.html` → `/ui/app.js`, so renaming makes the canvas version the new default.

**Files:**
- Rename: `ui/app.js` → `ui/app-cytoscape-archive.js`
- Rename: `ui/canvas-poc.js` → `ui/app.js`
- Rename: `ui/canvas-poc.css` → merge / replace into `ui/styles.css` (or update the link in `ui/index.html`)
- Modify: `ui/canvas-poc.html` → `ui/index.html` (or keep the existing index.html and update its `src` reference)

- [ ] **Step 1: Decide on the swap shape**

Two clean options:

A) **Rename both files, keep the existing `ui/index.html`.** Move `ui/app.js` → `ui/app-cytoscape-archive.js`. Move `ui/canvas-poc.js` → `ui/app.js`. Move `ui/canvas-poc.css` content → `ui/styles.css` (or add a `<link>` for it in the existing `ui/index.html`). Delete `ui/canvas-poc.html`. The existing `ui/index.html` already loads `/ui/styles.css` and `/ui/app.js`, so it will load the new code without changes — but you must make sure the body markup in `ui/index.html` matches what the new `app.js` expects (the same `#topbar-title`, `#topbar-status`, `#stage`, `#timeline-panel`, `#inspector-panel` mount points, the same toolbar buttons, etc.).

B) **Replace `ui/index.html` with the POC's HTML.** Move `ui/index.html` → `ui/index-cytoscape-archive.html`. Move `ui/canvas-poc.html` → `ui/index.html`. Move `ui/canvas-poc.js` → `ui/app.js`. Move `ui/canvas-poc.css` → `ui/styles.css` (overwrite). Move `ui/app.js` → `ui/app-cytoscape-archive.js`. Update the `<script src>` and `<link rel="stylesheet">` paths in the new `ui/index.html` to point at `/ui/app.js` and `/ui/styles.css`.

Pick **B** unless the existing `ui/index.html` is preferable to keep. B gives a clean swap of the entire UI shell at once.

- [ ] **Step 2: Execute the swap (option B shown)**

```bash
git mv ui/index.html ui/index-cytoscape-archive.html
git mv ui/app.js ui/app-cytoscape-archive.js
git mv ui/styles.css ui/styles-cytoscape-archive.css
git mv ui/canvas-poc.html ui/index.html
git mv ui/canvas-poc.js ui/app.js
git mv ui/canvas-poc.css ui/styles.css
```

Open the new `ui/index.html` and update the `<link>` and `<script>` paths so they reference `/ui/styles.css` and `/ui/app.js`:

```html
<link rel="stylesheet" href="/ui/styles.css" />
<script type="module" src="/ui/app.js"></script>
```

Open the new `ui/app.js` (formerly canvas-poc.js) and check the import path for the view-model — it should still work as `../src/view-model/buildMindgraphViewModel.js` since the file's location did not change relative to `src/`.

- [ ] **Step 3: Verify in browser**

Visit `http://127.0.0.1:4173/`. Expected: the new canvas-based UI loads at the root URL, looks like the canvas POC did before the swap, and behaves the same. The cytoscape archive is reachable at `http://127.0.0.1:4173/ui/index-cytoscape-archive.html` for reference.

Run the smoke check:

```bash
npm run ui:check
```

Should report no parse errors. (`ui:check` parses `ui/app.js` and the dev server, both of which still exist at those paths.)

- [ ] **Step 4: Commit**

```bash
git commit -m "feat(ui): swap canvas UI in as the default; archive cytoscape version" -m "$(cat <<'EOF'
The canvas UI is now the default at http://127.0.0.1:4173/. The
former cytoscape implementation is archived at
ui/index-cytoscape-archive.html / ui/app-cytoscape-archive.js /
ui/styles-cytoscape-archive.css and remains reachable for
reference until a follow-up cleanup removes it (and the cytoscape
dependency from package.json).

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Implementation notes (deviations from plan)

Two things came up during execution that the plan did not anticipate. Recorded here for future readers.

### Task 9 — toolbar button guard

The plan's Step 3 wraps the wheel and drag listeners in `if (!canvasEl.dataset.boundCameraEvents)` because `bindEvents()` is called on every `render()`. The plan did **not** apply the same guard to the toolbar button click listeners (Step 2: `data-action="zoom-in"`, `zoom-out`, `fit`, `reset-camera`).

In practice, the toolbar lives in static HTML that `render()` does not rewrite, so each `render()` would attach a fresh click listener to each button. After N renders, one button click would trigger N zoom steps.

The implementer caught this and added a matching `dataset.boundCameraEvents` guard around the toolbar handlers. Future plans for static-DOM event wiring should follow the same pattern.

### Task 11 — status pill concept label

During the Task 11 parity check, the canvas POC's status pill was showing `Concept · macro 1 · …` when a concept was selected — copying the level label instead of the concept's display label. The Task 5 template only branched on `liveOrFrame` to set the prefix, then always used the level label.

The fix in Task 11 made `updateTopbar` read `state.viewModel.concepts.byId[selectedConceptId].label` when a concept is active, mirroring the live UI's status text. The same pattern is correct for any future inspector / pill that derives its title from selection state.

---

## Done

All twelve tasks complete. The canvas UI is the default. Post-build cleanup (cytoscape dependency, archive files, gitignore, comment refresh) was committed in a follow-up session — see `git log --grep='^chore'`.

The v1.5 parking lot from the spec is the natural next set of tasks: animation system, topographic backdrop, typed-edge color variants, filled cluster bodies in mockup style, focus reticle, hover preview, breathing labels, cluster collapse, search.

---

### Post-v1 — module split (2026-05-04)

`ui/app.js` grew to 941 lines after the v1 polish pass, past the spec's ~600–700 line split threshold. A mechanical refactor split it along the existing section-comment seams:

| Module | Lines | Responsibility |
|---|---|---|
| `ui/app.js` | 161 | Orchestrator: bootstrap, state, render, panel updaters |
| `ui/camera.js` | 67 | applyDpr, screenToWorld/worldToScreen, fitCameraToLayout, zoomAround/Center |
| `ui/hit-test.js` | 34 | hitTestAt(state, worldPoint) |
| `ui/draw.js` | 177 | draw entry + all sub-draw functions; imports hexToRgba/wrapLabel from util |
| `ui/layout.js` | 72 | computeLayout, PROTOTYPE_CLUSTER_LAYOUT, CLUSTER_COLORS, deterministicAngle/seededUnit |
| `ui/events.js` | 183 | bindEvents(state, render, scheduleDraw), playback controls, camera/canvas handlers |
| `ui/panels/timeline.js` | 59 | renderTimeline, renderTrack, getVisibleTimelineLevels |
| `ui/panels/inspector.js` | 178 | renderInspector/Concept/Frame, chrome/chip/transcript/stat helpers |
| `ui/util.js` | 46 | escapeHtml, formatTime, frameLabel, numberOrDash, wrapLabel, hexToRgba |

Design decisions:
- `state` is a singleton in `app.js`; modules receive it as a parameter rather than importing it (avoids implicit coupling). The draw/event modules accept `state` directly.
- `render` and `scheduleDraw` live in `app.js` and are passed as parameters into `bindEvents`, avoiding a real import cycle problem.
- `zoomAroundCenter` is a pure camera mutator; call sites call `render()` separately. This keeps `camera.js` free of any DOM/render dependency.
- No bundler; native ES modules loaded directly by the browser via `<script type="module" src="/ui/app.js">` in index.html — unchanged.
- All nine modules pass `node --check`. Zero runtime errors in Playwright walkthrough of all v1 verification states.
