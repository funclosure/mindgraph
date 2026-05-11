# Graph rendering v2 — continuous-physics layout

- **Status:** approved through brainstorm; awaiting implementation plan
- **Date:** 2026-05-11
- **Predecessor:** `docs/superpowers/specs/2026-05-10-graph-rendering-design.md` (v1 — static precompute, hand-rolled force sim, screen-space labels)
- **Origin:** v1 shipped a one-shot force-directed layout that freezes after 300 iterations. v2 turns the simulator into a continuous, declarative-physics substrate à la `UIDynamicAnimator`: each pair of dots has an ideal distance derived from co-occurrence in the source material, stiffness modulated by producer-asserted relationships, and the simulator stays alive across the session so positions emerge live from the rules.

## Context

v1 fixed the immediate bug (hand-placed cluster anchors that piled non-Episode-1 documents into a single disk) by introducing a static force-directed precompute. It works — clusters emerge from data, labels survive zoom-and-collision. But the layout is computed once at doc-load and frozen, which:

- Encodes "togetherness" as a uniform 60 px link distance for every relation, regardless of edge type, weight, or how strongly the source material actually paired the two concepts.
- Treats the graph as static furniture even though the document being read is a temporal artifact whose structure is fundamentally about *what came up together when*.
- Forecloses on natural interactions (drag, gentle reorganization on bloom-in) that a continuous physics model would make almost-free.

v2 keeps everything else in v1's pipeline (Maps-style screen-space labels, importance-driven label policy, hash-based cluster colors, the bloom-in animation, the existing camera-follow infrastructure) and replaces just the layout module with a live simulator. Producer side is unchanged — no schema migrations.

## Locked-in decisions

| Decision | Choice | Q-ref |
|---|---|---|
| Simulator lifecycle | **B — warm-when-disturbed, freezes when settled.** Runs whenever something perturbs equilibrium, sleeps via `isSettled()` when alpha drops below threshold and all velocities are sub-pixel. Closer to D3-force's `.alphaTarget(0).restart()` than to always-on. | Q1 |
| Distance signal | **C — co-occurrence-driven.** Pair "ideal distance" derived from how much overlap two concepts have in source-material frame activations, not from a uniform constant. | Q2 |
| Co-occurrence definition | **B — duration-weighted, per-level summed.** Score = Σ_level w_level × Σ_frame duration(f) × [i ∈ f.active] × [j ∈ f.active]. Default `(w_micro, w_meso, w_macro) = (1, 1, 1)`; D's tuning surface lives as constants for one-edit retuning. | Q3 |
| Relation role | **C — relations modulate stiffness, not distance.** One spring per pair. Explicit relations and shared-cluster siblings firm up the spring without moving the target distance. | Q4 |
| Reheat strength model | **Q5a-1 + Q5b-1 — bloom-in reheats, additive with cap.** Every newly-bloomed concept bumps alpha; events stack to a saturation ceiling of 1.0. | Q5 |
| Bloom-in / initial position | **C-with-pinning — full cold-start precompute, invisible concepts pinned as one-sided force anchors.** Bloom-in unpins. No "new dot walks across the canvas" pop-in. | Q6 |
| Camera-follow | **A — keep existing 700 ms damped lerp unchanged.** Fallback tunings staged (extend rolling buffer to all levels, then bump time constant to 1 s) but deferred until evidence demands. | Q7 |
| Drag-to-rearrange | **In scope.** Pin/unpin is already a v2 primitive — drag just calls it from pointer handlers. | Q7 tail |
| Cluster anchors as physics nodes | **Dropped.** v1 needed them; v2 replaces with sibling-stiffness multipliers + fallback springs. Cluster ids stay on the document for color/labeling. | Q4 consequence |

## Architecture overview

The layered model from v1 is preserved. Only `ui/layout.js` changes shape; everything downstream consumes positions through what looks like the same contract.

