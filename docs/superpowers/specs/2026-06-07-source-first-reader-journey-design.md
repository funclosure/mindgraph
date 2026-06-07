# Source-first Reader Journey Design

## Status

Design approved for long-term architecture. This spec describes the destination model, not the immediate migration plan.

## Problem

The current `micro / meso / macro` model mixes several concerns:

- source granularity
- LLM digest work units
- semantic grouping
- UI navigation level
- graph focus state

This works poorly for non-timestamped sources such as web articles. Article paragraphs are forced into fake transcript-like timing, and users are asked to switch between abstract levels that do not map naturally to reading.

A visible symptom is that a final macro frame can have no focus, leaving the graph in a confusing empty state. The desired behavior is different: while the user is progressing through the source, every step should have current semantic focus; when the user reaches the very end, the UI should intentionally show the whole picture with no local focus.

## Design Goals

1. Make reader navigation source-first.
2. Separate durable source/digest structure from UI presentation modes.
3. Make digesting friendlier for LLM operators by turning one large abstract task into staged transformations.
4. Ensure every reader-visible progress step has semantic focus.
5. Support articles, videos, lectures, and papers through one source-position abstraction.
6. Allow radical schema evolution later without blocking incremental compatibility work.

## Long-term Document Architecture

The durable document should separate five first-class concerns:

```txt
sourceBlocks
readerSteps
sections
concepts
relations
```

### `sourceBlocks`

`sourceBlocks` are raw grounding units from the source.

For articles, examples include:

- heading
- paragraph
- list item
- quote
- code/math/table representation, eventually

For videos/transcripts, examples include:

- timestamped caption chunk
- speaker turn
- paragraphized transcript chunk

A source block is not necessarily a reader-visible step. It is evidence and grounding.

### `readerSteps`

`readerSteps` are the primary reader progression units. Each step contains one or more contiguous source blocks and carries semantic focus.

A representative shape:

```ts
interface ReaderStep {
  id: string
  sourceBlockIds: string[]
  summary: string
  focusConcepts: Activation[]
  supportingConcepts?: Activation[]
  focusRelations?: Activation[]
  sectionId?: string
}
```

Invariant:

> Every reader-visible step must have at least one focus anchor.

A focus anchor may be a concept, relation, claim, or another semantic object introduced later. In the current model, concepts and relations are enough.

Low-signal source blocks should be grouped with neighbors until the reader-visible step has meaningful focus. If a step still has no focus, the digest is not UI-ready.

### `sections`

`sections` are larger semantic or structural groupings over reader steps.

Examples:

- “Setup: the problem of meaning”
- “Historical context”
- “Recursive self-improvement loop”
- “Implications and risks”

Sections support orientation, table-of-contents views, minimaps, summaries, and section-level graph context. They are not the primary progress unit.

### `concepts` and `relations`

Concepts and relations form the global semantic graph. They are not owned by a specific level. They can appear across many reader steps and sections.

Concepts and relations should be grounded back to source blocks and/or reader steps where possible. Inferred relations should carry rationale and, when externally validated, validation sources.

## LLM-friendly Digest Workflow

The long-term digest pipeline should be staged:

```txt
1. import source
2. extract sourceBlocks
3. propose readerSteps
4. annotate readerStep focus
5. consolidate concepts/relations
6. propose sections
7. validate readiness
8. build UI view model
```

### 1. Import source

The producer normalizes any input into `sourceBlocks`.

Articles preserve article structure. Videos preserve timestamp and speaker metadata when available. The LLM should not need to reason about fake timestamps for articles.

### 2. Propose reader steps

The LLM groups source blocks into reader-visible steps.

Prompt contract:

- include one or more contiguous source blocks
- preserve source order
- provide a concise summary
- provide at least one semantic focus candidate
- mark truly low-value blocks as skippable only with justification

### 3. Annotate reader step focus

Each reader step gets focus annotations:

- focus concepts
- supporting concepts
- focus relations
- claims or observations, eventually

If a step has no focus, the LLM must merge it with a neighbor or mark it as skippable/ambient with a reason.

### 4. Consolidate concepts and relations

After local step annotation, the LLM consolidates globally:

