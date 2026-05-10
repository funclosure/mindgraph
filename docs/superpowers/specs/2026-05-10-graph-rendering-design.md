# Graph rendering — Obsidian-style force-directed layout with Maps-style labels

- **Status:** approved through brainstorm; awaiting implementation plan
- **Date:** 2026-05-10
- **Origin:** the canvas rendering of Episode 2 piled all concepts into a single yellow disk because `ui/layout.js` hardcoded cluster anchors for Episode 1's cluster ids. The user surfaced the bug + asked for an Obsidian-style redesign + identified labels as the dominant noise.

## Context

The mindgraph reading UI renders a `.mindgraph.json` document as a graph (left) + scrollable prose (right). The graph is reading-driven: concepts bloom in as the prose scrolls past their first mention, the active concepts at the playhead glow, click-bidirectional links bind prose ↔ graph.

Two problems with the existing renderer:

1. **Layout is document-specific.** `ui/layout.js` carries a `PROTOTYPE_CLUSTER_LAYOUT` keyed by Episode 1's cluster ids; any other document falls through to the default `{x: 640, y: 400, r: 80}` and concepts pile into one disk. This is the immediate bug.
2. **Labels are the dominant visual noise.** All visible-cluster labels (18 px) and all visible-atomic labels (11 px) draw every frame regardless of importance, zoom, or focus. Even with a working layout the canvas would still feel cluttered.

Both problems are reframed by adopting two well-understood patterns:

- **Obsidian's force-directed graph view** — positions emerge from the data, clusters are emergent (not drawn).
- **Google Maps' label policy** — screen-space labels with importance × zoom threshold + collision avoidance, not on/off rules.

## Locked-in decisions

From the brainstorm (visual companion mockups in `.superpowers/brainstorm/.../content/`):

| Decision | Choice |
|---|---|
| Layout | Force-directed, data-driven. **Static precompute** (run once at doc-load, freeze positions), not live simulation. Determinism via id-seeded initial placement. |
| Clusters | Pure dots. **No region disks, no convex hulls, no in-canvas cluster labels.** Cluster identity expressed only via dot color (deterministic hash on cluster id) and emergent spatial proximity. |
| Labels | **Screen-space (constant pixel size, do not scale with zoom).** Reveal governed by `importance(c) ≥ threshold(zoom)` with collision avoidance. |
| Importance score | `base(c) + active(c) + selected(c) + hovered(c)` — single source of truth replacing the four discrete states the brainstorm initially considered. |
| Reading-driven model | **Preserved.** Concepts still bloom in via cumulative reveal as the prose scrolls; click-bidirectional linking still works; camera still follows the active region. |
| Dependencies | **Hand-rolled force simulator.** No new runtime dep. Project stays at zero runtime deps. |
| Out of scope (v1) | Drag-to-rearrange, click-to-focus beyond 1-hop, animated layout transitions, user-runnable re-simulate, document-defined cluster colors, in-canvas cluster labels, label leader lines. |

## Architecture overview

| File | Today | After |
|---|---|---|
| `ui/layout.js` | 72 lines, hardcoded anchors per cluster id | Hand-rolled force-directed precompute. ~120 lines, no document-specific data. |
| `ui/draw.js` | 198 lines: background, cluster bodies, curved edges, atomic nodes, cluster labels, atomic labels | ~120 lines: background, straight edges, atomic nodes, selection rings, screen-space labels via `ui/labels.js`. |
| `ui/labels.js` | doesn't exist | **New.** Pure function: importance score, zoom threshold, screen-space collision avoidance. ~80 lines. |
| `src/view-model/buildMindgraphViewModel.js` | computes nodes/edges | Adds `degree(conceptId)` (single pass over edges) and exposes `peakActivation` / `persistence` from `concept.stats` if not already on the VM. |
| `src/view-model/buildGraphRenderState.js` | 319 lines, includes `dimmedRegionIds`, `regionEmphasis`, `cumulativeVisibleClusterIds`, `labelVisibleNodeIds` | Drops the four region-related fields and `labelVisibleNodeIds`. Adds `conceptImportance: Record<conceptId, number>` (the precomputed `base()` map). |
| `ui/animator.js` | per-entity opacity/scale animations for bloom-in | Unchanged. Bloom-in still runs, just at the precomputed positions. |
| `ui/camera.js`, `ui/events.js`, `ui/hit-test.js` | as-is | as-is. |