| File | Today (v1) | v2 |
|---|---|---|
| `ui/layout.js` | Pure function `computeLayout(vm) → { nodes, bounds }`. Runs 300 iterations of explicit Euler at doc-load, freezes. | Exports `createLayoutSimulator(vm) → sim`. Constructor runs cold-start to convergence. Instance exposes `positions`, `bounds`, `step(dt)`, `reheat(strength)`, `pin/unpin(id, point?)`, `alpha`, `isSettled()`. |
| `ui/animator.js` | Per-entity bloom/fade + camera lerp; tick gates on bloom/fade animations. | Adds `sim.step(dt)` to the tick; gates rAF on `bloomingOrFading || !sim.isSettled()`. Detects newly-bloomed ids and calls `sim.unpin(id)` + `sim.reheat(0.20)` per bloom. |
| `ui/events.js` | Click selects, wheel zooms, background drag pans. | Adds pointer-down hit-test for dots → `sim.pin` + `alpha = 1.0`; pointer-move updates pin anchor; pointer-up calls `sim.unpin` + `sim.reheat(0.5)`. Selection events call `sim.reheat(0.10)`. |
| `ui/app.js` | `state.layout = computeLayout(vm)`. | `state.sim = createLayoutSimulator(vm)`. Shim: `state.layout` becomes a getter over `state.sim.positions` / `state.sim.bounds` so `draw.js`, `labels.js`, `camera.js`, `buildGraphRenderState.js` are unchanged at the API level. |
| `src/view-model/buildMindgraphViewModel.js` | Computes `degree` and `conceptImportance` per concept. | Adds co-occurrence derivation: `coOccurrence(i, j)` for all atomic pairs, computed during VM build, stored on `vm.graph.coOccurrence` as a `Record<id, Record<id, score>>` (sparse, only pairs with score > 0). |
| `ui/draw.js`, `ui/labels.js`, `ui/camera.js`, `src/view-model/buildGraphRenderState.js` | as-is | as-is. Read positions through the shim. |

Net change is concentrated: ~+200 lines in `ui/layout.js`, ~+30 lines in `animator.js`, ~+30 in `events.js`, ~+40 in `buildMindgraphViewModel.js`. No file deletions; the v1 layout module is replaced in-place.

## The simulator's external contract

```js
const sim = createLayoutSimulator(viewModel)
sim.positions       // Record<conceptId, {x, y}> — mutated each step; consumers read directly
sim.bounds          // {minX, minY, maxX, maxY} — recomputed cheap each step from atomic positions
sim.alpha           // 0..1, decays each frame, drives whether step() does meaningful work
sim.step(dt)        // one integration step; called from animator's rAF loop
sim.reheat(strength)              // additive with cap at 1.0
sim.pin(id, {x, y})               // lock concept to position; one-sided forces only
sim.unpin(id)                     // release back into live dynamics
sim.isSettled()                   // alpha < SETTLED_ALPHA && maxVelocity < SETTLED_VEL
```

Consumers:

- **`app.js` at doc load** — `state.sim = createLayoutSimulator(state.viewModel)`. Cold start runs synchronously inside the constructor (~50–80 ms at n=70) so `sim.positions` is fully populated before the first paint.
- **`animator.js` per rAF tick** — if `!sim.isSettled()`, call `sim.step(dt)`. Joins the existing "stillAnimating" gate.
- **`app.js` on events** — bloom-in (animator), drag (events.js), selection (events.js + panels) call `sim.reheat`, `sim.pin`, `sim.unpin` as appropriate.

`draw.js`, `labels.js`, `camera.js`, `buildGraphRenderState.js` are unchanged at the API level — they read `state.layout.nodes` and `state.layout.bounds` through a getter shim that returns `state.sim.positions` and `state.sim.bounds` live.

## Spring forces — co-occurrence + relation-modulated stiffness

Everything below precomputes once at `createLayoutSimulator(vm)` and is read per-iter. No per-frame derivation.

### Data sources (all already in the VM)

- **Frames** at `vm.frames.{micro,meso,macro}`. Each has `span: {start, end}` and `activeConceptIds: string[]`.
- **Relations** at `vm.graph.edges`.
- **Cluster membership** at `node.parentIds[]`.

