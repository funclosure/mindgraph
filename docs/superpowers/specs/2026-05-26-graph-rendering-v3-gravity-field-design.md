# Graph rendering v3 — gravity-field elastic layout

- **Status:** approved for implementation planning
- **Date:** 2026-05-26
- **Predecessors:**
  - `2026-05-11-graph-rendering-v2-design.md` — continuous physics simulator
  - `2026-05-11-graph-rendering-v2-tuning.md` — post-merge tuning, FA2-style repulsion, edge-only attraction
- **Origin:** the v2/v0.6.0 layout is stable and data-aware, but feels too rigid: it cold-starts to a solved state, uses several pairwise distance constraints, and makes relation neighborhoods feel like short rods rather than elastic local systems. Obsidian-style graph reference footage shows a more organic transition: a graph grows from a seed, large nodes organize their own neighborhoods, leaves settle into loose circular shells, and the whole cloud remains gently contained by gravity and resistance.

## Goal

Make the graph feel like a living semantic cloud rather than a solved constraint diagram.

The v3 layout should:

- let large / important / high-degree concepts act as local organizers;
- allow hub neighborhoods to form visible rings naturally;
- preserve a soft global cloud with gentle center gravity;
- make motion smoother and less abrupt during load, bloom-in, and drag;
- keep explicit relation topology as the primary structural skeleton;
- demote co-occurrence and cluster membership from hard geometry to secondary bias.

Non-goals:

- Do not introduce D3 or another layout dependency in this round.
- Do not add a bundler or UI framework.
- Do not change the durable mindgraph document schema.
- Do not solve large-graph acceleration yet; Barnes-Hut remains deferred.

## Visual target from reference footage

The Obsidian reference video shows these relevant properties:

1. **Progressive growth.** The graph starts from a small connected seed and expands as nodes appear. It does not begin as a fully settled final map.
2. **Hub-local rings.** Larger connected nodes produce radial flower structures. Their leaves are pulled inward by links but repel each other sideways, producing circular shells without explicit circle layout.
3. **Topology before color.** Colored nodes are metadata; they do not form rigid color islands. Structure follows links first.
4. **Soft outer shell.** Peripheral nodes can drift outward, but a weak global force keeps the cloud bounded.
5. **Elastic edges.** Edges are longer and softer than the current `RELATION_IDEAL_MAX = 50` behavior.
6. **Viscous resistance.** Motion is damped and smooth, not jittery; the graph relaxes visibly without shaking.

## Core model

v3 keeps `createLayoutSimulator(viewModel) → sim` and the existing canvas consumers, but changes the force hierarchy.

Priority order:

```txt
1. Explicit relation springs       primary topology
2. Mass-based repulsion            spacing, hub territory, local rings
3. Gentle center gravity           global containment
4. Collision                       anti-overlap
5. Weak co-occurrence bias         optional semantic nudge
6. Damping / resistance            smooth fluid motion
```

This replaces the current feel of “many pairs have target distances” with “connected structure floats in a gravity field.”

## Node mass

Each atomic concept receives a layout mass from explicit graph degree and VM importance:

```txt
degree(i)      = count of incident explicit relation edges among atomic concepts
importance(i)  = vm.graph.conceptImportance[i] or 0
mass(i)        = 1 + DEGREE_MASS * sqrt(degree(i)) + IMPORTANCE_MASS * importance(i)
```

Initial constants:

```txt
DEGREE_MASS = 0.45
IMPORTANCE_MASS = 0.75
MASS_MAX = 4.0
```

Mass is capped to prevent a single super-hub from collapsing the document.

Mass affects:

- many-body repulsion;
- relation spring strength;
- relation rest length around hubs;
- center gravity, weakly.

## Many-body repulsion

Repulsion remains all-pairs for now:

```txt
F_repulse(i, j) = REPEL_K * mass(i) * mass(j) / max(distance², minDistance²)
```

