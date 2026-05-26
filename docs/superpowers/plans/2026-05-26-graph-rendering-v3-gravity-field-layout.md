# Graph Rendering v3 Gravity-Field Layout Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the rigid v2/v0.6.0 pair-distance layout with a smoother gravity-field elastic graph that lets hubs organize local rings while the whole cloud stays gently contained.

**Architecture:** Keep the existing `createLayoutSimulator(viewModel) → sim` contract so `ui/app.js`, `ui/draw.js`, labels, camera, and render-state consumers continue to work. Refactor `ui/layout.js` internally around v3 forces: node mass, relation springs, mass-based repulsion, gentle center gravity, soft collision, dt-aware damping, short warm-start, and bloom placement. Add focused Node tests for pure simulator behavior and run existing UI/VM checks.

**Tech Stack:** Vanilla ES modules, browser Canvas UI, Node built-in test runner (`node --test`), no new runtime dependencies, no bundler.

---

## File structure

- Modify `ui/layout.js`
  - Own all v3 force constants and simulator internals.
  - Export `createLayoutSimulator`, `seededUnit`, `clusterColor` exactly as today.
  - Add public method `placeForBloom(id, visibleIds)` for animator-driven progressive entry.
  - Keep `positions`, `bounds`, `alpha`, `step(dt)`, `reheat`, `pin`, `unpin`, `isSettled` public contract.

- Modify `ui/animator.js`
  - On newly visible concepts, call `sim.placeForBloom(id, prevConceptSet)` before `sim.unpin(id)` and `sim.reheat(0.28)`.
  - Keep bloom opacity/scale logic unchanged.

- Modify `ui/events.js`
  - Retune selection reheat from `0.10` to `0.08`.
  - Keep drag alpha/reheat behavior mostly unchanged.

- Create `test/layout-v3.test.js`
  - Test pure simulator invariants without DOM: mass/ring behavior via positions after stepping, bloom placement near visible relation neighbor, dt-aware step changes alpha smoothly, and no cluster-only collapse.

- Modify `package.json`
  - Add `test:layout`: `node --test test/layout-v3.test.js`.

---

### Task 1: Add focused layout v3 regression tests

**Files:**
- Create: `test/layout-v3.test.js`
- Modify: `package.json`

- [ ] **Step 1: Add the test script to `package.json`**

Edit the `scripts` object to include this entry after `ui:check`:

```json
"test:layout": "node --test test/layout-v3.test.js"
```

- [ ] **Step 2: Create `test/layout-v3.test.js` with failing tests**

Write this complete file:

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { createLayoutSimulator } from '../ui/layout.js';

function concept(id, parentIds = []) {
  return {
    id,
    label: id,
    level: 'atomic',
    parentIds,
    childIds: [],
    firstSeenAt: 0,
  };
}

function edge(id, from, to, weight = 1) {
  return { id, from, to, type: 'related', weight, provenance: 'source' };
}

function vm({ concepts, edges, coOccurrence = {}, importance = {} }) {
  const byId = Object.fromEntries(concepts.map((c) => [c.id, c]));
  return {
    concepts: {
      atomic: concepts,
      clustered: [],
      byId,
      childrenByClusterId: {},
      clustersByAtomicId: {},
    },
    graph: {
      nodes: concepts.map((c) => ({ ...c, degree: edges.filter((e) => e.from === c.id || e.to === c.id).length })),
      edges,
      nodeById: byId,
      coOccurrence,
      conceptImportance: importance,
    },
    frames: { micro: [], meso: [], macro: [{ span: { start: 0, end: 1 } }] },
  };
}

function dist(a, b) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function average(values) {
  return values.reduce((sum, v) => sum + v, 0) / values.length;
}

function step(sim, frames = 180) {
  for (let i = 0; i < frames; i += 1) sim.step(1 / 60);
}

