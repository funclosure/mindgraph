# Graph Rendering Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the canvas graph renderer with an Obsidian-style force-directed layout and Maps-style screen-space labels, fixing the bug where any document beyond Episode 1 piles every concept into one disk because of hand-placed cluster anchors.

**Architecture:** Three phases, six commits. Each commit is independently revertible. Phase A is plumbing (degree on graph nodes, importance scores). Phase B replaces label rendering with an importance-threshold + collision-avoidance pipeline. Phase C swaps the hardcoded layout for a hand-rolled force simulator and drops the cluster-region-rendering machinery.

**Tech Stack:** Vanilla ES modules, HTML5 Canvas, Node 18+ / Bun. No bundler. No new runtime dependencies — force simulator is hand-rolled (~80 lines).

**Spec:** `docs/superpowers/specs/2026-05-10-graph-rendering-design.md`

**Verification model:** This project has no unit-test framework. Verification per the project's CLAUDE.md:

- VM changes → `npm run vm:example` and inspect output.
- UI changes → `npm run ui:check` (syntax) then `npm run ui:dev` and walk the feature in a browser.
- CLI: `npm run test:smoke:node` should be unaffected; run it after every commit.

---

## File structure

| File | Status | Responsibility |
|---|---|---|
| `src/view-model/buildMindgraphViewModel.js` | Modified (Tasks 1, 2) | Adds `degree` to graph nodes; adds `conceptImportance` map to `viewModel.graph`. |
| `src/view-model/buildGraphRenderState.js` | Modified (Task 2 thin pass-through, Task 6 cleanup) | Re-emits `conceptImportance` so consumers can find it on render state. Drops `labelVisibleNodeIds`, `dimmedRegionIds`, `regionEmphasis`, `cumulativeVisibleClusterIds` once consumers no longer need them. |
| `ui/labels.js` | **Created (Task 3)** | Pure function `computeVisibleLabels`. Owns importance score, zoom threshold, screen-space collision avoidance, alpha curve, selection focus mode. ~120 lines. |
| `ui/draw.js` | Modified (Task 4 labels rewire, Task 6 cluster cleanup) | Drops `drawAtomicLabels`, `drawClusterLabels`, `drawClusterBodies`. Replaces curved edges with straight lines. Calls into `ui/labels.js` for screen-space label drawing. |
| `ui/layout.js` | Replaced (Task 5) | Hand-rolled force simulator. Pure function `computeLayout(viewModel) → { nodes, bounds, clusters }`. No more hardcoded `PROTOTYPE_CLUSTER_LAYOUT`. Adds `clusterColor(id)` deterministic-hash helper. |

Net: ~+15 lines of code, but materially less conceptual surface (no per-doc layout constants, no region-rendering pipeline).

---

## Task 1: Add `degree` to graph nodes in the VM

**Files:**
- Modify: `src/view-model/buildMindgraphViewModel.js` — `buildGraphVM` (lines 220-251)
- Verify: `npm run vm:example`

**Why:** The importance score uses `degree` (number of edges incident on a concept). Compute once per VM build, attach to each node so downstream code reads it without rescanning edges.

- [ ] **Step 1: Read the current `buildGraphVM` function**

Open `src/view-model/buildMindgraphViewModel.js`, find `buildGraphVM` at line 220. Note that `nodes` is built from `[...conceptsVM.clustered, ...conceptsVM.atomic]`, then `nodeById` is built, then `edgesByNodeId` is populated by walking edges. We will add a `degree` field to each node and increment it during the same edge walk.

- [ ] **Step 2: Add `degree: 0` to the node init and an edge-walk increment**

Replace lines 220-251 with:

```javascript
function buildGraphVM(conceptsVM, relationsVM) {
  const nodes = [...conceptsVM.clustered, ...conceptsVM.atomic].map((concept) => ({
    id: concept.id,
    label: concept.label,
    level: concept.level,
    parentIds: concept.parentIds,
    childIds: concept.childIds,
    stats: concept.stats,
    regionKey: concept.level === 'atomic' ? concept.parentIds?.[0] : concept.id,
    visualWeight: concept.stats?.peakActivation ?? 0.5,
    degree: 0,
  }));

  const edges = relationsVM.all.map((relation) => ({
    id: relation.id,
    from: relation.from,
    to: relation.to,
    type: relation.type,
    label: relation.label,
    visualWeight: 0.5,
  }));

  const nodeById = Object.fromEntries(nodes.map((node) => [node.id, node]));
  const edgesByNodeId = {};
  for (const edge of edges) {
    if (nodeById[edge.from]) nodeById[edge.from].degree += 1;
    if (nodeById[edge.to]) nodeById[edge.to].degree += 1;
    if (!edgesByNodeId[edge.from]) edgesByNodeId[edge.from] = [];
    if (!edgesByNodeId[edge.to]) edgesByNodeId[edge.to] = [];
    edgesByNodeId[edge.from].push(edge.id);
    edgesByNodeId[edge.to].push(edge.id);
  }

  return { nodes, edges, nodeById, edgesByNodeId };
}
```

The change merges the existing `edgesByNodeId` walk with the new degree increment so we don't iterate edges twice.

- [ ] **Step 3: Verify with `vm:example`**

Run:

```bash
npm run vm:example
```

