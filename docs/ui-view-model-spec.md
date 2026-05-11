# mindgraph UI View-Model Spec v0

## Purpose

Define the exact UI-facing data layer that sits between the durable `mindgraph.document` JSON format and the interactive UI.

This layer should:
- normalize document data
- resolve references
- denormalize relationships where useful
- prepare graph/timeline/inspector-friendly structures
- centralize selectors for active state, provenance, and recurrence

This is the bridge between:
- the storage model
- the component architecture
- the runtime interaction model

---

## 1. Design Goals

### 1. Keep the document honest
Raw `mindgraph.document` remains the canonical source of truth.
The view-model must not mutate or reinterpret it invisibly.

### 2. Make the UI simple
UI components should consume already-prepared structures rather than perform ad hoc lookup chains.

### 3. Support semantic zoom
The view-model must expose:
- atomic concepts
- clustered concepts
- micro frames
- meso frames
- macro frames
- ancestry/provenance relationships across levels

### 4. Support time-aware highlighting
The UI must be able to quickly answer:
- what concepts are active at time `t`
- what frame is active at each level
- what relations are active at time `t`

---

## 2. Raw Input

The input is a `MindgraphDocument` shaped roughly like:

```ts
interface MindgraphDocument {
  version: 1
  kind: 'mindgraph.document'
  transcript: {
    title: string
    source: string
    speakers: string[]
    segments: TranscriptSegment[]
  }
  concepts: {
    atomic: AtomicConcept[]
    clustered: ClusteredConcept[]
  }
  relations: Relation[]
  frames: {
    micro: Frame[]
    meso: Frame[]
    macro: Frame[]
  }
  meta: Record<string, unknown>
}
```

---

## 3. Top-Level View Model

```ts
interface MindgraphViewModel {
  documentMeta: DocumentMetaVM
  transcript: TranscriptVM
  concepts: ConceptsVM
  relations: RelationsVM
  frames: FramesVM
  graph: GraphVM
  indexes: IndexesVM
}
```

### `DocumentMetaVM`
```ts
interface DocumentMetaVM {
  title: string
  source: string
  speakers: string[]
  durationSeconds: number
  counts: {
    transcriptSegments: number
    atomicConcepts: number
    clusteredConcepts: number
    relations: number
    microFrames: number
    mesoFrames: number
    macroFrames: number
  }
}
```

---

## 4. Transcript View Model

```ts
interface TranscriptVM {
  segments: TranscriptSegmentVM[]
  byId: Record<string, TranscriptSegmentVM>
}

interface TranscriptSegmentVM {
  id: string
  start: number
  end: number
  speaker?: string
  text: string
  duration: number
}
```

### Notes
- `duration = end - start`
- this is the grounding substrate
- transcript segment objects should remain close to raw source data

---

## 5. Concepts View Model

```ts
interface ConceptsVM {
  atomic: ConceptVM[]
  clustered: ConceptVM[]
  byId: Record<string, ConceptVM>
  childrenByClusterId: Record<string, string[]>
  clustersByAtomicId: Record<string, string[]>
}
```

### Shared concept shape
```ts
interface ConceptVM {
  id: string
  label: string
  level: 'atomic' | 'clustered'
  description?: string
  aliases?: string[]
  parentIds: string[]
  childIds: string[]
  stats?: ConceptStatsVM
}

interface ConceptStatsVM {
  recurrenceCount: number
  totalActivation: number
  peakActivation: number
  persistence: number
}
```

### Notes
- clustered concepts should have `childIds`
- atomic concepts should usually have empty `childIds`
- `parentIds` should be normalized to `[]` if absent

---

## 6. Relations View Model

```ts
interface RelationsVM {
  all: RelationVM[]
  byId: Record<string, RelationVM>
  outgoingByConceptId: Record<string, string[]>
  incomingByConceptId: Record<string, string[]>
}

interface RelationVM {
  id: string
  from: string
  to: string
  type: string
  label?: string
  description?: string
  meta?: Record<string, unknown>
}
```

### Notes
These adjacency maps are important for:
- graph neighborhood highlighting
- concept inspector related-concept sections

---

## 7. Frame View Model

```ts
interface FramesVM {
  micro: TimelineFrameVM[]
  meso: TimelineFrameVM[]
  macro: TimelineFrameVM[]
  byRef: Record<string, TimelineFrameVM>
}
```

### Frame reference
```ts
type FrameLevel = 'micro' | 'meso' | 'macro'

interface FrameRef {
  level: FrameLevel
  index: number
}
```

### Keyed ref helper
```ts
type FrameRefKey = `${FrameLevel}:${number}`
```