Initial constants:

```txt
REPEL_K = 75
REPEL_MIN_DISTANCE = 6
REPEL_FORCE_CAP = 6
```

This is the main spacing force. Hubs claim more territory because they repel more strongly. That territory is what allows their connected leaves to orbit instead of collapsing into the hub.

## Relation springs

Explicit relations are the structural skeleton. They should be softer and longer than v2 relation caps.

For each explicit atomic-atomic edge:

```txt
hubMass = max(mass(a), mass(b))
restLength = BASE_LINK_DISTANCE + HUB_RING_BONUS * (hubMass - 1)
strength = BASE_LINK_STRENGTH
         * relationWeight(edge)
         * (1 + HUB_ATTRACTION * (hubMass - 1))
         * coOccurrenceBoost(a, b)
```

Initial constants:

```txt
BASE_LINK_DISTANCE = 95
HUB_RING_BONUS = 18
BASE_LINK_STRENGTH = 0.055
HUB_ATTRACTION = 0.18
LINK_STRENGTH_MAX = 0.16
```

Important invariant: large nodes attract their connected neighbors more, but also receive a larger orbit radius. This avoids the failure mode where hubs swallow all leaves into a ball.

Spring law should be elastic and stable:

```txt
extension = distance - restLength
F_link = strength * extension
```

If this is still too rod-like in implementation testing, switch to a soft-tension variant:

```txt
F_link = strength * softsign(extension, softness)
```

The first implementation should keep the linear spring because it is easier to compare against v2.

## Co-occurrence bias

Co-occurrence should stop acting like a hard pair-distance command.

Initial v3 rule:

- If a pair has an explicit relation, positive co-occurrence may boost that relation’s spring strength slightly.
- If a pair has no explicit relation, co-occurrence does not create a strong spring in the first v3 implementation.

```txt
coOccurrenceBoost(a, b) = 1 + COOCC_LINK_BOOST_MAX * sqrt(clamp01(score / scoreRef))
```

Initial constants:

```txt
COOCC_LINK_BOOST_MAX = 0.35
SCORE_REF_PERCENTILE = 0.9
```

Reasoning: explicit topology remains readable, while temporal co-topic-ness still makes genuine relation edges feel more cohesive.

Deferred option if the layout becomes too sparse: add a weak co-occurrence-only attraction for the top percentile of co-occurring non-relation pairs, capped far below relation strength.

## Cluster membership

Cluster membership should not create hard geometry in v3.

Initial rule:

- Cluster membership continues to drive color and labels.
- Cluster-only sibling springs are disabled.
- Shared cluster may provide a very small spring-strength multiplier only when an explicit relation already exists.

```txt
SIBLING_RELATION_MULT = 1.08
```

This follows the reference video: color is metadata, not a rigid cluster island.

## Center gravity

Center force should contain the cloud, not organize it.

Use gentle gravity toward world origin:

```txt
F_center(i) = -CENTER_GRAVITY * mass(i)^CENTER_MASS_EXP * position(i)
```

Initial constants:

```txt
CENTER_GRAVITY = 0.008
CENTER_MASS_EXP = 0.35
```

If the cloud feels overly circular or compressed, switch to soft-boundary gravity:

```txt
if radius <= COMFORT_RADIUS:
  no center force, or very weak force
else:
  pull inward proportional to radius - COMFORT_RADIUS
```

The first implementation should use simple gentle center gravity for fewer moving parts.

## Collision

Keep pairwise collision, but make it soft enough not to create rigid shoves:

```txt
minGap = radius(a) + radius(b) + COLLISION_PADDING
```

Initial constants:

```txt
COLLISION_PADDING = 5
COLLISION_STRENGTH = 0.45
```

Node radius used by physics should approximate render radius but does not need to be identical.

## Resistance and integration

v2 uses explicit Euler with substeps for stability. v3 can keep substeps, but the constants should feel more fluid.