Expected: command exits 0. Output is a representative VM slice; you should see graph nodes printed somewhere (depending on `src/view-model/example.js`'s output choices). If it doesn't print `degree`, that's not a failure — `degree` is a new field, just verify nothing else broke.

- [ ] **Step 4: Verify with `npm run ui:check`**

Run:

```bash
npm run ui:check
```

Expected: PASS (no syntax errors).

- [ ] **Step 5: Verify with `test:smoke:node`**

Run:

```bash
npm run test:smoke:node
```

Expected: PASS (CLI is untouched; this is a regression check). After the run, restore canonical samples that smoke deletes:

```bash
git checkout HEAD -- examples/out/episode-1-built.mindgraph.json examples/out/build-sample.mindgraph.json examples/out/awakening.mindgraph.json
trash examples/out/empty.mindgraph.json 2>/dev/null || rm -f examples/out/empty.mindgraph.json
```

- [ ] **Step 6: Commit**

```bash
git add src/view-model/buildMindgraphViewModel.js
git commit -m "$(cat <<'EOF'
feat(view-model): compute graph node degree once per VM build

Adds degree (count of incident edges) to each entry in
viewModel.graph.nodes. Computed during the existing edges→edgesByNodeId
walk so we don't iterate edges twice. Sets the stage for an
importance score that drives the new label policy without rescanning
edges per render.
EOF
)"
```

---

## Task 2: Compute `conceptImportance` and expose it through render state

**Files:**
- Modify: `src/view-model/buildMindgraphViewModel.js` — extend `buildGraphVM`
- Modify: `src/view-model/buildGraphRenderState.js` — pass `conceptImportance` through to the render-state output
- Verify: `npm run vm:example`, `npm run ui:check`

**Why:** Every render needs an importance score per atomic concept to drive the label-visibility threshold. Compute it once per VM (cheap, pure function of the document) and pass through to render state so labels.js can read it.

- [ ] **Step 1: Add `computeConceptImportance` helper at the top of `buildMindgraphViewModel.js`**

Insert after `durationFromSpan` (around line 7), before `normalizeConcept`:

```javascript
function computeConceptImportance(nodes) {
  // Importance score per the design spec:
  //   base(c) = 0.4·degreeFactor + 0.3·peakActivation + 0.3·persistence
  // where degreeFactor is normalised against the max-degree atomic concept,
  // and peakActivation/persistence are read from concept.stats (clamped to
  // [0, 1] in case the stats step hasn't run yet).
  //
  // Returns Record<conceptId, number> where value ∈ [0, 1].
  const importance = {};
  const atomic = nodes.filter((n) => n.level === 'atomic');
  if (!atomic.length) return importance;
  const maxDegree = Math.max(1, ...atomic.map((n) => n.degree ?? 0));
  for (const node of atomic) {
    const degreeFactor = (node.degree ?? 0) / maxDegree;
    const peak = clamp01(node.stats?.peakActivation ?? 0);
    const persistence = clamp01(node.stats?.persistence ?? 0);
    importance[node.id] = 0.4 * degreeFactor + 0.3 * peak + 0.3 * persistence;
  }
  return importance;
}

function clamp01(n) {
  if (typeof n !== 'number' || Number.isNaN(n)) return 0;
  if (n < 0) return 0;
  if (n > 1) return 1;
  return n;
}
```

- [ ] **Step 2: Call it from `buildGraphVM` and expose the result**

Modify `buildGraphVM` (the function from Task 1). At the end, just before the `return { nodes, edges, nodeById, edgesByNodeId };` line, add:

```javascript
  const conceptImportance = computeConceptImportance(nodes);

  return { nodes, edges, nodeById, edgesByNodeId, conceptImportance };
```

So the function tail becomes:

```javascript
  const nodeById = Object.fromEntries(nodes.map((node) => [node.id, node]));
  const edgesByNodeId = {};
  for (const edge of edges) {
    if (nodeById[edge.from]) nodeById[edge.from].degree += 1;
    if (nodeById[edge.to]) nodeById[edge.to].degree += 1;
    if (!edgesByNodeId[edge.from]) edgesByNodeId[edge.from] = [];
    if (!edgesByNodeId[edge.to]) edgesByNodeId[edge.to] = [];
    edgesByNodeId[edge.from].push(edge.id);
    edgesByNodeId[edge.to].push(edge.id);
  }

  const conceptImportance = computeConceptImportance(nodes);

  return { nodes, edges, nodeById, edgesByNodeId, conceptImportance };
}
```

- [ ] **Step 3: Pass `conceptImportance` through the render-state output**

Open `src/view-model/buildGraphRenderState.js`. Find the `return { ... }` block at line 299. Add `conceptImportance` to the returned object — pulled directly from the view model, no recomputation needed:

```javascript
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
    cameraTarget,
    conceptImportance: viewModel.graph.conceptImportance ?? {},
  };
```

The `?? {}` guards against an old VM that didn't have it (defensive — shouldn't happen since this PR adds it, but keeps render state robust).

- [ ] **Step 4: Verify with `vm:example`**

Run:

```bash
npm run vm:example
```

Expected: passes. Output won't necessarily print `conceptImportance` (depends on `example.js`), but no errors.

- [ ] **Step 5: Verify with `ui:check` and `test:smoke:node`**

Run:

```bash
npm run ui:check && npm run test:smoke:node
```

Expected: both PASS. Restore samples after smoke as in Task 1 step 5.

- [ ] **Step 6: Commit**

```bash
git add src/view-model/buildMindgraphViewModel.js src/view-model/buildGraphRenderState.js
git commit -m "$(cat <<'EOF'
feat(view-model): expose conceptImportance for label policy

Adds the precomputed base-importance score per atomic concept to
viewModel.graph.conceptImportance, threaded through render state so
ui/labels.js can find it. Score: 0.4·degreeFactor + 0.3·peakActivation
+ 0.3·persistence, clamped/normalised. Defensive against missing
stats — concepts with no peakActivation or persistence collapse to a
degree-only score.

Pure plumbing: nothing renders differently yet. Sets up the labels
rewrite in the next commit.
EOF
)"
```

---

## Task 3: Create `ui/labels.js` with the full label pipeline

**Files:**
- Create: `ui/labels.js`
- Verify: `npm run ui:check`

**Why:** Concentrate the entire label policy — importance scoring, zoom threshold, screen-space layout, collision avoidance, alpha curve, selection focus mode — in one pure function. `ui/draw.js` only needs to call it and draw what it returns.

- [ ] **Step 1: Create the empty file with module documentation**

Create `ui/labels.js`:

```javascript
// ---------------------------------------------------------------------------
// Labels — importance-driven, zoom-threshold-gated, collision-aware label
// placement in screen space.
//
// Pure function. Inputs: VM, layout, camera, viewport, render state, ctx
// (for measureText), hover/selection. Output: array of resolved labels with
// screen-space x/y/alpha, ready to draw.
//
// See docs/superpowers/specs/2026-05-10-graph-rendering-design.md § "Importance
// score & label collision" for the full rationale.
// ---------------------------------------------------------------------------

const FONT = "11px 'Inter', system-ui, sans-serif";
const LABEL_PADDING_X = 4;   // horizontal hit padding around each rect for collision
const LABEL_PADDING_Y = 2;
const VIEWPORT_PAD = 40;     // skip labels whose dot is more than this many px outside the viewport

export function computeVisibleLabels({
  viewModel,
  layout,
  camera,
  viewport,
  renderState,
  ctx,
  hoveredConceptId,
  selectedConceptId,
}) {
  // Implementation in subsequent steps.
  return [];
}
```