No producer-side changes needed.

### Co-occurrence score, per pair (i, j) of atomic concepts

```
score(i, j) = w_micro × Σ_micro_frames duration(f) × [i ∈ f.active] × [j ∈ f.active]
            + w_meso  × Σ_meso_frames  duration(f) × [i ∈ f.active] × [j ∈ f.active]
            + w_macro × Σ_macro_frames duration(f) × [i ∈ f.active] × [j ∈ f.active]

LEVEL_WEIGHTS = (1, 1, 1)         // ship default — recovers plain Q3-B
                                   // auto-normalize each level's sum by total level duration: off by default,
                                   // one-line toggle, deferred until needed
```

`duration(f) = f.span.end − f.span.start`. Open-ended end-of-doc frames default to 30 s (matches v1 frame-duration convention).

### Ideal distance, per pair (i, j)

```
D_MIN = 35    // strongest co-occurrence → tightly bonded (matches v1's membership-spring distance)
D_MAX = 180   // weakest co-occurrence → loose spring, lets the pair drift apart
D_MID = 100   // fallback for explicit-relation-or-sibling pairs with co-occurrence score = 0

SCORE_REF = percentile(positive_scores, 0.9)  // recomputed once per cold-start; per-document.
                                               // Percentile taken over pairs with score > 0 only — zeros are
                                               // not springs and shouldn't depress the reference.
                                               // Strongest 10% of co-occurring pairs hit D_MIN, the rest scale linearly.

if score(i, j) > 0:
    ideal_d(i, j) = D_MAX − (D_MAX − D_MIN) × clamp01(score(i, j) / SCORE_REF)
elif has_relation(i, j) or shares_cluster(i, j):
    ideal_d(i, j) = D_MID                            // fallback: producer intent honored
else:
    no spring exists for this pair                    // pair is not in the spring list
```

Per-document SCORE_REF (not a global constant) is what makes the layout shape-stable across documents of different sizes/densities. Same doc → same ref → same equilibrium across reloads.

### Stiffness, per pair (i, j)

```
BASE_STIFFNESS = 0.5    // matches v1's relation-spring stiffness

relation_mult(i, j) = 1.5  if vm.graph.edges contains (i, j) or (j, i), else 1.0
sibling_mult(i, j)  = 1.3  if i.parentIds[0] === j.parentIds[0], else 1.0

stiffness(i, j) = BASE_STIFFNESS × relation_mult(i, j) × sibling_mult(i, j)
```

A co-occurring pair that's also explicitly related and in the same cluster: `0.5 × 1.5 × 1.3 = 0.975`. A co-occurring pair with no producer assertion: `0.5`. The Q4-C principle in concrete form: relations and sibling-status are the stiffness knobs, co-occurrence is the distance knob.

### Other forces, unchanged from v1

| Force | Constant | Behavior |
|---|---|---|
| Charge | `k = 200`, `min_dist = 4` | Pairwise inverse-square repulsion, jitter on near-zero distance |
| Center pull | `0.05 × distance` | Toward world origin |
| Collision | 4 px gap, `r = 4` per node | Pairwise overlap repulsion |
| Velocity clamp | 50 px/iter | v1's stability fix — retained, required for explicit-Euler safety |
| Integrator | `velocity *= 0.4` per iter | Explicit Euler with damping |

### Per-iter cost at n = 70

| Force | Ops/iter |
|---|---|
| Charge (O(n²)) | ~29 k |
| Spring | ~18 k |
| Collision (O(n²)) | ~14 k |
| Center + integrate + clamp | ~3 k |
| **Total** | **~64 k ops** |

At 60 fps warm phase: ~3.8 M ops/s ≈ 0.3–0.5 ms/frame in V8. Existing draw is ~3 ms/frame. Comfortable inside 16 ms.

## Reheat policy

### Alpha model

Single scalar `sim.alpha ∈ [0, 1]`. Drives whether each `sim.step(dt)` does meaningful work.

