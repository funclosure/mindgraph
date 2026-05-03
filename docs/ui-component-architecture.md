# mindgraph UI Component Architecture v0

## Purpose

Translate the current wireframe and `mindgraph` data model into a concrete implementation-oriented component architecture.

This spec answers:
- what major UI components exist
- what data each one needs
- what state each one owns versus receives
- how graph, timeline, and inspector coordinate
- where adaptation from raw `mindgraph` JSON should happen

This is written with a React-style architecture in mind, but the ideas are portable.

---

## 1. Architectural Principles

### 1. Graph-first product
The graph canvas is the dominant surface.
Other components support graph understanding rather than compete with it.

### 2. Timeline is stateful, not ornamental
The timeline is not just a display bar.
It drives temporal state and active concept emphasis.

### 3. Inspector is contextual, not global
The right panel reflects current selection and provenance.
It should not try to show everything at once.

### 4. Raw data should not flow directly into presentational components
A view-model adaptation layer should normalize:
- concept hierarchy
- frame levels
- temporal state
- graph display state
- selection context

### 5. Selection and playback are cross-cutting application state
These should live above graph/timeline/inspector.

---

## 2. Top-Level Component Tree

```text
MindgraphApp
└─ MindgraphWorkspace
   ├─ TopBar
   ├─ MainLayout
   │  ├─ GraphCanvasPane
   │  │  ├─ GraphCanvas
   │  │  ├─ GraphLayerControls
   │  │  └─ GraphLegend (optional)
   │  └─ InspectorPane
   │     ├─ InspectorHeader
   │     ├─ ConceptInspector | FrameInspector
   │     ├─ GroundingPanel
   │     └─ AnnotationPanel (later)
   └─ TimelinePane
      ├─ PlaybackControls
      ├─ TimelineTracks
      │  ├─ MicroTrack
      │  ├─ MesoTrack
      │  └─ MacroTrack
      └─ TimelineStatusBar
```

---

## 3. App Shell Components

## 3.1 `MindgraphApp`
### Responsibility
- app bootstrap
- load document
- instantiate global state providers
- pass normalized view model into workspace

### Inputs
- `MindgraphDocument`
- app configuration

### Owns
- document loading lifecycle
- error state
- initial view preferences

---

## 3.2 `MindgraphWorkspace`
### Responsibility
Main coordinator for:
- selection state
- playback state
- current frame level emphasis
- graph focus state
- inspector mode

### Inputs
- normalized document view model

### Owns shared UI state
```ts
type WorkspaceState = {
  selectedConceptId?: string
  selectedFrameRef?: { level: 'micro' | 'meso' | 'macro'; index: number }
  pinnedSelection: boolean
  playheadTime: number
  activeLevel: 'micro' | 'meso' | 'macro'
  graphZoom: number
  graphPan: { x: number; y: number }
  hoveredConceptId?: string
  hoveredFrameRef?: { level: 'micro' | 'meso' | 'macro'; index: number }
}
```

### Delegates to
- `GraphCanvasPane`
- `InspectorPane`
- `TimelinePane`

---

## 4. Graph Surface Components

## 4.1 `GraphCanvasPane`
### Responsibility
Wrap the central graph experience.

### Contains
- `GraphCanvas`
- `GraphLayerControls`
- optional legend/minimap later

### Receives
- graph nodes/edges view model
- active concept set at current playhead
- selection state

---

## 4.2 `GraphCanvas`
### Responsibility
Render the semantic graph itself.

### Renders
- cluster regions or cluster hub nodes
- atomic concept nodes
- relation edges
- active highlighting
- selection/neighbor emphasis

### Inputs
```ts
type GraphCanvasProps = {
  nodes: GraphNodeVM[]
  edges: GraphEdgeVM[]
  selectedConceptId?: string
  activeConceptIds: string[]
  hoveredConceptId?: string
  onConceptClick(id: string): void
  onConceptHover(id?: string): void
  zoom: number
  pan: { x: number; y: number }
}
```

### Notes
This component should remain mostly presentational.
Layout computation should happen outside it.

---

## 4.3 `GraphLayerControls`
### Responsibility
Small local controls for graph interpretation.

### Controls
- cluster visibility
- atomic visibility
- edge density mode later
- semantic zoom hint

### Notes
Keep visually minimal.
This should not become a giant toolbar.

---

## 5. Timeline Components