- [ ] **Step 2: Implement the helpers (`worldToScreen`, `dotRadiusFor`, `rectsIntersect`)**

Append to `ui/labels.js`:

```javascript
function worldToScreen(point, camera) {
  return {
    x: point.x * camera.zoom + camera.pan.x,
    y: point.y * camera.zoom + camera.pan.y,
  };
}

function dotRadiusFor(node) {
  // Mirror the formula used by ui/draw.js so labels offset above the dot at
  // the dot's actual screen-space radius (dots themselves render in world
  // space; radius scales with camera zoom).
  return Math.max(2.5, Math.min(6, 2.5 + (node.degree ?? 0) * 0.4));
}

function rectsIntersect(a, b) {
  return !(a.right < b.left || b.right < a.left || a.bottom < b.top || b.bottom < a.top);
}
```

- [ ] **Step 3: Implement `threshold(zoom)` and `alphaFor`**

Append:

```javascript
function threshold(zoom) {
  // Spec: clamp(0.85 − (zoom − 1.0) × 0.20, 0.05, 0.85)
  // zoom 1.0 → 0.85, zoom 2.0 → 0.65, zoom 4.0 → 0.25, zoom ≥ 5 → 0.05
  return Math.max(0.05, Math.min(0.85, 0.85 - (zoom - 1.0) * 0.20));
}

function alphaFor({ importance, zoom, isHovered, isSelected, isActive }) {
  if (isHovered || isSelected) return 1.0;
  const margin = importance - threshold(zoom);
  const base = Math.max(0.4, Math.min(1.0, margin * 4));
  if (isActive) return Math.max(base, 0.92);
  return base;
}
```

- [ ] **Step 4: Implement importance scoring with state boosts**

Append:

```javascript
function importanceFor(node, {
  conceptImportance,
  hoveredConceptId,
  selectedConceptId,
  selectedNeighborIds,
  activeNodeIds,
}) {
  let score = conceptImportance[node.id] ?? 0;
  if (activeNodeIds.has(node.id)) score += 0.6;
  if (selectedConceptId === node.id) score += 0.8;
  else if (selectedNeighborIds.has(node.id)) score += 0.4;
  if (hoveredConceptId === node.id) score += 1.0;
  return score;
}
```

- [ ] **Step 5: Implement the main `computeVisibleLabels` body**

Replace the placeholder body with the real implementation:

```javascript
export function computeVisibleLabels({
  viewModel,
  layout,
  camera,
  viewport,
  renderState,
  ctx,
  hoveredConceptId,
  selectedConceptId,
}) {
  if (!viewModel || !layout || !camera || !viewport || !ctx) return [];

  const conceptImportance = renderState?.conceptImportance ?? viewModel.graph.conceptImportance ?? {};
  const activeNodeIds = new Set(renderState?.activeNodeIds ?? []);
  const cumulative = new Set(renderState?.cumulativeVisibleConceptIds ?? viewModel.graph.nodes.map((n) => n.id));

  // Selection focus mode: if anything is selected, suppress non-neighbor labels entirely.
  const selectedNeighborIds = new Set();
  if (selectedConceptId) {
    const neighbors = viewModel.selectors.getConceptNeighbors(selectedConceptId);
    for (const concept of neighbors) selectedNeighborIds.add(concept.id);
  }
  const focusMode = !!selectedConceptId;

  // Build candidates: all bloomed-in atomic concepts.
  const z = camera.zoom;
  const cutoff = threshold(z);
  ctx.save();
  ctx.font = FONT;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'bottom';

  const candidates = [];
  for (const node of viewModel.graph.nodes) {
    if (node.level !== 'atomic') continue;
    if (!cumulative.has(node.id)) continue;

    const isHovered = hoveredConceptId === node.id;
    const isSelected = selectedConceptId === node.id;
    const isNeighbor = selectedNeighborIds.has(node.id);
    const isActive = activeNodeIds.has(node.id);

    // Selection focus mode: drop everyone who isn't selected/neighbor, regardless of base importance.
    // Hover always survives — you explicitly summoned that label.
    if (focusMode && !isSelected && !isNeighbor && !isHovered) continue;

    const importance = importanceFor(node, {
      conceptImportance,
      hoveredConceptId,
      selectedConceptId,
      selectedNeighborIds,
      activeNodeIds,
    });

    if (importance < cutoff && !isHovered && !isSelected && !isNeighbor) continue;

    candidates.push({ node, importance, isHovered, isSelected, isActive });
  }

  candidates.sort((a, b) => b.importance - a.importance);

  // Greedy placement in screen space with collision check.
  const placed = [];
  for (const cand of candidates) {
    const worldPos = layout.nodes[cand.node.id];
    if (!worldPos) continue;
    const screenPos = worldToScreen(worldPos, camera);

    // Off-viewport (with padding): skip — never draw a label the user can't see.
    if (
      screenPos.x < -VIEWPORT_PAD ||
      screenPos.x > viewport.width + VIEWPORT_PAD ||
      screenPos.y < -VIEWPORT_PAD ||
      screenPos.y > viewport.height + VIEWPORT_PAD
    ) continue;

    const text = cand.node.label;
    const metrics = ctx.measureText(text);
    const w = metrics.width + LABEL_PADDING_X * 2;
    const h = 14 + LABEL_PADDING_Y * 2;
    const dotR = dotRadiusFor(cand.node) * z;
    const left = screenPos.x - w / 2;
    const top = screenPos.y - dotR - 6 - h;
    const rect = {
      left,
      top,
      right: left + w,
      bottom: top + h,
    };

    // Collision check.
    let collidesWith = -1;
    for (let i = 0; i < placed.length; i += 1) {
      if (rectsIntersect(rect, placed[i].rect)) { collidesWith = i; break; }
    }
    if (collidesWith !== -1) {
      // Hover/selection bypass collision and EVICT the lower-importance occupant.
      if (cand.isHovered || cand.isSelected) {
        placed.splice(collidesWith, 1);
      } else {
        continue;
      }
    }

    const alpha = alphaFor({
      importance: cand.importance,
      zoom: z,
      isHovered: cand.isHovered,
      isSelected: cand.isSelected,
      isActive: cand.isActive,
    });

    placed.push({
      id: cand.node.id,
      text,
      x: screenPos.x,
      y: screenPos.y - dotR - 6,
      alpha,
      rect,
    });
  }

  ctx.restore();
  return placed;
}
```

- [ ] **Step 6: Verify syntax**

Run:

```bash
npm run ui:check
```

