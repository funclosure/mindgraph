---
name: mindgraph
description: Use this skill whenever the user asks you to digest, summarize, ingest, build, visualize, or otherwise turn a transcript, lecture, podcast episode, video, or article into a navigable map of concepts and time. Trigger on phrases like "digest this transcript", "build a mindgraph", "make a concept map of this lecture", "ingest this episode", "I want to study this video" — or whenever they mention "mindgraph" by name. The skill walks the producer-side CLI workflow (`mindgraph ingest → build timeline → concept upsert → frame set-activations → frame merge → stats recompute → validate`) and finishes by telling the user to open the reading UI with `mindgraph view <file>`. Use this even when the user doesn't say "mindgraph" explicitly — if their request is "make this lecture easier to study" or similar, this is the right tool.
---

# mindgraph

Turn raw source text (lecture transcripts, podcasts, articles, papers) into a `.mindgraph.json` document that the user can read in a browser-based reading UI. You operate the CLI; the user reads the result.

## How to think about it

mindgraph has a **producer / consumer split**.

- **Producer side** is you — the agent. The CLI is built for an LLM operator. Idempotent upserts, JSON in / JSON out, parseable errors. Your job: take raw source material, run the CLI in the right order, do the *semantic* work the CLI can't do by itself (extract concepts, weight activations, name chapters), and finish with a validated document.
- **Consumer side** is the user. They open `mindgraph view <file>` in a browser and read the prose with a graph that evolves as they scroll.

The `.mindgraph.json` document is the contract between you and the UI. Get the document right; the UI takes care of itself.

## Prerequisite check

Before doing anything else, verify the CLI is installed:

```bash
mindgraph --help
```

If the command is not found, install it:

```bash
npm install -g github:funclosure/mindgraph
```

Requires Node 18+. If `npm` is also missing, ask the user to install Node first (or use Bun).

## Document shape (the thing you're building)

A `.mindgraph.json` document has:

- `transcript` — the source text split into segments with `start`/`end` timestamps (real or inferred) and optional `speaker`.
- `concepts.atomic` — fine-grained ideas mentioned by the speaker. Examples: "meaning crisis", "wisdom", "psychedelics".
- `concepts.clustered` — higher-level groupings of atomic concepts. Each clustered concept has `parentIds` and aggregates several atoms. Examples: "Cultural Convergences", "Transformative Consciousness".
- `relations` — typed edges between concepts. Examples: `wisdom --addresses--> meaning-crisis`.
- `frames.micro` — short focus slices (one or a few transcript segments).
- `frames.meso` — paragraph-grain windows (~50-100 seconds of speech).
- `frames.macro` — chapter-grain windows. The UI uses `macro.title` as the visible chapter heading.

Each frame has `foregroundConcepts` and `backgroundConcepts` — weighted activations that say "these concepts are in focus during this slice of time".

You do not edit the JSON file directly. You operate it through CLI commands.

## Workflow

The end-to-end flow has three phases: **structural ingest**, **semantic enrichment**, **finalize and hand off**.

### Phase 1 — Structural ingest

Take the user's source file and produce a starter document with micro and meso frames already laid out:

```bash
mindgraph build timeline <source-file> -o <output-file> \
  [--title "Display Title"] \
  [--mode auto|timed-lines|captions|untimed] \
  [--speaker "Speaker Name"] \
  [--wpm 150] \
  [--meso-size 12]
```

`--mode` defaults to `auto` and detects timed-lines / captions / untimed.

For untimed sources (articles, papers, blog posts) pass `--mode untimed --wpm 150`. The producer infers synthetic timestamps from word count at 150 wpm; the UI never shows the timestamps to the reader, they're internal plumbing.

After this command runs, inspect the result:

```bash
mindgraph inspect <output-file>
mindgraph frame list <output-file> --level meso --offset 0 --limit 5
```

The build also embeds a `meta.build.suggestedNextCommands` list — a hint of what to do next. Read it, but don't blindly follow; your judgment is better than the hint.