- merge duplicate concept names
- normalize aliases
- detect repeated concepts
- create relations between concepts
- ground relations to source evidence or inference rationale

This is easier than asking the LLM to extract the global graph before it has local context.

### 5. Propose sections

Sections are generated after reader steps exist. A section groups a range of reader steps and provides:

- title
- summary
- dominant concepts
- narrative role, such as setup, explanation, contrast, implication, or synthesis

Sections replace the reader-facing role of old macro frames without exposing a separate level switch.

### 6. Validate readiness

Readiness validation should check user-experience invariants:

- every reader step has focus
- every source block is covered or intentionally skipped
- sections cover all non-skipped reader steps
- concepts used by steps exist globally
- relations used by steps exist globally
- no orphan concepts dominate the graph
- the global graph has enough structure for an after-end whole-picture view

Failures should be actionable for the LLM operator, for example:

```txt
readerStep[7] has no focus anchors; merge with a neighbor or add a concept.
sourceBlock[23] is uncovered.
relation recursive-self-improvement -> goal-drift is used but not defined.
```

## UI and Navigation Model

The UI should not expose `micro / meso / macro` as navigation modes.

The primary navigation state is:

```txt
currentReaderStepIndex
```

A reader step maps source position to semantic focus:

```txt
source position -> reader step -> semantic focus -> graph state
```

For articles, scroll position maps to source blocks and reader steps. For videos, playback time maps to source blocks and reader steps. The graph consumes the same abstraction for both.

### Presentation modes

Presentation modes are UI-derived, not durable document levels.

1. **Focused step**
   - current reader step has active focus concepts/relations
   - graph highlights local neighborhood
   - source excerpt is primary

2. **Section context**
   - user remains inside a section
   - nearby reader steps and section-level concepts can be softly visible
   - used for orientation, not as an explicit level switch

3. **Whole picture**
   - user scrolls beyond the final reader step
   - no local current focus
   - global graph is visible
   - strongest concepts, relations, and sections are emphasized

### After-end overview

When the user reaches the very end, the UI enters a synthetic after-end state:

```txt
if progress > lastReaderStep:
  currentReaderStep = null
  presentationMode = "whole-picture"
```

This state is UI-only. It should not be stored as a fake final reader step or macro frame.

This fixes the empty-final-focus problem: the final source step must have focus, and the no-focus state only appears when the UI intentionally shows the whole completed map.

### No-focus handling

A reader-visible step should never silently produce no focus.

If a current step lacks focus in a legacy or degraded document, the UI may fall back to nearest valid focus or source-only dimmed state, but readiness should report the document as needing repair.

## Compatibility and Migration Strategy

The long-term model can be adopted incrementally.

Current documents contain:

```txt
transcript.segments
frames.micro
frames.meso
frames.macro
concepts
relations
```

A compatibility adapter can derive the new model:

```txt
transcript.segments / frames.micro -> sourceBlocks
micro frames grouped by focus -> readerSteps
meso/macro frames -> provisional sections
concept activations -> readerStep focus
relations -> global relations
```

This adapter should live in the view-model/core derivation layer, not directly in UI rendering code.

The UI should consume one abstraction:

```txt
ReaderJourneyVM
```

regardless of whether it came from legacy frames or first-class `readerSteps`.

### Incremental path

1. Define `ReaderJourneyVM`.
2. Derive it from existing documents.
3. Make UI navigation consume `ReaderJourneyVM`.
4. Add readiness checks for no-focus reader steps.
5. Later evolve the schema to store `sourceBlocks`, `readerSteps`, and `sections` directly.
6. Later update CLI/MCP digest workflow to produce the new objects directly.

## Non-goals

- Do not teach users `micro / meso / macro` as reader-facing terminology.
- Do not store the after-end overview as a fake final frame.
- Do not require immediate schema migration before proving the reader journey abstraction.
- Do not mix UI choreography into durable semantic data. The document stores source, reader steps, sections, concepts, and relations; the UI derives presentation modes.

## Open Future Extensions

- First-class claims or observations as focus anchors.
- Multiple reader journeys over the same source for different audiences.
- Adaptive reader steps based on user expertise or reading speed.
- Section-level summaries for minimap and recap panels.
- Migration command from legacy frame documents to first-class reader journey documents.
