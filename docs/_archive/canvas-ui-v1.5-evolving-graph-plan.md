# Canvas UI v1.5 — Evolving Graph Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the canvas graph evolve as the playhead moves. Concepts bloom in at their `firstSeenAt`, fade out when scrubbed back. Camera lerps to follow the focus of the active frame at the user's chosen level. Selection locks the camera; clicking an unseen concept in the inspector auto-advances the playhead.

**Architecture:** Keep the existing pure pipeline (`state → buildGraphRenderState → draw`). Insert a small **animator** module between the pure render-state and the draw call. The pure layer gains `cumulativeVisible{Concept,Cluster,Edge}Ids` and `cameraTarget` fields. The animator owns the only mutable graph-rendering state outside the canvas: per-entity opacity and scale, and the live camera. It runs an rAF loop while anything is animating and stops when everything is settled.

**Tech Stack:** Vanilla JavaScript (ES modules, no bundler), HTML5 Canvas 2D, the existing pure view-model in `src/view-model/`. No new dependencies.

**Spec:** `docs/canvas-ui-v1.5-evolving-graph-spec.md` (commit `75be8fd`).

---

## Pre-flight

The dev server (`npm run ui:dev`) must be running at `http://127.0.0.1:4173`. The canvas UI is reachable at the root.

There is no automated test runner for the UI. Verification at the end of each task is visual: load the URL in a browser (use Playwright if a real browser is not available), exercise the changed feature, take a screenshot if useful, and check the listed expected behaviors. For the view-model task, `npm run vm:example` is used as the verification command.

Each task is self-contained. Read the file path notes, do the steps in order, run the verification, then commit.

---

## File Structure

**Modified files:**

- `src/view-model/buildMindgraphViewModel.js` — add `firstSeenAt` derivation in `buildConceptsVM`.
- `src/view-model/buildGraphRenderState.js` — add `cumulativeVisible{Concept,Cluster,Edge}Ids`, gate the existing `visibleNodeIds`/`visibleClusterIds`/`visibleEdgeIds` through them, and add `cameraTarget`.
- `ui/app.js` — own the animator instance, replace `scheduleDraw` with a continuous rAF tick loop driven by the animator. Track `cameraMode` in state.
- `ui/draw.js` — read per-entity opacity/scale from the animator; multiply into existing draw opacity/radius.
- `ui/events.js` — set `cameraMode = 'manual'` on drag/wheel; `'selection'` on click; back to `'auto'` on Reset / empty click / Play. Auto-advance playhead from inspector concept link.
- `ui/hit-test.js` — gate atomic and cluster hits through `cumulativeVisible*` sets.
- `ui/panels/inspector.js` — emit a `data-action="select-concept"` link with `data-first-seen-at` attribute so the events handler can auto-advance.
- `ui/camera.js` — add `fitCameraToBounds(camera, bounds, viewport, padding)` helper used by both the initial fit and the cameraTarget derivation.

**New files:**

- `ui/animator.js` — the animation layer. Holds per-entity animated opacity/scale, last-known cumulative sets, and runs the lerp on each rAF tick. Exposes `step(now, opts)` and `getEntityState(id)`.

---

## Task 1: Derive `firstSeenAt` in the view-model

The canonical sample document has zero concepts with `firstSeenAt` set. The view-model should derive it from frames so the cumulative visibility logic has something to gate on. Producer-set values (rare) are kept as overrides.

**Files:**
- Modify: `src/view-model/buildMindgraphViewModel.js` (the `buildConceptsVM` function, around line 39)

- [ ] **Step 1: Read the current `buildConceptsVM`**

Open `src/view-model/buildMindgraphViewModel.js` and locate `buildConceptsVM` (line 39). Note that it currently maps each `clustered` and `atomic` concept through `normalizeConcept`, which copies `firstSeenAt: rawConcept.firstSeenAt` — so the field is preserved if set, but never derived.

- [ ] **Step 2: Add a derivation helper near the top of the file**

Add this helper function above `buildConceptsVM`:

```js
function deriveFirstSeenAt(document) {
  // For each concept id, find the earliest frame.span.start where the
  // concept appears in foregroundConcepts or backgroundConcepts at any
  // level. Returns { conceptId: firstSeenAt }.
  const firstSeen = {};
  const allFrames = [
    ...(document.frames?.micro ?? []),
    ...(document.frames?.meso ?? []),
    ...(document.frames?.macro ?? []),
  ];
  for (const frame of allFrames) {
    const start = frame.span?.start;
    if (typeof start !== 'number') continue;
    for (const list of [frame.foregroundConcepts ?? [], frame.backgroundConcepts ?? []]) {
      for (const activation of list) {
        const prev = firstSeen[activation.id];
        if (prev === undefined || start < prev) {
          firstSeen[activation.id] = start;
        }
      }
    }
  }
  return firstSeen;
}
```

- [ ] **Step 3: Apply the derivation inside `buildConceptsVM`**

Modify `buildConceptsVM` to use the helper:

```js
function buildConceptsVM(document) {
  const derivedFirstSeen = deriveFirstSeenAt(document);
  const applyFirstSeen = (concept) => {
    if (typeof concept.firstSeenAt === 'number') return concept;
    const derived = derivedFirstSeen[concept.id];
    if (typeof derived === 'number') concept.firstSeenAt = derived;
    return concept;
  };

  const clustered = (document.concepts?.clustered ?? [])
    .map((concept) => normalizeConcept(concept, 'clustered'))
    .map(applyFirstSeen);
  const atomic = (document.concepts?.atomic ?? [])
    .map((concept) => normalizeConcept(concept, 'atomic'))
    .map(applyFirstSeen);

  // ...rest of function unchanged (byId, childrenByClusterId, etc.)
```

The rest of the function body (constructing `byId`, `childrenByClusterId`, `clustersByAtomicId`, the children pass) stays exactly as-is.

- [ ] **Step 4: Verify with the view-model example driver**

Run:

```bash
npm run vm:example
```

Expected: the JSON output's `sampleGraph.firstCluster` should now have a numeric `firstSeenAt` field (was `undefined`). Confirm with a follow-up command:

```bash
node -e "import('./src/view-model/buildMindgraphViewModel.js').then(({ buildMindgraphViewModel }) => { const fs = require('fs'); const d = JSON.parse(fs.readFileSync('./examples/out/episode-1-built.mindgraph.json')); const vm = buildMindgraphViewModel(d); const all = [...vm.concepts.atomic, ...vm.concepts.clustered]; const missing = all.filter(c => typeof c.firstSeenAt !== 'number'); console.log('total:', all.length, 'with firstSeenAt:', all.length - missing.length, 'missing:', missing.length); const earliest = all.slice().sort((a,b) => a.firstSeenAt - b.firstSeenAt).slice(0,5); earliest.forEach(c => console.log(c.firstSeenAt, c.id, c.label)); });"
```

Expected output:

```
total: 70 with firstSeenAt: 70 missing: 0
0 meaning-in-life Meaning in Life
0 cultural-convergences Cultural Convergences
55 buddhism Buddhism
55 cognitive-science Cognitive Science
55 mindfulness-revolution Mindfulness Revolution
```

If any concept is still `missing`, check that the document has it in some frame's activations — concepts that never appear in any frame are intentionally left without a `firstSeenAt`.

- [ ] **Step 5: Commit**

```bash
git add src/view-model/buildMindgraphViewModel.js
git commit -m "feat(view-model): derive firstSeenAt from frame activations" -m "$(cat <<'EOF'
For concepts missing an explicit firstSeenAt, walk all frames at all
levels and use the earliest frame.span.start where the concept appears
in foreground or background. Producer-set firstSeenAt (via the CLI
--first-seen-at flag) is preserved as an override. This gives the
cumulative visibility logic a reliable signal without a producer
schema change.
EOF
)"
```

---

## Task 2: Cumulative visibility sets in render-state + hit-test gate

Add `cumulativeVisible{Concept,Cluster,Edge}Ids` to `buildGraphRenderState`. Intersect them into the existing `visibleNodeIds`/`visibleClusterIds`/`visibleEdgeIds` so the draw layer (and hit-test) automatically respects them. This is the pure-layer change; bloom/fade animation comes later.

**Files:**
- Modify: `src/view-model/buildGraphRenderState.js`
- Modify: `ui/hit-test.js`