## 5.1 `TimelinePane`
### Responsibility
Coordinate timeline rendering and playback actions.

### Contains
- `PlaybackControls`
- `TimelineTracks`
- `TimelineStatusBar`

### Receives
- frame view model across all levels
- playhead time
- active level
- selection state

---

## 5.2 `PlaybackControls`
### Responsibility
Temporal interaction controls.

### Controls
- play
- pause
- step forward/back
- speed later
- jump to previous/next selected frame later

### Owns
No durable state beyond UI interaction.
Playback state should live in `MindgraphWorkspace`.

---

## 5.3 `TimelineTracks`
### Responsibility
Render all three timeline levels in coordinated form.

### Contains
- `MicroTrack`
- `MesoTrack`
- `MacroTrack`

### Inputs
```ts
type TimelineTracksProps = {
  microFrames: TimelineFrameVM[]
  mesoFrames: TimelineFrameVM[]
  macroFrames: TimelineFrameVM[]
  activeLevel: 'micro' | 'meso' | 'macro'
  selectedFrameRef?: FrameRef
  hoveredFrameRef?: FrameRef
  playheadTime: number
  onFrameClick(ref: FrameRef): void
  onFrameHover(ref?: FrameRef): void
  onPlayheadChange(time: number): void
}
```

---

## 5.4 `MicroTrack`, `MesoTrack`, `MacroTrack`
### Responsibility
Each renders one granularity level.

### Shared responsibilities
- draw frame bars
- display selected frame
- display current playhead overlap
- support hover/click

### Notes
These can share a common `TimelineTrack` base component with different styling density.

---

## 5.5 `TimelineStatusBar`
### Responsibility
Show compact contextual status.

### Could display
- current playhead timestamp
- selected frame label
- current active level
- concept count active at playhead later

---

## 6. Inspector Components

## 6.1 `InspectorPane`
### Responsibility
Switch between selection modes and assemble contextual panels.

### Contains
- `InspectorHeader`
- `ConceptInspector` or `FrameInspector`
- `GroundingPanel`
- optional `AnnotationPanel`

### Inputs
- selected concept VM or selected frame VM
- provenance VM
- transcript excerpt VM

---

## 6.2 `InspectorHeader`
### Responsibility
Display selection type and quick context.

### Example
- `Concept · Meaning Crisis`
- `Frame · meso 10 · 517s–570s`

---

## 6.3 `ConceptInspector`
### Responsibility
Show structured concept detail.

### Sections
- identity
- parent clusters
- recurrence metrics
- related concepts
- strongest frames

### Inputs
```ts
type ConceptInspectorProps = {
  concept: ConceptVM
  relatedConcepts: ConceptVM[]
  strongestFrames: FrameRef[]
  onRelatedConceptClick(id: string): void
  onFrameClick(ref: FrameRef): void
}
```

---

## 6.4 `FrameInspector`
### Responsibility
Show structured frame detail.

### Sections
- frame identity
- summary
- active foreground/background concepts
- active relations
- navigation refs

### Inputs
```ts
type FrameInspectorProps = {
  frame: TimelineFrameVM
  onConceptClick(id: string): void
  onNavigateFrame(ref: FrameRef): void
}
```

---

## 6.5 `GroundingPanel`
### Responsibility
Show transcript grounding and provenance chain.

### Displays
- transcript excerpt text
- source segment ids
- source frame refs
- macro → meso → micro path when available

### Notes
This is essential to preserve interpretability.
It should exist in both concept and frame modes.

---

## 6.6 `AnnotationPanel` (later)
### Responsibility
Allow light edits and notes.

### Later actions
- concept note
- relabel suggestion
- merge suggestion
- frame summary refinement

### Notes
Keep out of v0 unless needed early.

---

## 7. Data Adaptation Layer

## 7.1 `buildMindgraphViewModel(document)`
### Responsibility
Convert raw `MindgraphDocument` into UI-friendly structures.

### Output
```ts
type MindgraphViewModel = {
  concepts: {
    atomic: ConceptVM[]
    clustered: ConceptVM[]
    byId: Record<string, ConceptVM>
  }
  relations: RelationVM[]
  frames: {
    micro: TimelineFrameVM[]
    meso: TimelineFrameVM[]
    macro: TimelineFrameVM[]
  }
  transcript: TranscriptSegmentVM[]
  graph: GraphVM
}
```