Expected: PASS. The check parses `ui/app.js` and `src/ui/dev-server.js` — `ui/labels.js` isn't checked yet (no consumer imports it), but Node's parser will catch any syntax error if we extend `ui:check`.

Actually — `ui:check` doesn't yet include `ui/labels.js`. Verify it parses:

```bash
node --check ui/labels.js
```

Expected: no output, exit 0.

- [ ] **Step 7: Commit**

```bash
git add ui/labels.js
git commit -m "$(cat <<'EOF'
feat(ui): add labels.js — importance-driven, zoom-aware label policy

Pure function `computeVisibleLabels` owning the full label pipeline:
importance score (with active/selected/hovered boosts), zoom-dependent
threshold, screen-space placement, collision avoidance with
hover/selection eviction, alpha curve for soft fade-in, selection focus
mode that suppresses non-neighbor labels.

Not yet wired into draw.js — that's the next commit. This commit
ships the module in isolation so the integration can be reviewed
separately.
EOF
)"
```

---

## Task 4: Wire `ui/labels.js` into `ui/draw.js`

**Files:**
- Modify: `ui/draw.js` — drop `drawClusterLabels` and `drawAtomicLabels`, add screen-space label loop
- Modify: `ui/app.js` — pass hover/selection state into the draw call (likely already plumbed through `state`)
- Modify: `package.json` — add `ui/labels.js` to the `ui:check` invocation
- Verify: `npm run ui:check`, then browser walk

**Why:** The label module exists but isn't called yet. This commit replaces the existing always-on label rules with the new pipeline. After this lands, label noise is gone in any document — the layout fix in Task 5 makes the dots arrange sensibly, but the labels are already calmer here.

- [ ] **Step 1: Add `ui/labels.js` to `ui:check`**

Open `package.json`. Find the `"ui:check"` script:

```json
"ui:check": "node --check ./ui/app.js && node --check ./src/ui/dev-server.js",
```

Replace with:

```json
"ui:check": "node --check ./ui/app.js && node --check ./ui/labels.js && node --check ./src/ui/dev-server.js",
```

- [ ] **Step 2: Import `computeVisibleLabels` and drop the old label functions in `draw.js`**

Open `ui/draw.js`. At the top, add the import:

```javascript
import { computeVisibleLabels } from './labels.js';
```

Delete `drawClusterLabels` (lines ~157-174) and `drawAtomicLabels` (lines ~176-198). Also remove the calls to them from the main `draw` function.

- [ ] **Step 3: Add the new label loop to the main `draw` function**

In the `draw` function, the current structure is:

```javascript
  drawClusterBodies(ctx, layout, grs, animator);
  drawEdges(ctx, vm, layout, grs, animator);
  drawAtomicNodes(ctx, vm, layout, grs, animator);
  drawClusterLabels(ctx, layout, grs, animator);   // delete
  drawAtomicLabels(ctx, vm, layout, grs, animator); // delete
```

Replace with (note: also drop selection rings into a separate function if not already, but those exist inline in `drawAtomicNodes` today — leave that be in this commit):

```javascript
  drawClusterBodies(ctx, layout, grs, animator);
  drawEdges(ctx, vm, layout, grs, animator);
  drawAtomicNodes(ctx, vm, layout, grs, animator);

  // Pop the camera transform — labels are screen space.
  ctx.restore();

  drawLabels(ctx, state);
```

But the existing `draw` function `ctx.save() … ctx.restore()` pair already wraps the world-space drawing. We want to *exit* the world-space transform before labels. The current structure uses one save/restore at the start of the world-space block; we need to restore before labels and not re-enter.

Replace the entire `draw` function body with:

```javascript
export function draw(ctx, state) {
  const { viewModel: vm, layout, graphRenderState: grs, viewport, animator } = state;
  const dpr = window.devicePixelRatio || 1;

  // Background — screen space.
  ctx.save();
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  drawBackground(ctx, viewport);
  ctx.restore();

  // World-space layer: clusters, edges, dots.
  ctx.save();
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.translate(state.camera.pan.x, state.camera.pan.y);
  ctx.scale(state.camera.zoom, state.camera.zoom);

  drawClusterBodies(ctx, layout, grs, animator);
  drawEdges(ctx, vm, layout, grs, animator);
  drawAtomicNodes(ctx, vm, layout, grs, animator);

  ctx.restore();

  // Screen-space layer: labels.
  ctx.save();
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  drawLabels(ctx, state);
  ctx.restore();
}
```

- [ ] **Step 4: Add `drawLabels` at the bottom of `draw.js`**

```javascript
function drawLabels(ctx, state) {
  const labels = computeVisibleLabels({
    viewModel: state.viewModel,
    layout: state.layout,
    camera: state.camera,
    viewport: state.viewport,
    renderState: state.graphRenderState,
    ctx,
    hoveredConceptId: state.hoveredConceptId,
    selectedConceptId: state.selectedConceptId,
  });

  ctx.font = "11px 'Inter', system-ui, sans-serif";
  ctx.textAlign = 'center';
  ctx.textBaseline = 'bottom';
  for (const label of labels) {
    ctx.fillStyle = `rgba(234, 227, 213, ${label.alpha})`;
    ctx.fillText(label.text, label.x, label.y);
  }
}
```

- [ ] **Step 5: Confirm `state.hoveredConceptId` exists or add it**

Open `ui/app.js`. Look at the `state` object (around line 29). It has `selectedConceptId` already. Check `ui/events.js` for whether hover state is tracked — if not, hovered labels won't appear (acceptable for v1; hover is a polish, can be added in a follow-up).

If `hoveredConceptId` isn't yet tracked, add it to `state` initialisation in `ui/app.js`:

```javascript
const state = {
  document: undefined,
  viewModel: undefined,
  layout: undefined,
  graphRenderState: undefined,
  selectedConceptId: undefined,
  hoveredConceptId: undefined,   // new
  selectedFrameRef: undefined,
  // ... rest unchanged
};
```

For the wiring through `events.js` (mouse-move handler that sets `state.hoveredConceptId`), defer to a follow-up commit — out of scope for this plan. The labels module already handles `hoveredConceptId === undefined` gracefully (no boost), so missing wiring degrades to "labels never appear via hover" (selection and active-foreground reveals still work).

- [ ] **Step 6: Run `ui:check` and `test:smoke:node`**

```bash
npm run ui:check && npm run test:smoke:node
```

Expected: both PASS. Restore samples after smoke (Task 1 step 5 commands).