- [ ] **Step 1: Add a cumulative-visibility helper at the top of `buildGraphRenderState.js`**

Above `function scoreNodeBase(node)`, add:

```js
function buildCumulativeVisibility(viewModel, playheadTime) {
  const conceptIds = new Set();
  const clusterIds = new Set();
  for (const concept of viewModel.graph.nodes) {
    if (typeof concept.firstSeenAt !== 'number') continue;
    if (concept.firstSeenAt <= playheadTime) {
      conceptIds.add(concept.id);
    }
  }
  // A cluster is visible if at least one of its members is visible.
  // (Cluster nodes themselves use the cluster's own firstSeenAt — set during
  // buildConceptsVM derivation — but we also include any cluster whose
  // children are visible, in case the cluster itself has no activation.)
  for (const cluster of viewModel.concepts.clustered) {
    if (conceptIds.has(cluster.id)) {
      clusterIds.add(cluster.id);
      continue;
    }
    const childIds = viewModel.concepts.childrenByClusterId[cluster.id] ?? [];
    if (childIds.some((id) => conceptIds.has(id))) clusterIds.add(cluster.id);
  }
  // Make sure clusters that are visible are also in the conceptIds set
  // (cluster-level concepts share id space with the graph's "clustered" nodes).
  for (const id of clusterIds) conceptIds.add(id);
  const edgeIds = new Set();
  for (const edge of viewModel.graph.edges) {
    if (conceptIds.has(edge.from) && conceptIds.has(edge.to)) edgeIds.add(edge.id);
  }
  return { conceptIds, clusterIds, edgeIds };
}
```

- [ ] **Step 2: Take `playheadTime` into the cumulative helper inside `buildGraphRenderState`**

Locate the `buildGraphRenderState` function signature (line 62) — it already accepts `playheadTime`. Right after the `const focus = ...` line, add:

```js
const cumulative = buildCumulativeVisibility(viewModel, playheadTime);
```

- [ ] **Step 3: Gate the existing visibility sets through the cumulative sets**

Inside `buildGraphRenderState`, the existing logic builds `visibleNodeIds`, `visibleClusterIds`, `visibleEdgeIds` based on score + focus + viewport mode. After all those `.add(...)` calls but before the final `return`, intersect with the cumulative sets:

```js
// Cumulative gate: nothing introduced after the playhead is visible.
for (const id of [...visibleNodeIds]) {
  if (!cumulative.conceptIds.has(id)) visibleNodeIds.delete(id);
}
for (const id of [...visibleClusterIds]) {
  if (!cumulative.clusterIds.has(id)) visibleClusterIds.delete(id);
}
for (const id of [...visibleEdgeIds]) {
  if (!cumulative.edgeIds.has(id)) visibleEdgeIds.delete(id);
}
for (const id of [...labelVisibleNodeIds]) {
  if (!cumulative.conceptIds.has(id)) labelVisibleNodeIds.delete(id);
}
```

- [ ] **Step 4: Add cumulative arrays to the returned render-state**

In the final `return { ... }` of `buildGraphRenderState`, add three new fields right after `regionEmphasis`:

```js
return {
  viewportMode,
  focusMode: focus.focusMode,
  visibleNodeIds: [...visibleNodeIds],
  visibleEdgeIds: [...visibleEdgeIds],
  activeNodeIds: [...activeNodeIds],
  activeEdgeIds: [...activeEdgeIds],
  selectedNodeIds: [...selectedNodeIds],
  neighborNodeIds: [...neighborNodeIds],
  labelVisibleNodeIds: [...labelVisibleNodeIds],
  visibleClusterIds: [...visibleClusterIds],
  dimmedNodeIds: [...dimmedNodeIds],
  dimmedRegionIds: [...dimmedRegionIds],
  regionEmphasis,
  nodeScores: Object.fromEntries(nodeScores.entries()),
  cumulativeVisibleConceptIds: [...cumulative.conceptIds],
  cumulativeVisibleClusterIds: [...cumulative.clusterIds],
  cumulativeVisibleEdgeIds: [...cumulative.edgeIds],
};
```

- [ ] **Step 5: Update `ui/hit-test.js` to also gate on cumulative**

Open `ui/hit-test.js`. The function currently gates atomic-node hits on `visibleNodeIds` only and lets cluster hits through unconditionally. Replace its body:

```js
export function hitTestAt(state, worldPoint) {
  // Hit-test only what is currently drawn. visibleNodeIds is already
  // gated by cumulative visibility (see buildGraphRenderState). Cluster
  // hits also need the cumulative cluster gate so empty cluster regions
  // don't accept clicks before the cluster has appeared.
  const visibleNodes = state.graphRenderState?.visibleNodeIds
    ? new Set(state.graphRenderState.visibleNodeIds)
    : null;
  const visibleClusters = state.graphRenderState?.cumulativeVisibleClusterIds
    ? new Set(state.graphRenderState.cumulativeVisibleClusterIds)
    : null;

  for (const node of state.viewModel.graph.nodes) {
    if (node.level === 'clustered') continue;
    if (visibleNodes && !visibleNodes.has(node.id)) continue;
    const pos = state.layout.nodes[node.id];
    if (!pos) continue;
    const radius = 6 + (node.visualWeight ?? 0.5) * 1.8;
    const dx = worldPoint.x - pos.x;
    const dy = worldPoint.y - pos.y;
    if (dx * dx + dy * dy <= radius * radius) {
      return { kind: 'concept', id: node.id };
    }
  }
  for (const cluster of state.layout.clusters) {
    if (visibleClusters && !visibleClusters.has(cluster.id)) continue;
    const dx = worldPoint.x - cluster.x;
    const dy = worldPoint.y - cluster.y;
    if (dx * dx + dy * dy <= cluster.radius * cluster.radius) {
      return { kind: 'cluster', id: cluster.id };
    }
  }
  return null;
}
```

- [ ] **Step 6: Verify in browser**

Visit `http://127.0.0.1:4173/` and reload. Expected at `playheadTime = 0`:

- Only the **Cultural Convergences** cluster body and the **Meaning in Life** atomic concept are visible. All other clusters and concepts hidden.
- Drag the timeline scrubber to ~50s — concepts like Buddhism / Cognitive Science / Mindfulness Revolution should appear (they snap in instantly for now; bloom comes in Task 5).
- Drag the scrubber back to 0 — only the seed concept and its cluster remain.
- Click somewhere inside the Cultural Pathologies cluster region while still at t=0 — nothing should be selected (cluster not yet visible, hit-test rejects).

If at t=0 multiple clusters are still visible, check that the cumulative gate intersection in Step 3 actually runs after the existing visibility additions.

- [ ] **Step 7: Commit**

```bash
git add src/view-model/buildGraphRenderState.js ui/hit-test.js
git commit -m "feat(view-model): cumulative visibility gates render-state" -m "$(cat <<'EOF'
buildGraphRenderState now derives cumulativeVisible{Concept,Cluster,
Edge}Ids from the playhead time, intersects them into the existing
visibleNodeIds/visibleClusterIds/visibleEdgeIds, and exposes them on
the returned object. hit-test also gates cluster hits on the cumulative
cluster set so empty regions don't accept clicks. Concepts and edges
introduced after the playhead are no longer drawn.
EOF
)"
```

---

## Task 3: `cameraTarget` derivation in render-state

Add the camera target computation (per spec section "Camera Tracking → Target derivation"). The camera doesn't actually move yet; this just produces the field so downstream tasks can lerp toward it.

**Files:**
- Modify: `src/view-model/buildGraphRenderState.js`
- Read for reference: `ui/layout.js` (cluster anchors), `ui/camera.js` (viewport shape)

- [ ] **Step 1: Note the input dependencies**

The camera target depends on layout positions (cluster centers, atomic-node positions). The render-state currently does not see layout. We'll pass `layout` and `viewport` through the options object.

- [ ] **Step 2: Update `buildGraphRenderState` signature to accept `layout` and `viewport`**

In `buildGraphRenderState`, change the destructured options:

```js
export function buildGraphRenderState(viewModel, {
  selectedConceptId,
  selectedFrameRef,
  playheadTime,
  activeLevel = 'meso',
  zoomLevel = 1,
  layout,           // { clusters: [{ id, x, y, radius }], nodes: { [id]: { x, y } } }
  viewport,         // { width, height }
} = {}) {
```