### Why this matters
Raw document shape is durable and honest.
UI needs:
- normalized indexes
- denormalized relations
- resolved parent labels
- precomputed neighborhoods
- active-state helpers

Those should not be recomputed ad hoc inside components.

---

## 7.2 Graph View Model Builder
### Responsibility
Build graph-oriented node and edge structures from concepts + relations.

### Output examples
```ts
type GraphNodeVM = {
  id: string
  label: string
  level: 'atomic' | 'clustered'
  parentIds: string[]
  stats?: ConceptStats
  regionKey?: string
  x?: number
  y?: number
}

type GraphEdgeVM = {
  id: string
  from: string
  to: string
  type: string
  weight?: number
}
```

### Notes
Later, graph layout data may be cached alongside these nodes.

---

## 7.3 Frame View Model Builder
### Responsibility
Normalize frame objects for rendering and inspector use.

### Output example
```ts
type TimelineFrameVM = {
  ref: FrameRef
  id?: string
  title?: string
  t: number
  span: { start: number; end: number }
  summary: string
  foregroundConcepts: ActivationVM[]
  backgroundConcepts: ActivationVM[]
  activeRelations: RelationActivationVM[]
  sourceSegmentIds: string[]
  sourceFrameRefs?: FrameRef[]
}
```

---

## 8. Shared State Boundaries

## App-level shared state
Should live in a workspace store/context:
- selected concept
- selected frame
- pinned state
- playhead time
- active level
- hover state
- graph camera state

## Local component state
Can remain local:
- inspector tab open/closed later
- timeline hover label
- graph tooltip visibility
- panel collapse state later

### Recommendation
Use a lightweight state store like Zustand or React context + reducer.
Keep raw document immutable once loaded.

---

## 9. Derived Selectors

These should be computed in selectors, not directly in components.

### Needed selectors
- active concepts at playhead
- active relations at playhead
- selected concept neighborhood
- selected concept strongest frames
- selected frame transcript excerpts
- visible graph subgraph for current zoom/selection
- macro/meso/micro ancestry chain

### Example
```ts
getActiveConceptIdsAtTime(time): string[]
getSelectedConceptNeighbors(id): string[]
getFrameTranscriptExcerpt(ref): TranscriptExcerptVM
```

---

## 10. Event Flow

## Concept click
```text
GraphCanvas -> selectConcept(id)
            -> Inspector switches to concept mode
            -> Timeline highlights concept recurrence later
```

## Frame click
```text
TimelineTrack or Graph-linked frame action -> selectFrame(ref)
                                           -> Inspector switches to frame mode
                                           -> Graph highlights frame-active concepts
```

## Playhead move
```text
Timeline -> setPlayhead(time)
         -> derive active concepts/relations
         -> Graph updates emphasis
         -> Inspector updates only if selection is unpinned preview
```

---

## 11. Implementation Phases

## Phase 1
- document loader
- graph canvas with static nodes
- timeline tracks
- frame selection
- concept selection
- concept inspector
- frame inspector
- grounding panel

## Phase 2
- semantic zoom behavior
- graph layout refinement
- active playhead-driven highlighting
- related concepts / strongest frame lists

## Phase 3
- annotation interactions
- playback animation
- compare/diff states
- editing workflows

---

## 12. Recommended File/Module Structure

```text
ui/
  app/
    MindgraphApp.tsx
    MindgraphWorkspace.tsx
  components/
    TopBar.tsx
    graph/
      GraphCanvasPane.tsx
      GraphCanvas.tsx
      GraphLayerControls.tsx
    timeline/
      TimelinePane.tsx
      PlaybackControls.tsx
      TimelineTracks.tsx
      TimelineTrack.tsx
    inspector/
      InspectorPane.tsx
      InspectorHeader.tsx
      ConceptInspector.tsx
      FrameInspector.tsx
      GroundingPanel.tsx
  state/
    workspaceStore.ts
    selectors.ts
  view-model/
    buildMindgraphViewModel.ts
    buildGraphViewModel.ts
    buildFrameViewModel.ts
  types/
    uiTypes.ts
```

---

## 13. Current Recommendation

After this architecture spec, the next best step is:

### `ui-view-model-spec.md`

That should define:
- exact UI-facing types
- selectors
- normalized indexes
- derived graph/timeline/inspector structures

That document will become the bridge between:
- the durable `mindgraph` JSON format
- and the actual UI implementation.
