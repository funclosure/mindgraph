# mindgraph Canvas UI v1 — Spec

Date: 2026-05-04
Status: approved (Victor, brainstorming session 2026-05-04)

## Goal

Replace the cytoscape-based live UI (`ui/app.js`) with a single HTML5 Canvas implementation. Same features, simpler architecture, no graph engine. The replacement extends the existing canvas POC (`ui/canvas-poc.html` + `ui/canvas-poc.js`) into a real consumer surface for the digested mindgraph documents.

## Background

This decision was reached on 2026-05-03 (see project memory: `rendering_decision.md`). Key drivers: the cytoscape-as-camera + custom-canvas-overlay hybrid (in `ui/cytoscape-spike.js`) kept crashing; Sam Spratt's site (samspratt.com/story) demonstrates that a single-canvas approach with hand-written pan/zoom is sufficient at this scale; and the view-model already holds the data layer, so cytoscape was being used only for camera math and hit-testing.

The canvas POC at `ui/canvas-poc.html` already proves the cluster-as-galaxy layout reads visually with 70 nodes / 60 edges drawn by hand on a single canvas, with no animation and no interaction.

## Scope

**Feature parity with the current live UI.** Everything `ui/app.js` does — graph, inspector panel, three-track timeline, scrubbing, level toggle, focus / dim states — but on canvas instead of cytoscape.

**Plus one v1 addition: progressive label reveal**, Google-Maps-style. Cluster labels visible at all zooms. Atomic labels appear in importance order as the user zooms in. The render-state layer already computes `labelVisibleNodeIds` per zoom level; the canvas draw consumes that set.

## Architecture

The POC stays a single HTML page (`ui/canvas-poc.html`) with one JS module (`ui/canvas-poc.js`). The page has four DOM regions:

- **Topbar.** Document title and status pill (DOM).
- **Stage.** The canvas, full width of the main column. The only canvas. One draw loop.
- **Right sidebar.** Inspector panel (DOM, copied from the live UI).
- **Bottom.** Timeline panel (DOM, copied from the live UI with the absolute-positioning patch made on 2026-05-04).

State lives in a single `state` object inside `ui/canvas-poc.js`:

- `selectedConceptId`
- `selectedFrameRef`
- `playheadTime`
- `activeLevel` (one of `macro`, `meso`, `micro`)
- `camera` (object with `zoom` and `pan`)
- `viewModel` and `layout` (both immutable after load)

When state changes, `render()` runs in three steps:

1. Recompute `graphRenderState` from state via the existing pure function `buildGraphRenderState(viewModel, { selectedConceptId, selectedFrameRef, playheadTime, activeLevel, zoomLevel: state.camera.zoom })`.
2. Update the DOM panels (inspector + timeline) by setting `innerHTML` on their host elements, using template functions copied from the live UI.
3. Schedule a canvas redraw (one frame) and rebind event listeners on the freshly-rendered DOM.

This is the same shape as the live UI, but the graph layer is canvas, not cytoscape. The rendering decision memo (`rendering_decision.md`) is the durable record of why.

### File structure inside `ui/canvas-poc.js`

While the file is small (~600 lines or fewer), it is one file organized in sections:

1. Constants and the `state` object
2. Bootstrap (load doc, build VM, mount)
3. `render()` orchestrator and DOM update functions
4. Inspector and timeline render templates (copied from live UI)
5. Canvas `draw(ctx, state)` and helpers
6. Camera (`screenToWorld`, `worldToScreen`, `pan`, `zoom`, `fit`)
7. Hit-test (`hitTestAt(point) → { kind, id } | null`)
8. Event bindings (`bindEvents()`, rebound each render)

When the file grows past ~600–700 lines, split into separate ES modules organically (camera.js, hit-test.js, etc.). Do not pre-split.

## Data flow

```
state changes (click, scrub, level toggle, etc.)
  ↓
render()
  ├─ recompute graphRenderState from state (pure function)
  ├─ update DOM panels (inspector, timeline)
  ├─ scheduleDraw() → next animation frame
  └─ bindEvents()

scheduleDraw() → frame:
  ├─ clear canvas
  ├─ apply camera transform (zoom + pan)
  ├─ draw clusters → edges → atomic nodes → labels
  └─ draw playhead-tied indicators if applicable

mouse event on canvas (click, wheel, drag):
  ↓
get mouse position → screenToWorld(point)
  ↓
hitTestAt(worldPoint) → { kind: 'concept' | 'cluster' | null, id }
  ↓
update state → render()

mouse wheel on canvas:
  ↓
update state.camera.zoom around cursor → render()
  (render-state recomputes labelVisibleNodeIds at the new zoom)
```