These are optional — when they are missing (e.g., other callers), the camera-target step short-circuits.

- [ ] **Step 3: Add a `deriveCameraTarget` helper near the top of the file**

Above `function scoreNodeBase(node)` and below `buildCumulativeVisibility`:

```js
function deriveCameraTarget(viewModel, layout, viewport, opts) {
  if (!layout || !viewport) return undefined;
  const { activeLevel, playheadTime, cumulative } = opts;
  const frame = viewModel.selectors.getActiveFrameAtTime(activeLevel, playheadTime);
  const fg = frame?.foregroundConcepts ?? [];

  // Resolve a foreground id to a layout point.
  const pointFor = (id) => layout.nodes[id];

  // Case 1: no active frame → fit visible clusters.
  if (!frame || !fg.length) {
    const clusters = layout.clusters.filter((c) => cumulative.clusterIds.has(c.id));
    if (!clusters.length) return undefined;
    return boundsOfClusters(clusters, viewport, 0.15);
  }

  // Case 2: single foreground concept → use its parent cluster.
  if (fg.length === 1) {
    const concept = viewModel.concepts.byId[fg[0].id];
    const parentClusterId = concept?.parentIds?.[0] ?? concept?.id;
    const cluster = layout.clusters.find((c) => c.id === parentClusterId);
    if (cluster) return boundsOfClusters([cluster], viewport, 0.20);
    const point = pointFor(fg[0].id);
    if (!point) return undefined;
    return boundsAroundPoint(point, 200, viewport);
  }

  // Case 3: multiple foreground concepts → weighted center, unweighted bbox, padded.
  const points = fg.map((a) => ({ pos: pointFor(a.id), weight: a.weight ?? 0.5 }))
    .filter((p) => p.pos);
  if (!points.length) return undefined;
  const totalWeight = points.reduce((s, p) => s + p.weight, 0) || 1;
  const cx = points.reduce((s, p) => s + p.pos.x * p.weight, 0) / totalWeight;
  const cy = points.reduce((s, p) => s + p.pos.y * p.weight, 0) / totalWeight;
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const p of points) {
    if (p.pos.x < minX) minX = p.pos.x;
    if (p.pos.y < minY) minY = p.pos.y;
    if (p.pos.x > maxX) maxX = p.pos.x;
    if (p.pos.y > maxY) maxY = p.pos.y;
  }
  return fitTarget(minX, minY, maxX, maxY, cx, cy, viewport, 0.15);
}

function boundsOfClusters(clusters, viewport, pad) {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const c of clusters) {
    minX = Math.min(minX, c.x - c.radius);
    minY = Math.min(minY, c.y - c.radius);
    maxX = Math.max(maxX, c.x + c.radius);
    maxY = Math.max(maxY, c.y + c.radius);
  }
  const cx = (minX + maxX) / 2;
  const cy = (minY + maxY) / 2;
  return fitTarget(minX, minY, maxX, maxY, cx, cy, viewport, pad);
}

function boundsAroundPoint(point, radius, viewport) {
  return fitTarget(
    point.x - radius, point.y - radius,
    point.x + radius, point.y + radius,
    point.x, point.y, viewport, 0.15,
  );
}

function fitTarget(minX, minY, maxX, maxY, cx, cy, viewport, pad) {
  const worldW = Math.max(1, maxX - minX);
  const worldH = Math.max(1, maxY - minY);
  const padFactor = 1 + pad * 2;
  const screenW = Math.max(1, viewport.width);
  const screenH = Math.max(1, viewport.height);
  const zoom = Math.min(
    screenW / (worldW * padFactor),
    screenH / (worldH * padFactor),
  );
  return { cx, cy, zoom: Math.max(0.2, Math.min(4, zoom)) };
}
```

- [ ] **Step 4: Call `deriveCameraTarget` and add it to the returned render-state**

Right after the cumulative gate intersection (end of Step 3 in Task 2), compute:

```js
const cameraTarget = deriveCameraTarget(viewModel, layout, viewport, {
  activeLevel,
  playheadTime,
  cumulative,
});
```

Then in the `return { ... }`, add as the last field:

```js
  cumulativeVisibleEdgeIds: [...cumulative.edgeIds],
  cameraTarget,
};
```

`cameraTarget` is `{ cx, cy, zoom }` (world-space center + a target zoom) or `undefined`.

- [ ] **Step 5: Pass `layout` and `viewport` from `app.js`**

Open `ui/app.js`, locate `computeGraphRenderState()`. Modify it to pass the two extra fields:

```js
function computeGraphRenderState() {
  return buildGraphRenderState(state.viewModel, {
    selectedConceptId: state.selectedConceptId,
    selectedFrameRef: state.selectedFrameRef,
    playheadTime: state.playheadTime,
    activeLevel: state.activeLevel,
    zoomLevel: state.camera.zoom,
    layout: state.layout,
    viewport: state.viewport,
  });
}
```

- [ ] **Step 6: Verify the field exists**

Visit `http://127.0.0.1:4173/`, open the browser console, and run:

```js
fetch('/').then(() => null);
// After page settled:
const grs = window.__mindgraph?.state?.graphRenderState;
```

If `window.__mindgraph` is not exposed, add a temporary debug line near the end of `bootstrap()` in `ui/app.js` (will be removed in a later step):

```js
window.__mindgraph = { state };
```

Then in console:

```js
console.log(window.__mindgraph.state.graphRenderState.cameraTarget);
// Expected: { cx: <number>, cy: <number>, zoom: <number> } at t=0
```

Drag the playhead to the middle (~30:00) — cameraTarget values should change. (No visible effect yet — Task 7 wires the camera lerp.)

- [ ] **Step 7: Commit**

```bash
git add src/view-model/buildGraphRenderState.js ui/app.js
git commit -m "feat(view-model): derive cameraTarget from active frame foreground" -m "$(cat <<'EOF'
buildGraphRenderState now optionally accepts layout and viewport and
returns a cameraTarget = { cx, cy, zoom } per the v1.5 spec rules:
no active frame → fit visible clusters; single foreground → that
concept's parent cluster; multiple foreground → weighted centroid +
unweighted bbox padded 15%. The animator (next tasks) will lerp the
live camera toward this target.
EOF
)"
```

---

## Task 4: Animator module + wire into app.js (snap-only, no animation yet)

Create `ui/animator.js`. It owns per-entity opacity/scale and the live camera. It runs a continuous rAF loop that ticks once per frame, computes new live values, and triggers a redraw. In this task the animator just **snaps** to target — bloom, fade, and camera lerp come in later tasks. The point of this task is to thread the animator through the app so the next tasks have a place to put their changes.

**Files:**
- Create: `ui/animator.js`
- Modify: `ui/app.js`

- [ ] **Step 1: Create `ui/animator.js`**

Write the file:

```js
// ---------------------------------------------------------------------------
// Animator — per-entity opacity/scale, live camera, rAF tick loop
// ---------------------------------------------------------------------------
//
// The animator is the only stateful piece of the canvas rendering. Every other
// layer is a pure function of the input state. Each rAF tick:
//   1. Read the latest pure render-state (cumulative sets, cameraTarget).
//   2. Update per-entity opacity/scale (snap for now; bloom/fade later).
//   3. Update the live camera (snap for now; lerp later).
//   4. Return whether anything is still animating, so app.js can stop the
//      loop when everything has settled.

export function createAnimator() {
  const entityStates = new Map(); // id -> { opacity, scale, blooming, fading, animStart }
  let prevConceptSet = null;
  let prevClusterSet = null;
  let prevEdgeSet = null;

  function getEntityState(id) {
    let s = entityStates.get(id);
    if (!s) {
      s = { opacity: 1, scale: 1, blooming: false, fading: false, animStart: 0 };
      entityStates.set(id, s);
    }
    return s;
  }

  function step(now, opts) {
    const {
      cumulativeVisibleConceptIds = [],
      cumulativeVisibleClusterIds = [],
      cumulativeVisibleEdgeIds = [],
      cameraTarget,
      cameraMode,
      camera,
    } = opts;

    const conceptSet = new Set(cumulativeVisibleConceptIds);
    const clusterSet = new Set(cumulativeVisibleClusterIds);
    const edgeSet = new Set(cumulativeVisibleEdgeIds);

    const isFirstStep = prevConceptSet === null;
    if (isFirstStep) {
      // On first tick, treat current visible set as already-resting state.
      for (const id of conceptSet) {
        const s = getEntityState(id);
        s.opacity = 1;
        s.scale = 1;
      }
    }
    prevConceptSet = conceptSet;
    prevClusterSet = clusterSet;
    prevEdgeSet = edgeSet;

    // Snap visible entities to opacity 1 / scale 1; hidden entities to opacity 0.
    // (Bloom and fade transitions come in later tasks.)
    for (const id of conceptSet) {
      const s = getEntityState(id);
      s.opacity = 1;
      s.scale = 1;
    }
    for (const [id, s] of entityStates) {
      if (!conceptSet.has(id) && !clusterSet.has(id) && !edgeSet.has(id)) {
        s.opacity = 0;
      }
    }

    // Camera snap (lerp comes later).
    if (cameraTarget && cameraMode === 'auto') {
      // No-op for now; camera stays where bootstrap put it.
    }

    return false; // never "still animating" until later tasks add real interp
  }

  return {
    step,
    getEntityState,
    isVisible(id) {
      return (entityStates.get(id)?.opacity ?? 0) > 0.001;
    },
  };
}
```