### Timeline frame shape
```ts
interface TimelineFrameVM {
  ref: FrameRef
  key: FrameRefKey
  id?: string
  title?: string
  t: number
  span: { start: number; end: number }
  duration: number
  speakers: string[]
  summary: string
  foregroundConcepts: ActivationVM[]
  backgroundConcepts: ActivationVM[]
  activeRelations: RelationActivationVM[]
  sourceSegmentIds: string[]
  sourceFrameRefs: FrameRef[]
  ancestry: {
    macro?: FrameRef
    meso?: FrameRef
    micro?: FrameRef[]
  }
}
```

### Activation shapes
```ts
interface ActivationVM {
  id: string
  label: string
  weight: number
  mode?: string
  parentClusterIds: string[]
}

interface RelationActivationVM {
  id: string
  weight: number
  relation?: RelationVM
}
```

### Notes
- `foregroundConcepts` and `backgroundConcepts` should already be label-resolved
- `sourceFrameRefs` should normalize to `[]`
- `ancestry` is derived during build, not stored raw

---

## 8. Graph View Model

```ts
interface GraphVM {
  nodes: GraphNodeVM[]
  edges: GraphEdgeVM[]
  nodeById: Record<string, GraphNodeVM>
  edgesByNodeId: Record<string, string[]>
  conceptImportance: Record<string, number>  // base importance score per atomic concept, ∈ [0, 1]
  coOccurrence: Record<string, Record<string, number>>  // sparse symmetric pair-score matrix
}
```

### Co-occurrence matrix

`coOccurrence[a][b]` is the duration-weighted count of frames (across micro + meso + macro) where both atomic concepts `a` and `b` appear together in `foregroundConcepts ∪ backgroundConcepts`. Computed once at VM build time and stored sparsely — only pairs with score > 0 are present, and every present entry is symmetric (`coOccurrence[a][b] === coOccurrence[b][a]`). Drives the reading-UI graph's per-pair spring `ideal_d`: stronger co-occurrence → tighter ideal distance via an exponential decay curve, weakest pairs sit near `D_MAX` (or get the unrelated-pair repulsion).

### Graph nodes
```ts
interface GraphNodeVM {
  id: string
  label: string
  level: 'atomic' | 'clustered'
  parentIds: string[]
  childIds: string[]
  stats?: ConceptStatsVM
  regionKey?: string
  visualWeight: number
  degree: number  // count of incident edges (self-loops count twice, per graph-theory convention)
}
```

### Graph edges
```ts
interface GraphEdgeVM {
  id: string
  from: string
  to: string
  type: string
  label?: string
  visualWeight: number
}
```

### Visual weight rules (v0)
For concepts:
- default to `peakActivation` if available
- otherwise fallback to 0.5

For relations:
- default to 0.5 unless relation-level heuristics exist later

---

## 9. Indexes View Model

This is the performance/lookup layer.

```ts
interface IndexesVM {
  conceptToFrameRefs: Record<string, FrameRefKey[]>
  conceptToTranscriptSegmentIds: Record<string, string[]>
  frameToTranscriptSegments: Record<FrameRefKey, TranscriptSegmentVM[]>
  frameChildren: Record<FrameRefKey, FrameRef[]>
  frameParent: Record<FrameRefKey, FrameRef | undefined>
}
```

### Why it matters
These indexes power:
- concept inspector grounding
- strongest frame lookup
- transcript excerpt lookup
- drill-down between macro/meso/micro

---

## 10. Selector Layer

Selectors should sit above the raw view-model and below UI components.

---

## 10.1 Temporal selectors

```ts
getActiveFrameAtTime(level: FrameLevel, time: number): TimelineFrameVM | undefined
getActiveFramesAtTime(time: number): {
  micro?: TimelineFrameVM
  meso?: TimelineFrameVM
  macro?: TimelineFrameVM
}
```

### Behavior
- choose frame where `span.start <= time < span.end`
- if none, return nearest previous frame optionally later

---

## 10.2 Active concept selectors

```ts
getActiveConceptIdsAtTime(time: number, level: FrameLevel): string[]
getActiveConceptActivationsAtTime(time: number, level: FrameLevel): ActivationVM[]
getActiveRelationActivationsAtTime(time: number, level: FrameLevel): RelationActivationVM[]
```

### Notes
These feed:
- graph highlighting
- timeline overlays later
- inspector contextual emphasis

---

## 10.3 Concept selectors

```ts
getConceptById(id: string): ConceptVM | undefined
getConceptNeighbors(id: string): ConceptVM[]
getConceptIncomingRelations(id: string): RelationVM[]
getConceptOutgoingRelations(id: string): RelationVM[]
getConceptStrongestFrames(id: string, limit?: number): TimelineFrameVM[]
getConceptTranscriptExcerpts(id: string, limit?: number): TranscriptSegmentVM[]
```

### Strongest frame rule
Sort by maximum activation weight for that concept in the frame.

---

## 10.4 Frame selectors

```ts
getFrame(ref: FrameRef): TimelineFrameVM | undefined
getFrameTranscriptSegments(ref: FrameRef): TranscriptSegmentVM[]
getFrameParent(ref: FrameRef): TimelineFrameVM | undefined
getFrameChildren(ref: FrameRef): TimelineFrameVM[]
getFrameConcepts(ref: FrameRef): ActivationVM[]
```

