<p align="center">
  <img src="assets/mindgraph-icon.svg" alt="mindgraph" width="128" />
</p>

# mindgraph

An LLM-native CLI and data model for turning transcripts into evolving concept timelines, plus a reading-driven UI for re-entering them.

## How to think about it

mindgraph has two sides, with a JSON document between them.

**Producer side — agent + CLI.** The CLI is built for an LLM agent to operate end-to-end. For new graphs the preferred path is **source-first authoring**: the agent reads the material, writes an editable `.mindgraph.md`, then validates and compiles it to runtime JSON (an older transcript → micro/meso/macro pipeline remains for existing fixtures). Ergonomics target an AI user, not a human typist — idempotent upserts, JSON in / JSON out, parseable errors. You don't drive the CLI; you bring source material and review the output.

**Consumer side — human + UI.** The UI presents the digested mindgraph as a reading surface: a graph that fills the window plus a **Source** panel that reads like an essay — scroll the prose and the graph reveals and spotlights concepts as they appear in the text. A **focus** control (Whole map / Section / Current step) sets how tightly the view tracks your reading, and a **Chat** panel lets you ask the source about whatever's in focus. Reading drives time. The point is to re-enter dense source material at your own pace, with conceptual and temporal structure visible.

**The document is the contract.** A `.mindgraph.json` file is the boundary. CLI writes it. UI reads it. Either side can change as long as the schema holds. The document is the durable artifact.

mindgraph itself is the **toolkit**; your transcript or research repo is the **content workspace**. Build and evolve mindgraph here, then run it against files elsewhere.

## Quick start

Install the CLI globally from a tagged release:

```bash
npm install -g github:funclosure/mindgraph#v0.9.4
```

Tag-pinning is recommended — npm's git-URL install path is fragile and a tag gives you a stable artifact. (Check this repo's releases page for newer tags.)

That puts `mindgraph` on your `PATH`. Sanity check:

```bash
mindgraph --help
```

**Read a graph.** Two ways to open the reading UI:

```bash
mindgraph view          # read-only — opens the bundled sample, no API key
mindgraph open          # live UI with the Ask agent — newest graphs/*.mindgraph.md
```

`view` is a static reading surface. `open` adds the conversational **Ask** panel — talk to the source about the current focus, with answers that stream as Markdown and clickable `b###` citations that jump to the passage. Its agent runs on the Claude Agent SDK, so it needs Claude credentials in the environment; use `mindgraph open --stub` for an API-free stub. Point either at a specific document:

```bash
mindgraph view ./graphs/my-episode.mindgraph.json
mindgraph open my-episode          # name fragment or path; resolves under ./graphs
```

Both boot a small server (default `http://127.0.0.1:4173`) and open your browser. Ctrl+C to stop; `--port <n>` if 4173 is taken. Re-running `open` on a busy port reuses the server already running there instead of failing.

