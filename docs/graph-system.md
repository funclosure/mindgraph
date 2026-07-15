# The graph system — how the concept graph moves

How mindgraph lays out and animates the concept graph: the forces, the gravity
model, the integrator, and the settle/reheat lifecycle. This documents the
**as-built** system in `ui/layout.js` (the "v3" gravity-field model), which has
moved past the earlier `docs/superpowers/specs/*-graph-rendering-*` specs — see
[§10 Lineage](#10-lineage--how-this-differs-from-the-specs).

For where this sits in the whole system, see [`../DESIGN.md`](../DESIGN.md).

> **One-line mental model.** Every concept is a little mass floating in a field.
> Related concepts are joined by springs; every concept pushes every other away
> with a gravity-like repulsion scaled by mass; a soft center-gravity keeps the
> cloud from drifting apart. The simulation runs live, warms up when you disturb
> it, and falls asleep when it stops moving.

---

## 1. The pieces

**Nodes** are the **atomic** concepts (`viewModel.concepts.atomic`). Clustered
concepts are *not* physics bodies — they exist for colour and labelling only.
Each node has a live `{x, y}` position and a velocity.

**Edges** are the relations (`viewModel.graph.edges`). An edge between two atomic
concepts becomes a **spring**. Edges to/from clusters are ignored by the sim.

Everything the simulator needs is precomputed once at
`createLayoutSimulator(viewModel)` and read each frame — no per-frame derivation:

| Input | Source | Used for |
|---|---|---|
| `degree` | edge count per node | mass, hub bonuses |
| `mass` | `buildMass()` (below) | repulsion strength, spring geometry, center pull |
| `coOccurrence` | `viewModel.graph.coOccurrence` | boosts spring *strength* |
| `conceptImportance` | `viewModel.graph.conceptImportance` | mass |
| `relations` | `viewModel.graph.edges` | which pairs get springs |
| `parentIds` | concept clusters | sibling spring bonus |
| `firstSeenAt` | per concept | reveal timing + initial pinning |

### Mass — what makes a hub a hub

```
mass(c) = min( 4.0,  1 + 0.45·√degree(c) + 0.75·importance(c) )
```

- **degree** = number of relations touching the concept.
- **importance** ∈ [0,1] = `0.4·degreeFactor + 0.3·peakActivation + 0.3·persistence`
  (`degreeFactor` normalised against the highest-degree atomic concept).

A well-connected, frequently-foregrounded concept can reach mass **4**; a
peripheral one sits near **1**. Mass shows up in almost every force: heavy nodes
repel harder, sit at the center of wider spring rings, and resist the center
pull less. Hubs earn territory; leaves tuck in close.

### Co-occurrence — "these two were the topic at the same time"

```
score(i, j) = Σ over frames where BOTH i and j are foreground:  duration(frame)
```

Summed over every reading/timeline frame (foreground only — being peripherally
active doesn't count), with a 30 s fallback for zero-duration/open-ended frames.
Stored sparse and symmetric. A per-document reference,
`scoreRef = 90th percentile of positive scores`, normalises it so layout shape is
stable across documents of different sizes. Co-occurrence does **not** set
distance in v3 — it *firms up the spring* (see below).

---

## 2. The forces

Each `step()` runs these in order, accumulating into per-node velocity, then
integrates. All constants live in `DEFAULT_LAYOUT_CONFIG` and are live-tunable
(§9).

### 2.1 Charge — mass-based repulsion (the "gravity" that pushes apart)

Every pair of nodes repels with an inverse-square force scaled by both masses —
Newtonian gravity's math, run in reverse (push, not pull):

```
f = repelK · mass(a) · mass(b) / r²        capped at repelForceCap
repelK = 75   repelMinDistance = 6 (jitter apart below this)   repelForceCap = 6
```

Two heavy hubs shove each other far apart; two leaves barely notice each other.
This is what spreads the graph out and gives hubs their personal space. The cap
keeps a near-collision from launching a node across the canvas.

### 2.2 Springs — relation links define the topology

Each atomic–atomic relation is a spring with a rest length and a stiffness:

```
restLength = baseLinkDistance + hubRingBonus · max(0, hubMass − 1)
           = 50 + 15 · (hubMass − 1)

strength   = min( linkStrengthMax,
                  baseLinkStrength · relationWeight
                    · (1 + hubAttraction · (hubMass − 1))   ← hubs pull neighbours in
                    · coBoost                                ← co-occurrence firms the spring
                    · siblingMult )                          ← same cluster → a touch tighter
           = min( 0.07, 0.035 · … )

coBoost     = 1 + 0.35 · √min(1, score/scoreRef)     (1.0 when no co-occurrence)
siblingMult = 1.08 if the two share a parent cluster, else 1.0
hubMass     = max(mass(a), mass(b))
```

The spring force is the classic `(distance − restLength) · strength` along the
line between the two nodes. **Rest length grows around hubs** (so a hub sits in a
ring of its neighbours rather than on top of them); **strength grows with hub
mass, co-occurrence, and sibling-status** (so strongly-paired concepts snap
tighter). This is the v3 inversion of v2: v2 moved the *target distance* with
co-occurrence; v3 keeps distance hub-driven and moves *stiffness* instead.

### 2.3 Unrelated separation — keep strangers at arm's length

Pairs that are **not** relation-neighbours get a short-range push so unrelated
concepts don't crowd:

```
if not neighbours and dist < unrelatedMinDistance(120):
    push = (120 − dist) · unrelatedSeparationStrength(0.045)
```

Unlike charge (which is always on), this only acts inside 120 px and only between
unrelated pairs — it declutters local neighbourhoods without fighting the springs.

### 2.4 Center gravity — a soft boundary, not a hard well

A gentle inward pull that only switches on **outside** a comfort radius, so the
graph organises itself freely in the middle and only disconnected drifters get
reeled back:

```
if radius > centerComfortRadius(75):
    pull = centerGravity(0.025) · mass^centerMassExp(0.35) · (radius − 75)/radius
    velocity −= position · pull
```

The `mass^0.35` term means heavy hubs are pulled in *slightly less* — they're
allowed to define the outskirts — while light stragglers are gathered. Inside
75 px there's no center force at all.

### 2.5 Component cohesion — don't let islands evaporate

If the relation graph is **fragmented** (several disconnected components, none
dominant — precisely `nodeCount ≥ 8 && components ≥ 3 &&
largestComponentRatio < 0.75 && relationDensity < 1.2`), each small component
(≤ 6 nodes) gets pulled toward its own centroid when it drifts past 150 px. This
keeps a 3-node island together as a unit instead of letting charge scatter it.

### 2.6 Section cohesion — reading structure as gentle springs

Concepts that are co-active within the same reading **section** but *aren't*
already related get very soft springs (top 8 per section, `restLength 95`,
`strength 0.012·scale`). This nudges "things you read about together" into loose
proximity without asserting a relation that isn't there. Source-first documents
only (needs `sourceFlow.sections` + `readerSteps`).

### 2.7 Collision — no two dots overlap

Short-range hard push whenever two nodes are closer than `2·4 + 5 = 13 px`,
strength `0.45`. Purely cosmetic — keeps dots legible.

---

## 3. The integrator — sub-stepped explicit Euler

Positions advance by damped explicit Euler, **sub-stepped 4×** per frame for
stability (a single big step with these stiffnesses would ring):

```
SUBSTEPS = 4
per frame:
  subAlpha = alpha · dtScale / SUBSTEPS          (dtScale clamps dt·60 to [0.25, 2])
  ×4:  run all forces → clampVelocity(35 px) → integrate(subAlpha, decay)
  alpha ·= 0.5 ^ (dtScale / alphaHalfLifeFrames)   (half-life ≈ 145 frames)

integrate:  p += v · subAlpha ;  v ·= decay(0.70^(1/4) per substep)
```

- **`alpha`** is the global "temperature" — it scales how far nodes actually move
  each frame and decays every frame, so motion cools over time.
- **velocity clamp (35 px/iter)** and **velocity decay (0.70)** are the stability
  guards that make explicit Euler safe at these stiffnesses.
- Pinned nodes skip integration entirely (see §5).

---

## 4. Lifecycle — warm when disturbed, asleep when settled

The simulator idles at **zero CPU** when nothing moves and wakes on interaction.
Two independent phases:

**Cold start (in the constructor).** A **warm start** runs 70 steps so the graph
opens with real structure instead of the seed ring, then alpha is set to `0.24`
for a brief visible relaxation. (Skipped when seed positions are supplied — see
§7.) Concepts *not yet visible* at the opening playhead time are then **pinned**
at their warm-start spot so they don't drift before they're revealed.

**Settling.** Settling is judged on **observed motion, not alpha** — alpha's slow
half-life would keep the rAF loop alive for 15–20 s. Instead:

```
settled  ⇔  per-frame displacement < 0.02 px for 30 consecutive frames
```

`reheat()` resets the calm-frame counter, so any interaction re-arms the sim.
`animator.js` gates the rAF loop on `!sim.isSettled()` (joined with bloom/fade
and camera animations), so the loop stops cleanly once everything is quiet.

### Reheat events

`reheat(strength)` adds to alpha (capped at 1.0). Each interaction pours in a
different amount of heat:

| Event | Strength | Where | Side effect |
|---|---|---|---|
| Concept blooms in (revealed by reading) | **0.01** | `animator.js` | `placeForBloom` + `unpin` — a calm join, the node is already placed near a neighbour |
| User selects a concept | **0.05** | `events.js` | none — a very subtle nudge |
| Drag release (if the dot moved) | **0.32** | `events.js` | `unpin` the dragged node |
| Deepen / "Add to graph" rebuild | **0.5** | `app.js` | seeded rebuild; existing nodes barely move |
| Config change (debug panel) | **1.0** | `layout.js` | full re-settle after re-tuning |

The bloom reheat is deliberately tiny: a newly-revealed concept is *placed* next
to its strongest visible neighbour (§6), so it needs a whisper of heat to relax
into the field, not a shove.

---

## 5. Pinning & drag — one-sided anchors

A **pinned** node is an infinite-mass anchor: it exerts force on its neighbours
but ignores all force on itself. Integration just holds it at its anchor and
zeroes its velocity. Forces still accumulate *into* neighbours normally, so
pinning a node lets you drag the graph and watch everything else react.

- **Drag:** pointer-down on a dot pins it under the cursor (`pin(id, world)`);
  pointer-move updates the anchor to the live cursor; release `unpin`s and
  reheats `0.32`. Pointer-down on empty canvas pans the camera instead.
- **Invisible concepts** are pinned at cold-start until reading reveals them.

## 6. Bloom placement — grow in place, no fly-in

When a concept is first revealed, `placeForBloom(id, visibleIds)` teleports it to
a sensible spot *before* it fades in, so it never streaks across the canvas from
the seed ring:

```
anchor  = the highest-mass visible relation-neighbour
radius  = bloomNeighborDistance(96) + bloomHubDistanceBonus(16)·(hubMass−1)
angle   = deterministic hash of the id       jitter = ±22 (hashed)
place the new node at anchor + (radius ± jitter) in direction angle
```

If it has no visible neighbour yet, it keeps its pinned cold-start position. Then
the animator un-pins it, gives the 0.01 reheat, and the node settles into place.

## 7. Growing in place — deepen without re-settling

`createLayoutSimulator(vm, { initialPositions })` seeds known nodes from a prior
layout and **skips the warm start**, so a deepen/expand rebuilds the graph
without yanking the existing nodes around. New nodes fall back to the
deterministic id-seeded ring; a `0.5` reheat lets the neighbourhood absorb them
locally. This is how the graph grows when the reader adds concepts via Ask.

## 8. Determinism

Same document + same code ⇒ bit-exact final positions. Sources of determinism:

- **Seeded placement** — `seededUnit(id)` (a stable string hash) picks the
  initial ring angle/radius, bloom angle, and jitter. **No `Math.random()`
  anywhere** in the sim.
- **Deterministic iteration order** — V8 preserves object key insertion order.
- **Per-document `scoreRef`** — the 90th-percentile co-occurrence reference is
  computed from the document, not a global constant.

Within a single session positions *drift* — that's the trajectory toward
equilibrium as reheats fire, not divergence. Reload the same doc and you land on
the same equilibrium.

## 9. Tuning & instrumentation

Every constant lives in `DEFAULT_LAYOUT_CONFIG` (forces) and
`DEFAULT_ANIMATION_CONFIG` (bloom/camera timing). `ui/layout-debug-panel.js`
exposes them as live sliders — `sim.updateConfig({...})` rebuilds the pair data
and reheats to 1.0 so you can watch a re-tune settle in real time. This is how
the v3 constants were dialled in; there's no offline solver.

**Consumers of the layout.** The simulator only produces positions. Everything
visual reads them downstream and is unchanged by the physics:

- `src/view-model/buildGraphRenderState.js` — decides what's visible / dimmed /
  spotlit and computes the camera target (selection framing, reading-region fit).
- `ui/labels.js` — **screen-space labels** at constant pixel size, gated by
  `importance × zoom` with collision avoidance: a wide camera shows a handful of
  high-importance labels, zooming in reveals more.
- `ui/animator.js` — the rAF driver: bloom/fade opacity, highlight-tier easing,
  camera lerp, and stepping the sim.

## 10. Lineage — how this differs from the specs

The `docs/superpowers/specs/` graph-rendering specs describe earlier designs;
`ui/layout.js` is the source of truth for what actually runs.

| | v1 (`2026-05-10`) | v2 (`2026-05-11`) | **v3 (as-built, `layout.js`)** |
|---|---|---|---|
| Layout | static precompute, frozen after ~300 iters | continuous physics | continuous physics |
| Distance signal | uniform 60 px link | **co-occurrence → ideal distance** | **hub-mass → rest length**; co-occurrence → spring *strength* |
| Repulsion | uniform charge | uniform charge | **mass-scaled** charge (hubs get territory) |
| Boundary | cluster anchors | center pull | **soft comfort-radius** center gravity + component/section cohesion |
| Settle test | n/a | alpha threshold | **observed displacement** over N calm frames |

If you're touching layout, trust this file and the code over the v2 spec. The v2
spec is still worth reading for the *reasoning* behind continuous physics and
drag-to-pin; just know the distance/stiffness model was inverted and the gravity
+ cohesion forces were added afterwards.

---

*Reflects `ui/layout.js`, `ui/animator.js`, and the co-occurrence/importance
derivations in `src/view-model/buildMindgraphViewModel.js` as of v0.11.0.*
