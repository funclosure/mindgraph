# Canvas UI v1.5 — Evolving Graph Spec

**Status:** approved 2026-05-07. Successor to v1 (`canvas-ui-v1-spec.md`).

## Goal

Make the graph **evolve as the playhead moves**. The current canvas renders the full graph statically and only dims/highlights based on activation. v1.5 changes the basic dynamic to: at any moment in time, the visible graph is exactly the set of concepts the speaker has introduced *up to that moment*. Concepts grow into existence with a small bloom; the camera follows the focus of the conversation; the user can pause that flow by selecting something or by panning manually.

The point is to convey **thoughts evolving over time** — the graph is a record of what has been said, not a flat map of everything the document contains.

## Architecture

The current pipeline:

```
state → buildGraphRenderState (pure) → draw (canvas)
```

The new pipeline keeps the pure derivation and adds an animation layer between it and the canvas:

```
state → buildGraphRenderState (pure)        ← target state at this playhead
     → animation step (rAF, per-frame interp) ← live state, lerped toward target
     → draw (canvas)
```

The animation layer holds **per-entity animated properties**: each concept's opacity and scale; each cluster body's opacity; each edge's opacity; the camera's pan and zoom. On each requestAnimationFrame, those values lerp toward whatever `buildGraphRenderState` says they should be. The render loop runs while anything is animating and stops when everything has settled within an epsilon.

`buildGraphRenderState` gains two derived fields:

- `cumulativeVisibleConceptIds` / `cumulativeVisibleClusterIds` / `cumulativeVisibleEdgeIds` — what should be on screen at this playhead time.
- `cameraTarget: { x, y, zoom }` — where the camera should be aimed.

The view-model itself stays pure and testable. The animation step is small and isolated, holding the only mutable graph-rendering state outside React-of-canvas.

## Reveal Pipeline (cumulative + bloom)

### Visibility rules (pure)

- **Concept** visible iff `playheadTime ≥ concept.firstSeenAt`.
- **Cluster** visible iff at least one of its members is visible (i.e., `min(member.firstSeenAt) ≤ playheadTime`).
- **Edge** visible iff both `from` and `to` concepts are visible.

These produce the three `cumulative*VisibleIds` sets per playhead time.

### Bloom (animation layer)

Bloom is a transient effect, not a property of the pure render state. Each animation step compares the current `cumulativeVisibleConceptIds` against the previous frame's set. For any id **newly entering** the set, schedule a bloom keyframe:

- t=0: `opacity = 0`, `scale = 1.6`, color shifted ~10% brighter than resting
- t=600 ms: `opacity = 1`, `scale = 1.0`, color at resting value
- Easing: `easeOutCubic`

Same bloom for clusters and edges when they first cross the visibility threshold.

**Initial load is not a transition.** On the first animation frame after the page loads, the animator's "previous set" is initialised to equal the current cumulative set, so concepts already visible at startup (e.g., concepts with `firstSeenAt = 0` while the playhead is at 0) do not bloom. They render in their resting state. Bloom only fires on a real visibility transition during the user's session.

Bloom fires **only on the visibility threshold crossing** (in either direction; entering the set blooms in, leaving the set fades out, see "Reverse scrub" below). Re-activation in a later frame — when a concept that already exists becomes foreground again — is handled by the active/dim emphasis layer (no second bloom; frequent re-activations would feel noisy).

### Reverse scrub

When the user scrubs back so a concept's `firstSeenAt` is now in the future, opacity ramps to 0 over **~200 ms** (faster than bloom — reverse should feel quicker so the user feels in control of time). Scrubbing forward past the threshold again triggers a fresh bloom. The animation is idempotent: visibility is a function of playhead time, and the animator just chases it.

## Camera Tracking

### Target derivation (pure)

Read foreground concepts of the active frame at the user's chosen level (`activeLevel`). Then:

1. **No active frame at this level** (e.g., very early time, or playhead before any frame): target = a `{ center, bounds }` derived from `cumulativeVisibleClusterIds` — center is the unweighted centroid, bounds is the bounding box of visible cluster bodies.
2. **Foreground has one concept**: target = the concept's parent cluster — center is the cluster's center, bounds is the cluster's circle (treat radius as a square bbox). A single dot zoomed tight feels claustrophobic; the cluster gives anchoring context.
3. **Foreground has multiple concepts**:
   - **Center** = weighted centroid of foreground concept positions, weight = activation weight (so a concept at weight 0.95 pulls the camera more than one at 0.4).
   - **Bounds** = unweighted bounding box of all foreground concept positions, padded 15 % so they are not pressed against the canvas edges.

`cameraTarget = { x, y, zoom }` is then derived by fitting `bounds` into the canvas viewport and centring on `center`.

### Animation (animator)

The animator lerps the live camera toward `cameraTarget` each frame:

- Lerp time constant: **~700 ms ease-in-out** for both pan and zoom.
- **Micro-level smoothing**: when `activeLevel === 'micro'`, the live camera additionally lags behind a smoothed target — a 5-frame moving average of the raw target — so sentence-grain frame changes do not whip the camera around.

### Manual override (`cameraMode`)

A `cameraMode` field tracks who is driving:

- `auto` — camera follows derived target. Default at startup.
- `manual` — user has taken control by dragging or wheeling. Camera stays put.
- `selection` — a concept or frame is selected. Camera locked on the selection.

Transitions:

| Event                            | Effect                                          |
| -------------------------------- | ----------------------------------------------- |
| Press **Play**                   | If `manual`, switch to `auto`.                  |
| Press **Reset**                  | Switch to `auto`, lerp back to derived target.  |
| Click empty canvas               | If `selection`, switch to `auto`.               |
| Drag or wheel in `auto`/`selection` | Switch to `manual`.                          |
| Click concept or frame           | Switch to `selection`, camera lerps to it.      |

At any moment the camera has exactly one source of authority — the derivation, the user, or a selection.

## Selection

### Click a concept on canvas

The concept is by definition visible (you can only click what you can see). Set `cameraMode = 'selection'`, camera lerps to fit the concept's parent cluster. Selected concept gets the brightest emphasis; one-hop neighbors are lit a notch dimmer; everything else stays at its current state. Edges touching the selection are highlighted. Inspector switches to the concept inspector.

### Click a concept in the inspector

A concept linked from the inspector (e.g., a related concept) may not yet be visible because `firstSeenAt > playheadTime`. The new rule for cumulative:

> If `concept.firstSeenAt > playheadTime`, **auto-advance** `playheadTime` to that `firstSeenAt`.

The graph then plays the missing reveals (each concept that crosses the threshold blooms in). Camera lerps to the now-visible concept. Selection is "I want to see this", and seeing implies visibility, so the playhead jumps to the moment that makes it true.

### Click a frame in the timeline

Same as today: playhead jumps to `frame.span.start`, `selectedFrameRef` is set, cumulative state advances accordingly. Camera lerps to fit the frame's foreground concepts. Inspector switches to the frame inspector.

### Reset

Clears selection, sets `cameraMode = 'auto'`, camera lerps back to derived target. Playhead is unchanged.

## Initial State

The earliest `firstSeenAt` in this document's data is `0` (multiple concepts are introduced in the very first frame). So:

- At t=0, paused: the canvas shows concepts whose `firstSeenAt = 0` already in their resting state — no bloom on those, they are "the starting point". Camera fits to them.
- Topbar already shows the document title — no canvas-text title overlay.
- Press play: the playhead advances; each concept blooms in when it crosses its `firstSeenAt`.

For documents where all concepts have `firstSeenAt > 0`, the canvas at t=0 will be empty save for the background. The first bloom is the moment.

## firstSeenAt Derivation

The current sample document has zero concepts with `firstSeenAt` set — the field is only populated via the manual `concept upsert --first-seen-at` CLI flag. All 70 concepts in the canonical sample have it as `undefined`.

Fix it in the view-model rather than re-running the producer:

> In `buildConceptsVM` (or a small enrichment step right after), for each concept, walk all frames at all levels and find the earliest `frame.span.start` where the concept appears in `foregroundConcepts` or `backgroundConcepts`. Use that as the derived `firstSeenAt`. If the concept has no frame appearance, leave `firstSeenAt = undefined` (it will never be visible — same as today, by design).

Producer-side `firstSeenAt` (set explicitly via the CLI) is treated as an override. If `concept.firstSeenAt` is already a number, keep it; otherwise derive from frames. This way the derivation is opportunistic and the producer flag still works.

## Out of Scope

Explicitly **not** in this slice:

- Filled cluster galaxies with members visually inside (mockup-style cluster body redesign).
- Typed-edge color variants (cyan vs tan by relation type).
- Topographic backdrop, focus reticle, breathing labels.
- Hover preview state.
- Cluster collapse / expand, search, fly-to-concept.
- Spring physics — easing functions only.
- Off-camera-activation indicators (arrow at the screen edge pointing to an active off-screen concept).
- Persistent recent-active glow / trail.
- Auto-play on load — the user still presses play.
- Sub-frame interpolation at micro level beyond the 5-frame moving-average smoothing.

These are parked. The current cumulative + active emphasis is enough for v1.5; the listed items are visible polish or new interaction layers, separable from the core dynamic.

## Verification

Per project convention (CLAUDE.md):

- `npm run vm:example` should still run and the example output should now show derived `firstSeenAt` values for all concepts.
- `npm run ui:check` for module syntax.
- `npm run ui:dev`, then in browser:
  - Reload at t=0: see seed concepts (Meaning in Life + Cultural Convergences cluster) at rest.
  - Press play: subsequent concepts should bloom in as the playhead advances.
  - Pause and drag the scrubber: concepts appear/disappear as time crosses their `firstSeenAt`.
  - Camera should lerp smoothly between focus targets at meso/macro level; micro should not feel jittery.
  - Click a concept on canvas: camera lerps in, selection visual emphasis applies, inspector updates.
  - Click a concept in the inspector that hasn't appeared yet: playhead should jump to its `firstSeenAt`, the missing concepts bloom in, camera lerps to it.
  - Drag the canvas while playing: camera should stop following.
  - Press Reset: camera should resume following.

No new test runner. Visual verification via Playwright screenshots, as in v1.