- [ ] **Step 7: Browser walk**

```bash
npm run ui:dev
```

Open `http://127.0.0.1:4173`. Walk:

- Default zoom: only a handful of high-importance labels visible (not all). Most concepts show as plain dots.
- Scroll the prose: as the playhead moves through chapters, the active concepts' labels appear in the canvas.
- Click a concept word in the prose: that concept gets selected, its label and 1-hop neighbor labels appear, others disappear (focus mode).
- Click a dot on the graph: same as above.
- Wheel-zoom into a region: progressively more labels emerge as the threshold drops, with no overlap.
- Zoom all the way out: labels become very sparse.
- No regressions in chapter-strip click, drift-forward auto-scroll, prose ↔ graph linking.

Stop the dev server with Ctrl+C in the running terminal.

If something looks wrong (e.g., labels missing entirely, or all collapsing on top of each other), inspect via DevTools and adjust. Most likely fix points: `threshold(zoom)` constants in `ui/labels.js`, `dotRadiusFor` formula, or the `clamp01` defensive default.

- [ ] **Step 8: Commit**

```bash
git add ui/draw.js ui/app.js package.json
git commit -m "$(cat <<'EOF'
feat(ui): drive labels through the importance-threshold pipeline

draw.js no longer carries drawClusterLabels and drawAtomicLabels;
labels are placed by ui/labels.js using screen-space collision and the
zoom-dependent importance threshold from the design spec. Net effect:
only a handful of high-importance labels render at default zoom; more
emerge progressively as you zoom in or interact (hover, select, scroll
to an active concept). Selection focus mode suppresses non-neighbor
labels entirely.

Layout still uses the hardcoded PROTOTYPE_CLUSTER_LAYOUT — Episode 2
still piles in one disk, but the disk is now readable. Force-directed
layout swap is the next commit.
EOF
)"
```

---

## Task 5: Hand-roll the force simulator and replace `ui/layout.js`

**Files:**
- Modify (substantially rewrite): `ui/layout.js`
- Verify: `npm run ui:check`, browser walk

**Why:** The hardcoded `PROTOTYPE_CLUSTER_LAYOUT` works only for Episode 1's cluster ids. Replace with a hand-rolled force simulator (charge + link + center + collision), seeded deterministically by concept id so layouts are stable across reloads.

- [ ] **Step 1: Read the current `ui/layout.js` to confirm what to preserve**

Open `ui/layout.js`. Note:

- `seededUnit(value)` is a string-hash helper — keep, used for both initial placement seeding and `clusterColor`.
- `deterministicAngle` — keep, may still be useful or can be removed.
- `PROTOTYPE_CLUSTER_LAYOUT` — delete.
- `CLUSTER_COLORS` — delete; replaced by `clusterColor(id)` hash.
- `computeLayout(vm)` — replace entirely with the force-sim version.

- [ ] **Step 2: Replace the entire file with the new layout module**

Overwrite `ui/layout.js`:

```javascript
// ---------------------------------------------------------------------------
// Layout — force-directed graph layout, hand-rolled.
//
// Pure function `computeLayout(viewModel) → { nodes, bounds, clusters }`.
//
// Atomic concepts: visible dots, participate in physics, returned in `nodes`.
// Clustered concepts: invisible physics anchors, used as gravitational centres
// for their atomic children. NOT returned in `nodes` (drawn nowhere). Their
// final positions ARE returned in `clusters` so legacy code paths that still
// expect a `clusters` array on the layout don't break — they are emitted with
// label/radius/color fields kept for backwards compat through the cluster
// rendering removal in Task 6.
//
// See docs/superpowers/specs/2026-05-10-graph-rendering-design.md § "Layout
// pipeline" for the full rationale and force constants.
// ---------------------------------------------------------------------------

const ITERATIONS = 300;
const ALPHA_DECAY = 0.9756;     // ≈ (1 − 0.0228)^(1/300) — d3-force-style cooldown
const VELOCITY_DECAY = 0.4;     // friction
const CHARGE_STRENGTH = 200;
const CHARGE_MIN_DISTANCE = 4;  // clamp r to avoid singularity in inverse-square
const LINK_DISTANCE_RELATION = 60;
const LINK_DISTANCE_MEMBERSHIP = 35;
const LINK_STIFFNESS_RELATION = 0.5;
const LINK_STIFFNESS_MEMBERSHIP = 1.5;
const CENTER_STRENGTH = 0.05;
const COLLISION_PADDING = 4;
const NODE_BASE_RADIUS = 4;     // used for collision; render-side radius is computed in draw.js

export function seededUnit(value) {
  let h = 0;
  for (let i = 0; i < value.length; i += 1) {
    h = ((h << 5) - h + value.charCodeAt(i)) | 0;
  }
  return (Math.abs(h) % 1000) / 1000;
}

export function clusterColor(clusterId) {
  // Deterministic warm-tone HSL hash. Hue restricted to [25°, 55°] so all
  // clusters sit in a coherent gold/amber palette.
  const hue = 25 + Math.floor(seededUnit(clusterId) * 30);
  return `hsl(${hue}, 35%, 60%)`;
}

export function computeLayout(viewModel) {
  const atomic = viewModel.concepts.atomic;
  const clustered = viewModel.concepts.clustered;
  const allNodes = [...atomic, ...clustered];

  if (!allNodes.length) {
    return { nodes: {}, bounds: { minX: 0, minY: 0, maxX: 1, maxY: 1 }, clusters: [] };
  }

  // Initial placement: deterministic, seeded by concept id, scattered on a unit disk
  // scaled to ~600 px so the simulation has room to settle.
  const positions = {};
  const velocities = {};
  for (const node of allNodes) {
    const t = seededUnit(node.id) * Math.PI * 2;
    const r = 200 + seededUnit(`${node.id}:r`) * 200;
    positions[node.id] = { x: Math.cos(t) * r, y: Math.sin(t) * r };
    velocities[node.id] = { x: 0, y: 0 };
  }

  // Build edge list for the simulation: relations + membership links.
  const edges = [];
  for (const e of viewModel.graph.edges) {
    edges.push({
      from: e.from,
      to: e.to,
      distance: LINK_DISTANCE_RELATION,
      stiffness: LINK_STIFFNESS_RELATION,
    });
  }
  for (const concept of atomic) {
    for (const parentId of concept.parentIds ?? []) {
      // Only add membership link if the parent cluster exists in the VM.
      if (!viewModel.concepts.byId[parentId]) continue;
      edges.push({
        from: concept.id,
        to: parentId,
        distance: LINK_DISTANCE_MEMBERSHIP,
        stiffness: LINK_STIFFNESS_MEMBERSHIP,
      });
    }
  }

  // Run the simulation.
  let alpha = 1;
  for (let iter = 0; iter < ITERATIONS && alpha > 0.001; iter += 1) {
    applyChargeForce(allNodes, positions, velocities);
    applyLinkForce(edges, positions, velocities);
    applyCenterForce(allNodes, positions, velocities);
    applyCollisionForce(allNodes, positions, velocities);
    integrate(allNodes, positions, velocities, alpha);
    alpha *= ALPHA_DECAY;
  }

  // Output: only atomic positions are visible. Clustered positions are
  // emitted in `clusters` for backwards compat with code that still iterates
  // `layout.clusters` (removed in Task 6).
  const nodes = {};
  for (const node of atomic) {
    nodes[node.id] = positions[node.id];
  }
  // Cluster anchors aren't drawn but downstream code (camera fit, legacy
  // drawClusterBodies) reads them — emit until cluster rendering is removed.
  const clusters = clustered.map((concept) => ({
    id: concept.id,
    label: concept.label,
    x: positions[concept.id].x,
    y: positions[concept.id].y,
    radius: 80,                          // legacy field for cluster bodies; ignored after Task 6
    color: clusterColor(concept.id),
  }));

  // Bounds from atomic positions only — cluster anchors might be off-screen and we don't want camera-fit to chase them.
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const id of Object.keys(nodes)) {
    const p = nodes[id];
    if (p.x < minX) minX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.x > maxX) maxX = p.x;
    if (p.y > maxY) maxY = p.y;
  }
  if (!Number.isFinite(minX)) {
    minX = -100; minY = -100; maxX = 100; maxY = 100;
  }

  return { nodes, bounds: { minX, minY, maxX, maxY }, clusters };
}

function applyChargeForce(nodes, positions, velocities) {
  const k = CHARGE_STRENGTH;
  for (let i = 0; i < nodes.length; i += 1) {
    for (let j = i + 1; j < nodes.length; j += 1) {
      const a = nodes[i].id;
      const b = nodes[j].id;
      const pa = positions[a];
      const pb = positions[b];
      let dx = pa.x - pb.x;
      let dy = pa.y - pb.y;
      let r2 = dx * dx + dy * dy;
      if (r2 < CHARGE_MIN_DISTANCE * CHARGE_MIN_DISTANCE) {
        // Apply a small jitter to avoid divide-by-zero stalls when two
        // concepts happen to seed to the same position.
        dx = (seededUnit(`${a}:${b}:x`) - 0.5) * 0.1;
        dy = (seededUnit(`${a}:${b}:y`) - 0.5) * 0.1;
        r2 = dx * dx + dy * dy + 1;
      }
      const f = k / r2;
      const r = Math.sqrt(r2);
      const fx = (dx / r) * f;
      const fy = (dy / r) * f;
      velocities[a].x += fx;
      velocities[a].y += fy;
      velocities[b].x -= fx;
      velocities[b].y -= fy;
    }
  }
}

function applyLinkForce(edges, positions, velocities) {
  for (const edge of edges) {
    const pa = positions[edge.from];
    const pb = positions[edge.to];
    if (!pa || !pb) continue;
    const dx = pb.x - pa.x;
    const dy = pb.y - pa.y;
    const dist = Math.sqrt(dx * dx + dy * dy) || 1;
    const delta = (dist - edge.distance) * edge.stiffness;
    const fx = (dx / dist) * delta;
    const fy = (dy / dist) * delta;
    velocities[edge.from].x += fx;
    velocities[edge.from].y += fy;
    velocities[edge.to].x -= fx;
    velocities[edge.to].y -= fy;
  }
}

function applyCenterForce(nodes, positions, velocities) {
  for (const node of nodes) {
    const p = positions[node.id];
    velocities[node.id].x -= p.x * CENTER_STRENGTH;
    velocities[node.id].y -= p.y * CENTER_STRENGTH;
  }
}

function applyCollisionForce(nodes, positions, velocities) {
  const minGap = NODE_BASE_RADIUS * 2 + COLLISION_PADDING;
  const minGap2 = minGap * minGap;
  for (let i = 0; i < nodes.length; i += 1) {
    for (let j = i + 1; j < nodes.length; j += 1) {
      const a = nodes[i].id;
      const b = nodes[j].id;
      const pa = positions[a];
      const pb = positions[b];
      const dx = pb.x - pa.x;
      const dy = pb.y - pa.y;
      const d2 = dx * dx + dy * dy;
      if (d2 >= minGap2) continue;
      const dist = Math.sqrt(d2) || 0.01;
      const overlap = (minGap - dist) * 0.5;
      const fx = (dx / dist) * overlap;
      const fy = (dy / dist) * overlap;
      velocities[a].x -= fx;
      velocities[a].y -= fy;
      velocities[b].x += fx;
      velocities[b].y += fy;
    }
  }
}

function integrate(nodes, positions, velocities, alpha) {
  for (const node of nodes) {
    const p = positions[node.id];
    const v = velocities[node.id];
    p.x += v.x * alpha;
    p.y += v.y * alpha;
    v.x *= VELOCITY_DECAY;
    v.y *= VELOCITY_DECAY;
  }
}
```

- [ ] **Step 3: Confirm `ui:check` covers `ui/layout.js`**

It already does — `node --check ./ui/app.js` will fail-loud if `ui/layout.js` doesn't parse, since `app.js` imports it.

- [ ] **Step 4: Run `ui:check` and `test:smoke:node`**

```bash
npm run ui:check && npm run test:smoke:node
```

Expected: both PASS. Restore samples after smoke (Task 1 step 5 commands).

- [ ] **Step 5: Browser walk — Episode 1 sample**

```bash
npm run ui:dev
```

Open `http://127.0.0.1:4173`. The default-loaded document is `examples/out/episode-1-built.mindgraph.json`.

Walk:

- Layout looks coherent — clusters visibly separated, atomic concepts orbit their parent.
- Layout is stable across reloads (refresh the page, positions identical).
- Bloom-in still works as you scroll.
- Click and hover work.
- Camera fit on initial load shows the whole layout.

Stop the dev server.

- [ ] **Step 6: Browser walk — Episode 2 sample (the document that triggered this whole project)**

If you have an Episode 2 mindgraph built (or can quickly build one), point the dev server at it:

```bash
npm run ui:dev -- --doc /path/to/episode-2.mindgraph.json
```

The `--doc` flag is honoured by `src/ui/dev-server.js` (and `mindgraph view <file>` when running through the installed CLI).

Walk: same as step 5. The key validation is that the disks-piled-in-one-disk failure mode is gone. Concepts are spread across the canvas, clusters visibly separate, labels emerge per the policy.

If the layout feels bad (clusters smashed together, or scattered too widely):
- Tune `LINK_DISTANCE_RELATION` (60) and `LINK_DISTANCE_MEMBERSHIP` (35) — smaller = tighter clusters.
- Tune `CHARGE_STRENGTH` (200) — higher = more spread.
- Tune `CENTER_STRENGTH` (0.05) — higher = pulled tighter to centre.

Constants live in one place at the top of `ui/layout.js`.

- [ ] **Step 7: Commit**

```bash
git add ui/layout.js
git commit -m "$(cat <<'EOF'
feat(ui): hand-rolled force-directed layout, no hardcoded anchors

Replaces ui/layout.js's PROTOTYPE_CLUSTER_LAYOUT (which keyed off
Episode 1's cluster ids and broke for any other document) with a
hand-rolled force simulator: charge + link + center + collision over
~300 cooled-down iterations. Cluster nodes participate as invisible
physics anchors so their atomic children gravitate to them.

Initial placement is seeded deterministically by concept id, so the
same document always lays out the same way (matters for the user's
mental map across rereads). Cluster colors come from a deterministic
HSL hash on the cluster id (warm tones, hue ∈ [25°, 55°]) — no more
per-doc CLUSTER_COLORS dict.

Cluster body rendering still expects a layout.clusters array; emitted
for backwards compat. Removed in the next commit along with the rest
of the region-rendering machinery.
EOF
)"
```

---

## Task 6: Drop cluster region rendering and unused render-state fields

**Files:**
- Modify: `ui/draw.js` — drop `drawClusterBodies`, simplify `drawEdges` (straight lines, single color)
- Modify: `src/view-model/buildGraphRenderState.js` — drop `regionEmphasis`, `dimmedRegionIds`, `cumulativeVisibleClusterIds`, `labelVisibleNodeIds`
- Modify: `ui/draw.js` — wire `clusterColor()` for atomic node fill instead of looking up `cluster.color`
- Modify: `ui/layout.js` — drop the `clusters` field from output (no longer consumed)
- Verify: `npm run ui:check`, browser walk

**Why:** With force-directed positions and pure-dot rendering, the cluster region disks no longer add information — clusters are emergent from spatial proximity and dot color. Drop the rendering and the now-unused render-state fields. Net code reduction.

- [ ] **Step 1: Replace `drawAtomicNodes` color lookup with `clusterColor`**

Open `ui/draw.js`. At the top, import `clusterColor`:

```javascript
import { clusterColor } from './layout.js';
```

In `drawAtomicNodes`, replace any cluster-color lookup that referenced `layout.clusters[…]` (if any — or that used the old `CLUSTER_COLORS` dict via the cluster object) with:

```javascript
const parentClusterId = node.parentIds?.[0];
const fillColor = parentClusterId ? clusterColor(parentClusterId) : '#b8a07a';
```

Apply this `fillColor` in place of the existing fill (where `drawAtomicNodes` currently picks `'#f4cf86'` or `'#b8a07a'`):

```javascript
ctx.fillStyle = isActive
  ? brightenForActive(fillColor)
  : fillColor;
```

Helper at the bottom of `draw.js`:

```javascript
function brightenForActive(hsl) {
  // hsl is "hsl(H, S%, L%)" — bump lightness by 12% for active state.
  const m = /^hsl\((\d+),\s*(\d+)%,\s*(\d+)%\)$/.exec(hsl);
  if (!m) return hsl;
  const h = m[1];
  const s = m[2];
  const l = Math.min(85, Number(m[3]) + 12);
  return `hsl(${h}, ${s}%, ${l}%)`;
}
```

- [ ] **Step 2: Drop `drawClusterBodies` from `draw.js` and from the main `draw` flow**

Delete the `drawClusterBodies` function (lines ~43-70). Delete its call in `draw`:

```javascript
  drawClusterBodies(ctx, layout, grs, animator);   // delete this line
```

- [ ] **Step 3: Simplify `drawEdges` to straight lines, single color**

Replace the body of `drawEdges` with:

```javascript
function drawEdges(ctx, vm, layout, grs, animator) {
  const visible = grs?.visibleEdgeIds ? new Set(grs.visibleEdgeIds) : null;
  const activeEdge = new Set(grs?.activeEdgeIds ?? []);
  const selectedNode = new Set(grs?.selectedNodeIds ?? []);

  ctx.lineCap = 'round';
  for (const edge of vm.graph.edges) {
    if (visible && !visible.has(edge.id)) continue;
    const animOpacity = animator?.getEntityState(edge.id)?.opacity ?? 1;
    if (animOpacity <= 0.001) continue;
    const from = layout.nodes[edge.from];
    const to = layout.nodes[edge.to];
    if (!from || !to) continue;

    const touchesSelection = selectedNode.has(edge.from) || selectedNode.has(edge.to);
    const isActive = activeEdge.has(edge.id);

    const baseAlpha = touchesSelection || isActive ? 0.95 : 0.28;
    ctx.strokeStyle = `rgba(218, 184, 116, ${baseAlpha * animOpacity})`;
    ctx.lineWidth = touchesSelection ? 1.4 : isActive ? 1.0 : 0.8;

    ctx.beginPath();
    ctx.moveTo(from.x, from.y);
    ctx.lineTo(to.x, to.y);
    ctx.stroke();
  }
}
```

Also delete the `sharedCluster` helper (lines ~72-78); no longer used.

- [ ] **Step 4: Drop unused fields from `buildGraphRenderState.js`**

Open `src/view-model/buildGraphRenderState.js`. In the return object (around line 299), delete these four fields:

```javascript
    labelVisibleNodeIds: [...labelVisibleNodeIds],   // delete
    visibleClusterIds: [...visibleClusterIds],       // delete
    dimmedRegionIds: [...dimmedRegionIds],           // delete
    regionEmphasis,                                   // delete
    cumulativeVisibleClusterIds: [...cumulative.clusterIds],  // delete
```