- [ ] **Step 2: Wire the animator into `ui/app.js`**

In `ui/app.js`, import the animator at the top of the imports block:

```js
import { createAnimator } from './animator.js';
```

In the `state` object literal, replace the `drawScheduled: false,` line with:

```js
  cameraMode: 'auto',
  animator: undefined,
  animationLoopActive: false,
};
```

(The previous line — `drawScheduled: false` — is being replaced. The old `scheduleDraw` debouncer is replaced by the rAF loop in this task.)

In `bootstrap()`, just before `render();`, insert:

```js
  state.animator = createAnimator();
```

- [ ] **Step 3: Replace `scheduleDraw` with `kickAnimationLoop`**

Find the existing `scheduleDraw` and `drawAll` functions (around line 92 of `ui/app.js`):

```js
function scheduleDraw() {
  if (state.drawScheduled) return;
  state.drawScheduled = true;
  requestAnimationFrame(() => {
    state.drawScheduled = false;
    drawAll();
  });
}

function drawAll() {
  draw(ctx, state);
}
```

Replace both with:

```js
function kickAnimationLoop() {
  if (state.animationLoopActive) return;
  state.animationLoopActive = true;
  let lastT = performance.now();
  function tick(now) {
    const dt = Math.min(0.1, (now - lastT) / 1000);
    lastT = now;
    const stillAnimating = state.animator.step(now / 1000, {
      cumulativeVisibleConceptIds: state.graphRenderState?.cumulativeVisibleConceptIds ?? [],
      cumulativeVisibleClusterIds: state.graphRenderState?.cumulativeVisibleClusterIds ?? [],
      cumulativeVisibleEdgeIds: state.graphRenderState?.cumulativeVisibleEdgeIds ?? [],
      cameraTarget: state.graphRenderState?.cameraTarget,
      cameraMode: state.cameraMode,
      camera: state.camera,
      activeLevel: state.activeLevel,
      dt,
    });
    draw(ctx, state);
    if (stillAnimating) {
      requestAnimationFrame(tick);
    } else {
      state.animationLoopActive = false;
    }
  }
  requestAnimationFrame(tick);
}

// Backwards-compat shim during transition: any callsite that still calls
// scheduleDraw() should now kick the animation loop. After all callsites
// are updated to call render() (which kicks the loop), this can be removed.
function scheduleDraw() {
  kickAnimationLoop();
}
```

- [ ] **Step 4: Make `render()` kick the loop**

In the existing `render()` function in `ui/app.js`:

```js
function render() {
  if (!state.viewModel) return;
  state.graphRenderState = computeGraphRenderState();
  updateTopbar();
  updateInspectorPanel();
  updateTimelinePanel();
  scheduleDraw();             // <-- replace this line
  bindEvents(state, render, scheduleDraw);
}
```

becomes:

```js
function render() {
  if (!state.viewModel) return;
  state.graphRenderState = computeGraphRenderState();
  updateTopbar();
  updateInspectorPanel();
  updateTimelinePanel();
  kickAnimationLoop();
  bindEvents(state, render, kickAnimationLoop);
}
```

`bindEvents` still receives a "schedule a redraw" callback as its 3rd arg, but now that callback kicks the rAF loop instead of debouncing.

- [ ] **Step 5: Verify in browser**

Visit `http://127.0.0.1:4173/`. Reload. Expected:

- The graph renders the same as before Task 4 (since the animator is in snap-only mode).
- Console should show no errors.
- Drag the canvas — graph still pans, redraw happens.
- Drag the playhead scrubber — graph updates, hidden clusters remain hidden.

If the canvas freezes after the first frame, check that `kickAnimationLoop` is being called by `render()` and that the `tick` closure doesn't return early on the first frame.

- [ ] **Step 6: Commit**

```bash
git add ui/animator.js ui/app.js
git commit -m "feat(ui): add animator module and rAF tick loop scaffolding" -m "$(cat <<'EOF'
ui/animator.js owns per-entity opacity/scale and is wired into app.js
through a kickAnimationLoop tick that runs while anything is animating
and stops when the animator reports settled. State gains cameraMode,
animator, animationLoopActive. Behaviour is unchanged because the
animator currently snaps to target — bloom, fade, and camera lerp
come in subsequent tasks.
EOF
)"
```

---

## Task 5: Bloom on visibility entry

Concepts that newly enter the cumulative visible set play a bloom keyframe (opacity 0→1, scale 1.6→1.0, color ~10 % brighter, easeOutCubic, 600 ms). Initial-load is **not** a transition — concepts already visible at startup do not bloom.

**Files:**
- Modify: `ui/animator.js`
- Modify: `ui/draw.js`

- [ ] **Step 1: Add easing helper to `ui/animator.js`**

Above `export function createAnimator()`, add:

```js
function easeOutCubic(t) {
  const x = Math.max(0, Math.min(1, t));
  return 1 - Math.pow(1 - x, 3);
}

const BLOOM_DURATION_MS = 600;
```

- [ ] **Step 2: Replace the snap loop in `step` with a bloom-aware loop**

In `ui/animator.js`, inside `step()`, replace the body that follows the `prevConceptSet` initialisation with:

```js
    const isFirstStep = prevConceptSet === null;

    // Detect transitions on every step except the very first. On first
    // step, just record the current sets as "already resting".
    if (isFirstStep) {
      for (const id of conceptSet) {
        const s = getEntityState(id);
        s.opacity = 1;
        s.scale = 1;
      }
      for (const id of clusterSet) {
        const s = getEntityState(id);
        s.opacity = 1;
        s.scale = 1;
      }
      for (const id of edgeSet) {
        const s = getEntityState(id);
        s.opacity = 1;
        s.scale = 1;
      }
    } else {
      // Newly entering ids → schedule a bloom.
      for (const id of conceptSet) if (!prevConceptSet.has(id)) startBloom(id, now);
      for (const id of clusterSet) if (!prevClusterSet.has(id)) startBloom(id, now);
      for (const id of edgeSet) if (!prevEdgeSet.has(id)) startBloom(id, now);
    }
    prevConceptSet = conceptSet;
    prevClusterSet = clusterSet;
    prevEdgeSet = edgeSet;

    // Advance bloom for any blooming entity.
    let stillAnimating = false;
    for (const [, s] of entityStates) {
      if (s.blooming) {
        const t = (now - s.animStart) * 1000 / BLOOM_DURATION_MS;
        if (t >= 1) {
          s.opacity = 1;
          s.scale = 1;
          s.blooming = false;
        } else {
          const e = easeOutCubic(t);
          s.opacity = e;
          s.scale = 1.6 - 0.6 * e;
          stillAnimating = true;
        }
      }
    }
```

And add the `startBloom` helper inside `createAnimator`, right after `getEntityState`:

```js
  function startBloom(id, now) {
    const s = getEntityState(id);
    s.blooming = true;
    s.fading = false;
    s.animStart = now;
    s.opacity = 0;
    s.scale = 1.6;
  }
```

Replace `return false;` at the end of `step()` with `return stillAnimating;`.

- [ ] **Step 3: Have `draw.js` multiply animator opacity/scale into existing draw**

Open `ui/draw.js`. Change `draw(ctx, state)` to pass the animator into each helper:

```js
export function draw(ctx, state) {
  const { viewModel: vm, layout, graphRenderState: grs, viewport, animator } = state;
  // ...existing setTransform / drawBackground...

  drawClusterBodies(ctx, layout, grs, animator);
  drawEdges(ctx, vm, layout, grs, animator);
  drawAtomicNodes(ctx, vm, layout, grs, animator);
  drawClusterLabels(ctx, layout, grs, animator);
  drawAtomicLabels(ctx, vm, layout, grs, animator);
  // ...existing restore...
}
```

In `drawClusterBodies(ctx, layout, grs, animator)`, multiply alpha by the animator's per-entity opacity:

```js
function drawClusterBodies(ctx, layout, grs, animator) {
  const dimmedRegions = new Set(grs?.dimmedRegionIds ?? []);
  const emphasisByRegion = grs?.regionEmphasis ?? {};
  const visibleClusters = new Set(grs?.cumulativeVisibleClusterIds ?? []);
  for (const cluster of layout.clusters) {
    if (!visibleClusters.has(cluster.id)) continue;
    const animOpacity = animator?.getEntityState(cluster.id)?.opacity ?? 1;
    if (animOpacity <= 0.001) continue;
    const animScale = animator?.getEntityState(cluster.id)?.scale ?? 1;
    const emphasis = emphasisByRegion[cluster.id] ?? 0.35;
    const isDimmed = dimmedRegions.has(cluster.id);
    const fillAlpha = (isDimmed ? 0.06 : 0.10 + emphasis * 0.14) * animOpacity;
    const strokeAlpha = (isDimmed ? 0.16 : 0.28 + emphasis * 0.22) * animOpacity;

    ctx.beginPath();
    ctx.fillStyle = hexToRgba(cluster.color, fillAlpha);
    ctx.strokeStyle = hexToRgba(cluster.color, strokeAlpha);
    ctx.lineWidth = 1.2;
    ctx.arc(cluster.x, cluster.y, cluster.radius * animScale, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();

    ctx.beginPath();
    ctx.strokeStyle = `rgba(255, 255, 255, ${0.04 * animOpacity})`;
    ctx.arc(cluster.x, cluster.y, (cluster.radius - 7) * animScale, 0, Math.PI * 2);
    ctx.stroke();
  }
}
```

In `drawAtomicNodes(ctx, vm, layout, grs, animator)`, do the same multiplication on `globalAlpha` and on the radius:

```js
function drawAtomicNodes(ctx, vm, layout, grs, animator) {
  const visible = new Set(grs?.visibleNodeIds ?? vm.graph.nodes.map((n) => n.id));
  const active = new Set(grs?.activeNodeIds ?? []);
  const dimmed = new Set(grs?.dimmedNodeIds ?? []);
  const selected = new Set(grs?.selectedNodeIds ?? []);

  for (const node of vm.graph.nodes) {
    if (node.level === 'clustered') continue;
    if (!visible.has(node.id)) continue;
    const pos = layout.nodes[node.id];
    if (!pos) continue;
    const animOpacity = animator?.getEntityState(node.id)?.opacity ?? 1;
    if (animOpacity <= 0.001) continue;
    const animScale = animator?.getEntityState(node.id)?.scale ?? 1;
    const radius = (3.2 + (node.visualWeight ?? 0.5) * 1.8) * animScale;
    const isActive = active.has(node.id);
    const isDimmed = dimmed.has(node.id);
    const isSelected = selected.has(node.id);

    ctx.beginPath();
    ctx.fillStyle = isActive ? '#f4cf86' : '#b8a07a';
    ctx.globalAlpha = (isSelected ? 1 : isActive ? 0.94 : isDimmed ? 0.28 : 0.7) * animOpacity;
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

In `drawEdges(ctx, vm, layout, grs, animator)`, multiply the `strokeStyle`'s alpha (already an `rgba(...)` string in current code) — easiest is to wrap the existing assignment:

```js
function drawEdges(ctx, vm, layout, grs, animator) {
  const visible = grs?.visibleEdgeIds ? new Set(grs.visibleEdgeIds) : null;
  const activeEdge = new Set(grs?.activeEdgeIds ?? []);
  const activeNode = new Set(grs?.activeNodeIds ?? []);
  const selectedNode = new Set(grs?.selectedNodeIds ?? []);

  ctx.lineCap = 'round';
  for (const edge of vm.graph.edges) {
    if (visible && !visible.has(edge.id)) continue;
    const animOpacity = animator?.getEntityState(edge.id)?.opacity ?? 1;
    if (animOpacity <= 0.001) continue;
    // ...existing dx/dy/curve computation unchanged...
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
    const baseAlpha = touchesSelection || isActive ? 0.95 : sameCluster ? 0.30 : 0.22;
    const baseColor = touchesSelection || isActive
      ? `rgba(218, 184, 116, ${baseAlpha * animOpacity})`
      : sameCluster
        ? `rgba(212, 188, 135, ${baseAlpha * animOpacity})`
        : `rgba(143, 183, 199, ${baseAlpha * animOpacity})`;
    ctx.strokeStyle = baseColor;
    ctx.lineWidth = touchesSelection ? 2 : isActive ? 1.4 : 0.85;
    ctx.stroke();
  }
}
```

Apply the same animator-opacity pattern to the two label functions. Replace `drawClusterLabels`:

```js
function drawClusterLabels(ctx, layout, grs, animator) {
  const visibleClusters = new Set(grs?.cumulativeVisibleClusterIds ?? []);
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.font = "500 18px 'Inter', system-ui, sans-serif";
  for (const cluster of layout.clusters) {
    if (!visibleClusters.has(cluster.id)) continue;
    const animOpacity = animator?.getEntityState(cluster.id)?.opacity ?? 1;
    if (animOpacity <= 0.001) continue;
    ctx.fillStyle = `rgba(245, 234, 210, ${0.92 * animOpacity})`;
    const lines = wrapLabel(cluster.label, 2);
    const lineHeight = 22;
    const top = -((lines.length - 1) * lineHeight) / 2;
    lines.forEach((line, i) => {
      ctx.fillText(line, cluster.x, cluster.y + top + i * lineHeight);
    });
  }
}
```

And replace `drawAtomicLabels`:

```js
function drawAtomicLabels(ctx, vm, layout, grs, animator) {
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
    const animOpacity = animator?.getEntityState(node.id)?.opacity ?? 1;
    if (animOpacity <= 0.001) continue;
    const isActive = active.has(node.id);
    const isDimmed = dimmed.has(node.id);
    const baseAlpha = isDimmed ? 0.34 : isActive ? 0.92 : 0.7;
    ctx.fillStyle = `rgba(234, 227, 213, ${baseAlpha * animOpacity})`;
    ctx.fillText(node.label, pos.x, pos.y - 8);
  }
}
```

- [ ] **Step 4: Verify bloom in browser**

Reload `http://127.0.0.1:4173/`. Expected:

- At t=0, seed concept (Meaning in Life + Cultural Convergences cluster) renders at full opacity, no bloom (initial load is not a transition).
- Press Play. As the playhead advances past ~50 s, the next concepts (Buddhism, Cognitive Science, Mindfulness Revolution) should each visibly bloom in (briefly larger and brighter, then settle).
- Pause and drag the scrubber from 0 → 600 s in one motion. The concepts that crossed the threshold should each bloom once.
- The graph should not feel jittery during steady playback.

If concepts pop in instantly without a scale/opacity ramp, check that `step()` correctly distinguishes "first step" from later transitions, and that draw is multiplying `animOpacity` and `animScale` into its calculations.

- [ ] **Step 5: Commit**

```bash
git add ui/animator.js ui/draw.js
git commit -m "feat(ui): bloom concepts on first appearance" -m "$(cat <<'EOF'
The animator now schedules a bloom keyframe (opacity 0→1, scale 1.6→1.0,
easeOutCubic, 600ms) when an id newly enters the cumulative visibility
set. Initial load is treated as not-a-transition: entities already
visible at startup render at rest with no bloom. draw.js multiplies the
animator's per-entity opacity and scale into its existing alpha and
radius calculations so the bloom is visible.
EOF
)"
```

---

## Task 6: Reverse fade on visibility exit