Initial constants:

```txt
SUBSTEPS = 4
VELOCITY_DECAY = 0.82       // per macro step; substep decay = pow(VELOCITY_DECAY, 1 / SUBSTEPS)
MAX_VELOCITY_PER_ITER = 35
```

Alpha should decay slower than v2:

```txt
ALPHA_HALF_LIFE_FRAMES = 75
SETTLED_ALPHA = 0.003
SETTLED_VEL = 0.12
```

`step(dt)` should use `dt` rather than ignoring it. Clamp dt to avoid background-tab jumps:

```txt
dtScale = clamp(dt * 60, 0.25, 2.0)
subAlpha = alpha * dtScale / SUBSTEPS
alpha *= pow(ALPHA_DECAY_PER_FRAME, dtScale)
```

This improves smoothness under variable frame rate.

## Startup and bloom transition

The reference footage’s most important transition behavior is visible assembly.

Change startup from:

```txt
run 300 cold-start iterations
pin invisible nodes
reset alpha = 0
```

to:

```txt
run 50–80 warm-start iterations
pin invisible nodes
keep alpha > 0 for visible relaxation
```

Initial constants:

```txt
WARM_START_ITERATIONS = 70
INITIAL_ALPHA_AFTER_WARM_START = 0.35
```

Bloom-in behavior:

- When a concept first becomes visible, place it near its strongest already-visible relation neighbor if one exists.
- Otherwise place it near its strongest visible co-occurrence neighbor.
- Otherwise keep its seeded position.
- Add small deterministic jitter so multiple new leaves do not stack.
- Unpin and reheat.

```txt
BLOOM_REHEAT = 0.28
BLOOM_NEIGHBOR_DISTANCE = 80 + 16 * hubMass
BLOOM_JITTER = 22
```

This should make new nodes appear as if they are joining the existing graph rather than teleporting from a precomputed final state.

## Drag and interaction

Dragging should keep the graph fluid:

- drag start: pin node at cursor, set alpha to 1.0;
- drag move: update pin anchor, keep alpha high;
- drag release: unpin, reheat by 0.5;
- selection: small reheat, around 0.08.

No permanent pinning in this version.

## Rendering implications

The first v3 pass is mostly layout math, but the visual target suggests small rendering follow-ups:

- Edges should remain faint enough that the node cloud is primary.
- Larger nodes should continue to be visibly larger by degree/importance.
- Label policy can stay unchanged initially; evaluate after layout stabilizes.

## Implementation boundaries

Primary file:

- `ui/layout.js`

Likely touch points:

- `ui/animator.js` — bloom placement/unpin/reheat coordination if current API lacks needed hook.
- `ui/events.js` — reheat constants for selection/drag if currently hard-coded.
- `src/view-model/buildGraphRenderState.js` — no expected change.
- `src/view-model/buildMindgraphViewModel.js` — no expected change.

No producer-side schema or CLI changes are required.

## Verification

Minimum checks:

1. `npm run ui:check`
2. `npm run vm:example`
3. Load `npm run ui:dev` in browser and inspect:
   - initial graph visibly relaxes rather than appearing fully dead;
   - hub neighborhoods form radial shells;
   - relation edges are longer/softer than v2;
   - graph does not jitter indefinitely;
   - drag/release feels fluid;
   - labels remain usable.

Optional instrumentation if tuning is hard:

- temporary console metrics for alpha, max velocity, step time, and active pair counts;
- screenshot/video comparison against the Obsidian reference frames.

## Acceptance criteria

v3 is successful if:

- large concepts visibly organize their connected neighborhoods;
- leaves around hubs form loose circles or arcs naturally;
- the graph cloud remains bounded without feeling compressed;
- startup and bloom-in show smooth relaxation;
- explicit relation topology is easier to read than v2;
- the simulation reliably settles after interaction;
- no new dependency, framework, bundler, or schema migration is introduced.