Also delete the corresponding local variables and the loops that populate them — search for `labelVisibleNodeIds`, `visibleClusterIds`, `dimmedRegionIds`, `regionEmphasis`, and `cumulative.clusterIds` in the file. Each should occur in exactly one declaration plus a few writes; delete the declarations and any writes whose result is no longer read.

The `cumulative` object can keep its `clusterIds` field internally if it's used by `deriveCameraTarget` (line 36); check `deriveCameraTarget`'s implementation. It's used in the `case 1` branch (`const clusters = layout.clusters.filter((c) => cumulative.clusterIds.has(c.id));`) — but `layout.clusters` is going away in step 6. Update `deriveCameraTarget` accordingly: when there's no active frame, fit to the bounds of all atomic-node positions in `cumulative.conceptIds`. Implementation:

```javascript
  // Case 1: no active frame → fit visible atomic nodes.
  if (!frame || !fg.length) {
    const visibleIds = [...cumulative.conceptIds].filter((id) => layout.nodes[id]);
    if (!visibleIds.length) return undefined;
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const id of visibleIds) {
      const p = layout.nodes[id];
      if (p.x < minX) minX = p.x;
      if (p.y < minY) minY = p.y;
      if (p.x > maxX) maxX = p.x;
      if (p.y > maxY) maxY = p.y;
    }
    const cx = (minX + maxX) / 2;
    const cy = (minY + maxY) / 2;
    return fitTarget(minX, minY, maxX, maxY, cx, cy, viewport, 0.15);
  }
```

Replaces the `boundsOfClusters(...)` call. The `boundsOfClusters` helper (lines ~77-88) becomes unused — delete it.

- [ ] **Step 5: Drop the `clusters` field from `ui/layout.js` output**

Open `ui/layout.js`. Remove the `clusters` array from the output (the part that emits `clustered.map(...)` near the end of `computeLayout`). Final return becomes:

```javascript
  return { nodes, bounds: { minX, minY, maxX, maxY } };
```

Also remove the now-unused `clustered` map at the end (the cluster array). Cluster anchors still participate in physics but aren't returned.

- [ ] **Step 6: Run `ui:check` and `test:smoke:node`**

```bash
npm run ui:check && npm run test:smoke:node
```

Expected: both PASS. Restore samples after smoke (Task 1 step 5 commands).

If `ui:check` fails because something still imports `cluster.color` or `layout.clusters`, search for the reference and remove:

```bash
grep -rn 'layout\.clusters' ui/ src/
grep -rn 'visibleClusterIds\|dimmedRegionIds\|regionEmphasis\|labelVisibleNodeIds\|cumulativeVisibleClusterIds' ui/ src/
```

Any remaining hits indicate consumers that need updating.

- [ ] **Step 7: Browser walk**

```bash
npm run ui:dev
```

Open `http://127.0.0.1:4173`. Walk:

- Episode 1: clusters are no longer outlined as disks. Atomic concepts visible as dots colored by cluster (deterministic warm-tone hash). Edges are straight thin lines. Labels emerge per the importance policy.
- Selection focus: click a concept → 1-hop neighbors highlighted, others fade.
- Bloom-in: scroll prose, concepts fade in as their first mention is reached, at their precomputed positions (no reflow).
- Camera fit on first load: shows whole layout. Resize window: no layout reflow, only camera adjusts.
- Episode 2 sample (if available): clusters visibly separate, ≤3 default labels. Capture a screenshot for the commit message.

Stop the dev server.

- [ ] **Step 8: Commit**

```bash
git add ui/draw.js ui/layout.js src/view-model/buildGraphRenderState.js
git commit -m "$(cat <<'EOF'
feat(ui): drop cluster region rendering and now-unused render state

With force-directed positions and pure-dot rendering, cluster identity
is emergent (color + spatial proximity) rather than drawn as a disk
backdrop. This commit takes out the now-redundant machinery:

- ui/draw.js: drawClusterBodies removed. drawEdges simplified to
  straight lines, single warm-gold color. sharedCluster helper gone.
  Atomic node colors come from clusterColor(parentClusterId), no longer
  looking through layout.clusters[].

- ui/layout.js: layout.clusters field dropped from the output (no
  remaining consumers). Cluster nodes still participate as invisible
  physics anchors.

- src/view-model/buildGraphRenderState.js: drops labelVisibleNodeIds
  (replaced by ui/labels.js), regionEmphasis, dimmedRegionIds,
  visibleClusterIds, cumulativeVisibleClusterIds (no longer consumed).
  deriveCameraTarget's "no active frame" branch fits to atomic node
  positions instead of cluster bounds.

Net: ~150 fewer lines across draw.js + layout.js + buildGraphRenderState.js.

Done criteria from spec met: Episode 1 renders coherently with
data-driven positions; Episode 2 (the broken doc that started this
project) renders with clearly distinct clusters and ≤3 default labels.
EOF
)"
```

(Attach a manual screenshot of Episode 2 to the commit if you took one — `git commit --amend` after running `git notes add -m 'screenshot: <path>' HEAD` or however you're tracking screenshots.)

---

## Self-review checklist

After all six tasks land, walk the spec and confirm coverage:

- [x] Spec § Layout pipeline → Task 5 (force sim, all four forces, deterministic seed).
- [x] Spec § Render pipeline → Tasks 4 (label loop wiring), 6 (edge simplification, no cluster bodies, hash-based color).
- [x] Spec § Importance score & label collision → Tasks 2 (compute), 3 (apply).
- [x] Spec § Rollout & verification → all six tasks have ui:check + smoke + browser walk; commit messages reference the spec; commits independently revertible.
- [x] Spec § Out of scope items not introduced (no drag, no multi-hop, no animated transitions, no in-canvas cluster labels).

Type / signature consistency:

- `clusterColor(id)` — defined in Task 5, consumed in Task 6.
- `computeVisibleLabels({ ... })` — signature defined in Task 3, called in Task 4.
- `viewModel.graph.conceptImportance` — added in Task 2, read in Task 3 / 4.
- `node.degree` — added in Task 1, used by `dotRadiusFor` in Task 3 and `computeConceptImportance` in Task 2.

If a future implementer hits a contradiction, check the spec for the canonical decision and update the plan accordingly.

---

## Done criteria

All six commits in `main`, each passing `npm run ui:check` and `npm run test:smoke:node`. Episode 1 sample renders coherently. Episode 2 sample (the broken one that started this project) renders with clearly distinct cluster regions and ≤3 default labels. Manual screenshot of Episode 2 attached to commit 6 for posterity.
