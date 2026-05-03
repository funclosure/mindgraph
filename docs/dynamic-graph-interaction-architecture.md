# mindgraph Dynamic Graph Interaction Architecture v0

## Purpose

Translate graph-UI research into a buildable interaction architecture for `mindgraph`.

This document is not about making one static layout prettier.
It is about defining a **dynamic exploration system** that can preserve the feel of the prototype while remaining data-driven.

---

## Core Position

`mindgraph` should behave less like a node editor and more like a **semantic terrain explorer**.

That implies:
- stable large-scale geography
- semantic zoom instead of pure geometric zoom
- focus+context instead of equal emphasis everywhere
- progressive disclosure instead of full-detail default rendering
- transcript grounding always reachable from the visual surface

---

## 1. Design Principles

### 1.1 Stable mental map
The graph should not radically reflow on every interaction.

Users should gradually learn:
- where the major concept regions live
- which regions are adjacent
- how the episode’s conceptual terrain is organized

#### Implication
- cluster positions should be mostly stable
- major routes between regions should be mostly stable
- local rearrangements are acceptable
- global rearrangements should be rare and intentional

---

### 1.2 Semantic zoom, not just scaling
Zoom must change **what is shown**, not only size.

At different scales, the graph should present different semantic abstractions.

#### Implication
- zoomed out: show regions / clusters / dominant currents
- mid zoom: show important atomic concepts within active regions
- close zoom: show local concept neighborhoods, labels, relation detail, provenance hooks

---

### 1.3 Focus+context by default
A graph with equal emphasis everywhere becomes a hairball.

When the user selects or hovers:
- the focus area should gain detail and contrast
- the surrounding context should remain visible but quieter
- unrelated material should recede without fully disappearing

#### Implication
- selection should drive visibility, opacity, label priority, and edge emphasis
- the graph should always answer: “what matters right now?”

---

### 1.4 Progressive disclosure
The system should reveal more only when needed.

#### Implication
Default state should hide or soften:
- minor labels
- weak relations
- secondary atomic concepts
- dense provenance paths

Reveal on:
- zoom
- selection
- hover
- playhead relevance
- filter toggles

---

### 1.5 Grounding must remain first-class
This is not a decorative graph.
It must justify itself against transcript evidence.

#### Implication
Every visual focus should have a clear path to:
- active frame(s)
- transcript segment(s)
- recurrence across the episode
- macro → meso → micro provenance

---

## 2. Interaction Model

## 2.1 Primary navigation modes

### A. Episode shape mode
Goal: understand the conceptual terrain of the full episode.

Visible:
- cluster regions
- a few dominant atomic concepts
- major inter-cluster relations
- macro timeline emphasis

### B. Concept inspection mode
Goal: inspect one concept and its neighborhood.

Visible:
- selected concept
- parent cluster(s)
- 1-hop neighbors strongly
- 2-hop neighbors softly
- strongest supporting frames
- transcript excerpts

### C. Moment inspection mode
Goal: inspect one time slice.

Visible:
- active frame concepts
- active relations for that frame
- provenance chain
- local graph emphasis around the frame’s active concept set

### D. Playback mode
Goal: watch semantic attention move through time.

Visible:
- stable graph base
- active concepts/relations pulsing or brightening by playhead
- timeline as the primary temporal controller

---

## 2.2 Zoom levels

These are conceptual levels, not necessarily hard-coded only by pixel scale.

### Level 0 — Regional overview
Show:
- clustered concepts as semantic regions
- region labels
- inter-region currents / aggregated edges
- maybe top 1–3 atomic anchors per region

Hide/de-emphasize:
- most atomic labels
- most intra-region edges
- dense node-level provenance

Use when:
- opening a document
- user is zoomed out
- no strong selection is active

### Level 1 — Regional interior
Show:
- clusters
- important atomic concepts within current viewport
- strongest intra-region relations
- selected/active frame concepts

Hide/de-emphasize:
- low-importance atomic labels
- weak edges
- distant region internals

Use when:
- user zooms into one or two adjacent regions
- meso exploration is dominant

### Level 2 — Local semantic neighborhood
Show:
- selected concept
- local neighbors
- local relation structure
- micro/meso provenance links
- stronger labels and edge types

Hide/de-emphasize:
- unrelated distant nodes
- most off-focus edges

Use when:
- concept is selected
- user drills into a frame
- close zoom

---

## 2.3 Selection behaviors