Net code change: roughly −90 lines in `draw.js` + 50 lines added in `layout.js` + 80 lines added in `labels.js` − 40 lines pruned from `buildGraphRenderState.js` + 15 added there ≈ **+15 lines of code, −5 modules of conceptual furniture**.

The layered model stays intact: `src/view-model/` remains a pure derivation layer, `ui/` remains vanilla canvas + ES modules with no bundler.

## Layout pipeline (`ui/layout.js`)

Pure function: `computeLayout(viewModel) → { nodes, bounds }`.

**Simulation participants:**

- All atomic concepts (visible — render as dots).
- All clustered concepts (invisible — physics-only anchors so atomics gravitate to their parent).

**Simulation edges:**

- Every entry in `viewModel.graph.edges` (real relations).
- Synthetic *membership* edges from each atomic to each of its `parentIds` — short, stiff springs so atomics cling to their cluster anchor.

**Forces:**

| Force | Mechanic | Default |
|---|---|---|
| Charge | Pairwise inverse-quadratic repulsion: `F = -k / r²`, clamped to a minimum r to avoid singularity | `k = 200` |
| Link spring | Per-edge spring toward target distance: `F = stiffness × (current − d)` | `d_relation = 60`, `d_membership = 35`; `stiffness_relation = 0.5`, `stiffness_membership = 1.5` |
| Center pull | Linear pull toward viewport centroid | `0.05 × distance` |
| Collision | Pairwise repulsion when nodes are within `r1 + r2 + 4 px` | 4 px gap |

**Loop:**

```
positions = random unit-disk placements seeded by hash(conceptId)   // deterministic across reloads — reuse the existing `seededUnit` helper from today's `ui/layout.js`
velocities = zeros
alpha = 1
for i = 0..299:
  apply charge, link, center, collision forces → accumulate velocities
  positions += velocities × alpha
  velocities *= 0.4                                  // friction
  alpha *= 0.9756                                    // exponential cooldown ≈ 1 − 0.0228^(1/300)
  if alpha < 0.001: break
```

**Output:** `{ nodes: { [conceptId]: {x, y} }, bounds: {minX, maxX, minY, maxY} }`. Only atomic concept positions are exposed externally — cluster anchors are physics-only and don't render. The existing `ui/camera.js` consumes `bounds` to fit the camera on initial load.

**Determinism:** seeded by id-hash so the same document always lays out the same way. This matters for the user's mental map across rereads — the whole reason for the static-precompute choice.

**Performance:** at ~60 atomics + 8 clusters (n = 68) and ~50 relations, 300 iterations is roughly 3 M float ops dominated by `O(n²)` charge + collision pair tests. Well under 100 ms at doc-load on any modern browser. At n = 220 (a hypothetical large doc) it grows to ~30 M ops — still under ~100 ms but starts to be noticeable. If we cross that threshold we can swap charge for a Barnes-Hut tree, which collapses the per-iter cost from `O(n²)` to `O(n log n)`. Out of scope for v1.

## Render pipeline (`ui/draw.js`)

Single render order per frame:

```
draw(ctx, state):
  1. Background          (radial gradient, screen space — unchanged)
  2. Camera transform    (DPR + pan + zoom — unchanged)
  3. Edges               (straight lines, world space)
  4. Nodes               (dots, world space)
  5. Selection rings     (world space, on top of dots)
  6. Labels              (screen space — pop the camera transform first, then draw)
```

**Edges (step 3).** Straight lines, no curves, no perpendicular lift. Single rule:

```
for each edge in viewModel.graph.edges:
  if edge.id ∉ cumulativeVisibleEdgeIds: skip            // preserves bloom-in
  alpha = touchesSelection ? 0.95 : 0.28
  width = touchesSelection ? 1.4  : 0.8
  color = warm gold rgba(218, 184, 116, alpha)
  line from layout.nodes[edge.from] to layout.nodes[edge.to]
```

No "same-cluster vs cross-cluster" coloring — the layout already encodes that via spatial proximity; re-encoding it via edge color adds visual noise.

**Nodes (step 4).**

```
for each atomic node in viewModel.graph.nodes:
  if node.level === 'clustered': skip                    // cluster nodes are invisible
  if node.id ∉ cumulativeVisibleNodeIds: skip
  pos    = layout.nodes[node.id]
  radius = clamp(2.5 + degree(node) × 0.4, 2.5, 6)       // Obsidian-style: degree-driven sizing
  color  = clusterColor(node.parentIds[0])               // deterministic hash → warm-tone HSL
  alpha  = animator.opacity × stateAlpha
    where stateAlpha =
      selected → 1.00
      hovered  → 0.95
      active   → 0.92    // foreground at current playhead
      dimmed   → 0.22    // a selection exists, this node is not 1-hop
      otherwise → 0.70
  draw filled circle at pos
```

`degree(node)` is added to the VM during build. `clusterColor(clusterId)`: hash id → hue ∈ [25°, 55°] (warm tones to keep the palette cohesive), saturation 35 %, lightness 60 %. Same id → same color across reloads. No color list to maintain, no document-specific constants.

The current `visualWeight`-based size factor is dropped: importance is already represented in the *label visibility* score; doubling up by also varying dot size adds visual noise without new information.

**Selection rings (step 5).** Unchanged from today's renderer: thin gold ring at `radius + 4` for selected; faint ring at `radius + 6` for hovered.

**Labels (step 6).**

```
ctx.restore()                                            // pop the camera transform — labels are screen space
for each label in computeVisibleLabels({...}):
  ctx.fillStyle = `rgba(234, 227, 213, ${label.alpha})`
  ctx.fillText(label.text, label.x, label.y)             // x, y already in screen pixels
```

Everything substantive about labels is in the next section.

**What dies in `draw.js`:**

- `drawClusterBodies` (~30 lines)
- `drawClusterLabels` (~20 lines)
- the `sharedCluster` helper and quadratic-Bézier math in `drawEdges` (~15 lines)
- `drawAtomicLabels` (~25 lines, replaced by the labels-module-driven loop)

## Importance score & label collision (`ui/labels.js`)

Pure function: `computeVisibleLabels({ vm, layout, camera, viewport, ctx, renderState }) → [{id, text, x, y, alpha}]`.

Scores every currently-bloomed-in concept, sorts by importance descending, places labels greedily in screen space, returns those that survived collision and threshold.

**Importance formula:**

```
importance(c) = base(c) + active(c) + selected(c) + hovered(c)

base(c)     = normalize( 0.4·degree + 0.3·peakActivation + 0.3·persistence )   ∈ [0, 1]
active(c)   = 0.6   if c ∈ activeNodeIds at the current playhead, else 0
selected(c) = 0.8   if c is selected; 0.4 if c is 1-hop from selected; else 0
hovered(c)  = 1.0   if c is currently hovered, else 0
```

