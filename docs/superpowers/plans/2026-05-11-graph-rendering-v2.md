# Graph Rendering v2 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn v1's static one-shot force-directed layout into a continuous, UIDynamics-style declarative-physics substrate where each atomic-concept pair has an ideal distance derived from frame-level co-occurrence and a stiffness modulated by producer-asserted relations and shared-cluster membership.

**Architecture:** Four phases, four commits, each independently revertible. Phase A (Task 1) adds the co-occurrence derivation in the view-model. Phase B (Task 2) replaces `ui/layout.js` with a `createLayoutSimulator` factory that runs cold-start equivalent to v1 but with new spring math — no continuous physics yet, drop-in shim keeps consumers unchanged. Phase C (Task 3) wires `sim.step(dt)` into the animator's rAF loop and adds bloom-in reheat hooks. Phase D (Task 4) adds drag-to-pin and selection reheat.

**Tech Stack:** Vanilla ES modules, HTML5 Canvas, Node 18+ / Bun. No bundler. No new runtime dependencies. The simulator is hand-rolled (no `d3-force`).

**Spec:** `docs/superpowers/specs/2026-05-11-graph-rendering-v2-design.md`

**Verification model:** This project has no unit-test framework. Verification per `CLAUDE.md`:

- VM changes → `npm run vm:example` and inspect output.
- UI changes → `npm run ui:check` (syntax) then `npm run ui:dev` and walk the feature in a browser.
- CLI: `npm run test:smoke:node` should be unaffected; run after every commit. After smoke runs, restore canonical samples (smoke can mutate them):
  ```bash
  git checkout HEAD -- examples/out/episode-1-built.mindgraph.json examples/out/build-sample.mindgraph.json examples/out/awakening.mindgraph.json
  trash examples/out/empty.mindgraph.json 2>/dev/null || rm -f examples/out/empty.mindgraph.json
  ```

---

## File structure

| File | Status | Responsibility |
|---|---|---|
| `src/view-model/buildMindgraphViewModel.js` | Modified (Task 1) | Adds `computeCoOccurrence(framesVM, atomic)` and attaches sparse `Record<id, Record<id, score>>` to `viewModel.graph.coOccurrence`. |
| `ui/layout.js` | **Rewritten (Task 2)** | Exports `createLayoutSimulator(viewModel) → sim`. Keeps `seededUnit` and `clusterColor` exports unchanged (consumers in `draw.js` still import `clusterColor`). |
| `ui/app.js` | Modified (Task 2 + Task 3) | Switch `state.layout = computeLayout(vm)` → `state.sim = createLayoutSimulator(vm)`. Add `state.layout` getter shim. Task 3 wires `sim` into the animator step call. |
| `ui/animator.js` | Modified (Task 3) | `sim.step(dt)` joins each tick; `!sim.isSettled()` joins the rAF gate. Detect newly-bloomed ids and call `sim.unpin(id)` + `sim.reheat(0.20)`. |
| `ui/events.js` | Modified (Task 4) | Pointer-down hit-test → `sim.pin + alpha=1.0`. Pointer-move updates pin anchor. Pointer-up → `sim.unpin + reheat(0.5)`. Selection click → `sim.reheat(0.10)`. |

`ui/draw.js`, `ui/labels.js`, `ui/camera.js`, `ui/hit-test.js`, `src/view-model/buildGraphRenderState.js` are unchanged — they read `state.layout.nodes` / `state.layout.bounds` through the shim.

---

## Task 1: Add pair co-occurrence to the view-model

**Files:**
- Modify: `src/view-model/buildMindgraphViewModel.js`
- Verify: `npm run vm:example`

**Why:** The simulator's per-pair `ideal_d` is derived from a co-occurrence score that's a pure function of the document's frames. Compute it once per VM build (constant cost vs. F frames and A active concepts per frame) and store sparse so the simulator reads it in O(pair) per cold-start without rescanning frames.

- [ ] **Step 1: Read current `buildGraphVM` to confirm where to inject**

Open `src/view-model/buildMindgraphViewModel.js`. `buildGraphVM` lives at lines 248–284 and is called from `buildMindgraphViewModel` at line 477. It currently returns `{ nodes, edges, nodeById, edgesByNodeId, conceptImportance }`. We will add a `coOccurrence` field alongside.

Frames live at `framesVM.{micro,meso,macro}` (built at line 475 in `buildFramesVM`). Each frame has `span: {start, end}` and `foregroundConcepts` / `backgroundConcepts` arrays. The "active concepts" for our co-occurrence count is `[...foregroundConcepts, ...backgroundConcepts]`, matching the same union `buildIndexesVM` uses at line 298.

- [ ] **Step 2: Add the `computeCoOccurrence` helper**

Insert at the top of the file, after `clamp01` (line 35), before `normalizeConcept`:

```javascript
function computeCoOccurrence(framesVM, atomicNodes) {
  // Per spec § Spring forces — co-occurrence-driven distance.
  //
  //   score(i, j) = w_micro × Σ duration(f) over micro frames where both i,j ∈ active
  //               + w_meso  × Σ duration(f) over meso  frames where both i,j ∈ active
  //               + w_macro × Σ duration(f) over macro frames where both i,j ∈ active
  //
  // Stored sparse: Record<id, Record<id, score>>, only pairs with score > 0.
  // Symmetric — both directions written so the simulator can look up either way.
  //
  // "Active in a frame" matches buildIndexesVM's union of foreground + background.
  const LEVEL_WEIGHTS = { micro: 1, meso: 1, macro: 1 };
  const DEFAULT_FRAME_DURATION = 30; // matches v1 frame-duration convention for open-ended spans

  const atomicIds = new Set(atomicNodes.filter((n) => n.level === 'atomic').map((n) => n.id));
  const result = {};

  for (const level of ['micro', 'meso', 'macro']) {
    const weight = LEVEL_WEIGHTS[level];
    const frames = framesVM[level] ?? [];
    for (const frame of frames) {
      const dur = Math.max(0, (frame.span?.end ?? 0) - (frame.span?.start ?? 0)) || DEFAULT_FRAME_DURATION;
      const contribution = weight * dur;

      // Concepts in this frame, atomic-only, deduped.
      const ids = [];
      const seen = new Set();
      for (const activation of [...(frame.foregroundConcepts ?? []), ...(frame.backgroundConcepts ?? [])]) {
        const id = activation.id;
        if (!atomicIds.has(id)) continue;
        if (seen.has(id)) continue;
        seen.add(id);
        ids.push(id);
      }

      // Accumulate over all unordered pairs (i, j) in the frame.
      for (let i = 0; i < ids.length; i += 1) {
        for (let j = i + 1; j < ids.length; j += 1) {
          const a = ids[i];
          const b = ids[j];
          if (!result[a]) result[a] = {};
          if (!result[b]) result[b] = {};
          result[a][b] = (result[a][b] ?? 0) + contribution;
          result[b][a] = (result[b][a] ?? 0) + contribution;
        }
      }
    }
  }

  return result;
}
```

