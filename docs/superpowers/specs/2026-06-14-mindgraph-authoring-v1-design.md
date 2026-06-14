# Mindgraph Authoring v1 Design

- **Status:** approved through brainstorm
- **Date:** 2026-06-14
- **Scope:** Define the first source-first authoring substrate for living graph iteration.

## Problem

The current producer loop is too slow to close:

- The agent works against a large runtime JSON artifact.
- The user reviews the result in the UI, but feedback is hard to tie back to small, actionable edits.
- New source ingestion and repair of existing graph areas feel like separate workflows.
- The `micro / meso / macro` model mixes source granularity, digest work units, semantic grouping, UI navigation, and graph focus state.

For a living graph, the system needs a representation that is pleasant for humans and agents to edit, diff, review, and patch repeatedly. Runtime JSON is still useful, but it should not be the primary authoring surface.

## Decision

New living graphs use a text authoring document as the canonical source of truth:

```txt
graphs/foo.mindgraph.md    # canonical authoring document
graphs/foo.mindgraph.json  # compiled source-first runtime artifact
```

The authoring document is structured Markdown with lightweight directives. It compiles to a source-first JSON shape. The old `micro / meso / macro` frame model is disposable for this migration; it does not constrain the new architecture. Existing legacy JSON files may remain loadable during transition, but no compatibility migration is required.

## Design Goals

1. Make graph iteration fast, local, and reviewable.
2. Treat source ingestion and repair feedback as the same kind of intake.
3. Replace `micro / meso / macro` with source-first primitives.
4. Keep the agent's creative work in an editable text file.
5. Keep the compiler deterministic, strict, and easy to test.
6. Build the smallest slice that lets us sense the model quickly.

## Source-First Model

The durable model has these top-level concerns:

```txt
metadata
sources
sourceBlocks
readerSteps
sections
concepts
relations
intakes
revisions
```

### Sources

Sources identify the external or local material being digested: transcript files, articles, pasted notes, user feedback, or future PDFs. A source can be canonical content or an intake note.

### Source Blocks

`sourceBlocks` are evidence units:

- article headings
- article paragraphs
- transcript turns
- quotes
- list items
- user notes or corrections

Blocks preserve source order and grounding. They are not necessarily reader-visible steps.

### Reader Steps

`readerSteps` are the primary reader progression units. Each step references one or more source block IDs and carries semantic focus.

Invariant:

> Every visible reader step must have at least one focus anchor.

For v1, focus anchors are concepts and relations. Claims and observations are excluded from v1.

### Sections

`sections` group reader steps for orientation, table-of-contents views, recap, and section-level graph context. They replace the reader-facing role of old macro frames without becoming graph focus levels.

### Concepts And Relations

Concepts and relations form the global graph. They are grounded back to source blocks or marked as inferred with rationale. Concepts are not owned by reader steps or sections.

### Intakes

`intakes` represent new material to integrate:

- a new transcript/article/note
- a user correction
- a review comment
- a request to merge concepts
- a claim that a relation is wrong

This is what makes "ingest a new source" and "repair this part of the graph" one workflow.

### Revisions

`revisions` record accepted graph changes at a useful product level: what changed, why, and which intake or agent run caused it. This does not need to become a full event-sourced database in v1.

## Authoring Format

The authoring format is Markdown with frontmatter and directives. It must be readable as a document and strict enough to compile.

Example:

```md
---
kind: mindgraph.authoring
version: 1
title: Recursive Self-Improvement
runtime: ./recursive-self-improvement.mindgraph.json
---

# Sources

@source rsi-note
type: text
title: Recursive Self-Improvement Notes
path: ../transcripts/recursive-self-improvement.txt

# Source Blocks

@block b001 source=rsi-note kind=heading
Recursive Self-Improvement

@block b002 source=rsi-note kind=paragraph
Recursive self-improvement is a feedback process where improved capability increases the ability to improve further.

# Reader Steps

@step s001 section=setup blocks=b001,b002
summary: The source introduces recursive self-improvement as a capability feedback loop.
focus:
  - recursive-self-improvement 0.95 explicit
  - feedback-loop 0.80 explicit
relations:
  - recursive-self-improvement -> feedback-loop depends_on 0.85

# Sections

@section setup
title: Setup: improvement as feedback
steps: s001

# Concepts

@concept recursive-self-improvement
label: Recursive Self-Improvement
aliases: RSI
cluster: ai-capability-growth
first_seen: b002

@concept feedback-loop
label: Feedback Loop
cluster: systems-dynamics
first_seen: b002

@cluster ai-capability-growth
label: AI Capability Growth
children: recursive-self-improvement

# Relations

@relation rsi-depends-on-feedback
from: recursive-self-improvement
to: feedback-loop
type: depends_on
provenance: source
grounded_in: b002
```