test('hub leaves settle into a wider ring than a simple pair', () => {
  const hubConcepts = [concept('hub'), ...Array.from({ length: 8 }, (_, i) => concept(`leaf-${i}`))];
  const hubVm = vm({
    concepts: hubConcepts,
    edges: hubConcepts.slice(1).map((c, i) => edge(`e-${i}`, 'hub', c.id)),
    importance: { hub: 1 },
  });
  const hubSim = createLayoutSimulator(hubVm);
  hubSim.reheat(1);
  step(hubSim, 240);

  const hub = hubSim.positions.hub;
  const ringDistances = hubConcepts.slice(1).map((c) => dist(hub, hubSim.positions[c.id]));
  const ringAverage = average(ringDistances);

  const pairVm = vm({ concepts: [concept('a'), concept('b')], edges: [edge('ab', 'a', 'b')] });
  const pairSim = createLayoutSimulator(pairVm);
  pairSim.reheat(1);
  step(pairSim, 240);
  const pairDistance = dist(pairSim.positions.a, pairSim.positions.b);

  assert.ok(ringAverage > pairDistance + 8, `expected hub ring ${ringAverage} > pair ${pairDistance} + 8`);
  assert.ok(ringAverage > 90, `expected visible hub orbit, got ${ringAverage}`);
});

test('cluster-only sibling concepts are not pulled together without relation edges', () => {
  const document = vm({
    concepts: [concept('a', ['cluster-x']), concept('b', ['cluster-x']), concept('c', ['cluster-x'])],
    edges: [],
  });
  const sim = createLayoutSimulator(document);
  sim.reheat(1);
  step(sim, 180);

  const ab = dist(sim.positions.a, sim.positions.b);
  const bc = dist(sim.positions.b, sim.positions.c);
  const ac = dist(sim.positions.a, sim.positions.c);
  assert.ok(average([ab, bc, ac]) > 100, `cluster-only siblings should not collapse, distances: ${ab}, ${bc}, ${ac}`);
});

test('placeForBloom moves a new node near its strongest visible relation neighbor', () => {
  const document = vm({
    concepts: [concept('hub'), concept('newbie'), concept('other')],
    edges: [edge('hub-newbie', 'hub', 'newbie'), edge('hub-other', 'hub', 'other')],
    importance: { hub: 1 },
  });
  const sim = createLayoutSimulator(document);
  const before = { ...sim.positions.newbie };
  const hubBefore = { ...sim.positions.hub };

  assert.equal(typeof sim.placeForBloom, 'function');
  sim.placeForBloom('newbie', new Set(['hub', 'other']));

  const after = sim.positions.newbie;
  const moved = dist(before, after);
  const nearHub = dist(hubBefore, after);
  assert.ok(moved > 1, `expected bloom placement to move node, moved ${moved}`);
  assert.ok(nearHub >= 60 && nearHub <= 180, `expected bloom node near hub orbit, got ${nearHub}`);
});

test('step uses dt for smooth alpha decay', () => {
  const document = vm({ concepts: [concept('a'), concept('b')], edges: [edge('ab', 'a', 'b')] });
  const simA = createLayoutSimulator(document);
  const simB = createLayoutSimulator(document);
  simA.reheat(1);
  simB.reheat(1);

  simA.step(1 / 60);
  simB.step(1 / 30);

  assert.ok(simB.alpha < simA.alpha, `larger dt should decay alpha more: ${simB.alpha} < ${simA.alpha}`);
  assert.ok(simA.alpha > 0.9, `single 60fps frame should not overcool alpha, got ${simA.alpha}`);
});
```

- [ ] **Step 3: Run the tests and verify they fail on current v2 layout**

Run:

```bash
npm run test:layout
```

Expected result before implementation:

```txt
FAIL test/layout-v3.test.js
```

At least these failures are expected:

- `placeForBloom` is not a function.
- `step uses dt` fails because current `step(dt)` ignores `dt`.
- Hub ring / cluster-only tests may also fail depending on current constants.

- [ ] **Step 4: Commit failing tests**

```bash
git add package.json test/layout-v3.test.js
git commit -m "test(layout): capture v3 gravity-field behavior"
```

---

### Task 2: Replace pair-distance metadata with v3 node mass and relation springs

**Files:**
- Modify: `ui/layout.js`

- [ ] **Step 1: Replace the v2 constants block with v3 constants**

At the top of `ui/layout.js`, replace the cold-start, distance, stiffness, and live-phase constants from `ITERATIONS` through `SETTLED_VEL` with:

```js
// ───── v3 warm-start + force constants ─────────────────────────────────────
const WARM_START_ITERATIONS = 70;
const INITIAL_ALPHA_AFTER_WARM_START = 0.35;

const DEGREE_MASS = 0.45;
const IMPORTANCE_MASS = 0.75;
const MASS_MAX = 4.0;