The level weights are inlined as `{ micro: 1, meso: 1, macro: 1 }` per the ship default — `D's` tuning surface lives in `ui/layout.js` next to the other force constants. This helper only computes the unweighted-by-config raw sums per level; the simulator can apply per-level weights later if needed. For now we ship with uniform weights.

Wait — re-reading the spec § "Co-occurrence score": `score(i, j) = Σ_level w_level × Σ_frame duration × ...`. The weights are folded into the score here. If we later want them tunable, we change `LEVEL_WEIGHTS` here and rebuild the VM. That matches the spec's "constants live at the top of `ui/layout.js`" intent if we move the constants there, but keeping them here (at the derivation point) is also defensible because the score is a property of the document, not of the simulator. **Keep them here for v2.** If we want runtime tuning, that's a follow-up.

- [ ] **Step 3: Wire `computeCoOccurrence` into `buildMindgraphViewModel`**

`buildGraphVM` doesn't have access to `framesVM`. Refactor: pass `framesVM` to `buildGraphVM` and call `computeCoOccurrence` from there.

In `buildMindgraphViewModel` (line 471), change the call:

```javascript
// OLD:
//   const graph = buildGraphVM(concepts, relations);
const graph = buildGraphVM(concepts, relations, frames);
```

Update `buildGraphVM`'s signature and body. The function head becomes:

```javascript
function buildGraphVM(conceptsVM, relationsVM, framesVM) {
  const nodes = [...conceptsVM.clustered, ...conceptsVM.atomic].map((concept) => ({
    // ... unchanged
  }));
  // ... existing body unchanged through the `conceptImportance` line ...

  const conceptImportance = computeConceptImportance(nodes);
  const coOccurrence = computeCoOccurrence(framesVM, nodes);

  return { nodes, edges, nodeById, edgesByNodeId, conceptImportance, coOccurrence };
}
```

Concretely, the diff in `buildGraphVM`:

```javascript
function buildGraphVM(conceptsVM, relationsVM, framesVM) {          // ← +framesVM
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

  const conceptImportance = computeConceptImportance(nodes);
  const coOccurrence = computeCoOccurrence(framesVM, nodes);        // ← new

  return { nodes, edges, nodeById, edgesByNodeId, conceptImportance, coOccurrence };  // ← +coOccurrence
}
```

- [ ] **Step 4: Verify with `vm:example`**

Run:

```bash
npm run vm:example
```

Expected: command exits 0. Output is a representative VM slice. The new `coOccurrence` field is on `viewModel.graph` but `example.js` doesn't print it — that's fine. We're verifying no errors.

- [ ] **Step 5: Verify with `ui:check`**

Run:

```bash
npm run ui:check
```

Expected: PASS.

- [ ] **Step 6: Verify with `test:smoke:node`**

Run:

```bash
npm run test:smoke:node
```

Expected: PASS. Then restore canonical samples:

```bash
git checkout HEAD -- examples/out/episode-1-built.mindgraph.json examples/out/build-sample.mindgraph.json examples/out/awakening.mindgraph.json
trash examples/out/empty.mindgraph.json 2>/dev/null || rm -f examples/out/empty.mindgraph.json
```

- [ ] **Step 7: Sanity-print one pair's score (optional debug, revert before commit)**

Quick eyeball verification: pop a `console.log` into `vm:example` to print `viewModel.graph.coOccurrence` for two well-known concepts in Episode 1 (e.g. the two with the highest expected pairing). Confirm:

- Self-pairs absent (no `result[a][a]`).
- Symmetric (`result[a][b] === result[b][a]`).
- Values are positive numbers, not NaN.

Remove the log before commit.

- [ ] **Step 8: Commit**

```bash
git add src/view-model/buildMindgraphViewModel.js
git commit -m "$(cat <<'EOF'
feat(view-model): compute pair co-occurrence at VM build time

Adds computeCoOccurrence helper, called once per VM build, that scans
all micro/meso/macro frames and accumulates duration-weighted
co-occurrence counts for every unordered atomic-concept pair that
appears together in a frame's foreground + background union.

Stored sparse as viewModel.graph.coOccurrence: Record<id, Record<id,
score>>, symmetric, only pairs with score > 0. Level weights (1, 1, 1)
inlined here per ship default; if tuning is needed later they move next
to the other force constants in ui/layout.js (v2 spec § Out of scope).

Pure plumbing: no consumer reads coOccurrence yet. Sets up
createLayoutSimulator in the next commit.
EOF
)"
```

---

## Task 2: Replace `ui/layout.js` with `createLayoutSimulator` — cold-start equivalent

**Files:**
- Rewrite (substantial): `ui/layout.js`
- Modify: `ui/app.js` (swap `computeLayout` for `createLayoutSimulator`, add `state.layout` shim)
- Verify: `npm run ui:check`, browser walk

**Why:** The new spring math (co-occurrence-driven distance, relation-modulated stiffness, fallback springs, per-document SCORE_REF) changes what `computeLayout` produces. This task swaps the underlying math but keeps continuous physics OFF — cold-start runs to convergence at construction time and positions then look stable. Consumers see `state.layout.nodes` / `state.layout.bounds` through a getter shim and don't change. This lets us land the new layout math separately from the live-physics wiring, so if the new math produces a bad-looking layout we can revert just this commit.

- [ ] **Step 1: Read the current `ui/layout.js` to confirm what to preserve**

Open `ui/layout.js`. Note:

- `seededUnit(value)` (lines 29–35) — keep, re-exported.
- `clusterColor(clusterId)` (lines 37–43) — keep, re-exported. `ui/draw.js:6` imports this.
- `hslToHex` (lines 45–56) — keep as private helper.
- `computeLayout(viewModel)` (lines 58–134) — replaced by `createLayoutSimulator`.
- Force functions (`applyChargeForce`, `applyLinkForce`, `applyCenterForce`, `applyCollisionForce`, `clampVelocities`, `integrate`) — keep the math, refactor into the simulator-instance methods (charge/center/clamp largely unchanged; spring force needs to use per-pair distance and stiffness from precomputed pair data; integrate gets a pin check).
- Constants — most carry over; new ones added for v2 (alpha decay per frame, settle thresholds, distance triad, score-ref percentile, etc.).

- [ ] **Step 2: Rewrite `ui/layout.js` end-to-end**

Replace the file's contents with:

```javascript
// ---------------------------------------------------------------------------
// Layout — continuous force-directed simulator, hand-rolled.
//
// Exports:
//   createLayoutSimulator(viewModel) → sim   continuous-physics simulator
//   seededUnit(value)                         deterministic [0, 1) hash on a string
//   clusterColor(clusterId)                   deterministic warm-tone hex for a cluster id
//
// The simulator is the only stateful module in the canvas pipeline. It owns
// per-pair spring metadata (ideal_d, stiffness) computed at construction
// time, positions/velocities arrays, and a single alpha scalar that drives
// the warm-when-disturbed lifecycle.
//
// See docs/superpowers/specs/2026-05-11-graph-rendering-v2-design.md for the
// full design rationale.
// ---------------------------------------------------------------------------

// ───── Cold-start sim constants ─────────────────────────────────────────────
const ITERATIONS = 300;                          // cold-start iter count (matches v1)
const CHARGE_STRENGTH = 200;
const CHARGE_MIN_DISTANCE = 4;
const CENTER_STRENGTH = 0.05;
const COLLISION_PADDING = 4;
const NODE_BASE_RADIUS = 4;
const MAX_VELOCITY_PER_ITER = 50;
const VELOCITY_DECAY = 0.4;

// ───── Distance & stiffness for the new pair-spring model ───────────────────
const D_MIN = 35;                                // strongest co-occurrence
const D_MAX = 180;                               // weakest co-occurrence (but spring exists)
const D_MID = 100;                               // fallback for relation/sibling pairs with score=0
const SCORE_REF_PERCENTILE = 0.9;                // strongest 10% of co-occurring pairs hit D_MIN

const BASE_STIFFNESS = 0.5;
const RELATION_STIFFNESS_MULT = 1.5;
const SIBLING_STIFFNESS_MULT = 1.3;

// ───── Live-phase alpha lifecycle ───────────────────────────────────────────
const HALF_LIFE_FRAMES = 30;                     // 0.5 s at 60 fps
const ALPHA_DECAY_PER_FRAME = Math.pow(0.5, 1 / HALF_LIFE_FRAMES);  // ≈ 0.9772
const SETTLED_ALPHA = 0.005;
const SETTLED_VEL = 0.5;

// ───── String hash helpers (unchanged from v1) ──────────────────────────────
export function seededUnit(value) {
  let h = 0;
  for (let i = 0; i < value.length; i += 1) {
    h = ((h << 5) - h + value.charCodeAt(i)) | 0;
  }
  return (Math.abs(h) % 1000) / 1000;
}

export function clusterColor(clusterId) {
  // Deterministic warm-tone hash: hue ∈ [25°, 55°], saturation 35%, lightness 60%.
  // Returns #RRGGBB so consumers using hexToRgba() work unchanged.
  const hue = 25 + Math.floor(seededUnit(clusterId) * 30);
  return hslToHex(hue, 35, 60);
}

function hslToHex(h, s, l) {
  const sNorm = s / 100;
  const lNorm = l / 100;
  const a = sNorm * Math.min(lNorm, 1 - lNorm);
  const channel = (n) => {
    const k = (n + h / 30) % 12;
    const c = lNorm - a * Math.max(-1, Math.min(k - 3, 9 - k, 1));
    return Math.round(255 * c).toString(16).padStart(2, '0');
  };
  return `#${channel(0)}${channel(8)}${channel(4)}`;
}