**Produce a graph.** The fastest path is the [Claude skill](#use-as-a-claude--superpowers-skill): tell the agent *"build a mindgraph for this article,"* and it drives the source-first pipeline for you. To do it by hand, see [Source-first authoring](#source-first-authoring).

Requires Node 18+ (or Bun). Runtime deps: `@anthropic-ai/claude-agent-sdk` and `zod` (used by the Ask agent); no other system dependencies.

## Use as a Claude / superpowers skill

The producer-side workflow is packaged as a skill at [`skills/mindgraph/SKILL.md`](skills/mindgraph/SKILL.md). When loaded by Claude Code (or any compatible runtime) it triggers on phrases like "digest this lecture" or "build a mindgraph for this transcript" and walks the CLI command sequence end-to-end. Drop the file into your skills folder (typically `~/.claude/skills/mindgraph/`) and the agent does the rest.

## First commands

> The commands in this and the next few sections are the lower-level transcript → micro/meso/macro pipeline, kept for existing fixtures. For **new** graphs, prefer [Source-first authoring](#source-first-authoring) (or the [Claude skill](#use-as-a-claude--superpowers-skill)), which is the path the producer workflow now follows.

```bash
bun src/cli/index.js --help
bun src/cli/index.js init examples/out/empty.mindgraph.json
bun src/cli/index.js ingest transcript examples/awakening.sample.transcript.txt -o examples/out/awakening.mindgraph.json
bun src/cli/index.js validate examples/out/awakening.mindgraph.json
bun src/cli/index.js inspect examples/out/awakening.mindgraph.json
```

Node still works too if needed.

## External usage model

In another project:

```bash
mindgraph ingest transcript ./transcripts/episode-01.txt -o ./graphs/episode-01.mindgraph.json
mindgraph validate ./graphs/episode-01.mindgraph.json
mindgraph inspect ./graphs/episode-01.mindgraph.json
mindgraph view ./graphs/episode-01.mindgraph.json
```

Or directly with Bun before packaging/installing globally:

```bash
bun /path/to/mindgraph/src/cli/index.js ingest transcript ./transcripts/episode-01.txt -o ./graphs/episode-01.mindgraph.json
```

## Product journey commands

For agent-operated digestion, prefer the high-level journey command:

```bash
mindgraph digest ./transcripts/episode-01.txt -o ./graphs/episode-01.mindgraph.json --title "Episode 01"
```

For readable web articles:

```bash
mindgraph digest https://example.com/article -o ./graphs/article.mindgraph.json --mode untimed
```

This creates a starter `.mindgraph.json` with transcript segments, micro frames, meso frames, validation, and an agent-facing next step. The LLM agent then creates a structured `DigestPlan`, applies it, evaluates quality, and opens the viewer:

```bash
mindgraph digest apply ./graphs/episode-01.mindgraph.json --plan ./plans/episode-01.digest-plan.json
mindgraph digest evaluate ./graphs/episode-01.mindgraph.json --json
mindgraph view ./graphs/episode-01.mindgraph.json
```

YouTube URLs are detected, but this slice does not fetch YouTube transcripts directly. Save a transcript with a tool such as `yt-dlp`, then pass the transcript file to `mindgraph digest`.

## Source-first authoring

New living graphs can be authored as structured Markdown and compiled to source-first runtime JSON:

```bash
mindgraph authoring validate examples/authoring/recursive-self-improvement.mindgraph.md
mindgraph authoring compile examples/authoring/recursive-self-improvement.mindgraph.md -o graphs/recursive-self-improvement.mindgraph.json
```

The Markdown file is the editing surface. The compiled JSON is the runtime artifact for validation, view-model construction, and future reader/workbench UI work.

For a plain article or pasted text file, draft the editable Markdown and compiled JSON in one pass:

```bash
mindgraph authoring draft ./article.txt -o graphs/article.mindgraph.md --title "Article Title" --compile graphs/article.mindgraph.json
```

The draft command is deterministic bootstrap, not a final semantic digest. It creates a valid source-first graph shell so the next iteration can happen in `.mindgraph.md`.

## MCP usage

mindgraph also ships a minimal MCP server for Claude Desktop and other MCP-capable apps:

```bash
mindgraph mcp --workspace /path/to/content-workspace
# or
mindgraph-mcp --workspace /path/to/content-workspace
```

Initial tools:

- `mindgraph_prepare_source`
- `mindgraph_build_starter_digest`
- `mindgraph_apply_digest_plan`
- `mindgraph_evaluate_digest`
- `mindgraph_inspect_document`
- `mindgraph_open_viewer`

The MCP server is an adapter over the same journey operations as the CLI. It does not require a model API key; the connected agent performs semantic digestion and supplies a `DigestPlan`.

## Current scope

- Source-first authoring: editable `.mindgraph.md` → `validate` / `qa` / `compile` to runtime JSON (the preferred path for new graphs)
- Canonical `.mindgraph.json` document with atomic + clustered concepts, typed relations, and a frame timeline
- CLI covering the full producer pipeline: bootstrap, validate, inspect, source-first authoring, transcript ingest + staged build timeline, upsert concepts and relations, set frame activations, merge/backfill across levels, recompute stats
- Timestamped and untimed transcript parsing (timed lines, captions, untimed paragraphs)
- Reading UI: continuous-physics force-directed graph, screen-space labels, Source panel with click-bidirectional linking, Whole map / Section / Current step focus with selection spotlight, and a conversational **Ask** panel (streamed Markdown answers, clickable citations, "Add to graph")

## Transcript formats currently supported

```text
[00:01:23] Speaker: text
00:01:23 Speaker: text
00:01:23 - text

[00:01:23] first caption line
second caption line

Untimed paragraph one.

Untimed paragraph two.
```

For untimed transcripts, `mindgraph` can infer rough timing with flags like:

```bash
mindgraph ingest transcript ./transcripts/episode-01.md -o ./graphs/episode-01.mindgraph.json --mode untimed --speaker "John Vervaeke" --wpm 150
```

Each parsed transcript segment becomes:
- a transcript segment in `transcript.segments`
- a starter frame in `frames`

That gives an LLM or human editor a concrete timeline to refine.

## Document shape

A `mindgraph` document contains:

- `transcript`: source metadata plus parsed segments
- `concepts.atomic`: fine-grained recurring concepts
- `concepts.clustered`: higher-level grouped concepts
- `relations`: durable edges between concepts
- `frames.micro`: low-level timestamped focus slices
- `frames.meso`: merged topic windows
- `frames.macro`: major episode phases

Each concept can later carry recurrence stats like:
- `recurrenceCount`
- `totalActivation`
- `peakActivation`
- `persistence`

And frame-level concept mentions are meant to be weighted, e.g.:

```json
{
  "id": "meaning-crisis",
  "weight": 0.92,
  "mode": "explicit"
}
```

## LLM-actuator workflow

The CLI is meant to be the rigid structural layer an LLM writes into.

Typical pattern:

```bash
mindgraph build timeline ./episode-01.txt -o ./episode-01.mindgraph.json --meso-size 12
mindgraph concept upsert ./episode-01.mindgraph.json --id meaning-crisis --label "Meaning Crisis" --first-seen-at 0
mindgraph frame set-activations ./episode-01.mindgraph.json --level micro --index 0 --foreground-json '[{"id":"meaning-crisis","weight":1,"mode":"explicit"}]'
mindgraph stats recompute ./episode-01.mindgraph.json
```

Current actuator commands:

- `mindgraph concept upsert ...`
- `mindgraph concept list/show ...`
- `mindgraph relation upsert ...` (use `--provenance inferred` to mark common-knowledge connections the speaker assumed; the UI renders these as dashed edges)
- `mindgraph frame list/show ...`
- `mindgraph frame set-activations ...`
- `mindgraph frame merge ...`
- `mindgraph frame backfill-activations ...` (broadcast a coarser level's activations onto a finer level — e.g. copy meso foreground concepts down to all overlapping micro frames)
- `mindgraph stats recompute ...`

Example of building a meso frame from micro frames:

```bash
mindgraph frame list ./episode-01.mindgraph.json --level micro --offset 0 --limit 5
mindgraph relation upsert ./episode-01.mindgraph.json --id responds-to --from wisdom --to meaning-crisis --type addresses
mindgraph frame merge ./episode-01.mindgraph.json --from micro --to meso --start-index 0 --end-index 12 --title "Opening Problem Space"
mindgraph frame show ./episode-01.mindgraph.json --level meso --index 0
```

## Staged build timeline

`mindgraph build timeline` is intentionally not fake-magic.

It currently does the rigid parts:
- transcript ingest
- micro frame creation
- coarse meso window generation
- embedding a review plan into `meta.build`

Example:

```bash
mindgraph build timeline ./episode-01.txt -o ./episode-01.mindgraph.json --speaker "John Vervaeke" --meso-size 12
```

Then inspect and annotate:

```bash
mindgraph frame list ./episode-01.mindgraph.json --level meso --offset 0 --limit 5
mindgraph concept upsert ./episode-01.mindgraph.json --id meaning-crisis --label "Meaning Crisis"
```

## Reading UI

A reading-driven UI for the digested mindgraph. Single HTML5 Canvas for the graph, plain DOM for the prose, vanilla ES modules — no bundler, no framework.

Run it with:

```bash
npm run ui:dev
```

Then open:

```text
http://127.0.0.1:4173
```

`npm run ui:dev` serves the static reading surface (graph + Source). The **Ask** (Chat) panel needs the live agent server — start that with `mindgraph open` (or `mindgraph open --stub` for no API).

What you see:

- **Full-width top nav** with the document title and **[Source] [Chat]** toggles on the trailing edge. The graph fills the window; the Source and Chat panels open over the right side when toggled (both off → graph only).
- **Focus control** on the graph — **Whole map / Section / Current step**. *Whole map* shows the entire graph at a wide camera no matter how far you've read; *Section* and *Current step* track your reading position and frame the camera tighter. A single focus — your selection, or the section you're reading — spotlights nodes and their edges while the rest fall to a quiet backdrop.
- **Source panel.** Reads like an essay; concept mentions are gold-underlined inline, and the passage you're on highlights as you scroll. A one-line source dropdown switches between sources when a graph has more than one.
- **Selection spotlight.** Click a concept (Shift- or ⌘-click to add more) → it and its links stay bright, the rest dim to the backdrop, and the camera frames the selection (except on Whole map, which stays wide).
- **Ask (Chat panel).** Talk to the source about the current focus — your selection, or the section you're reading if nothing's selected. Answers stream as Markdown with clickable `b###` citations that jump to the source passage. **Add to graph** crystallizes an answer into new concepts and relations (with **Undo**).
- **Live force-directed graph.** Concept positions emerge from a continuous physics simulation. Co-occurring concepts attract toward shorter ideal distances; producer-asserted relations and cluster siblings modulate spring stiffness; unrelated pairs gently repel. The simulator is *warm when disturbed, sleeps when settled* — it idles at zero CPU when nothing changes and reheats subtly on scroll, selection, or drag.
- **Reading drives time.** Scroll the Source panel; at the narrower focus levels the graph reveals concepts as their `firstSeenAt` thresholds are crossed — newly-revealed concepts bloom in and neighbors re-settle around them. A source-progress strip at the bottom marks the semantic sections.
- **Click-bidirectional linking.** Click a concept word in the prose → the camera flies to that concept on the graph; click a concept on the graph → the prose scrolls to its first mention.
- **Drag to rearrange.** Pointer-down on a concept dot pins it under the cursor; neighbors react in real time. Release un-pins back into live dynamics. Pointer-down on empty canvas pans the camera.
- **Screen-space labels.** Labels render at constant pixel size regardless of zoom, gated by an importance score × zoom threshold with collision avoidance. At a wide camera only a handful of high-importance labels show; zooming in reveals more.

Syntax check:

```bash
npm run ui:check
```

The UI loads `examples/out/episode-1-built.mindgraph.json` by default. Point it at a different document via the dev server's `--doc` flag (`npm run ui:dev -- --doc /path/to/my.mindgraph.json`), or use the installed CLI directly (`mindgraph view /path/to/my.mindgraph.json`).