const REPEL_K = 75;
const REPEL_MIN_DISTANCE = 6;
const REPEL_FORCE_CAP = 6;

const BASE_LINK_DISTANCE = 95;
const HUB_RING_BONUS = 18;
const BASE_LINK_STRENGTH = 0.055;
const HUB_ATTRACTION = 0.18;
const LINK_STRENGTH_MAX = 0.16;
const SIBLING_RELATION_MULT = 1.08;
const COOCC_LINK_BOOST_MAX = 0.35;
const SCORE_REF_PERCENTILE = 0.9;

const CENTER_GRAVITY = 0.008;
const CENTER_MASS_EXP = 0.35;

const COLLISION_PADDING = 5;
const COLLISION_STRENGTH = 0.45;
const NODE_BASE_RADIUS = 4;
const MAX_VELOCITY_PER_ITER = 35;
const VELOCITY_DECAY = 0.82;
const SUBSTEPS = 4;
const SUBSTEP_DECAY = Math.pow(VELOCITY_DECAY, 1 / SUBSTEPS);

const ALPHA_HALF_LIFE_FRAMES = 75;
const ALPHA_DECAY_PER_FRAME = Math.pow(0.5, 1 / ALPHA_HALF_LIFE_FRAMES);
const SETTLED_ALPHA = 0.003;
const SETTLED_VEL = 0.12;

const BLOOM_NEIGHBOR_DISTANCE = 80;
const BLOOM_HUB_DISTANCE_BONUS = 16;
const BLOOM_JITTER = 22;
```

- [ ] **Step 2: Build degree and mass maps in `createLayoutSimulator`**

Keep the current degree computation, then add this immediately after it:

```js
  const mass = buildMass(viewModel, nodes, degree);
```

- [ ] **Step 3: Replace `buildPairs(viewModel, atomic, degree)` call**

Change:

```js
  const pairs = buildPairs(viewModel, atomic, degree);
```

to:

```js
  const relationPairs = buildRelationPairs(viewModel, atomic, degree, mass);
  const relationNeighborIds = buildRelationNeighborIds(relationPairs);
```

- [ ] **Step 4: Add helper functions below `createLayoutSimulator`**

Replace the existing `buildPairs` function with these helpers:

```js
function buildMass(viewModel, nodes, degree) {
  const importance = viewModel.graph.conceptImportance ?? {};
  const mass = {};
  for (const node of nodes) {
    const deg = degree[node.id] ?? 0;
    const score = importance[node.id] ?? 0;
    mass[node.id] = Math.min(
      MASS_MAX,
      1 + DEGREE_MASS * Math.sqrt(deg) + IMPORTANCE_MASS * score,
    );
  }
  return mass;
}

function buildRelationPairs(viewModel, atomic, degree, mass) {
  const atomicIds = new Set(atomic.map((c) => c.id));
  const conceptById = viewModel.concepts.byId;
  const coOccurrence = viewModel.graph.coOccurrence ?? {};
  const scoreRef = computeScoreRef(coOccurrence, atomicIds);
  const pairs = [];
  const seen = new Set();

  for (const edge of viewModel.graph.edges ?? []) {
    if (!atomicIds.has(edge.from) || !atomicIds.has(edge.to)) continue;
    const key = edge.from < edge.to ? `${edge.from}|${edge.to}` : `${edge.to}|${edge.from}`;
    if (seen.has(key)) continue;
    seen.add(key);

    const a = edge.from;
    const b = edge.to;
    const hubMass = Math.max(mass[a] ?? 1, mass[b] ?? 1);
    const relationWeight = Number.isFinite(edge.weight) ? Math.max(0.2, Math.min(1.5, edge.weight)) : 1;
    const score = coOccurrence[a]?.[b] ?? coOccurrence[b]?.[a] ?? 0;
    const coBoost = score > 0
      ? 1 + COOCC_LINK_BOOST_MAX * Math.sqrt(Math.min(1, score / scoreRef))
      : 1;
    const siblingMult = haveSharedParent(conceptById[a], conceptById[b]) ? SIBLING_RELATION_MULT : 1;
    const restLength = BASE_LINK_DISTANCE + HUB_RING_BONUS * Math.max(0, hubMass - 1);
    const strength = Math.min(
      LINK_STRENGTH_MAX,
      BASE_LINK_STRENGTH
        * relationWeight
        * (1 + HUB_ATTRACTION * Math.max(0, hubMass - 1))
        * coBoost
        * siblingMult,
    );

    pairs.push({ a, b, restLength, strength });
  }

  return pairs;
}