```
HALF_LIFE_MS = 500
ALPHA_DECAY_PER_FRAME = 0.5 ^ (1/30) ≈ 0.9772    // assumes 60 fps; if dt jitter is an issue, lerp by dt
SETTLED_ALPHA = 0.005
SETTLED_VEL   = 0.5                              // px/iter — any node slower than this is at rest

isSettled() = (alpha < SETTLED_ALPHA) && (maxVelocity < SETTLED_VEL)
```

Both clauses matter: alpha could be high while no node is moving (event with no resulting motion); velocity could be high while alpha is low (something pathological).

A single `+0.20` bloom-in reheat drives ~1 s of warm phase before drifting below `SETTLED_ALPHA`. The bloom-in opacity animation is 600 ms — the visual bloom and the physics warm-up are roughly co-temporal.

### Event → strength table

| Event | Strength | Where dispatched | Pinning side-effect |
|---|---|---|---|
| Doc load | n/a (cold start) | `bootstrap()` in `app.js` | Cold-start sim runs all concepts un-pinned to convergence; then pins each invisible concept at its cold-start position |
| Concept blooms in (cumulative set gains an id) | `+0.20` | `animator.js`, inside existing newly-entering-id loop | `sim.unpin(id)` |
| User clicks/selects a concept | `+0.10` | `events.js` `onCanvasClick`; panel `onSelectConcept` | none |
| Drag start | `alpha = 1.0` (set) | `events.js` `onPointerDown` on a dot | `sim.pin(id, screenToWorld(pointer))` |
| Drag move | `alpha = 1.0` (held) | `events.js` `onPointerMove` while dragging | pin anchor updated to live cursor |
| Drag release | `+0.5` | `events.js` `onPointerUp` (or `onPointerLeave` while dragging) | `sim.unpin(id)` |

**Deliberately not in the table:**

- **Window resize** — `center pull` is toward world-origin, not viewport center; resize affects camera fit only.
- **Wheel zoom** — camera-only, world unchanged.
- **Concept un-blooming** — doesn't exist. `cumulativeVisibleConceptIds` is monotonic in v1 and v2 preserves that.
- **Playhead motion (`activeNodeIds` churn)** — consumed by labels and styling, not by physics.

### Cold start

```js
function createLayoutSimulator(vm) {
  const sim = newSimState();
  buildPairData(sim, vm);                 // co-occurrence matrix, ideal_d, stiffness per pair
  seedInitialPositions(sim);              // existing seededUnit-based placement
  sim.alpha = 1.0;
  for (let i = 0; i < 300 && sim.alpha > 0.001; i++) {
    sim.step(1);                          // dt=1 ≈ "as fast as possible"; alpha decay handles cooldown
  }
  // Pin invisible concepts at their final cold-start positions.
  // "Initially visible" = concept appears in the cumulative-visible set at the document's starting playhead time
  // (i.e., in viewModel.selectors.getCumulativeVisibleConceptIds(initialPlayheadTime)). Everything else is invisible
  // at doc-load and gets pinned; it un-pins when its first frame is scrolled past.
  for (const node of atomic) {
    if (!initiallyVisible(node)) sim.pin(node.id, sim.positions[node.id]);
  }
  return sim;
}
```

Same explicit-Euler loop as v1's `computeLayout`, run synchronously. ~50–80 ms at n = 70.

### Settle-then-wake

When the animator's rAF loop dies (everything settled), the next reheat has to wake it. The existing `kickAnimationLoop()` in `app.js` already handles this — drag handlers, click handlers, and the scroll-binding all call it. The new requirement: bloom-in detection in `animator.js` must call `sim.reheat()` AND not return `stillAnimating: false` until the sim is also settled.

## Pinning & drag

### Pin state per node

```js
sim.pinState = Map<conceptId, { x: number, y: number } | null>
// null/missing = unpinned (responds to forces)
// {x, y}       = pinned at this position
```

### One-sided force application

Forces accumulate into `velocities[id]` regardless of pin state. Integration:

```js
for (const node of allNodes) {
  const anchor = sim.pinState.get(node.id);
  if (anchor) {
    sim.positions[node.id] = anchor;
    sim.velocities[node.id].x = 0;
    sim.velocities[node.id].y = 0;
  } else {
    sim.positions[node.id].x += sim.velocities[node.id].x * alpha;
    sim.positions[node.id].y += sim.velocities[node.id].y * alpha;
    sim.velocities[node.id].x *= VELOCITY_DECAY;
    sim.velocities[node.id].y *= VELOCITY_DECAY;
  }
}
```

Newton's-third-law-asymmetric on purpose: pinned nodes are infinite-mass anchors that exert force on their neighbors but don't react themselves.

### Drag pointer handling

```
onPointerDown(e):
  worldPoint = screenToWorld(state.camera, screenPoint(e))
  hitId = hitTest(state.sim.positions, state.viewModel, worldPoint, /*radius*/ 8)
  if hitId:
    state.dragging = { id: hitId }
    state.sim.pin(hitId, worldPoint)
    state.sim.alpha = 1.0
    kickAnimationLoop()
  else:
    // existing background-pan path

onPointerMove(e) [while dragging]:
  state.sim.pin(state.dragging.id, screenToWorld(state.camera, screenPoint(e)))
  state.sim.alpha = 1.0

onPointerUp(e) [while dragging]:
  state.sim.unpin(state.dragging.id)
  state.sim.reheat(0.5)
  state.dragging = undefined

onPointerLeave(e) [while dragging]:
  // treat as pointerup
```

`hit-test.js` already exists for click selection — reused unchanged.

### Drag edge cases

- **Drag a never-bloomed concept.** Can't happen — only bloomed concepts are drawn as hit-testable dots.
- **Drag during scroll-bloom.** Newly-bloomed concept reheats and un-pins; dragged dot stays pinned. No conflict.
- **Drag with zoom mid-gesture.** Pin anchor uses live `screenToWorld(state.camera, ...)`, so wheel-zoom mid-drag recalculates correctly.

## Camera-follow

**Unchanged from v1.** The existing `ui/animator.js` does:

- 700 ms time-constant exponential lerp (`CAMERA_TIME_CONSTANT_S = 0.23`) toward `cameraTarget`.
- 5-sample rolling buffer at micro-level only.
- Snaps to target when within thresholds.

Justification for v2: the simulator's `VELOCITY_DECAY = 0.4` gives a noise floor < 1 px/frame at typical equilibria; a 700 ms exponential lerp absorbs that order of motion easily. The camera tracks the slow-moving signal, not per-frame noise.

Fallback tunings staged but not yet committed:

1. Extend the rolling buffer from micro-only to all levels (~10 LoC change in `animator.js`).
2. If still jittery, time constant 700 ms → 1 s (one literal).

Both deferred until evidence demands.

## Determinism

Same document, same code → bit-exact `sim.positions` after `isSettled()`. Sources:

- Seeded initial placement (`seededUnit(node.id)` — unchanged from v1).
- Deterministic iteration order (V8 preserves object key insertion order).
- `SCORE_REF` recomputed deterministically from the document (90th percentile over sorted pair scores).
- No `Math.random()` anywhere in the sim.

The "drift" observed during a single session is the trajectory toward this equilibrium, not divergence between sessions. Same doc across reads → same final positions.

## Stability & perf

### Stability

- `MAX_VELOCITY_PER_ITER = 50` retained from v1.
- Charge `min_dist = 4` retained — prevents inverse-square singularity.
- Seeded initial placement (ring radius 200–400) retained.
- New continuous-sim risk: alpha held at 1.0 for many frames (long drag). Mathematically safe — velocity decay 0.4 caps steady-state speed regardless of alpha duration. Verified by the 60-second hold-drag stress test in the browser walk.

### Scale ceiling

- n = 70 (canonical): ~64 k ops/iter, 0.3–0.5 ms/frame.
- n = 200 (hypothetical large doc): ~480 k ops/iter, 2–3 ms/frame. Still fine.
- **n = 500: ~3 M ops/iter, painful.** Barnes-Hut quadtree migration kicks in here. Below 500 atomic concepts, stay O(n²). **Out of v2 scope.**