// ───── Simulator factory ────────────────────────────────────────────────────
export function createLayoutSimulator(viewModel) {
  const atomic = viewModel.concepts.atomic;
  const nodes = atomic.map((c) => ({ id: c.id }));   // physics participants — atomic only in v2
  const nodeIndex = Object.fromEntries(nodes.map((n, i) => [n.id, i]));

  // Position + velocity storage.
  const positions = {};
  const velocities = {};
  for (const node of nodes) {
    const t = seededUnit(node.id) * Math.PI * 2;
    const r = 200 + seededUnit(`${node.id}:r`) * 200;
    positions[node.id] = { x: Math.cos(t) * r, y: Math.sin(t) * r };
    velocities[node.id] = { x: 0, y: 0 };
  }

  const pinState = new Map();                        // id → {x, y} | null

  // Build per-pair spring metadata.
  const pairs = buildPairs(viewModel, atomic);

  // ───── Force kernels (closed over `positions`, `velocities`, `pairs`, `pinState`) ─────

  function applyCharge() {
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

  function applySprings() {
    for (const pair of pairs) {
      const pa = positions[pair.a];
      const pb = positions[pair.b];
      const dx = pb.x - pa.x;
      const dy = pb.y - pa.y;
      const dist = Math.sqrt(dx * dx + dy * dy) || 1;
      const delta = (dist - pair.idealD) * pair.stiffness;
      const fx = (dx / dist) * delta;
      const fy = (dy / dist) * delta;
      velocities[pair.a].x += fx;
      velocities[pair.a].y += fy;
      velocities[pair.b].x -= fx;
      velocities[pair.b].y -= fy;
    }
  }

  function applyCenter() {
    for (const node of nodes) {
      const p = positions[node.id];
      velocities[node.id].x -= p.x * CENTER_STRENGTH;
      velocities[node.id].y -= p.y * CENTER_STRENGTH;
    }
  }

  function applyCollision() {
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

  function clampVelocity() {
    const max = MAX_VELOCITY_PER_ITER;
    const max2 = max * max;
    for (const node of nodes) {
      const v = velocities[node.id];
      const speed2 = v.x * v.x + v.y * v.y;
      if (speed2 > max2) {
        const scale = max / Math.sqrt(speed2);
        v.x *= scale;
        v.y *= scale;
      }
    }
  }

  function integrate(alpha) {
    let maxV2 = 0;
    for (const node of nodes) {
      const anchor = pinState.get(node.id);
      if (anchor) {
        positions[node.id].x = anchor.x;
        positions[node.id].y = anchor.y;
        velocities[node.id].x = 0;
        velocities[node.id].y = 0;
        continue;
      }
      const p = positions[node.id];
      const v = velocities[node.id];
      p.x += v.x * alpha;
      p.y += v.y * alpha;
      v.x *= VELOCITY_DECAY;
      v.y *= VELOCITY_DECAY;
      const s2 = v.x * v.x + v.y * v.y;
      if (s2 > maxV2) maxV2 = s2;
    }
    sim._maxVelocity = Math.sqrt(maxV2);
  }

  function computeBounds() {
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const node of nodes) {
      const p = positions[node.id];
      if (p.x < minX) minX = p.x;
      if (p.y < minY) minY = p.y;
      if (p.x > maxX) maxX = p.x;
      if (p.y > maxY) maxY = p.y;
    }
    if (!Number.isFinite(minX)) {
      minX = -100; minY = -100; maxX = 100; maxY = 100;
    }
    return { minX, minY, maxX, maxY };
  }

  // ───── Public sim object ────────────────────────────────────────────────
  const sim = {
    positions,                                    // mutated in place each step
    get bounds() { return computeBounds(); },     // recomputed cheap on each access
    alpha: 1.0,
    _maxVelocity: 0,

    step(dt /* unused at v2 — single-iter step */) {
      applyCharge();
      applySprings();
      applyCenter();
      applyCollision();
      clampVelocity();
      integrate(this.alpha);
      this.alpha *= ALPHA_DECAY_PER_FRAME;
    },

    reheat(strength) {
      this.alpha = Math.min(1.0, this.alpha + strength);
    },

    pin(id, anchor) {
      pinState.set(id, { x: anchor.x, y: anchor.y });
    },

    unpin(id) {
      pinState.delete(id);
    },

    isSettled() {
      return this.alpha < SETTLED_ALPHA && this._maxVelocity < SETTLED_VEL;
    },
  };

  // ───── Cold start — run sim to convergence (~300 iters or alpha floor) ────
  for (let i = 0; i < ITERATIONS && sim.alpha > 0.001; i += 1) {
    sim.step(1);
  }

  // Pin every concept that is NOT initially visible at the document's
  // starting playhead time. "Initially visible" matches buildCumulativeVisibility's
  // rule in buildGraphRenderState.js: concept.firstSeenAt <= initialPlayheadTime.
  const initialPlayheadTime =
    viewModel.frames.macro[0]?.span?.start ??
    viewModel.frames.meso[0]?.span?.start ??
    0;
  for (const concept of atomic) {
    const seen = concept.firstSeenAt;
    const visibleAtStart = typeof seen === 'number' && seen <= initialPlayheadTime;
    if (!visibleAtStart) sim.pin(concept.id, positions[concept.id]);
  }

  // After cold-start + pinning: reset alpha and velocities so the rAF loop
  // (when wired in Task 3) sees a settled system, not residual cold-start motion.
  sim.alpha = 0;
  for (const node of nodes) {
    velocities[node.id].x = 0;
    velocities[node.id].y = 0;
  }
  sim._maxVelocity = 0;

  return sim;
}

// ───── Pair-data precompute ─────────────────────────────────────────────────
function buildPairs(viewModel, atomic) {
  const atomicIds = atomic.map((c) => c.id);
  const conceptById = viewModel.concepts.byId;
  const coOccurrence = viewModel.graph.coOccurrence ?? {};

  // 1) Compute SCORE_REF: 90th-percentile of positive co-occurrence scores.
  const positiveScores = [];
  for (const a of atomicIds) {
    const row = coOccurrence[a];
    if (!row) continue;
    for (const b of Object.keys(row)) {
      if (a < b) positiveScores.push(row[b]);    // avoid double-counting symmetric pairs
    }
  }
  positiveScores.sort((x, y) => x - y);
  const scoreRef = positiveScores.length
    ? positiveScores[Math.min(positiveScores.length - 1, Math.floor(positiveScores.length * SCORE_REF_PERCENTILE))]
    : 1; // no co-occurrence data → arbitrary positive; fallback springs do the work

  // 2) Build a quick relation lookup.
  const hasRelation = new Set();
  for (const edge of viewModel.graph.edges ?? []) {
    hasRelation.add(`${edge.from}|${edge.to}`);
    hasRelation.add(`${edge.to}|${edge.from}`);
  }

  // 3) Walk every unordered atomic pair, decide if a spring exists, build pair record.
  const pairs = [];
  for (let i = 0; i < atomicIds.length; i += 1) {
    for (let j = i + 1; j < atomicIds.length; j += 1) {
      const a = atomicIds[i];
      const b = atomicIds[j];

      const score = coOccurrence[a]?.[b] ?? 0;
      const conceptA = conceptById[a];
      const conceptB = conceptById[b];
      const sharesCluster =
        !!conceptA?.parentIds?.[0] &&
        conceptA.parentIds[0] === conceptB?.parentIds?.[0];
      const relation = hasRelation.has(`${a}|${b}`);

      let idealD;
      if (score > 0) {
        const normalized = Math.max(0, Math.min(1, score / scoreRef));
        idealD = D_MAX - (D_MAX - D_MIN) * normalized;
      } else if (relation || sharesCluster) {
        idealD = D_MID;
      } else {
        continue;                                 // no spring for this pair
      }

      const stiffness =
        BASE_STIFFNESS *
        (relation ? RELATION_STIFFNESS_MULT : 1.0) *
        (sharesCluster ? SIBLING_STIFFNESS_MULT : 1.0);

      pairs.push({ a, b, idealD, stiffness });
    }
  }

  return pairs;
}
```

Two design points worth flagging inline so the reviewer doesn't need to cross-reference the spec:

- **Cluster anchors dropped.** v1 included `viewModel.concepts.clustered` as invisible physics nodes. v2 doesn't — atomic-only physics, sibling proximity comes from the sibling-stiffness multiplier on co-occurrence springs (plus the D_MID fallback when no co-occurrence exists between two siblings). This matches the spec § "Cluster anchors as physics nodes — Dropped".
- **Post-cold-start reset.** After the 300-iter cold start, we explicitly zero `sim.alpha` and all velocities. Without this, the rAF loop (wired in Task 3) would start mid-warm-phase on doc load and the user would see ~5 s of residual settling that's just numerical-precision noise. Cold-start positions are the equilibrium; reset to "settled" so live physics only activates on actual disturbance.

- [ ] **Step 3: Update `ui/app.js` — swap `computeLayout` for `createLayoutSimulator`, add shim**

Open `ui/app.js`.

At line 5, the existing import:

```javascript
import { computeLayout } from './layout.js';
```

Change to:

```javascript
import { createLayoutSimulator } from './layout.js';
```

In the `state` object initialisation (line 29), change:

```javascript
const state = {
  document: undefined,
  viewModel: undefined,
  layout: undefined,                  // ← keep this name; will become a getter via shim
  // ...
```

to:

```javascript
const state = {
  document: undefined,
  viewModel: undefined,
  sim: undefined,                     // ← new: the live simulator
  // layout is now a getter; defined below via Object.defineProperty after sim exists
  // ...
```

Remove the `layout: undefined,` line (it's getting replaced by the getter).

In `bootstrap()` (line 58), the current line 64:

```javascript
  state.layout = computeLayout(state.viewModel);
```

becomes:

```javascript
  state.sim = createLayoutSimulator(state.viewModel);
  Object.defineProperty(state, 'layout', {
    get() {
      return {
        nodes: state.sim.positions,
        bounds: state.sim.bounds,
      };
    },
    configurable: true,
  });
```

The `configurable: true` matters only if you ever want to redefine the property (you don't in v2 — but it's the conservative default for `defineProperty` on a state singleton).

`fitCameraToLayout(state.camera, state.layout, state.viewport);` on line 72 keeps working — it reads `state.layout.bounds` via the getter, which calls `sim.bounds` (which recomputes). One tradeoff: each `state.layout.bounds` access recomputes; we accept it because bounds is O(n) and not called every frame.

The `console.info` at line 101 reads `state.layout.nodes`:

```javascript
console.info('mindgraph canvas POC ready', {
  nodes: Object.keys(state.layout.nodes).length,
});
```

This continues to work — `state.layout.nodes` returns `state.sim.positions`.

- [ ] **Step 4: Verify with `ui:check`**

```bash
npm run ui:check
```

Expected: PASS. If it fails on `ui/layout.js`, the most likely cause is a syntax slip in the rewrite — check the error line.

- [ ] **Step 5: Verify with `test:smoke:node`**

```bash
npm run test:smoke:node
```

Expected: PASS. Then restore canonical samples (smoke can mutate them):

```bash
git checkout HEAD -- examples/out/episode-1-built.mindgraph.json examples/out/build-sample.mindgraph.json examples/out/awakening.mindgraph.json
trash examples/out/empty.mindgraph.json 2>/dev/null || rm -f examples/out/empty.mindgraph.json
```

- [ ] **Step 6: Browser walk — Episode 1**

```bash
npm run ui:dev
```

Open `http://127.0.0.1:4173`. The default-loaded document is `examples/out/episode-1-built.mindgraph.json`. Walk:

- Layout looks coherent. Positions are **different from v1** (new spring math), but plausibly clustered.
- Cluster identity still visible via dot color.
- Layout is stable across reloads (refresh, positions identical — determinism check).
- Bloom-in still works as you scroll (concepts fade in at precomputed positions).
- Click and hover work.
- Camera fit on initial load shows whole layout.
- Resize window: no layout reflow.

If Episode 1's layout looks markedly worse than v1, the tuning constants in `ui/layout.js` may need adjustment. Likely candidates: `D_MAX` (lower means tighter overall), `SCORE_REF_PERCENTILE` (lower means more pairs hit D_MIN, tighter clustering), or `BASE_STIFFNESS` (higher means springs win harder against charge).

- [ ] **Step 7: Capture before/after screenshot for commit message**

Open DevTools, screenshot the canvas. The commit message will note "positions differ from v1" — having a side-by-side screenshot in commit-or-PR context is useful.

If Playwright/MCP browser is available, scripted screenshot; otherwise manual via OS screenshot tool.

- [ ] **Step 8: Stop the dev server with Ctrl+C**

- [ ] **Step 9: Commit**

```bash
git add ui/layout.js ui/app.js
git commit -m "$(cat <<'EOF'
feat(ui): introduce createLayoutSimulator with cold-start equivalent to v1

Replaces ui/layout.js's computeLayout(viewModel) one-shot function with
a createLayoutSimulator(viewModel) factory that returns a stateful
simulator instance. The simulator's external contract:

  sim.positions               // Record<id, {x, y}> — mutated in place
  sim.bounds                  // recomputed cheap from positions
  sim.alpha                   // 0..1, drives whether step() does work
  sim.step(dt)                // one integration step
  sim.reheat(strength)        // additive with cap at 1.0
  sim.pin(id, anchor) / unpin(id)
  sim.isSettled()             // alpha < threshold && maxVelocity < threshold

At construction time the simulator runs 300 iterations of cold-start
(same explicit-Euler loop as v1) using the new spring math: per-pair
ideal distance derived from co-occurrence (via viewModel.graph.coOccurrence
from the previous commit), per-pair stiffness modulated by explicit
relations and shared-cluster siblings, fallback D_MID springs for
relation-or-sibling pairs with no co-occurrence. After cold-start
convergence, every concept whose firstSeenAt > initialPlayheadTime is
pinned at its cold-start position; bloom-in (next commit) will un-pin
them as the prose scrolls past their first mention.

Cluster anchors are no longer physics nodes — atomic-only physics, with
sibling-stiffness multipliers + D_MID fallback covering the spatial
role that membership springs played in v1.

ui/app.js swap: state.sim = createLayoutSimulator(vm); state.layout
becomes a getter shim returning {nodes: sim.positions, bounds: sim.bounds}
so draw.js/labels.js/camera.js consume the same shape they did under v1.

No continuous physics yet — the rAF loop doesn't call sim.step. Alpha
is reset to 0 after cold-start so the system reads as settled. Live
physics wired in the next commit.
EOF
)"
```

---

## Task 3: Wire `sim.step(dt)` into the animator + bloom-in reheat hooks

**Files:**
- Modify: `ui/animator.js` — call `sim.step(dt)` per tick, detect newly-bloomed ids and call `sim.unpin(id)` + `sim.reheat(0.20)`, gate `stillAnimating` on `!sim.isSettled()`
- Modify: `ui/app.js` — pass `sim` reference into the animator's step (it's already in `state`, so just an opts addition)
- Verify: `npm run ui:check`, browser walk

**Why:** This is the moment the simulator becomes live. After this lands, the system reheats on every concept bloom-in (per Q5a-1) and the rAF loop keeps drawing while the simulator hasn't settled. The cold-start equilibrium from Task 2 stays as the baseline; reheats produce subtle motion around it.

- [ ] **Step 1: Open `ui/animator.js` and locate the bloom-in diff loop**

Open `ui/animator.js`. The bloom-detection block lives at lines 83–91:

```javascript
} else {
  // Newly entering ids → schedule a bloom.
  for (const id of conceptSet) if (!prevConceptSet.has(id)) startBloom(id, now);
  for (const id of edgeSet) if (!prevEdgeSet.has(id)) startBloom(id, now);

  // Newly leaving ids → schedule a fade.
  for (const id of prevConceptSet) if (!conceptSet.has(id)) startFade(id, now);
  for (const id of prevEdgeSet) if (!edgeSet.has(id)) startFade(id, now);
}
```

This is where we inject `sim.unpin(id) + sim.reheat(0.20)` for newly-entering concepts.

- [ ] **Step 2: Add the sim wiring to `step()`**

Modify `ui/animator.js`'s `step()` function. The full updated function:

```javascript
function step(now, opts) {
  const {
    cumulativeVisibleConceptIds = [],
    cumulativeVisibleEdgeIds = [],
    cameraTarget,
    cameraMode,
    camera,
    sim,              // ← new opt
  } = opts;

  const conceptSet = new Set(cumulativeVisibleConceptIds);
  const edgeSet = new Set(cumulativeVisibleEdgeIds);

  const isFirstStep = prevConceptSet === null;

  if (isFirstStep) {
    for (const id of conceptSet) {
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
    // Newly entering ids → schedule a bloom + reheat the sim (Q5a-1).
    for (const id of conceptSet) {
      if (!prevConceptSet.has(id)) {
        startBloom(id, now);
        if (sim) {
          sim.unpin(id);            // concept rejoins live dynamics
          sim.reheat(0.20);         // additive with cap; per-event strength from spec § Reheat policy
        }
      }
    }
    for (const id of edgeSet) if (!prevEdgeSet.has(id)) startBloom(id, now);

    // Newly leaving ids → schedule a fade.
    for (const id of prevConceptSet) if (!conceptSet.has(id)) startFade(id, now);
    for (const id of prevEdgeSet) if (!edgeSet.has(id)) startFade(id, now);
  }
  prevConceptSet = conceptSet;
  prevEdgeSet = edgeSet;

  // ── existing bloom/fade advance block — unchanged ──
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
    } else if (s.fading) {
      const t = (now - s.animStart) * 1000 / FADE_DURATION_MS;
      if (t >= 1) {
        s.opacity = 0;
        s.fading = false;
      } else {
        s.opacity = 1 - t;
        stillAnimating = true;
      }
    }
  }

  // ── NEW: step the physics simulator ────────────────────────────────────
  if (sim && !sim.isSettled()) {
    sim.step(opts.dt ?? 0);
    stillAnimating = true;             // sim work means we must redraw next frame
  }

  // ── existing camera-target smoothing — unchanged ───────────────────────
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
      microSmoothBuffer.length = 0;
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

  return stillAnimating;
}
```

Two integration points worth flagging:

- **`isFirstStep` branch deliberately does NOT call `sim.reheat` or `sim.unpin`.** On the first call, the `conceptSet` is whatever the initial-visible set is, and Task 2's cold-start already left those concepts unpinned and the rest pinned. We don't want to retroactively reheat — the system is settled by design after cold-start. Re-pinning is what the bloom-in event does, in the `else` branch.
- **`if (sim && !sim.isSettled()) sim.step(...)`**: the `sim &&` guard is defensive against `sim` being undefined during early bootstrap. Once `bootstrap()` has run, it's always present. The `!sim.isSettled()` guard is the actual gate — when settled, `step()` does no work.

- [ ] **Step 3: Pass `sim` through from `ui/app.js`'s rAF loop**

Open `ui/app.js`. The `kickAnimationLoop` function (lines 121–146) calls `state.animator.step(now / 1000, { ... })`. Add `sim: state.sim` to the opts object:

```javascript
const stillAnimating = state.animator.step(now / 1000, {
  cumulativeVisibleConceptIds: state.graphRenderState?.cumulativeVisibleConceptIds ?? [],
  cumulativeVisibleEdgeIds: state.graphRenderState?.cumulativeVisibleEdgeIds ?? [],
  cameraTarget: state.graphRenderState?.cameraTarget,
  cameraMode: state.cameraMode,
  camera: state.camera,
  viewport: state.viewport,
  activeLevel: state.activeLevel,
  sim: state.sim,                                // ← new
  dt,
});
```

That's it for app.js.

- [ ] **Step 4: Verify with `ui:check`**

```bash
npm run ui:check
```

Expected: PASS.

- [ ] **Step 5: Verify with `test:smoke:node`**

```bash
npm run test:smoke:node
```

Expected: PASS. Then restore canonical samples (smoke can mutate them):

```bash
git checkout HEAD -- examples/out/episode-1-built.mindgraph.json examples/out/build-sample.mindgraph.json examples/out/awakening.mindgraph.json
trash examples/out/empty.mindgraph.json 2>/dev/null || rm -f examples/out/empty.mindgraph.json
```

- [ ] **Step 6: Browser walk — bloom-in reheat**

```bash
npm run ui:dev
```

Open `http://127.0.0.1:4173`. Walk:

- **Default zoom** — layout looks like Task 2. No motion until you scroll.
- **Scroll the prose** — as concepts bloom in, the area around the newly-visible dots **subtly settles** (a few hundred ms of motion per bloom). Should feel "alive" but not chaotic — the new dot doesn't *walk in*, it fades in at its precomputed position while the neighborhood adjusts.
- **Scroll quickly through several chapters** — multiple blooms in rapid succession reheat the sim repeatedly. Alpha saturates at 1.0 (we'd need the `?perf=1` overlay to see this number; the visible effect is sustained motion until scrolling stops).
- **Stop scrolling** — within ~1 second the motion damps below `SETTLED_VEL`; the rAF loop dies (open DevTools Performance tab, watch frames stop being painted ~1s after the last bloom).
- **Click a concept** — selection works as before. No physics motion because Task 4 hasn't added the selection reheat yet (that's intentional in this commit — verify it's silent).
- **Reload the page** — same layout positions as before. Determinism preserved.

If during a long scroll you see runaway motion (positions blowing up to Infinity / NaN), the velocity clamp may not be holding. Most likely cause: the cold-start equilibrium plus reheat accumulator pushed alpha way past what the math survives. Investigate by adding a `console.log(sim.alpha, sim._maxVelocity)` inside `step()` to see what's happening. The clamp should hold; if not, lower `MAX_VELOCITY_PER_ITER` or reduce reheat strength.

- [ ] **Step 7: Stress test — fast-scroll the full document**

In the prose panel, scroll from top to bottom as fast as comfortable. The graph should remain visually coherent — clusters maintain rough shape, no concept escapes the viewport. If concepts visibly migrate to noticeably wrong places, the reheat-during-bloom strength may be too high; reduce `0.20` to `0.10` and retest.

- [ ] **Step 8: Stop the dev server**

- [ ] **Step 9: Commit**

```bash
git add ui/animator.js ui/app.js
git commit -m "$(cat <<'EOF'
feat(ui): wire continuous simulation into rAF loop

The animator now calls sim.step(dt) on each tick when the simulator
isn't settled, and the rAF loop's stillAnimating gate includes
!sim.isSettled() so painting continues during warm phases. The
bloom-detection block additionally calls sim.unpin(id) +
sim.reheat(0.20) for each newly-entering concept, implementing the
Q5a-1 policy from the design spec — every bloom-in subtly disturbs the
system; alpha decays back below SETTLED_ALPHA in ~1 s.

isFirstStep deliberately doesn't reheat — Task 2's cold-start left the
system at equilibrium with the initially-visible concepts unpinned, so
the first tick has nothing to do. Subsequent ticks only reheat on
genuine bloom-in events (prose-scroll past a concept's firstSeenAt).

Selection click is silent in this commit; selection reheat lands in
the drag-and-reheat-wiring commit next.
EOF
)"
```

---

## Task 4: Drag-to-pin and selection reheat

**Files:**
- Modify: `ui/events.js` — pointerdown hit-test for dots → `sim.pin + alpha=1.0`; pointermove updates pin anchor; pointerup → `sim.unpin + reheat(0.5)`. Click selection adds `sim.reheat(0.10)`
- Verify: `npm run ui:check`, browser walk including drag stress test

**Why:** Drag is the user-facing payoff of having a continuous simulator. Now that pinning is a primitive (added in Task 2 for invisible concepts, used in Task 3 for bloom-in), drag is essentially "do the same thing, but driven by mouse instead of bloom-detection."

- [ ] **Step 1: Read current `ui/events.js` pointer plumbing**

`ui/events.js:196-227` has the existing pointer-down/move/up handlers that drive **canvas pan** (not dot drag — that's what we're adding). The existing flow:

```
pointerdown   → dragging = true; record start coords
pointermove   → if moved >4 px, switch cameraMode=manual; update camera.pan
pointerup     → dragging = false; release pointer capture
```

We need to fork this: if pointerdown lands on a *dot*, drag the dot; otherwise, fall through to the existing pan-the-canvas behavior. The existing click handler (line 234) already does hit-testing for selection — we re-use the same `hitTestAt` import.

- [ ] **Step 2: Add `hitTestAt` import (already present) and inspect signature**

The import already exists:

```javascript
import { hitTestAt } from './hit-test.js';
```

`hitTestAt(state, world) → { kind, id } | null` where kind is `'concept'` or `'cluster'`. For drag we only want to grab *bloomed concepts* — `hitTestAt` already filters to visible nodes, so any returned hit is something we can drag.

- [ ] **Step 3: Add dot-drag state and modify pointerdown / move / up**

In `ui/events.js`'s `bindEvents`, modify the canvas-events block (currently lines 176-263). The full updated block (the `if (canvasEl && !canvasEl.dataset.boundCameraEvents) { ... }` body):

```javascript
if (canvasEl && !canvasEl.dataset.boundCameraEvents) {
  canvasEl.dataset.boundCameraEvents = '1';

  canvasEl.addEventListener('wheel', (e) => {
    e.preventDefault();
    const rect = canvasEl.getBoundingClientRect();
    const point = { x: e.clientX - rect.left, y: e.clientY - rect.top };
    const factor = Math.exp(-e.deltaY * 0.0015);
    state.cameraMode = 'manual';
    zoomAround(state.camera, point, factor);
    render();
  }, { passive: false });

  // Pan-vs-drag state. dragging.kind === 'pan' means panning the camera;
  // dragging.kind === 'dot' means dragging a pinned concept.
  let dragging = null;
  let lastX = 0;
  let lastY = 0;
  let downStartX = 0;
  let downStartY = 0;
  let dragSwitched = false;
  canvasEl.addEventListener('pointerdown', (e) => {
    const rect = canvasEl.getBoundingClientRect();
    const screen = { x: e.clientX - rect.left, y: e.clientY - rect.top };
    const world = screenToWorld(state.camera, screen);
    const hit = hitTestAt(state, world);

    if (hit && hit.kind === 'concept' && state.sim) {
      // Dot drag — pin the concept under the cursor.
      dragging = { kind: 'dot', id: hit.id };
      state.sim.pin(hit.id, world);
      state.sim.alpha = 1.0;
      canvasEl.setPointerCapture(e.pointerId);
      canvasEl.style.cursor = 'grabbing';
      scheduleDraw();
      return;
    }

    // Else: pan path (unchanged behavior).
    dragging = { kind: 'pan' };
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

    if (dragging.kind === 'dot') {
      const rect = canvasEl.getBoundingClientRect();
      const screen = { x: e.clientX - rect.left, y: e.clientY - rect.top };
      const world = screenToWorld(state.camera, screen);
      state.sim.pin(dragging.id, world);
      state.sim.alpha = 1.0;
      scheduleDraw();
      return;
    }

    // Pan path (unchanged).
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
  canvasEl.addEventListener('pointerup', (e) => {
    if (!dragging) return;
    try { canvasEl.releasePointerCapture(e.pointerId); } catch (_) {}
    canvasEl.style.cursor = 'grab';

    if (dragging.kind === 'dot' && state.sim) {
      state.sim.unpin(dragging.id);
      state.sim.reheat(0.5);
      dragging = null;
      scheduleDraw();          // wakes the rAF loop if it was idle
      return;
    }

    dragging = null;
    render();
  });
  canvasEl.addEventListener('pointercancel', (e) => {
    // pointercancel fires on iOS scroll interruption, browser-level capture
    // loss, etc. Treat as a clean release so we don't leave the dot pinned.
    if (!dragging) return;
    try { canvasEl.releasePointerCapture(e.pointerId); } catch (_) {}
    canvasEl.style.cursor = 'grab';
    if (dragging.kind === 'dot' && state.sim) {
      state.sim.unpin(dragging.id);
      state.sim.reheat(0.5);
    }
    dragging = null;
    scheduleDraw();
  });
  canvasEl.style.cursor = 'grab';

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
    const world = screenToWorld(state.camera, screen);
    const hit = hitTestAt(state, world);
    if (hit) {
      state.selectedConceptId = hit.id;
      state.selectedFrameRef = undefined;
      state.cameraMode = 'selection';
      if (state.sim) state.sim.reheat(0.10);     // ← selection nudge
      scrollProseToConcept(state.selectedConceptId);
    } else {
      state.selectedConceptId = undefined;
      state.selectedFrameRef = undefined;
      if (state.cameraMode === 'selection') state.cameraMode = 'auto';
    }
    render();
  });
}
```

Three things to call out:

- **Two pointerdown listeners**: the existing code already has two `pointerdown` listeners (one for drag/pan plumbing, one to record `downAt` for click suppression). We keep both — the second one's job is unchanged.
- **`pointercancel`**: new handler for robustness. Without it, an interrupted gesture (e.g., a system modal opens mid-drag) would leave the dot pinned at the cursor's last position forever. With it, the dot un-pins cleanly.
- **`scheduleDraw()` on drag-end**: the rAF loop may have been idle (sim settled). Calling `scheduleDraw` wakes it so the reheated sim gets to step.

- [ ] **Step 4: Verify with `ui:check`**

```bash
npm run ui:check
```

Expected: PASS.

- [ ] **Step 5: Verify with `test:smoke:node`**

```bash
npm run test:smoke:node
```

Expected: PASS. Then restore canonical samples (smoke can mutate them):

```bash
git checkout HEAD -- examples/out/episode-1-built.mindgraph.json examples/out/build-sample.mindgraph.json examples/out/awakening.mindgraph.json
trash examples/out/empty.mindgraph.json 2>/dev/null || rm -f examples/out/empty.mindgraph.json
```

- [ ] **Step 6: Browser walk — drag basics**

```bash
npm run ui:dev
```

Open `http://127.0.0.1:4173`. Walk:

- **Click on a dot** — concept gets selected (existing v1 behavior). The graph subtly settles for ~250 ms (Q5b-1 selection reheat at +0.10). Verify by watching the dot's neighborhood for slight motion right after click.
- **Press and hold on a dot, then drag across the canvas** — the dot follows the cursor 1:1; neighbors get pulled around live. Cursor shows `grabbing`. The drag is buttery, not laggy.
- **Release the dot** — it stays roughly where you dropped it but neighbors continue to settle for ~1.5 s. After settling, the released dot may have moved slightly (the spring forces from co-occurring neighbors pull it back toward equilibrium, but the new equilibrium reflects the system's adapted state).
- **Press on empty canvas and drag** — pans the camera (existing pan behavior unchanged).
- **Wheel-zoom while dragging a dot** — pin anchor uses live `screenToWorld(state.camera, ...)`, so the dot stays attached to the cursor in screen space across the zoom.
- **Scroll-bloom while dragging a dot** — newly-bloomed concept reheats (+0.20) and un-pins. Dragged dot remains pinned. No conflict.

- [ ] **Step 7: Stress test — 60-second hold-drag**

Press on a dot. Hold pointer down and slowly drag the dot back and forth across the canvas for 60 seconds. Stop somewhere offscreen. Observe:

- No `NaN` or `Infinity` in `sim.positions` (open DevTools console: `Object.values(state.sim.positions).flatMap(p => [p.x, p.y]).some(n => !Number.isFinite(n))` should return `false`).
- The visible cluster doesn't migrate to a corner — it's been pinned by one dot but the rest of the system holds its rough shape due to charge + collision + co-occurrence springs.
- Release the pointer. The graph rapidly settles back to its equilibrium (~1.5 s).

This stress-tests `alpha = 1.0` being held for an extended period. If the test passes, the explicit-Euler stability claims in the spec § "Stability" hold up empirically.

- [ ] **Step 8: Stop the dev server**

- [ ] **Step 9: Commit**

```bash
git add ui/events.js
git commit -m "$(cat <<'EOF'
feat(ui): drag-to-pin and full reheat wiring

Pointerdown on a concept dot now pins it to the cursor and sets
sim.alpha = 1.0; pointermove keeps the pin attached to the live cursor
position in world coordinates (recomputed each move so wheel-zoom mid-
drag stays correct); pointerup unpins and applies a reheat(0.5) so the
released dot settles cleanly. pointercancel mirrors pointerup so an
interrupted gesture never leaves a dot pinned forever.

Pan behavior is preserved — pointerdown on empty canvas continues to
drive the camera-pan path. The fork between dot-drag and pan-drag
happens at pointerdown based on whether hitTestAt returns a concept
hit.

Click selection now calls sim.reheat(0.10) so the selected concept's
neighborhood eases open by a small amount as forces re-balance with
selection-driven dimming.

All four reheat event paths from spec § Reheat policy are now wired:
  - bloom-in       +0.20  (animator, prior commit)
  - selection      +0.10  (events.js click handler)
  - drag-start     1.0    (events.js pointerdown on dot)
  - drag-release   +0.5   (events.js pointerup / pointercancel)
EOF
)"
```

---

## Self-review checklist

After all four tasks land, walk the spec section by section and confirm coverage:

- [x] Spec § Locked-in decisions → all eight decisions reflected in the implementation tasks.
- [x] Spec § Architecture overview / external contract → Task 2 builds the contract; Task 3 wires it; Task 4 extends it for drag.
- [x] Spec § Spring forces — co-occurrence + relation-modulated stiffness → Task 1 (co-occurrence derivation) + Task 2 (buildPairs uses it; ideal_d + stiffness composition).
- [x] Spec § Reheat policy → Task 2 (alpha + decay constants), Task 3 (bloom reheat at +0.20), Task 4 (selection +0.10, drag-start 1.0, drag-release +0.5).
- [x] Spec § Pinning & drag → Task 2 (pin/unpin/integrate-with-pin-check), Task 4 (drag wiring).
- [x] Spec § Camera-follow → no change required; existing animator stays as-is.
- [x] Spec § Determinism → preserved via Task 2 (seeded init, sorted SCORE_REF, no RNG).
- [x] Spec § Stability & perf → Task 2 carries forward v1's velocity clamp + min_dist; Task 3 stress tests via fast-scroll; Task 4 stress tests via 60-s hold-drag.
- [x] Spec § Rollout (four commits) → Tasks 1–4 map 1:1.
- [x] Spec § Out of scope items not introduced → no Barnes-Hut, no auto-normalize toggle, no per-doc overrides, no replay mode, no sticky drag, no document-mutation reheat.

Type / signature consistency:

- `viewModel.graph.coOccurrence: Record<id, Record<id, number>>` — written in Task 1, read in Task 2 (`buildPairs`).
- `sim.positions: Record<id, {x, y}>` — written in Task 2, read by the shim in Task 2 and by `draw.js` / `labels.js` unchanged.
- `sim.bounds: {minX, minY, maxX, maxY}` — written in Task 2 (getter), read by `camera.js`'s `fitCameraToLayout`.
- `sim.alpha`, `sim.reheat`, `sim.pin`, `sim.unpin`, `sim.isSettled` — written in Task 2; called from Task 3 (animator) and Task 4 (events).
- `firstSeenAt` field on `concept` — read in Task 2's cold-start invisible-detection (already populated by `buildConceptsVM` via `deriveFirstSeenAt`).

---

## Done criteria

All four commits in `main`, each passing `npm run ui:check` and `npm run test:smoke:node`. After Task 4:

- Episode 1 sample renders coherently — positions are *different* from v1 (new spring math) but clusters are clearly visible.
- Bloom-in produces subtle live motion as the user scrolls; the simulator damps to settled within ~1 s of the last bloom.
- Drag a dot — it follows the cursor, neighbors react live, release settles within ~1.5 s.
- 60-second hold-drag stress test produces no NaN / Infinity in `sim.positions`.
- Reload the same document twice — positions are bit-exactly identical after the system settles (determinism preserved).

If Playwright/MCP browser is available, script the post-Task-4 walk and capture a 5-second screencast for the PR description. Otherwise capture a screenshot at default zoom plus a screenshot mid-drag.
