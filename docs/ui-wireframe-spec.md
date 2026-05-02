# mindgraph UI Wireframe Spec v0

## Purpose

Translate the current `mindgraph` product direction into a concrete screen structure that can guide implementation.

This spec is intentionally layout-first.
It defines:
- what major surfaces exist
- what each surface contains
- how selection and navigation flow between them
- what should be visible at the same time

---

## Primary Screen Layout

```text
┌──────────────────────────────────────────────────────────────────────────────┐
│ Top Bar                                                                      │
│ Project / Document title · episode selector · view mode · playback controls  │
├──────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│  Graph Canvas                                              Inspector Panel   │
│  (dominant surface)                                        (right side)      │
│                                                                              │
│  - clustered regions                                        ┌──────────────┐ │
│  - atomic concept nodes                                     │ Focus        │ │
│  - weighted relations                                       │ Grounding    │ │
│  - active highlights                                        │ Neighbors    │ │
│  - semantic zoom                                            │ Annotation   │ │
│                                                             └──────────────┘ │
│                                                                              │
├──────────────────────────────────────────────────────────────────────────────┤
│ Timeline Strip                                                               │
│ micro track · meso track · macro track · playhead · selected span            │
└──────────────────────────────────────────────────────────────────────────────┘
```

---

## 1. Top Bar

### Purpose
Provide global context and lightweight controls without competing with the graph.

### Contents
- document title
- episode / document selector
- current selection breadcrumb
- playback controls
  - play
  - pause
  - step
- zoom mode toggle
  - graph-first
  - timeline-first
- optional level emphasis toggle
  - micro
  - meso
  - macro

### Notes
- Keep this visually quiet.
- This is not a command center.
- The graph remains the hero.

---

## 2. Graph Canvas

### Purpose
Primary semantic surface for understanding conceptual structure.

### Wireframe zones

```text
┌───────────────────────────────────────────────────────────────┐
│ Cluster region: Cultural Convergences                         │
│   • Buddhism       • Cognitive Science                        │
│   • Mindfulness    • Wisdom                                   │
│                                                               │
│                           Cluster region: Meaning Crisis Core │
│                           • Meaning Crisis                    │
│                           • Meaning in Life                   │
│                           • Dark Factors                      │
│                                                               │
│       Cluster region: Transformative Consciousness            │
│       • Altered States   • Awakening   • Enlightenment       │
│                                                               │
│                             Cluster region: Expanded          │
│                             Epistemology                      │
│                             • Kinds of Knowing                │
│                             • Belief-Centrism                │
│                                                               │
└───────────────────────────────────────────────────────────────┘
```

### Elements
#### Clustered concepts
- large region labels or hub nodes
- visible at zoomed-out view
- serve as orientation anchors

#### Atomic concepts
- nested or spatially associated under clusters
- appear more clearly at mid zoom
- fully readable at close zoom

#### Relations
- visible between atomic concepts
- simplified between clusters at far zoom
- brighter when active at current playhead

### Interaction
- click concept → inspector enters concept mode
- hover concept → preview highlight
- click empty canvas → clear local selection but preserve time position
- zoom out → clusters dominate
- zoom in → atomic nodes and edges dominate

### Visual behavior
#### Default
- low-intensity ambient graph
- cluster labels readable first
- atomic layer secondary

#### On current time/frame
- active concepts brighten
- inactive concepts remain visible but quieter

#### On selection
- selected node strongest emphasis
- one-hop neighbors softly emphasized
- unrelated nodes slightly muted

---

## 3. Timeline Strip

### Purpose
Show how conceptual focus unfolds across time.

### Wireframe

```text
┌───────────────────────────────────────────────────────────────┐
│ micro  ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░ │
│ meso   ├────┼─────┼──────┼────┼──────┼────────┼────────────┤ │
│ macro  ├──────────────┼────────────────┼──────────────────┤ │
│                  ▲ playhead                                    │
└───────────────────────────────────────────────────────────────┘
```

### Tracks
#### Micro
- fine-grained, dense
- mostly used for precision and provenance

#### Meso
- default working track
- semantic windows
- most readable operational layer

#### Macro
- top-level episode phases
- orientation layer

### Interaction
- click frame block → select frame
- drag playhead → update active graph state
- hover block → temporary preview in inspector
- selected frame remains outlined

### Future affordances
- concept recurrence overlays
- annotation markers
- bookmarks
- compare ranges

---

## 4. Inspector Panel

### Purpose
Act as a semantic inspector + transcript grounding pane.