### Notes
Frame inspector should rely on these selectors instead of doing manual lookup.

---

## 10.5 Cluster selectors

```ts
getClusterChildren(clusterId: string): ConceptVM[]
getConceptClusters(conceptId: string): ConceptVM[]
getClusterStrongestFrames(clusterId: string, limit?: number): TimelineFrameVM[]
```

### Notes
These become more important once cluster-level graph navigation is built.

---

## 11. Inspector-Specific View Models

Instead of letting the inspector assemble everything itself, provide mode-specific view models.

---

## 11.1 Concept Inspector VM

```ts
interface ConceptInspectorVM {
  concept: ConceptVM
  parentClusters: ConceptVM[]
  incomingRelations: RelationVM[]
  outgoingRelations: RelationVM[]
  relatedConcepts: ConceptVM[]
  strongestFrames: TimelineFrameVM[]
  transcriptExcerpts: TranscriptSegmentVM[]
}
```

---

## 11.2 Frame Inspector VM

```ts
interface FrameInspectorVM {
  frame: TimelineFrameVM
  foregroundConcepts: ActivationVM[]
  backgroundConcepts: ActivationVM[]
  activeRelations: RelationActivationVM[]
  transcriptSegments: TranscriptSegmentVM[]
  parentFrame?: TimelineFrameVM
  childFrames: TimelineFrameVM[]
}
```

---

## 12. Graph Rendering State VM

The graph component needs more than static nodes and edges.
It needs selection-aware state.

```ts
interface GraphRenderStateVM {
  visibleNodeIds: string[]
  visibleEdgeIds: string[]
  activeNodeIds: string[]
  activeEdgeIds: string[]
  selectedNodeId?: string
  neighborNodeIds: string[]
  fadedNodeIds: string[]
}
```

### Produced by selectors such as
```ts
buildGraphRenderState({
  selectedConceptId,
  playheadTime,
  activeLevel,
  zoomLevel,
}): GraphRenderStateVM
```

---

## 13. Timeline Rendering VM

```ts
interface TimelineTrackVM {
  level: FrameLevel
  frames: TimelineFrameVM[]
  selectedFrameKey?: FrameRefKey
  hoveredFrameKey?: FrameRefKey
  activeFrameKey?: FrameRefKey
}
```

### Future extensions
- recurrence markers
- bookmarks
- annotations
- compare ranges

---

## 14. Build Pipeline

## `buildMindgraphViewModel(document)`
Recommended order:

1. normalize transcript segments
2. normalize concepts
3. normalize relations
4. normalize frames at all levels
5. resolve concept labels into frame activations
6. build ancestry links across frame levels
7. build transcript/frame indexes
8. build graph node/edge view model
9. expose selectors

---

## 15. Normalization Rules

### Missing arrays
Always normalize to empty arrays:
- `parentIds`
- `childIds`
- `foregroundConcepts`
- `backgroundConcepts`
- `activeRelations`
- `sourceFrameRefs`
- `sourceSegmentIds`

### Missing labels
If a concept id cannot be resolved:
- never silently invent a label
- emit a safe placeholder like `[missing concept: <id>]`
- surface a validation/debug warning in development

### Ordering
Preserve document ordering for:
- transcript segments
- frames

Sort derived lists only when explicitly useful, such as:
- strongest frames
- related concepts by activation strength later

---

## 16. Example Selector Flow

### User clicks concept `meaning-crisis`

1. `getConceptById('meaning-crisis')`
2. `getConceptStrongestFrames('meaning-crisis')`
3. `getConceptTranscriptExcerpts('meaning-crisis')`
4. `getConceptNeighbors('meaning-crisis')`
5. build `ConceptInspectorVM`
6. build `GraphRenderStateVM`

### User clicks meso frame 10

1. `getFrame({ level: 'meso', index: 10 })`
2. `getFrameTranscriptSegments(...)`
3. `getFrameParent(...)`
4. `getFrameChildren(...)`
5. build `FrameInspectorVM`
6. derive active graph state from frame activations

---

## 17. v0 Implementation Advice

### Keep the builder deterministic
No hidden semantic inference in the view-model layer.
Only:
- lookup
- normalization
- denormalization
- indexing
- sorting

### Keep selectors pure
Selectors should not mutate state or depend on UI framework internals.

### Cache where useful
Memoize:
- by-id maps
- adjacency lists
- frame ancestry
- concept-to-frame indexes

---

## 18. Deliverable Relationship

After this spec, the design stack becomes:

1. `ui-wireframe-spec.md`
2. `ui-component-architecture.md`
3. `ui-view-model-spec.md`

That gives us:
- layout contract
- component contract
- data contract

Which is enough to begin real UI implementation with much less ambiguity.