### Phase 2 — Semantic enrichment (the hard part)

This is where you do real work. The CLI gives you structure; you supply meaning.

**Step 1 — Identify atomic concepts.** Read through the meso frames. List the recurring ideas the speaker keeps coming back to. For a 60-minute lecture this is usually 30-80 concepts. Use stable, lowercase, hyphenated ids (`meaning-crisis`, `wisdom`, `cognitive-science`). Use the human-readable label as the display name.

For each atomic concept, upsert:

```bash
mindgraph concept upsert <output-file> \
  --id meaning-crisis \
  --label "Meaning Crisis" \
  --level atomic
```

Upsert is idempotent — re-running with the same id updates the existing concept. Don't be afraid to refine and re-run.

**Step 2 — Identify clusters.** Group your atomic concepts into 5-10 thematic clusters. A cluster is a higher-level concept that groups related atoms. Examples from a typical lecture: "Cultural Convergences", "Meaning Crisis Core", "Transformative Consciousness".

For each cluster, upsert it as a clustered concept and link the atoms via `--parent-ids-json`:

```bash
mindgraph concept upsert <output-file> \
  --id cultural-convergences \
  --label "Cultural Convergences" \
  --level clustered

mindgraph concept upsert <output-file> \
  --id buddhism \
  --label "Buddhism" \
  --level atomic \
  --parent-ids-json '["cultural-convergences"]'
```

The flag takes a JSON array of cluster ids, so a concept can belong to more than one cluster: `--parent-ids-json '["cultural-convergences","wisdom-traditions"]'`.

**Step 3 — Set frame activations.** For each meso frame, decide which concepts are foreground (the speaker is actively discussing them) and which are background (related but not the focus). Weight each from 0.0 to 1.0.

```bash
mindgraph frame set-activations <output-file> \
  --level meso --index 0 \
  --foreground-json '[
    {"id":"meaning-crisis","weight":0.92,"mode":"explicit"},
    {"id":"wisdom","weight":0.6,"mode":"explicit"}
  ]' \
  --background-json '[
    {"id":"cultural-convergences","weight":0.4,"mode":"implicit"}
  ]'
```

Activation weights drive the camera (which concepts pull the camera as the user scrolls), the brightness (which concept words glow in the prose), and the cumulative reveal (when each concept first appears on the graph). Spend time on this step — it's the most impactful.

For long sources, you can batch this: process meso frames in groups of 10-20, save your work, and continue.

**Step 4 — Identify relations.** Look for explicit or implicit relationships between concepts. The relation `type` is free-form; common ones:

- `addresses` — "wisdom addresses the meaning crisis"
- `responds-to`, `extends`, `contradicts`, `co-occurs-with`, `caused-by`

```bash
mindgraph relation upsert <output-file> \
  --id wisdom-addresses-meaning-crisis \
  --from wisdom \
  --to meaning-crisis \
  --type addresses
```

Then attach relations to the frames where they're active:

```bash
mindgraph frame set-activations <output-file> \
  --level meso --index 12 \
  --relations-json '[{"id":"wisdom-addresses-meaning-crisis","weight":0.85}]'
```

**Step 5 — Merge meso into macro chapters.** Look at the narrative arc. Group consecutive meso frames into 4-8 macro chapters. Each macro frame becomes a chapter heading in the prose UI.

```bash
mindgraph frame merge <output-file> \
  --from meso --to macro \
  --start-index 0 --end-index 8 \
  --title "Opening Convergences and the Search for Meaning" \
  --summary "The lecture opens by surveying convergent cultural signals — Buddhism, cognitive science, mindfulness — that hint at a deeper unifying condition."
```

The macro `title` is what the user reads as the chapter heading. Make it specific to the content, not generic ("Chapter 1").

### Phase 3 — Finalize and hand off

Recompute aggregate stats (recurrence count, peak activation, persistence):

```bash
mindgraph stats recompute <output-file>
```

Validate:

```bash
mindgraph validate <output-file>
```

If validation fails, the error message points at the issue. Fix and re-validate.

