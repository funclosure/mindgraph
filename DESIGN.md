# DESIGN — mindgraph

How the system is put together and why. This is the architecture doc; the
[`README.md`](README.md) is the user-facing tour and [`CLAUDE.md`](CLAUDE.md)
is the wake-up orientation for agents. For the graph simulation specifically —
the forces, gravity, and settling behaviour — see
[`docs/graph-system.md`](docs/graph-system.md).

*Describes the as-built system as of v0.11.0.*

---

## 1. What it is

mindgraph digests dense learning material — transcripts, essays, lectures,
papers — into an **evolving, multi-layer concept graph** that a human can
re-enter and read at their own pace. The digested artifact is a JSON document;
one side produces it, the other side reads it.

## 2. The one idea: two sides, one document between them

Everything in the codebase falls on one side of a single seam.

```
   PRODUCER SIDE                 CONTRACT                 CONSUMER SIDE
   agent + CLI          →   .mindgraph.json file   →      human + UI
   (writes the graph)        (the durable artifact)       (reads the graph)
```

- **Producer side — agent + CLI.** The CLI is built for an **LLM agent** to
  operate end-to-end, not for a human typist. Ergonomics target that: idempotent
  upserts, JSON in / JSON out, parseable errors, sensible defaults. The CLI and
  `core/` are **deterministic** — no model, no API key (the only network call is
  fetching an article's HTML). The *semantic* work — choosing concepts, grounding
  relations, designing the reading journey — belongs to whatever agent drives the
  CLI, following the packaged skill.

- **Consumer side — human + UI.** A person reads the digested graph through a
  reading surface: a force-directed concept graph plus a **Source** panel that
  reads like an essay. Scroll the prose and the graph reveals and spotlights
  concepts as they appear. The UI **reveals**; it never authors.

- **The document is the contract.** A `.mindgraph.json` file is the boundary.
  The CLI writes it, the UI reads it, and either side can evolve independently as
  long as the schema holds. When deciding where new code belongs, first ask
  *which side of the seam am I on?*

**Where the intelligence lives — two layers, one per side.** *Producing* a graph
is done by the operating agent against a deterministic CLI. *Reading* a graph is
where mindgraph carries its own model: the live **Ask** agent in `src/server/`
uses the Claude Agent SDK (`claude-sonnet-4-6`, override via `MINDGRAPH_MODEL`).
The skill is how a graph gets *made*; the Agent SDK is how it gets *talked to*.

## 3. The four layers

Named so that "which layer does this belong to?" always has an answer.

| Layer | Path | Side | Responsibility |
|---|---|---|---|
| **Core** | `src/core/` | producer | Pure document layer. `schema.js` (canonical shape + validation), `document.js` (load/save/mutate), `transcript.js` (parsing), `build.js` (staged build pipeline). No I/O beyond fs read/write of JSON. No CLI, no UI. |
| **CLI** | `src/cli/index.js` | producer | The single agent-operator surface. Dispatch + arg parsing + calls into `core/`. This is *the* tool the agent drives. Gaps here are work to do — extend the CLI, never write a one-off script beside it. |
| **View-model** | `src/view-model/` | consumer | Pure derivation. `buildMindgraphViewModel.js` (document → shell-ready VM: concepts, clusters, frames, co-occurrence, importance, selectors) and `buildGraphRenderState.js` (VM + selection → what's visible/dimmed/spotlit). Pure functions — no DOM, no fetch, no fs. |
| **UI** | `ui/` + `src/ui/dev-server.js` | consumer | The browser shell. Single HTML5 Canvas, hand-written camera, hit-testing, physics simulator (`layout.js`), rAF driver (`animator.js`), label policy (`labels.js`). Vanilla ES modules — **no bundler, no framework**. |

The **live Ask agent** (`src/server/`) is a fifth, optional piece that sits
beside the UI: a small server exposing the Claude Agent SDK so the reader can
ask the source questions. It's the only part that needs credentials.

## 4. The document model

There are two document shapes. Both validate through `core/schema.js`; the VM
normalises both into one internal shape the UI never has to branch on.

### Source-first (`kind: "mindgraph.source-first"`) — the preferred path

Authored as structured Markdown (`*.mindgraph.md`), then compiled to runtime
JSON. **The reading journey is the spine.** Key structures:

- `sources` — what's being digested (`{ id, type, title, path, url? }`).
- `sourceBlocks` — grounded passages (`{ id, sourceId, kind, text, order }`).
- `concepts.atomic` / `concepts.clustered` — navigable ideas
  (`{ id, label, aliases, parentIds, firstSeenBlockId }`).
- `relations` — typed concept edges (`{ id, from, to, type, provenance,
  groundedInBlockIds }`). `provenance: "source"` is grounded in blocks;
  `"inferred"` marks common-knowledge scaffolding and renders dashed.
- `readerSteps` — the journey: each step reveals concepts and grounds them in
  blocks, with weighted `focusConcepts`.
- `sections` — narrative groupings of reader steps.
- `revisions` / `intakes` — why the graph changed across iterations.

The UI derives its reading frames (overview → section → step) from this
structure; there is no separate micro/meso/macro array.

### Frame-timeline (legacy transcript path)

Produced by `ingest transcript` / `build timeline`. Time is the spine:

- `transcript` — source metadata + parsed segments.
- `concepts.atomic` / `concepts.clustered` — with recurrence stats.
- `relations` — durable edges.
- `frames.micro` / `frames.meso` / `frames.macro` — timestamped focus slices,
  merged topic windows, major phases.

Kept for existing fixtures; new architecture doesn't need to fit it.

## 5. The reading model (consumer side)

**Reading drives time.** There is no video and no play button — the reader's
scroll position *is* the playhead. As you move through the Source prose, the
playhead crosses each concept's `firstSeenAt` threshold and that concept
**blooms in** on the graph; its neighbours re-settle around it.

Three ideas compose the experience:

1. **Focus level** — *Whole map / Section / Current step* — sets how tightly the
   camera tracks reading. Whole map stays wide no matter how far you've read;
   the narrower levels frame the active region and gate what's revealed.
2. **Spotlight** — a single focus (an explicit selection, else the section
   you're reading) keeps its nodes and edges bright while the rest fall to a
   quiet backdrop. Nothing is hidden on Whole map; the backdrop just keeps the
   focus from being lost in a field of equally-bright dots.
3. **Ask** — a conversational panel that talks to the source about the current
   focus, streaming Markdown answers with clickable `b###` citations that jump
   to the passage. "Add to graph" crystallises an answer into new concepts and
   relations (with Undo).

The graph, the prose, and the selection are **click-bidirectional**: click a
concept word in the prose and the camera flies to that node; click a node and
the prose scrolls to its first mention.

## 6. The graph (pointer)

The concept graph is a **continuous force-directed simulation** — positions
emerge live from physical rules rather than being precomputed and frozen. The
current implementation is a *gravity-field elastic model* (v3): mass-based
repulsion gives hub concepts territory, relation springs define topology,
co-occurrence firms up the springs, and soft center gravity keeps the cloud
bounded. It's *warm when disturbed, asleep when settled* — zero CPU at rest,
reheats subtly on scroll, selection, or drag.

The full force breakdown, gravity model, integrator, and settling lifecycle
live in **[`docs/graph-system.md`](docs/graph-system.md)**.

## 7. Producing a graph (authoring path)

New graphs are authored source-first and compiled:

```
article / transcript
   → *.mindgraph.md        (editable authoring surface — human- or agent-written)
   → authoring validate    (structural check)
   → authoring compile     (→ runtime .mindgraph.json)
   → view / open           (read it in the UI)
```

The one-shot `mindgraph author <file>` runs this end-to-end with an agent for the
semantic pass; `--stub` gives an API-free dry run. The deterministic `draft`
command bootstraps a valid shell so the real work can happen in `.mindgraph.md`.
The legacy `digest` / `build timeline` path still exists for transcript fixtures.

## 8. Conventions & constraints

- **Runtime:** Bun preferred for the CLI; Node 18+ works everywhere.
- **No bundler, no framework** in the UI — the browser loads `ui/app.js` as a
  module directly. 🚫 Don't introduce Vite/Webpack or React/Vue/Svelte without
  explicit approval.
- **ES modules** throughout (`"type": "module"`).
- **Minimal dependencies** — only `@anthropic-ai/claude-agent-sdk` (the live Ask
  agent) and `zod`. The CLI / core / view-model layers stay dependency-free.
- **Producer discipline** — extend the CLI rather than writing scripts beside it;
  never write a human "here's what to type" runbook for producer tasks.

## 9. Verification

| Change | How to verify |
|---|---|
| CLI / document model | `npm run test:smoke` (Bun) — worked end-to-end example. |
| New producer pipeline | Run it on real source via the CLI; `mindgraph inspect` the output; load in the UI. |
| View-model | `npm run vm:example` and inspect the printed VM slice. |
| UI | `npm run ui:check` for syntax, then **load `npm run ui:dev` in a browser** and exercise the change. Syntax-check alone is not verification. |

## 10. Design specs (deeper reading)

- [`docs/graph-system.md`](docs/graph-system.md) — the as-built graph simulation
  (forces, gravity, lifecycle). **Start here for anything touching layout.**
- `docs/superpowers/specs/2026-05-11-graph-rendering-v2-design.md` — v2 design
  (co-occurrence-*distance*). Partly superseded by the v3 gravity-field model now
  in `ui/layout.js`; kept as design history. See `graph-system.md` for the diff.
- `docs/superpowers/specs/2026-05-10-graph-rendering-design.md` — v1 (static
  precompute). Historical.
- `docs/ui-view-model-spec.md` — the VM contract; the joint between producer
  schema and consumer rendering.
- `docs/ui-component-architecture.md`, `docs/dynamic-graph-interaction-architecture.md`,
  `docs/ui-wireframe-spec.md` — UI decomposition, interaction, wireframes (older;
  cross-check against the as-built `ui/app.js`).