When the user scrubs back so a concept's `firstSeenAt` is now in the future, ramp opacity to 0 over **200 ms** and stop drawing it once it has faded. Scrubbing forward past the threshold again triggers a fresh bloom (Task 5 already handles the entry side).

**Files:**
- Modify: `ui/animator.js`

- [ ] **Step 1: Add fade-duration constant**

Near the top of `ui/animator.js`:

```js
const FADE_DURATION_MS = 200;
```

- [ ] **Step 2: Detect newly-removed ids and start a fade**

Inside `createAnimator`, add a `startFade` helper next to `startBloom`:

```js
  function startFade(id, now) {
    const s = getEntityState(id);
    if (s.opacity <= 0.001) return; // already invisible
    s.fading = true;
    s.blooming = false;
    s.animStart = now;
    s.scale = 1;
  }
```

In `step()`, in the non-first-step branch (right after the `for (const id of conceptSet) if (!prevConceptSet.has(id)) startBloom(id, now);` block), add the symmetric "leaving" detection:

```js
    } else {
      // Newly entering → bloom.
      for (const id of conceptSet) if (!prevConceptSet.has(id)) startBloom(id, now);
      for (const id of clusterSet) if (!prevClusterSet.has(id)) startBloom(id, now);
      for (const id of edgeSet) if (!prevEdgeSet.has(id)) startBloom(id, now);

      // Newly leaving → fade.
      for (const id of prevConceptSet) if (!conceptSet.has(id)) startFade(id, now);
      for (const id of prevClusterSet) if (!clusterSet.has(id)) startFade(id, now);
      for (const id of prevEdgeSet) if (!edgeSet.has(id)) startFade(id, now);
    }
```

- [ ] **Step 3: Advance fade in the per-entity tick loop**

Inside the `for (const [, s] of entityStates)` loop in `step()`, just after the `if (s.blooming) { ... }` block, add:

```js
      else if (s.fading) {
        const t = (now - s.animStart) * 1000 / FADE_DURATION_MS;
        if (t >= 1) {
          s.opacity = 0;
          s.fading = false;
        } else {
          s.opacity = 1 - t;
          stillAnimating = true;
        }
      }
```

- [ ] **Step 4: Verify in browser**

Reload `http://127.0.0.1:4173/`. Expected:

- Drag the scrubber forward to ~5 minutes. Multiple concepts should be visible.
- Drag the scrubber back to 0. The newly-introduced concepts should fade out (200 ms each — feels quicker than the bloom).
- Drag forward again past their `firstSeenAt` — they bloom in fresh.
- Steady forward playback shouldn't trigger any fades (concepts only enter, never leave).

If a concept disappears instantly without fading, check that `startFade` is called for ids in `prevConceptSet` but not in the new set, and that the per-entity loop applies the fade.

- [ ] **Step 5: Commit**

```bash
git add ui/animator.js
git commit -m "feat(ui): fade concepts on reverse scrub" -m "$(cat <<'EOF'
When an id leaves the cumulative visibility set (e.g., user drags the
playhead back past its firstSeenAt), the animator ramps opacity to 0
over 200ms. Reverse motion is faster than forward bloom so the user
feels in control of time. Re-entry triggers a fresh bloom.
EOF
)"
```

---

## Task 7: Camera lerp toward `cameraTarget` (auto + selection modes)

Make the live camera glide toward `graphRenderState.cameraTarget` when `cameraMode === 'auto'` or `'selection'`. Use exponential damping (target-tracking, handles target changes mid-lerp) with a time constant ≈ 0.23 s — full convergence in ~700 ms.

**Files:**
- Modify: `ui/animator.js`
- Modify: `ui/camera.js` (add a target-applying helper)

- [ ] **Step 1: Add a camera time constant to `ui/animator.js`**

Near the easing constants:

```js
const CAMERA_TIME_CONSTANT_S = 0.23; // ~700ms full convergence
```

- [ ] **Step 2: Lerp the camera each step when mode is auto or selection**

Inside `step()`, **after the per-entity bloom/fade loop** (the loop that ends with the `else if (s.fading)` block from Task 6) and **before** `return stillAnimating;`, add the camera lerp block:

```js
    if (cameraTarget && (cameraMode === 'auto' || cameraMode === 'selection')) {
      // Convert target into screen-space pan+zoom for comparison.
      const targetZoom = cameraTarget.zoom;
      const targetPanX = (opts.viewport?.width ?? 0) / 2 - cameraTarget.cx * targetZoom;
      const targetPanY = (opts.viewport?.height ?? 0) / 2 - cameraTarget.cy * targetZoom;

      // Exponential damping: live = live + (target - live) * (1 - exp(-dt/τ))
      const factor = 1 - Math.exp(-(opts.dt ?? 0) / CAMERA_TIME_CONSTANT_S);
      camera.zoom += (targetZoom - camera.zoom) * factor;
      camera.pan.x += (targetPanX - camera.pan.x) * factor;
      camera.pan.y += (targetPanY - camera.pan.y) * factor;

      // Settle check: if very close, snap and treat as not animating; otherwise mark active.
      const dz = Math.abs(targetZoom - camera.zoom);
      const dx = Math.abs(targetPanX - camera.pan.x);
      const dy = Math.abs(targetPanY - camera.pan.y);
      if (dz > 0.0005 || dx > 0.5 || dy > 0.5) stillAnimating = true;
      else {
        camera.zoom = targetZoom;
        camera.pan.x = targetPanX;
        camera.pan.y = targetPanY;
      }
    }
```

`opts.dt` is already passed in from `app.js` via `kickAnimationLoop` (Task 4 step 3). `opts.viewport` is added in Step 3 below.

- [ ] **Step 3: Pass `viewport` from `app.js` into `step`**

In `ui/app.js`, in `kickAnimationLoop`, the `state.animator.step(...)` call should already include `cameraTarget`, `cameraMode`, `camera`, `dt`. Add `viewport`:

```js
    const stillAnimating = state.animator.step(now / 1000, {
      cumulativeVisibleConceptIds: state.graphRenderState?.cumulativeVisibleConceptIds ?? [],
      cumulativeVisibleClusterIds: state.graphRenderState?.cumulativeVisibleClusterIds ?? [],
      cumulativeVisibleEdgeIds: state.graphRenderState?.cumulativeVisibleEdgeIds ?? [],
      cameraTarget: state.graphRenderState?.cameraTarget,
      cameraMode: state.cameraMode,
      camera: state.camera,
      viewport: state.viewport,
      activeLevel: state.activeLevel,
      dt,
    });
```

- [ ] **Step 4: Verify camera follows in browser**

Reload `http://127.0.0.1:4173/`. Expected:

- At t=0, camera fits to the seed concept's cluster (Cultural Convergences).
- Press Play. As the lecture moves between cluster regions (visible by the active emphasis on different clusters), the camera should glide between them smoothly.
- Drag the scrubber to a different time (e.g., 30:00) — camera should lerp to the new focus over ~700 ms.
- Switch the level toggle to **macro**, **meso**, **micro** — at macro, the camera mostly stays in one region per chapter; at meso it moves more often; at micro it might whip around (smoothing comes in Task 10).

If the camera doesn't move at all, check that `cameraMode` defaults to `'auto'` (set in Task 4) and that the rAF loop's `stillAnimating` returns `true` while the camera is moving.

- [ ] **Step 5: Commit**

```bash
git add ui/animator.js ui/app.js
git commit -m "feat(ui): camera lerps toward derived target in auto mode" -m "$(cat <<'EOF'
Animator now exponentially damps the live camera toward
graphRenderState.cameraTarget when cameraMode is 'auto' or 'selection'.
Time constant 0.23s (~700ms full convergence). Adds applyCameraTarget
helper to camera.js for snap-style use, and threads viewport through
to the animator step call. Camera follows the active frame's
foreground concepts as the playhead moves.
EOF
)"
```

---

## Task 8: Camera mode transitions (manual / selection / auto)

Wire `cameraMode` transitions into events:

- Drag canvas / wheel → `manual`.
- Click concept on canvas → `selection`.
- Click empty canvas while `selection` → `auto`.
- Press Reset → `auto` and clear selection.
- Press Play while `manual` → `auto`.

**Files:**
- Modify: `ui/events.js`

- [ ] **Step 1: Set `manual` on drag and wheel**

In `ui/events.js`, inside the canvas wheel handler, add `state.cameraMode = 'manual';` before the zoom call:

```js
    canvasEl.addEventListener('wheel', (e) => {
      e.preventDefault();
      const rect = canvasEl.getBoundingClientRect();
      const point = { x: e.clientX - rect.left, y: e.clientY - rect.top };
      const factor = Math.exp(-e.deltaY * 0.0015);
      state.cameraMode = 'manual';
      zoomAround(state.camera, point, factor);
      render();
    }, { passive: false });
```

In the `pointerdown` → drag handler, set `manual` only when the pointer actually moves more than the click threshold (otherwise a click-without-drag should not flip to manual). Modify the existing `pointermove` handler to switch on first significant motion:

```js
    let dragging = false;
    let lastX = 0;
    let lastY = 0;
    let downStartX = 0;
    let downStartY = 0;
    let dragSwitched = false;
    canvasEl.addEventListener('pointerdown', (e) => {
      dragging = true;
      lastX = e.clientX;
      lastY = e.clientY;
      downStartX = e.clientX;
      downStartY = e.clientY;
      dragSwitched = false;
      canvasEl.setPointerCapture(e.pointerId);
      canvasEl.style.cursor = 'grabbing';
    });
    canvasEl.addEventListener('pointermove', (e) => {
      if (!dragging) return;
      if (!dragSwitched) {
        const moved = Math.hypot(e.clientX - downStartX, e.clientY - downStartY);
        if (moved > 4) {
          state.cameraMode = 'manual';
          dragSwitched = true;
        }
      }
      state.camera.pan.x += e.clientX - lastX;
      state.camera.pan.y += e.clientY - lastY;
      lastX = e.clientX;
      lastY = e.clientY;
      scheduleDraw();
    });
```

- [ ] **Step 2: Click concept → selection; click empty → auto if selection**

In the canvas click handler (already exists for hit-test), change:

```js
      if (hit) {
        state.selectedConceptId = hit.id;
        state.selectedFrameRef = undefined;
      } else {
        state.selectedConceptId = undefined;
        state.selectedFrameRef = undefined;
      }
```

to:

```js
      if (hit) {
        state.selectedConceptId = hit.id;
        state.selectedFrameRef = undefined;
        state.cameraMode = 'selection';
      } else {
        state.selectedConceptId = undefined;
        state.selectedFrameRef = undefined;
        if (state.cameraMode === 'selection') state.cameraMode = 'auto';
      }
```

- [ ] **Step 3: Frame click in timeline → selection**

In the existing frame-select handler in `ui/events.js`:

```js
  document.querySelectorAll('[data-action="select-frame"]').forEach((btn) => {
    btn.addEventListener('click', () => {
      state.selectedFrameRef = { level: btn.dataset.level, index: Number(btn.dataset.index) };
      state.selectedConceptId = undefined;
      const frame = state.viewModel.selectors.getFrame(state.selectedFrameRef);
      if (frame) state.playheadTime = frame.span.start;
      render();
    });
  });
```

add the camera-mode line:

```js
  document.querySelectorAll('[data-action="select-frame"]').forEach((btn) => {
    btn.addEventListener('click', () => {
      state.selectedFrameRef = { level: btn.dataset.level, index: Number(btn.dataset.index) };
      state.selectedConceptId = undefined;
      state.cameraMode = 'selection';
      const frame = state.viewModel.selectors.getFrame(state.selectedFrameRef);
      if (frame) state.playheadTime = frame.span.start;
      render();
    });
  });
```

- [ ] **Step 4: Reset / Fit toolbar buttons**

In the toolbar wire-up, change:

```js
    document.querySelector('[data-action="fit"]')?.addEventListener('click', () => {
      fitCameraToLayout(state.camera, state.layout, state.viewport);
      render();
    });
    document.querySelector('[data-action="reset-camera"]')?.addEventListener('click', () => {
      state.selectedConceptId = undefined;
      state.selectedFrameRef = undefined;
      fitCameraToLayout(state.camera, state.layout, state.viewport);
      render();
    });
```

to:

```js
    document.querySelector('[data-action="fit"]')?.addEventListener('click', () => {
      // Fit is a one-shot manual override — let the user inspect the whole layout.
      state.cameraMode = 'manual';
      fitCameraToLayout(state.camera, state.layout, state.viewport);
      render();
    });
    document.querySelector('[data-action="reset-camera"]')?.addEventListener('click', () => {
      state.selectedConceptId = undefined;
      state.selectedFrameRef = undefined;
      state.cameraMode = 'auto';
      render();
    });
```

Note: Reset no longer calls `fitCameraToLayout` — the animator will lerp to the derived target as soon as `cameraMode = 'auto'`.

- [ ] **Step 5: Press Play while `manual` → switch to `auto`**

In the `togglePlayback`/`startPlayback` path (in `ui/events.js`), at the very top of `startPlayback(state, render)`:

```js
export function startPlayback(state, render) {
  if (state.isPlaying) return;
  if (state.cameraMode === 'manual') state.cameraMode = 'auto';
  // ...rest unchanged
```

- [ ] **Step 6: Verify camera modes in browser**

Reload `http://127.0.0.1:4173/`. Expected:

- Press Play → camera follows the playhead automatically.
- Drag the canvas during playback → camera stops following (cursor changes to grabbing, then on release the camera stays where you left it).
- Press **Reset** → camera resumes following (lerps back to the derived target).
- Click a concept on canvas → camera lerps to its parent cluster, stays there even as playhead moves.
- Click a frame segment in the timeline track → playhead jumps to its start, camera lerps to fit the frame's foreground concepts, frame inspector opens.
- Click empty canvas → selection clears, camera resumes following.
- Drag canvas (no movement, just pointer down/up) → should NOT flip to manual (only motion > 4 px does).

If pressing Reset doesn't move the camera, check that `cameraMode = 'auto'` is set and that `cameraTarget` is non-undefined (Task 3).

- [ ] **Step 7: Commit**

```bash
git add ui/events.js
git commit -m "feat(ui): cameraMode transitions for manual / selection / auto" -m "$(cat <<'EOF'
Wires the cameraMode state transitions per spec: drag or wheel switches
to 'manual', clicking a concept switches to 'selection', clicking empty
canvas while in 'selection' returns to 'auto', Reset clears selection
and switches to 'auto' (camera lerps back to derived target), and
pressing Play from 'manual' switches back to 'auto' so playback drives
the camera. Drag-to-manual triggers only after the pointer moves more
than 4 px — a plain click does not promote.
EOF
)"
```

---

## Task 9: Inspector concept link auto-advance

When the user clicks a related concept in the inspector and that concept has not yet been introduced (`firstSeenAt > playheadTime`), advance the playhead to the concept's `firstSeenAt` so the cumulative reveal "catches up" before showing the concept.

**Files:**
- Modify: `ui/events.js`

- [ ] **Step 1: Add the auto-advance branch**

In `ui/events.js`, find the inspector concept-select handler:

```js
  document.querySelectorAll('[data-action="select-concept"]').forEach((btn) => {
    btn.addEventListener('click', () => {
      state.selectedConceptId = btn.dataset.conceptId;
      state.selectedFrameRef = undefined;
      render();
    });
  });
```

Replace with:

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

The animator's bloom logic (Task 5) will handle the visible reveal of any concepts whose `firstSeenAt` was crossed by the time jump.

- [ ] **Step 2: Verify in browser**

Reload `http://127.0.0.1:4173/`. With the inspector showing the live overview, drag the playhead to ~30 s. Expected concepts active. Then:

- In the inspector, find a concept whose `firstSeenAt` is later (e.g., scroll Active Concepts and pick one not currently visible).
- A simpler way: at t = 0, click the **Cultural Convergences** cluster body to open its concept inspector. Inside, click a related concept link.
- The playhead should jump forward to that concept's `firstSeenAt`.
- The graph should bloom in the missing concepts as the time gap is crossed (instant snap, since the bloom only triggers on entry — but the visible end-state should match the new playhead).

If the click does nothing, check that `data-action="select-concept"` buttons have the `data-concept-id` attribute and that the auto-advance only triggers when `firstSeen > state.playheadTime`.

- [ ] **Step 3: Commit**