function computeScoreRef(coOccurrence, atomicIds) {
  const positiveScores = [];
  for (const a of atomicIds) {
    const row = coOccurrence[a];
    if (!row) continue;
    for (const b of Object.keys(row)) {
      if (a < b && atomicIds.has(b) && row[b] > 0) positiveScores.push(row[b]);
    }
  }
  positiveScores.sort((x, y) => x - y);
  return positiveScores.length
    ? positiveScores[Math.min(positiveScores.length - 1, Math.floor(positiveScores.length * SCORE_REF_PERCENTILE))]
    : 1;
}

function buildRelationNeighborIds(relationPairs) {
  const map = new Map();
  for (const pair of relationPairs) {
    if (!map.has(pair.a)) map.set(pair.a, new Set());
    if (!map.has(pair.b)) map.set(pair.b, new Set());
    map.get(pair.a).add(pair.b);
    map.get(pair.b).add(pair.a);
  }
  return map;
}
```

Keep the existing `haveSharedParent` helper below these functions.

- [ ] **Step 5: Run syntax check**

Run:

```bash
npm run ui:check
```

Expected: syntax passes or failures point to variable names still using `pairs`.

Do not commit yet; Task 3 makes the force kernels compile and pass tests.

---

### Task 3: Implement v3 forces, dt-aware stepping, warm-start, and bloom placement

**Files:**
- Modify: `ui/layout.js`

- [ ] **Step 1: Replace `applyCharge` with mass-based repulsion**

Inside `createLayoutSimulator`, replace the whole `applyCharge` function with:

```js
  function applyCharge() {
    for (let i = 0; i < nodes.length; i += 1) {
      const a = nodes[i].id;
      const aPinned = pinState.has(a);
      for (let j = i + 1; j < nodes.length; j += 1) {
        const b = nodes[j].id;
        const bPinned = pinState.has(b);
        if (aPinned && bPinned) continue;
        const pa = positions[a];
        const pb = positions[b];
        let dx = pa.x - pb.x;
        let dy = pa.y - pb.y;
        let r2 = dx * dx + dy * dy;
        if (r2 < REPEL_MIN_DISTANCE * REPEL_MIN_DISTANCE) {
          dx = (seededUnit(`${a}:${b}:x`) - 0.5) * REPEL_MIN_DISTANCE;
          dy = (seededUnit(`${a}:${b}:y`) - 0.5) * REPEL_MIN_DISTANCE;
          r2 = dx * dx + dy * dy + 1;
        }
        let f = (REPEL_K * (mass[a] ?? 1) * (mass[b] ?? 1)) / r2;
        if (f > REPEL_FORCE_CAP) f = REPEL_FORCE_CAP;
        const r = Math.sqrt(r2);
        const fx = (dx / r) * f;
        const fy = (dy / r) * f;
        if (!aPinned) {
          velocities[a].x += fx;
          velocities[a].y += fy;
        }
        if (!bPinned) {
          velocities[b].x -= fx;
          velocities[b].y -= fy;
        }
      }
    }
  }
```

- [ ] **Step 2: Replace `applySprings` with explicit relation springs only**

Replace the whole `applySprings` function with:

```js
  function applySprings() {
    for (const pair of relationPairs) {
      const aPinned = pinState.has(pair.a);
      const bPinned = pinState.has(pair.b);
      if (aPinned && bPinned) continue;
      const pa = positions[pair.a];
      const pb = positions[pair.b];
      const dx = pb.x - pa.x;
      const dy = pb.y - pa.y;
      const dist = Math.sqrt(dx * dx + dy * dy) || 1;
      const delta = (dist - pair.restLength) * pair.strength;
      const fx = (dx / dist) * delta;
      const fy = (dy / dist) * delta;
      if (!aPinned) {
        velocities[pair.a].x += fx;
        velocities[pair.a].y += fy;
      }
      if (!bPinned) {
        velocities[pair.b].x -= fx;
        velocities[pair.b].y -= fy;
      }
    }
  }