`base(c)` is computed once per `viewModel` build and stored on `renderState.conceptImportance`. `degree(c)` is a single-pass scan over `vm.graph.edges` (added during VM build — wasn't there). `peakActivation` and `persistence` already live on `concept.stats` after `mindgraph stats recompute` runs.

**Zoom threshold:**

```
threshold(zoom) = clamp(0.85 − (zoom − 1.0) × 0.20,  0.05,  0.85)

zoom 1.0 → 0.85   (only the very top — typically 2–3 labels)
zoom 2.0 → 0.65   (mid-importance survives)
zoom 4.0 → 0.25   (most of what's visible)
zoom ≥ 5.0 → 0.05 (essentially everything)
```

Constants live in `ui/labels.js`, not sprinkled. Tunable in one place.

**Placement loop:**

```
candidates = [c for c in cumulativeVisibleConceptIds if importance(c) ≥ threshold(zoom)]
candidates.sort by importance desc
placed = []

for c in candidates:
  screenPos = world_to_screen(layout.nodes[c.id], camera)
  if screenPos outside viewport (40 px padding): skip
  rect = labelRect(c.label, screenPos, ctx)             // measureText + offset above dot
  if rect collides with any placed[].rect:
    if c is hovered or selected:
      evict the colliding lower-importance label, accept c
    else:
      skip
  placed.push({ id: c.id, text: c.label, x: rect.x, y: rect.y, alpha: alphaFor(c), rect })

return placed
```

Hover and selection get **placement priority over collision** (you explicitly summoned the label; readability trumps tidiness; the colliding lower-importance label is evicted instead). Active-foreground labels at the playhead don't get this priority — they're scored highly enough that they usually win on first pass.

**Selection focus mode:** when `selectedConceptId` is set, non-neighbor labels are *fully suppressed* rather than just losing the score race. Concretely: in `selected(c)`, anyone who is neither the selection nor 1-hop returns a sentinel that means "skip entirely, ignore base importance." Fading text is harder to read than absent text. Mirrors the dot/edge dimming that already happens in selection mode.

**Alpha computation:**

```
margin = importance(c) − threshold(zoom)
alphaBase = clamp(margin × 4, 0.4, 1.0)
if hovered(c) or selected(c): alpha = 1.0
else if active(c):            alpha = max(alphaBase, 0.92)
else:                         alpha = alphaBase
```

A label that just clears threshold fades in softly (~0.4); one well above it sits at full opacity. Prevents popping in.

**Performance.** At ~60 visible concepts and zoom 4 (worst case for placed-count `k`):

- Sort: O(n log n) ≈ 360 comparisons/render
- Collision: O(k²) ≈ 1600 rect tests/render

Whole pipeline fits inside a few hundred microseconds. No spatial index needed at this scale.

## Rollout & verification

**Phasing — three commits on one branch, each independently shippable and revertible.**

| # | Commit | Visible to user | Risk |
|---|---|---|---|
| 1 | Add `degree` to VM build, add `conceptImportance` to render state, expose `peakActivation`/`persistence` on the VM if not already | Nothing — pure plumbing | Low. Adds fields, removes none. |
| 2 | New `ui/labels.js` + rewire `ui/draw.js` to drive labels through it. Drop `drawAtomicLabels`, drop `drawClusterLabels` | **Big.** Label noise gone in any document. Episode 2 still piles in one disk (expected) but is *readable*. | Medium. Touches the most visible part of the UI. Mitigated by smoke-test loop and manual browser pass. |
| 3 | Replace `ui/layout.js` with force sim. Drop `drawClusterBodies`, simplify `drawEdges` (straight lines, single color). Replace cluster colors with `clusterColor(id)` hash | **Big.** Episode 2 lays out cleanly. Region disks gone. Episode 1 looks different from before (positions emerge from data, not hand-placed). | Medium. The canonical Episode 1 sample changes its rendered appearance — that's the point, but it's worth noting in the commit. |

The split is for revertability, not for shipping each separately. If any commit feels wrong we revert that one without disturbing the others.

**Per-commit verification.**

- `npm run vm:example` — view-model build still emits valid output.
- `npm run ui:check` — syntax check on `ui/*.js`.
- `npm run test:smoke:node` — CLI smoke. Should be unaffected throughout (no producer-side changes).
- **Browser pass** — `npm run ui:dev`, then load:
  - The canonical Episode 1 sample (`examples/out/episode-1-built.mindgraph.json`)
  - A freshly built Episode 2 mindgraph (the doc that broke initially)
- **Walk for both:**
  - Default zoom: only top 2–3 labels visible
  - Scroll prose → bloom-in still works, labels emerge for active concepts at the playhead
  - Click a concept → focus mode (neighbors labeled, others suppressed; non-neighbor edges fade)
  - Hover a dot → label appears + thin ring
  - Wheel-zoom in → progressively more labels appear without overlap
  - Resize window → no layout reflow (positions are precomputed, only camera adjusts)
  - No regression in chapter-strip, prose ↔ graph click linking, drift-forward auto-scroll

If Playwright/MCP browser is available we'll script the passes; otherwise capture screenshots manually for each commit.

**Edge cases handled by the design.**

| Case | Behavior |
|---|---|
| Document with zero relations | Membership links still pull atomics to their cluster anchor; no relation springs. Each cluster forms a tight cloud, clouds scatter via repulsion. Works. |
| Single-cluster document | One anchor, all atomics distribute around it. Looks like a single Obsidian cluster. |
| Atomic with no `parentIds` | No membership link. Drifts to the periphery via repulsion + center pull — ends up in the satellite ring (mirrors Obsidian's behavior for unlinked notes). |
| 200+ concepts | 300 iters of O(n²) ≈ 30 M float ops. Likely under ~100 ms at doc-load. Barnes-Hut migration is a future optimization; out of scope for v1. |
| Concept missing `peakActivation`/`persistence` (no `stats recompute` ever run) | `base()` falls back to degree-only, normalized. Reasonable; producer should run `stats recompute` anyway, and `mindgraph validate` flags missing stats. |

**Done criteria.**

- All three commits in `main`, each passing `npm run ui:check` and `npm run test:smoke:node`.
- Episode 1 sample renders coherently (positions different from hand-placed but readable).
- Episode 2 sample (the broken one) renders with clearly distinct cluster regions and ≤ 3 default labels.
- Manual screenshot of Episode 2 attached to the final commit message for posterity (so it's comparable against the screenshot that started this brainstorm).

## Out of scope (v1, parking lot)

- Drag-to-rearrange — physics is static after precompute; drag would either be a no-op or require a second simulator. Defer.
- Click-to-focus beyond 1-hop — current focus mode highlights selected + 1-hop neighbors. Multi-hop expansion is a UI affordance question, not a rendering one.
- Animated layout transitions when document evolves between reads — possible future enhancement; out of scope until we can A/B against the static-precompute version in real reading sessions.
- User-runnable "shake" / re-simulate.
- Document-defined cluster colors. Hash-based for now; could add a `meta.clusterColors` schema field later.
- In-canvas cluster labels. Suppressed in v1; if they return later they flow through the importance pipeline like everything else.
- Label leader lines / connectors when a label sits far from its dot. Collision avoidance keeps labels close enough that this isn't needed at our scale.

## Open questions / risks

- **Will Episode 1's hand-tuned aesthetic be missed?** The current hand-placed layout was tuned by eye; force-directed might produce a less "balanced" look on the canonical sample. Mitigation: the canonical sample is *one* document; the cost of keeping a hand-tuned per-doc layout is bearing the bug we're fixing for every other document. If the canonical sample looks markedly worse, we can tune the force constants — not re-introduce hardcoded anchors.
- **Labels at very-zoomed-out states.** At zoom 1.0 with threshold 0.85, possibly 0 concepts pass. The user sees a label-less graph. That's intentional (Obsidian default), but worth checking by eye that it doesn't read as "something's broken." If so, consider lowering the floor of the threshold curve.
- **Cluster anchor interaction with the camera.** The current camera-fits to the layout `bounds`. With cluster anchors participating in physics, the bounds include anchor positions even though they don't render — could leave odd whitespace at the canvas edges. If this happens, compute `bounds` from atomic positions only (one extra line at end of `computeLayout`).

---

*Spec authored during the 2026-05-10 graph-rendering brainstorm. Visual companion mockups for the brainstorm live in `.superpowers/brainstorm/75283-1778413768/content/`.*