```bash
git add ui/events.js
git commit -m "feat(ui): auto-advance playhead when selecting unseen concept" -m "$(cat <<'EOF'
When a user clicks a concept link in the inspector and that concept's
firstSeenAt is in the future relative to the current playhead, the
playhead jumps to firstSeenAt before applying the selection. This
bridges 'I want to see this' with 'this hasn't shown up yet' without
requiring the user to scrub manually. Cumulative reveal catches up via
the existing bloom path.
EOF
)"
```

---

## Task 10: Micro-level camera smoothing (5-frame moving average)

At `activeLevel === 'micro'`, micro frames are ~4 s long and the camera target jumps every few seconds. Apply a moving average over the last 5 raw `cameraTarget`s when on micro so the camera doesn't whip around.

**Files:**
- Modify: `ui/animator.js`

- [ ] **Step 1: Add a small ring buffer for raw targets**

In `createAnimator` near the other state declarations:

```js
  const microSmoothBuffer = []; // array of recent { cx, cy, zoom } at micro level
  const MICRO_SMOOTH_SIZE = 5;
```

- [ ] **Step 2: Maintain the buffer and use a smoothed target on micro**

In `step()`, **replace the entire camera lerp block** (the one Task 7 added that begins with `if (cameraTarget && (cameraMode === 'auto' || cameraMode === 'selection')) {`) with this version, which adds the smoothing pass in front and uses `effectiveTarget` everywhere:

```js
    let effectiveTarget = cameraTarget;
    if (effectiveTarget) {
      if (opts.activeLevel === 'micro') {
        microSmoothBuffer.push({ ...effectiveTarget });
        while (microSmoothBuffer.length > MICRO_SMOOTH_SIZE) microSmoothBuffer.shift();
        let scx = 0, scy = 0, szoom = 0;
        for (const t of microSmoothBuffer) { scx += t.cx; scy += t.cy; szoom += t.zoom; }
        const n = microSmoothBuffer.length;
        effectiveTarget = { cx: scx / n, cy: scy / n, zoom: szoom / n };
      } else if (microSmoothBuffer.length) {
        microSmoothBuffer.length = 0; // clear when leaving micro
      }
    }

    if (effectiveTarget && (cameraMode === 'auto' || cameraMode === 'selection')) {
      const targetZoom = effectiveTarget.zoom;
      const targetPanX = (opts.viewport?.width ?? 0) / 2 - effectiveTarget.cx * targetZoom;
      const targetPanY = (opts.viewport?.height ?? 0) / 2 - effectiveTarget.cy * targetZoom;

      const factor = 1 - Math.exp(-(opts.dt ?? 0) / CAMERA_TIME_CONSTANT_S);
      camera.zoom += (targetZoom - camera.zoom) * factor;
      camera.pan.x += (targetPanX - camera.pan.x) * factor;
      camera.pan.y += (targetPanY - camera.pan.y) * factor;

      const dz = Math.abs(targetZoom - camera.zoom);
      const dx = Math.abs(targetPanX - camera.pan.x);
      const dy = Math.abs(targetPanY - camera.pan.y);
      if (dz > 0.0005 || dx > 0.5 || dy > 0.5) stillAnimating = true;
      else {
        camera.zoom = targetZoom;
        camera.pan.x = targetPanX;
        camera.pan.y = targetPanY;
      }
    }
```

- [ ] **Step 3: Verify on micro level**

Reload `http://127.0.0.1:4173/`. Press Play, then click the **micro** level toggle. Expected:

- Camera continues to follow but feels visibly smoother — no abrupt jumps every few seconds. There's a slight lag (a few seconds) because of the moving average, which is intentional.
- Switch back to **meso** or **macro** — camera responds quickly again.

If micro feels exactly the same as meso (jittery), check that `opts.activeLevel` is being read from the step args and that the buffer is actually being populated.

- [ ] **Step 4: Commit**

```bash
git add ui/animator.js
git commit -m "feat(ui): smooth camera at micro level via 5-frame moving average" -m "$(cat <<'EOF'
At activeLevel === 'micro', the animator averages the last 5 raw
cameraTargets before driving the lerp. Micro frames are ~4s long, so
the camera target would otherwise change every few seconds and feel
whippy. The smoothing introduces a small intentional lag in exchange
for calmness. Buffer is cleared when leaving micro level so meso /
macro stay snappy.
EOF
)"
```

---

## Task 11: Final integration polish

A small clean-up pass: make sure the toolbar's Reset behaviour is sensible at app startup, expose the animator at `window.__mindgraph` while in debug mode for browser inspection, and run the project's smoke test.

**Files:**
- Modify: `ui/app.js`

- [ ] **Step 1: Initial fit on first load uses the same path as Reset**

In `bootstrap()` of `ui/app.js`, replace:

```js
  state.viewport = applyDpr(canvas, ctx);
  fitCameraToLayout(state.camera, state.layout, state.viewport);
  render();
```

with:

```js
  state.viewport = applyDpr(canvas, ctx);
  // Initial fit uses the layout-fitter as a sensible start; the animator
  // will then lerp from there to the cameraTarget on the next frame.
  fitCameraToLayout(state.camera, state.layout, state.viewport);
  state.cameraMode = 'auto';
  render();
```

(`state.cameraMode = 'auto'` is already the default from Task 4 — assert it explicitly here so future refactors don't drift.)

- [ ] **Step 2: Remove or guard any temporary `window.__mindgraph` debug exposure**

If Task 3 left `window.__mindgraph = { state };` in `bootstrap()`, remove it (or guard behind a query string flag if you want to keep it for debugging). It is not part of the v1.5 contract.

- [ ] **Step 3: Run the smoke verification checklist**

Run `npm run ui:check` — should report no syntax errors.

Visit `http://127.0.0.1:4173/` and run through the spec's verification list:

1. Reload at t=0 → see seed concepts (Meaning in Life + Cultural Convergences cluster) at rest, no bloom.
2. Press Play → subsequent concepts bloom in as the playhead advances.
3. Pause and drag the scrubber → concepts appear/disappear as time crosses their `firstSeenAt`.
4. Camera lerps smoothly at meso/macro level; micro should feel smooth (not jittery).
5. Click a concept on canvas → camera lerps to it, selection visual emphasis applies, inspector updates.
6. Click a concept in the inspector that hasn't appeared yet → playhead jumps to its `firstSeenAt`, missing concepts bloom in, camera lerps to it.
7. Drag the canvas while playing → camera stops following.
8. Press Reset → camera resumes following.

Take a Playwright screenshot of (a) t=0 paused, (b) ~30s into playback, (c) after clicking a concept, and add them to the commit message body if useful for review.

- [ ] **Step 4: Commit**

```bash
git add ui/app.js
git commit -m "chore(ui): finalize v1.5 evolving graph integration" -m "$(cat <<'EOF'
Cleanup pass: bootstrap explicitly sets cameraMode='auto' so future
refactors do not drift, and any temporary window.__mindgraph debug hook
is removed. End-to-end smoke verification matches the spec's
verification list (cumulative reveal, bloom, fade, camera follow,
selection lock, inspector auto-advance, micro smoothing).
EOF
)"
```

---

## Self-Review Checklist (before declaring done)

- [ ] Every spec requirement maps to a task. Cross-check `docs/canvas-ui-v1.5-evolving-graph-spec.md`.
- [ ] No file is partially edited and committed in a non-working state — each task's commit produces a runnable UI.
- [ ] No magic numbers without a name — bloom, fade, and camera time constants live near the top of `ui/animator.js`.
- [ ] `ui/animator.js` stays small (target ≤ 180 lines including header comment).
- [ ] No dependency added — `package.json` unchanged through this plan.
- [ ] Out-of-scope items from the spec did not creep in (no spring physics, no typed-edge variants, no topographic backdrop, no hover preview).
- [ ] `npm run ui:check` is clean.
- [ ] `npm run vm:example` runs and shows derived `firstSeenAt` values.

---

## Open Notes for Future Work

These are *not* required by the spec and not in this plan, but landed adjacent and worth a follow-up issue:

- The animator's `entityStates` map only ever grows (no GC of long-faded entries). Acceptable at 70 concepts; revisit if a corpus has thousands.
- During playback, `render()` runs once per rAF tick (in addition to the animator's own tick). DOM panels rebuild every frame — wasteful but correct. v1 already had this, v1.5 doesn't make it worse.
- Bloom is suppressed on the first animator step. If a future spec wants a "ceremonial" bloom at app startup, the rule will need an explicit hook (e.g., a `cameraMode === 'intro'` state).