```

- [ ] **Step 3: Replace center force with gentle mass-aware gravity**

Replace `applyCenter` with:

```js
  function applyCenter() {
    for (const node of nodes) {
      if (pinState.has(node.id)) continue;
      const p = positions[node.id];
      const m = Math.pow(mass[node.id] ?? 1, CENTER_MASS_EXP);
      const pull = CENTER_GRAVITY * m;
      velocities[node.id].x -= p.x * pull;
      velocities[node.id].y -= p.y * pull;
    }
  }
```

- [ ] **Step 4: Soften collision**

In `applyCollision`, replace:

```js
        const overlap = (minGap - dist) * 0.5;
```

with:

```js
        const overlap = (minGap - dist) * COLLISION_STRENGTH;
```

- [ ] **Step 5: Make `step(dt)` dt-aware**

Replace the public `step` method with:

```js
    step(dt = 1 / 60) {
      const dtScale = Math.max(0.25, Math.min(2.0, dt * 60));
      const subAlpha = (this.alpha * dtScale) / SUBSTEPS;
      for (let i = 0; i < SUBSTEPS; i += 1) {
        applyCharge();
        applySprings();
        applyCenter();
        applyCollision();
        clampVelocity();
        integrate(subAlpha, SUBSTEP_DECAY);
      }
      this.alpha *= Math.pow(ALPHA_DECAY_PER_FRAME, dtScale);
    },
```

- [ ] **Step 6: Add `placeForBloom` to the public simulator object**

Add this method after `unpin(id) { ... }`:

```js
    placeForBloom(id, visibleIds = new Set()) {
      if (!positions[id]) return false;
      const visible = visibleIds instanceof Set ? visibleIds : new Set(visibleIds ?? []);
      let bestNeighbor = null;
      const neighbors = relationNeighborIds.get(id) ?? new Set();
      for (const neighborId of neighbors) {
        if (!visible.has(neighborId) || !positions[neighborId]) continue;
        if (!bestNeighbor || (mass[neighborId] ?? 1) > (mass[bestNeighbor] ?? 1)) bestNeighbor = neighborId;
      }
      if (!bestNeighbor) return false;

      const anchor = positions[bestNeighbor];
      const hubMass = mass[bestNeighbor] ?? 1;
      const angle = seededUnit(`${id}:bloom-angle`) * Math.PI * 2;
      const radius = BLOOM_NEIGHBOR_DISTANCE + BLOOM_HUB_DISTANCE_BONUS * Math.max(0, hubMass - 1);
      const jitter = (seededUnit(`${id}:bloom-jitter`) - 0.5) * BLOOM_JITTER;
      positions[id].x = anchor.x + Math.cos(angle) * (radius + jitter);
      positions[id].y = anchor.y + Math.sin(angle) * (radius + jitter);
      velocities[id].x = 0;
      velocities[id].y = 0;
      return true;
    },
```

- [ ] **Step 7: Replace cold-start section with warm-start**

Replace the cold-start loop and reset block near the end of `createLayoutSimulator` with:

```js
  // ───── Warm start — enough structure to avoid chaos, not a dead final solve ────
  for (let i = 0; i < WARM_START_ITERATIONS && sim.alpha > 0.001; i += 1) {
    sim.step(1 / 60);
  }

  // Pin every concept that is NOT initially visible at the document's
  // starting playhead time. Invisible concepts keep their warm-start position
  // until bloom placement moves them near a visible neighbor.
  const initialPlayheadTime =
    viewModel.frames.macro[0]?.span?.start ??
    viewModel.frames.meso[0]?.span?.start ??
    0;
  for (const concept of atomic) {
    const seen = concept.firstSeenAt;
    const visibleAtStart = typeof seen === 'number' && seen <= initialPlayheadTime;
    if (!visibleAtStart) sim.pin(concept.id, positions[concept.id]);
  }

  sim.alpha = INITIAL_ALPHA_AFTER_WARM_START;
  sim._maxVelocity = 0;
```

Do not zero all velocities; v3 should visibly relax after first render.

- [ ] **Step 8: Run layout tests**

Run:

```bash
npm run test:layout
```

Expected: all tests pass. If the hub ring assertion is too tight but the visual behavior is correct, adjust only the test threshold after inspecting actual distances printed in the failure message.

- [ ] **Step 9: Run UI syntax check**

Run:

```bash
npm run ui:check
```

Expected: pass.

- [ ] **Step 10: Commit v3 simulator internals**

```bash
git add ui/layout.js
git commit -m "feat(layout): add v3 gravity-field simulator"
```

---

### Task 4: Wire progressive bloom placement and interaction tuning

**Files:**
- Modify: `ui/animator.js`
- Modify: `ui/events.js`

- [ ] **Step 1: Update bloom handling in `ui/animator.js`**

In the newly entering concept block, replace:

```js
          if (sim) {
            sim.unpin(id);            // concept rejoins live dynamics
            sim.reheat(0.20);         // additive with cap; per-event strength from spec § Reheat policy
          }