### Concept selection
On concept click:
- pin concept
- brighten selected node
- show parent cluster(s)
- highlight incoming/outgoing relations
- emphasize 1-hop neighbors
- optionally surface strongest frames as ghost markers on timeline
- inspector switches to concept mode

### Frame selection
On frame click:
- pin frame
- highlight active concepts in graph
- highlight active relations for that frame
- dim unrelated regions
- inspector switches to frame mode
- timeline keeps selected frame outlined

### Hover
Hover should preview, not fully commit.

On hover:
- light emphasis only
- no major relayout
- no heavy panel churn unless explicitly designed as preview mode

---

## 2.4 Focus+context rules

When there is an active focus:

### Focus set
Could be:
- selected concept
- selected frame’s active concept set
- hovered concept
- current playhead concept set

### Rendering tiers
#### Tier 1 — focus
- highest opacity
- labels on
- strongest edge rendering
- richer glyphs if needed

#### Tier 2 — near context
- 1-hop neighbors
- moderate opacity
- some labels visible
- subdued but legible edges

#### Tier 3 — far context
- region still visible
- atomic details mostly hidden
- minimal edge rendering

This keeps orientation without full clutter.

---

## 3. Visibility Heuristics

## 3.1 Node importance score
Use a composite visibility score for atomic concepts.

Possible ingredients:
- recurrence count
- peak activation
- total activation
- current playhead activation
- whether selected
- whether neighbor of selected
- whether inside focused frame
- whether inside viewport center

Example conceptual formula:

```text
visibilityScore =
  baseImportance
  + selectionBoost
  + playheadBoost
  + neighborBoost
  + viewportBoost
```

Do not treat all atomic concepts equally.

---

## 3.2 Edge importance score
Edges should usually be more aggressively filtered than nodes.

Possible ingredients:
- relation weight / confidence
- whether both endpoints are active
- whether the edge touches the selected concept
- whether the edge is intra-cluster or inter-cluster
- current zoom level

Default behavior:
- show few edges when zoomed out
- show local edges when zoomed in
- always show edges that explain the current focus

---

## 3.3 Label priority
Labels should be ranked, not all-on.

Priority boosts when:
- node is selected
- node is active at playhead
- node is high recurrence / high centrality
- node is inside focused viewport
- node is a cluster label

This is critical to achieving the prototype feel.

---

## 4. Layout Architecture

## 4.1 Two-stage layout

### Stage A — macro geography
Compute stable positions for clustered concepts / regions.

This defines the episode’s broad terrain.
It should change rarely.

Candidate methods:
- manual/prototype-seeded region anchors
- force layout constrained by cluster adjacency
- ELK or force-directed layout with post-processing
- saved per-document layout coordinates

### Stage B — local interior layout
Within each cluster, place atomic concepts dynamically.

Candidate methods:
- radial packing
- constrained force layout
- importance-weighted orbital layout
- local collision resolution

This can be recomputed more often than macro geography.

---

## 4.2 Recommended layout behavior

### Stable cluster anchors
Clusters should have durable anchor positions.

### Flexible atomic interiors
Atomic concepts can move more locally within a bounded cluster territory.

### Selection-driven micro-relaxation
On selection, allow slight local re-spacing to improve readability.
Do not let the whole graph explode into a new shape.

---

## 4.3 Spatial metaphor
The prototype suggests a **terrain/map metaphor**, not a strict graph-theory diagram.

Lean into:
- semantic regions
- currents / paths between regions
- orbital local neighborhoods
- contour-like background cues

Avoid:
- box-grid compartmentalization
- org-chart symmetry
- perfectly even force blobs

---

## 5. Rendering Stack Recommendation

## 5.1 Near-term
For current scale, SVG is fine for rapid iteration.

Benefits:
- easy custom styling
- easy label management
- easy interaction wiring
- low implementation friction

Use while:
- refining visual grammar
- refining semantic zoom rules
- refining focus+context behaviors

---

## 5.2 Medium-term
Move to a hybrid rendering stack.

### Recommended split
- **Canvas or WebGL**: nodes, edges, region fills, high-frequency redraws
- **SVG or HTML overlay**: labels, hover affordances, inspector hooks, selection rings

This matches the pattern used by serious graph systems.

---

## 5.3 Why hybrid is likely right for mindgraph
`mindgraph` needs all of these at once:
- atmospheric styling
- lots of small primitives
- responsive time-based highlighting
- readable labels
- rich hover / selection interactions

