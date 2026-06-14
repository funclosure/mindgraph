<p align="center">
  <img src="assets/mindgraph-icon.svg" alt="mindgraph" width="128" />
</p>

# mindgraph

An LLM-native CLI and data model for turning transcripts into evolving concept timelines, plus a reading-driven UI for re-entering them.

## How to think about it

mindgraph has two sides, with a JSON document between them.

**Producer side — agent + CLI.** The CLI is built for an LLM agent to operate end-to-end: ingest source material, generate frames at three levels, extract concepts and relations, set activations, recompute stats. Ergonomics target an AI user, not a human typist — idempotent upserts, JSON in / JSON out, parseable errors. You don't drive the CLI; you bring source material and review the output.

**Consumer side — human + UI.** The UI presents the digested mindgraph as a reading surface: a graph that fills the window, a right-side prose panel that reads like an essay, scroll the prose and the graph reveals concepts as they appear in the text. Reading drives time. The point is to re-enter dense source material at your own pace, with conceptual and temporal structure visible.

**The document is the contract.** A `.mindgraph.json` file is the boundary. CLI writes it. UI reads it. Either side can change as long as the schema holds. The document is the durable artifact.

mindgraph itself is the **toolkit**; your transcript or research repo is the **content workspace**. Build and evolve mindgraph here, then run it against files elsewhere.

## Quick start

Install the CLI globally from a tagged release:

```bash
npm install -g github:funclosure/mindgraph#v0.4.1
```

Tag-pinning is recommended — npm's git-URL install path is fragile and a tag gives you a stable artifact. (Check this repo's releases page for newer tags.)

That puts `mindgraph` on your `PATH`. Sanity check:

```bash
mindgraph --help
```

Open the reading UI for the bundled sample (Awakening from the Meaning Crisis — Episode 1):

```bash
mindgraph view
```

Open the reading UI for your own document:

```bash
mindgraph view ./graphs/my-episode.mindgraph.json
```

Both forms boot a small dev server (default `http://127.0.0.1:4173`) and open your browser. Ctrl+C to stop. Use `--port <n>` if 4173 is taken.

To produce a document, run the CLI yourself or pair it with an LLM agent — see [LLM-actuator workflow](#llm-actuator-workflow) below.

Requires Node 18+ (or Bun). No other system dependencies.

## Use as a Claude / superpowers skill

The producer-side workflow is packaged as a skill at [`skills/mindgraph/SKILL.md`](skills/mindgraph/SKILL.md). When loaded by Claude Code (or any compatible runtime) it triggers on phrases like "digest this lecture" or "build a mindgraph for this transcript" and walks the CLI command sequence end-to-end. Drop the file into your skills folder (typically `~/.claude/skills/mindgraph/`) and the agent does the rest.

## First commands

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

- Canonical `.mindgraph.json` document with atomic + clustered concepts, typed relations, and a three-level frame timeline (micro / meso / macro)
- CLI covering the full producer pipeline: bootstrap, validate, inspect, ingest transcripts, build timeline, upsert concepts and relations, set frame activations, merge into coarser frames, backfill activations across levels, recompute concept stats
- Timestamped and untimed transcript parsing (timed lines, captions, untimed paragraphs)
- Reading-driven UI: continuous-physics force-directed graph, importance-driven screen-space labels, prose panel with click-bidirectional linking, chapter strip with click-to-jump and drift-forward auto-scroll, drag-to-rearrange on the graph

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

What you see:

- The window is split by a CSS grid: thin header on top, graph canvas in the left column, chapter strip below the graph, prose panel on the right.
- The prose reads like an essay — chapters from macro frames, paragraphs joined from transcript segments. Concept mentions are gold-underlined inline.
- **Live force-directed graph.** Concept positions emerge from a continuous physics simulation. Co-occurring concepts attract toward shorter ideal distances (exponential curve in co-occurrence strength); producer-asserted relations and cluster siblings modulate spring stiffness; unrelated pairs gently repel. The simulator is *warm when disturbed, sleeps when settled* — it idles at zero CPU when nothing changes and reheats subtly on scroll, selection, or drag.
- **Reading drives time.** Scroll the prose; the graph reveals concepts as their `firstSeenAt` thresholds are crossed. Newly-revealed concepts bloom in (opacity + scale, 600 ms easeOutCubic) and join live dynamics — neighbors re-settle around the new arrival.
- **Click-bidirectional linking.** Click a concept word in the prose → the camera flies to that concept on the graph; all its mentions in the prose glow brighter. Click a concept on the graph → the prose smooth-scrolls to its first mention.
- **Drag to rearrange.** Pointer-down on a concept dot pins it under the cursor; neighbors react in real time. Release un-pins back into live dynamics. Pointer-down on empty canvas pans the camera as before.
- **Maps-style labels.** Labels render in screen space (constant pixel size regardless of zoom), gated by an importance score × zoom threshold with collision avoidance. At default zoom only a handful of high-importance labels show; zooming in progressively reveals more.
- **Chapter strip** at the bottom shows macro chapters proportionally. Click any segment to jump.
- **Drift-forward** (▶ on the chapter strip) auto-scrolls the prose at the source's speech rate, so reading progresses in real time. Manual scroll cancels.
- **View popover** (gear icon in the header) toggles the camera-cadence level (macro / meso / micro).
- **Prose can be collapsed** (panel-right icon in the header) — graph fills the full window when hidden.

Syntax check:

```bash
npm run ui:check
```

The UI loads `examples/out/episode-1-built.mindgraph.json` by default. Point it at a different document via the dev server's `--doc` flag (`npm run ui:dev -- --doc /path/to/my.mindgraph.json`), or use the installed CLI directly (`mindgraph view /path/to/my.mindgraph.json`).