Then tell the user — explicitly, with the exact command:

> The mindgraph is ready at `<absolute-path-to-output-file>`. Open it in the browser by running:
>
> ```bash
> mindgraph view <absolute-path-to-output-file>
> ```

If the user wants the UI on a different port, they can pass `--port <n>`. If they want to put the file somewhere specific, that's their call — you don't need to manage their filesystem beyond the output path they specified.

## Heuristics and judgment

**On concept granularity.** Atomic concepts should be ideas the speaker would say without further breakdown — "meaning crisis", "wisdom", not "the Western intellectual tradition". If you're tempted to make a concept that's a whole sentence, split it.

**On activation weights.** Don't be fussy. 0.9 = clearly foreground. 0.5 = present but not central. 0.2 = barely mentioned. The graph behaviour is robust to small differences.

**On chapter boundaries.** Look for clear topic shifts — when the speaker says "now turning to..." or moves to a different domain. A 60-minute lecture typically has 4-6 macro chapters.

**On idempotency.** All `upsert` and `set-activations` commands are idempotent. Re-running them updates instead of creating duplicates. Use this freely — refine your work in passes.

**On scaling.** For very long sources (multi-hour lectures, full books), Phase 2 step 3 (set activations) scales linearly with meso frames. If the source has 100+ meso frames and you're hitting context limits, batch: do the first half, save, do the second half.

## Common failure modes

- **`mindgraph` not found.** The user doesn't have the CLI installed. Tell them the install command (above).
- **`Document became invalid` after a command.** A command produced an inconsistent document — usually a frame referencing a concept id that doesn't exist. Check the error, upsert the missing concept, retry.
- **`Concept not found`.** You referenced an id you haven't upserted yet. Order matters: upsert concepts before referencing them in frame activations or relations.
- **No chapter titles in the UI.** You skipped `frame merge` for the macro level. Run it for at least one merge so the UI has chapter headings.
- **Sparse graph.** Most meso frames have empty foreground activations. Step 3 of Phase 2 was incomplete. The UI will work but feel hollow.

## What success looks like

A finished mindgraph for a 60-minute lecture typically has:

- 30-80 atomic concepts
- 5-10 clustered concepts
- 20-50 relations
- 50-80 meso frames, most with non-empty foreground activations
- 4-6 macro chapters with descriptive titles
- Validation passes
- The user opens `mindgraph view <file>` and the prose reads naturally with concept words highlighted, the graph reveals concepts as they scroll, and the camera lerps between cluster regions as chapters change.

When the user opens the UI and the experience feels coherent — not "press play and see lots of dots" but "read this and the map of ideas comes alive" — you've done your job.

## Reference: full command list

For when you need a refresher on a specific command:

| Command | Purpose |
| --- | --- |
| `mindgraph init <file>` | Create empty starter document |
| `mindgraph validate <file>` | Validate document integrity |
| `mindgraph inspect <file>` | Print summary |
| `mindgraph ingest transcript <src> -o <file>` | Parse source into segments + micro frames |
| `mindgraph build timeline <src> -o <file>` | Ingest + create meso windows + suggest next steps |
| `mindgraph concept upsert <file> --id ... --label ...` | Create or update a concept |
| `mindgraph concept list <file>` | List concepts |
| `mindgraph concept show <file> --id ...` | Show one concept |
| `mindgraph relation upsert <file> --id ... --from ... --to ... --type ...` | Create or update a relation |
| `mindgraph frame list <file> --level meso` | List frames at a level |
| `mindgraph frame show <file> --level meso --index 3` | Show one frame |
| `mindgraph frame set-activations <file> --level meso --index 3 --foreground-json '...'` | Write weighted activations |
| `mindgraph frame merge <file> --from meso --to macro --start-index 0 --end-index 8 --title "..."` | Merge frames into a higher level |
| `mindgraph stats recompute <file>` | Recompute aggregate stats |
| `mindgraph view <file>` | Open the reading UI in the browser (this is for the user) |

`mindgraph --help` always works as a quick reference.
