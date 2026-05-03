# mindgraph

An LLM-native CLI and data model for turning transcripts into evolving concept timelines.

## How to think about it

- `mindgraph` is the **toolkit**
- your transcript or research repo is the **content workspace**

Build and evolve `mindgraph` here, then run it against files elsewhere.

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
```

Or directly with Bun before packaging/installing globally:

```bash
bun /path/to/mindgraph/src/cli/index.js ingest transcript ./transcripts/episode-01.txt -o ./graphs/episode-01.mindgraph.json
```

## Current v0 scope

- Canonical JSON document shape
- CLI for bootstrapping, validating, inspecting, and transcript ingestion
- Timestamped and untimed transcript parsing into starter frames
- Foundation for later concept extraction, annotation, and UI playback

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
- `mindgraph relation upsert ...`
- `mindgraph frame list/show ...`
- `mindgraph frame set-activations ...`
- `mindgraph frame merge ...`
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

## Minimal UI shell

There is now a small graph-first UI shell wired to the real episode 1 document and the new view-model layer.

Run it with:

```bash
npm run ui:dev
```

Then open:

```text
http://127.0.0.1:4173
```

Current shell capabilities:
- loads `examples/out/episode-1-built.mindgraph.json`
- builds the real `MindgraphViewModel`
- computes a derived graph render-state for overview / region / local visibility
- renders a deterministic clustered graph canvas
- supports graph zoom, wheel zoom, and drag pan
- renders micro / meso / macro timeline tracks
- supports playhead scrubbing and simple playback
- supports concept selection and frame selection
- shows concept and frame inspector grounding from transcript data

Syntax check:

```bash
npm run ui:check
```

## Next likely commands

- `mindgraph extract concepts ...`
- `mindgraph export ui ...`