## Build sequence

Five steps, in order. Each step ends with a verification load (see Verification).

### Step 1 — DOM scaffolding

Copy the inspector and timeline HTML templates and CSS from `ui/app.js` and `ui/styles.css` into the canvas POC. Add the `state` object and a `render()` orchestrator. Wire panels to render from a stub `state` (e.g., concept manually selected in code) so the visual structure is verifiable before any interaction.

Result: the POC page now looks like the live UI in layout (topbar, canvas in middle, right sidebar inspector, bottom timeline) — but the canvas still draws the static cluster-as-galaxy from the existing POC, no interaction, no render-state.

### Step 2 — Render-state integration (includes progressive labels)

Pass `graphRenderState` into the canvas draw. The static graph reflects active / dim / focus colors based on the (still hard-coded) selection. Implement the label visibility rule: read `labelVisibleNodeIds` from the render-state and only render labels for nodes in that set. Cluster labels always render (they have their own priority).

Result: with a hard-coded selection in `state`, the canvas dims unrelated nodes, brightens the focused neighborhood, and shows only the top-priority labels.

### Step 3 — Camera

Hand-written camera math. Pan: track mouse delta on drag, add to `state.camera.pan`. Zoom: wheel event, scale `state.camera.zoom` by a factor, recompute pan to keep cursor-pointed world position stable (`x_world = (x_screen - panX) / zoom`). Fit: compute bounding box of all clusters, set zoom and pan so the box fits with padding. `screenToWorld` and `worldToScreen` helpers.

Wheel and drag handlers attach to the canvas element. They update state and call `render()`. Render then recomputes `graphRenderState` with the new zoom, which updates `labelVisibleNodeIds` — labels appear and disappear as the user zooms, Google-Maps style.

Result: pan, zoom, and fit work. Progressive labels work.

### Step 4 — Hit-testing

Click handler on canvas. Convert click point to world coordinates. Distance check against atomic node positions first (smallest hit zone), then cluster centers (larger). The first match wins. Dispatches `state.selectedConceptId = id` for atomic, `state.selectedFrameRef = …` is left for timeline clicks (already DOM, already wired).

Result: clicking a concept on the canvas selects it, the inspector switches to the concept view, the canvas dims unrelated nodes.

### Step 5 — Polish

Visual fixes, breathing room, alignment with the live UI's overall feel. No animation system in v1 (parked for v1.5).

When all 5 steps work and the canvas POC visually matches the live UI for the parity scope, **swap**: rename `ui/app.js` → `ui/app-cytoscape-archive.js`, rename `ui/canvas-poc.js` → `ui/app.js`. The dev server's default route loads `ui/index.html`, which loads `/ui/app.js`, so the swap is transparent. The cytoscape dependency stays in `package.json` until a follow-up cleanup; archived file is untouched and can be referenced if needed.

## Out of scope for v1 (parking lot for v1.5+)

- Animation system (springs, smooth transitions, focus fly-to)
- Topographic backdrop
- Typed-edge color variants (cyan vs tan distinction by relation type)
- Filled cluster bodies with members visually inside, in the mockup style
- Focus reticle / camera crosshair indicator
- Hover preview state (light emphasis on hover, distinct from click)
- Breathing labels (amplitude oscillation)
- Cluster collapse / expand
- Search / fly-to-concept

## Verification

After each build step, load the POC URL (`http://127.0.0.1:4173/ui/canvas-poc.html`) in a browser. Use Playwright for screenshots if a real browser is not available. Compare the same state against the live UI (`http://127.0.0.1:4173/`). They should look and behave the same for whatever is in scope at that step.

The smoke test for the producer side (`npm run test:smoke`) is unaffected by this work — it tests the CLI / document layer, not the UI.

## Notes for future sessions

- The view-model layer (`src/view-model/buildMindgraphViewModel.js`, `buildGraphRenderState.js`) is unchanged by this work. It was already pure and engine-agnostic.
- The cytoscape POC files (`ui/cytoscape-spike.*`, `ui/cytoscape-camera-test.*`) remain untracked; they are reference material for what the hybrid approach was trying and how it failed.
- The dynamic-graph-interaction architecture doc (`docs/dynamic-graph-interaction-architecture.md`) is still the source of truth for interaction principles. Path B (graph engine substrate) is ruled out for this project; this spec implements Path A (custom).
- Once v1 ships and the swap is done, removing the cytoscape dependency is a small follow-up: delete `cytoscape` from `package.json` dependencies, delete the archived `ui/app-cytoscape-archive.js`, regenerate the lockfile.