Rules:

- IDs are stable, lowercase, human-readable slugs.
- Blocks preserve source order.
- Steps refer to block IDs instead of timestamps.
- Sections refer to step IDs.
- Concepts and relations may be declared before or after usage, but compilation validates all references.
- Source-grounded relations need grounding block IDs.
- Inferred relations need rationale.
- Agents edit `mindgraph.md`; runtime JSON is generated.

## Runtime JSON

The compiled artifact uses a source-first runtime shape:

```json
{
  "kind": "mindgraph.source-first",
  "version": 1,
  "title": "...",
  "sources": [],
  "sourceBlocks": [],
  "readerSteps": [],
  "sections": [],
  "concepts": {
    "atomic": [],
    "clustered": []
  },
  "relations": [],
  "intakes": [],
  "revisions": []
}
```

This JSON is for validation, view-model construction, and UI rendering. It is not the preferred editing surface.

## Compiler

The compiler is deterministic:

```txt
mindgraph.md
-> parse directives
-> validate authoring model
-> emit source-first runtime JSON
```

Validation checks:

- required frontmatter is present
- every block source exists
- every step block exists
- every visible step has focus
- every focus concept exists
- every focus relation resolves to a declared or inline relation
- every section step exists
- every non-skipped step belongs to a section
- every source block is covered or explicitly skipped
- every relation endpoint exists
- source relations have grounding
- inferred relations have rationale

Compiler errors should be written for agent repair, for example:

```txt
readerSteps.s007 has no focus anchors.
readerSteps.s004 references missing block b099.
relations.r012 is inferred but has no rationale.
concepts.recursive-self-improvement first_seen references missing block b002.
```

## Digest Workbench Direction

The digest workbench is a UI over the authoring document and compiler.

Core loop:

```txt
add intake
-> scope digest task
-> agent proposes edits to mindgraph.md
-> workbench shows Markdown diff, graph diff, and readiness warnings
-> user accepts, rejects, or asks for revision
-> compiler emits runtime JSON
-> reader reloads updated graph
```

The first workbench does not need a complex chat UI. A modest three-panel surface is enough:

```txt
left: intake/source text
middle: authoring document or proposed patch
right: compiled graph preview and validation warnings
```

Agent/provider integration sits behind a server-side adapter. The browser should not own Claude, Codex, or API credentials directly.

## First Implementation Slice

Implement **Mindgraph Authoring v1** before UI work.

Files and capabilities:

- `src/core/authoring/`
  - parser for `*.mindgraph.md`
  - compiler to source-first JSON
  - validator for source-first invariants
- CLI commands:
  - `mindgraph authoring validate <file.md>`
  - `mindgraph authoring compile <file.md> -o <file.json>`
- tests:
  - parser accepts the example format
  - compiler emits `kind: "mindgraph.source-first"`
  - validator catches missing blocks, concepts, sections, focus, grounding, and inference rationale
- examples:
  - one small `examples/authoring/*.mindgraph.md`
  - one compiled fixture only if tests require it

No UI work is required in this slice. The success criterion is that we can edit a small `mindgraph.md`, compile it, inspect validation output, and feel whether the source-first authoring loop is workable.

## Non-Goals

- No migration from legacy JSON.
- No preservation of `micro / meso / macro` semantics.
- No full digest workbench UI in the first slice.
- No built-in Claude/Codex/OpenAI adapter in the first slice.
- No hosted app.
- No event-sourced revision database.
- No custom parser dependency unless the hand-written parser becomes clearly brittle.

## Success Criteria

- A new graph can be authored in Markdown and compiled to source-first JSON.
- Compiler errors are precise enough for an agent to repair the authoring file.
- The model represents new source ingestion and repair feedback through the same intake concept.
- `micro / meso / macro` is absent from the new authoring model.
- The first slice is small enough to implement and test before designing the workbench UI in detail.