```

with:

```js
          if (sim) {
            sim.placeForBloom?.(id, prevConceptSet);
            sim.unpin(id);            // concept rejoins live dynamics
            sim.reheat(0.28);         // v3: stronger visible join into the elastic field
          }
```

- [ ] **Step 2: Retune selection reheat in `ui/events.js`**

Replace:

```js
        if (state.sim) state.sim.reheat(0.10);     // ← selection nudge
```

with:

```js
        if (state.sim) state.sim.reheat(0.08);     // v3: subtle selection nudge
```

- [ ] **Step 3: Run tests and syntax checks**

Run:

```bash
npm run test:layout
npm run ui:check
```

Expected: both pass.

- [ ] **Step 4: Commit bloom and interaction wiring**

```bash
git add ui/animator.js ui/events.js
git commit -m "feat(layout): bloom nodes into elastic neighborhoods"
```

---

### Task 5: Verify in the browser and tune constants once

**Files:**
- Modify: `ui/layout.js` only if visual tuning is required.

- [ ] **Step 1: Run non-browser verification**

Run:

```bash
npm run test:layout
npm run ui:check
npm run vm:example
```

Expected:

- `test:layout`: pass
- `ui:check`: pass
- `vm:example`: prints JSON with `documentMeta`, `sampleGraph`, and `sampleCoOccurrence`

- [ ] **Step 2: Start the dev server**

Run:

```bash
npm run ui:dev
```

Expected console includes a local URL like:

```txt
http://127.0.0.1:4173
```

- [ ] **Step 3: Browser visual checklist**

Open the local URL and inspect the canonical sample. Confirm each item:

```txt
[ ] initial graph visibly relaxes after first paint
[ ] large concepts organize their connected neighborhoods
[ ] hub leaves form loose arcs/rings instead of short rods
[ ] graph cloud remains bounded and does not fly apart
[ ] graph does not jitter indefinitely after 5 seconds idle
[ ] dragging a node feels fluid and settles after release
[ ] labels remain usable at default zoom and after zooming
```

- [ ] **Step 4: If needed, make one constants-only tuning pass**

Use these exact tuning rules:

```txt
If graph is too compact:
  REPEL_K 75 → 90
  CENTER_GRAVITY 0.008 → 0.006

If graph flies apart:
  CENTER_GRAVITY 0.008 → 0.011
  BASE_LINK_STRENGTH 0.055 → 0.065

If hub leaves are too close:
  BASE_LINK_DISTANCE 95 → 110
  HUB_RING_BONUS 18 → 24

If hub leaves are too far / disconnected:
  BASE_LINK_STRENGTH 0.055 → 0.070
  HUB_ATTRACTION 0.18 → 0.24

If motion feels jittery:
  VELOCITY_DECAY 0.82 → 0.74
  SETTLED_VEL 0.12 → 0.18

If motion dies too fast:
  ALPHA_HALF_LIFE_FRAMES 75 → 95
  INITIAL_ALPHA_AFTER_WARM_START 0.35 → 0.45
```

Change only constants in `ui/layout.js`; do not alter algorithms in this task.

- [ ] **Step 5: Re-run verification after tuning**

Run:

```bash
npm run test:layout
npm run ui:check
```

Expected: both pass.

- [ ] **Step 6: Commit tuning if any constants changed**

If `ui/layout.js` changed in Task 5:

```bash
git add ui/layout.js
git commit -m "fix(layout): tune v3 gravity-field constants"
```

If no constants changed, skip this commit.

---

## Final verification

Run:

```bash
npm run test:layout
npm run ui:check
npm run vm:example
```

Then browser-verify through `npm run ui:dev`.

Final acceptance:

- layout tests pass;
- syntax checks pass;
- VM example still works;
- browser shows a smoother elastic cloud;
- hub-local rings/arcs are visible;
- no D3, bundler, framework, schema migration, or producer-side changes were introduced.