Pure SVG will eventually get heavy.
Pure WebGL will make text and UI awkward.
Hybrid gives the best tradeoff.

---

## 6. Time-Aware Graph Behavior

## 6.1 Playhead as semantic activator
The playhead should not move nodes around drastically.
It should modulate emphasis.

At time `t`:
- brighten active concepts
- brighten active relations
- optionally show decaying trails for recently active concepts
- keep non-active regions quiet but present

---

## 6.2 Multi-level frame coupling
The graph should be aware of:
- macro frame context
- meso current window
- micro provenance detail

Recommended behavior:
- macro selection influences region-level emphasis
- meso selection influences concept subset emphasis
- micro selection influences transcript-grounded local detail

---

## 6.3 Recurrence visualization
Later, mindgraph should surface recurrence directly on the graph.

Possible approaches:
- halo strength from recurrence
- dotted recurrence rings
- timeline recurrence markers tied back to graph nodes
- “memory trails” when scrubbing

This should be subtle, not gamified.

---

## 7. Recommended Interaction Features

## Must-have
- pan
- zoom
- concept select
- frame select
- timeline scrub
- focus+context dimming
- transcript grounding

## Strong next features
- semantic zoom thresholds
- label priority rules
- hover neighborhood preview
- concept search → fly to region
- cluster collapse / expand

## Later
- fisheye / graph lens
- neighborhood expansion controls
- compare two frames or two concepts
- saved camera bookmarks
- alternate layouts

---

## 8. Candidate Implementation Paths

## Path A — Stay custom
Build our own graph renderer and interaction system.

Pros:
- full control over prototype feel
- can match the semantic-terrain aesthetic closely
- no fighting a generic node-editor abstraction

Cons:
- more engineering burden
- performance work becomes ours

Good when:
- visual identity matters most

---

## Path B — Use a graph engine as substrate
Candidates:
- Sigma.js
- Cytoscape.js
- yFiles if commercial tooling is acceptable later

Pros:
- battle-tested interaction + performance
- built-in graph behaviors
- easier path to larger scale

Cons:
- may resist the exact prototype feel
- styling / mental-model mismatch can create friction

Good when:
- graph scale and performance pressure rise quickly

---

## Path C — Hybrid custom-over-engine
Use an engine for spatial computation / low-level rendering, but keep our own semantic zoom, panel logic, and visual rules.

This is probably the most realistic serious path if `mindgraph` grows.

---

## 9. Current Recommendation for mindgraph

If building from where we are now:

### Recommendation
1. keep the current custom shell
2. replace static layout logic with a real multi-stage layout system
3. implement semantic zoom + focus tiers before chasing more polish
4. plan for hybrid rendering once the interaction model stabilizes

### Concretely
Next implementation milestone should be:

#### `graph-interaction-state`
A state layer that computes:
- zoom level mode
- focused concept set
- visible node ids
- visible edge ids
- label priority
- active region ids
- dimmed region ids
- selected neighborhood set

This should sit between the durable view-model and the renderer.

---

## 10. Proposed Internal Data Products

### `GraphLayoutVM`
Contains:
- cluster anchors
- region extents
- atomic node positions
- cached edge routes or route hints

### `GraphRenderStateVM`
Contains:
- visible nodes
- visible edges
- active nodes
- active edges
- label-visible nodes
- selected nodes
- neighbor nodes
- dimmed nodes
- region emphasis levels

### `GraphViewportMode`
```ts
'overview' | 'region' | 'local'
```

### `GraphFocusMode`
```ts
'none' | 'concept' | 'frame' | 'playhead'
```

---

## 11. Suggested Build Sequence

### Phase 1 — interaction state
- define zoom modes
- define visibility scoring
- define label priority logic
- define selection neighborhood logic

### Phase 2 — layout system
- stable cluster anchors
- bounded local interior layout
- optional saved layout snapshots

### Phase 3 — renderer upgrade
- move from current static SVG shell to better layered rendering
- separate graph primitives from labels/UI overlays

### Phase 4 — polish
- transitions
- recurrence cues
- search/fly-to
- richer transcript-linked interactions

---

## 12. Final Position

The main insight from the research is:

> The right problem is not “how do we render a pretty graph?”
> The right problem is “how do we let users explore conceptual terrain without losing clarity, grounding, or orientation?”

For `mindgraph`, the answer is likely:
- semantic zoom
- focus+context
- progressive disclosure
- stable geography
- hybrid rendering

That is the path most likely to preserve the prototype’s feel while becoming truly dynamic.