### Perf instrumentation

Dev-only `?perf=1` overlay shows: avg `step()` ms, max `step()` ms, avg alpha over last 1 s, iter-while-warm count. Not shipped to users; informs whether the math holds on real documents without committing to specific tunings up front.

## Verification

| Layer | Verification |
|---|---|
| Module syntax | `npm run ui:check` |
| Cold-start shape vs v1 | Compare `sim.positions` after cold start to v1's `layout.nodes` on canonical Episode 1. Different (new spring math) but similarly clustered. Capture before/after screenshots in the commit message. |
| Browser correctness | `npm run ui:dev` against: canonical Episode 1, Episode 2 (v1's original bug doc), one sparse-frame doc for fallback-spring testing. |
| Perf | `?perf=1` overlay reports avg `step()` < 4 ms/frame on Episode 1 during a 5-minute reading session. |
| Stability | 60-second hold-drag stress test — drag a dot across the canvas while alpha stays at 1.0; assert no NaN/Infinity in `sim.positions`. |
| Determinism | Reload the same doc twice, capture `sim.positions` after `isSettled()`, diff. Bit-exact. |

## Rollout — four commits on one branch

Each commit independently revertible.

1. **`feat(view-model): compute pair co-occurrence at VM build time`** — adds the co-occurrence derivation to `buildMindgraphViewModel.js`. Pure plumbing, no rendering change.
2. **`feat(ui): introduce createLayoutSimulator with cold-start equivalent to v1`** — new module replacing `computeLayout`. Cold-start runs synchronously, no continuous physics yet. Drop-in via the shim: `state.layout` becomes a getter over `state.sim.positions`. UI looks similar but uses new spring math (visibly different positions, plausibly clustered).
3. **`feat(ui): wire continuous simulation into rAF loop`** — `sim.step(dt)` joins the animator, `isSettled()` joins the rAF gate. Bloom-in reheat hooks added. Visible change: subtle settling after doc load and bloom-in.
4. **`feat(ui): drag-to-pin and full reheat wiring`** — drag handlers, selection reheat. Visible change: drag works, system feels alive.

Reverting 4 leaves continuous-but-undraggable. Reverting 3+4 leaves "v1 with new pair-spring math under the hood".

## Out of scope (v2, parking lot)

- **Barnes-Hut quadtree for charge/collision.** Deferred until documents push n ≥ ~500. Out of v2.
- **Auto-normalize per-level weights by total level duration.** Single-line toggle, off by default.
- **Per-document layout overrides via `meta.layoutWeights`.** Would let producer override `LEVEL_WEIGHTS` per document. No schema change in v2.
- **"Watch the concept map assemble itself" replay mode** (Q6 option B). Same simulator infrastructure; future feature, not v2.
- **Multi-finger drag / pinch-to-zoom on touch.** Pointer-events plumbing only.
- **Sticky drag** (dot stays where you put it, doesn't snap back). v2 unpins on release. Could add a long-press-to-stick affordance later.
- **Reheat on document mutation** (user re-runs producer pipeline mid-session). Out of v2; requires VM diffing.

## Concerns originally raised, addressed

1. **Determinism drift across reloads.** Resolved: per-document SCORE_REF + seeded init + no RNG → bit-exact equilibrium across reads. Within-session trajectories differ because reheat sequences differ; that's the explicit UX choice.
2. **Camera-follow against a moving target.** Resolved by analysis: v1's 700 ms damped lerp absorbs the sim's sub-pixel-per-frame motion at equilibrium. Fallbacks staged; deferred until evidence demands.
3. **Per-frame perf.** Resolved by accounting: ~64 k ops/iter at n=70, comfortably under 16 ms/frame. Scale ceiling identified at n ≈ 500; Barnes-Hut deferred.

---

*Spec authored during the 2026-05-11 graph rendering v2 brainstorm. Builds on v1 (`2026-05-10-graph-rendering-design.md`).*