Not a generic sidebar.
It should feel like a calm contextual lens.

### Modes
- concept mode
- frame mode

Only one primary mode at a time in v0.

---

## 4A. Concept Mode Wireframe

```text
┌──────────────────────────────┐
│ Concept: Meaning Crisis      │
│ Parent: Meaning Crisis Core  │
│                              │
│ Metrics                      │
│ - recurrence: 11             │
│ - total activation: 8.53     │
│ - peak activation: 0.97      │
│ - persistence: 1086s         │
│                              │
│ Related Concepts             │
│ - Meaning in Life            │
│ - Dark Factors               │
│ - Wisdom Cultivation         │
│                              │
│ Strongest Frames             │
│ - macro 1                    │
│ - meso 10                    │
│ - meso 11                    │
│                              │
│ Grounding                    │
│ - transcript excerpt(s)      │
│ - source segments            │
│                              │
│ Notes / Actions              │
│ - annotation note            │
│ - merge / relabel later      │
└──────────────────────────────┘
```

### Required fields
- label
- id
- parent cluster(s)
- recurrence stats
- related concepts
- strongest frames
- excerpt grounding

---

## 4B. Frame Mode Wireframe

```text
┌────────────────────────────────┐
│ Frame: meso 10                 │
│ Span: 517s → 570s              │
│ Title: [optional]              │
│                                │
│ Summary                        │
│ The lecture names the meaning  │
│ crisis as the unifying         │
│ diagnosis...                   │
│                                │
│ Active Concepts                │
│ - meaning-crisis      0.97     │
│ - dark-factors        0.82     │
│ - meaning-in-life     0.58     │
│                                │
│ Active Relations               │
│ - dark-factors → meaning-crisis│
│                                │
│ Grounding                      │
│ - source frame refs            │
│ - transcript excerpts          │
│ - source segment ids           │
│                                │
│ Navigation                     │
│ - previous / next              │
│ - parent / child frames        │
└────────────────────────────────┘
```

### Required fields
- level
- index
- timestamp span
- summary
- active concepts
- active relations
- provenance
- navigation links

---

## 5. Grounding Presentation

### Principle
The graph must always be able to justify itself against transcript evidence.

### Provenance chain
```text
macro -> meso -> micro -> transcript segment
```

### Display rules
#### When a concept is selected
show:
- strongest supporting frames
- transcript excerpts from those frames
- where in the episode the concept recurs

#### When a frame is selected
show:
- its transcript excerpt first
- its parent/child provenance second

---

## 6. Semantic Zoom Rules

### Zoomed out
- cluster labels dominate
- atomic nodes de-emphasized
- macro timeline emphasized

### Mid zoom
- atomic concepts readable
- meso frames become primary working layer

### Close zoom
- local neighborhoods and detailed relations visible
- micro frame grounding becomes more useful

---

## 7. Default User Flow

### Flow A — understand the episode shape
1. open episode
2. inspect macro frames
3. click a macro phase
4. graph highlights relevant concept terrain

### Flow B — inspect a concept
1. click concept node
2. inspector shows stats + grounding
3. scrub timeline to watch recurrence

### Flow C — inspect a moment
1. click meso frame
2. inspector shows summary + transcript basis
3. graph highlights active concepts
4. drill down to micro if needed

---

## 8. v0 Build Priorities

### Must-have
- graph canvas
- timeline strip
- concept selection
- frame selection
- concept inspector
- frame inspector
- transcript grounding excerpt

### Should-have
- semantic zoom
- macro/meso/micro switching emphasis
- neighbor highlighting

### Later
- editing/annotation in-panel
- concept merging UI
- playback animation polish
- diff/compare mode

---

## 9. Direct Mapping to `mindgraph` Data

### Graph canvas
- `concepts.clustered`
- `concepts.atomic`
- `relations`

### Timeline strip
- `frames.micro`
- `frames.meso`
- `frames.macro`

### Inspector
- concept `stats`
- concept `parentIds`
- frame `foregroundConcepts`
- frame `backgroundConcepts`
- frame `activeRelations`
- frame `sourceFrameRefs`
- frame `sourceSegmentIds`
- `transcript.segments`

---

## 10. Current Design North Star

Use the **first generated UI concept image** as the aesthetic north star.

Preserve:
- graph-first composition
- elegant dark scholarly mood
- map-like clustered semantic terrain
- timeline as subordinate but essential

Refine carefully:
- right-side panel clarity
- transcript grounding legibility
- selection-state feedback
