---
name: mindgraph
description: Use this skill whenever the user asks you to digest, summarize, ingest, build, visualize, or otherwise turn a transcript, lecture, podcast episode, video, or article into a navigable map of concepts and time — or to operate on a mindgraph that already exists (open it, list what's been built, add to it, rebuild it). Trigger on phrases like "digest this transcript", "build a mindgraph", "make a concept map of this lecture", "ingest this episode", "I want to study this video", "open my last mindgraph", "list my mindgraphs", "what graphs do I have", "show me what I've built", "add to the [X] graph", "refresh the [X] graph with these notes", "rebuild the [X] mindgraph" — or whenever they mention "mindgraph" by name. The skill walks the producer-side CLI workflow (`mindgraph ingest → build timeline → concept upsert → frame set-activations → frame merge → stats recompute → validate`) and finishes by telling the user to open the reading UI with `mindgraph view <file>`. For operations on existing graphs, see the "Lifecycle operations" section. Use this even when the user doesn't say "mindgraph" explicitly — if their request is "make this lecture easier to study" or similar, this is the right tool.
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

If the command is not found, install it from a tagged release:

```bash
npm install -g github:funclosure/mindgraph#v0.4.1
```

Tag-pinning is recommended over the unpinned `github:funclosure/mindgraph` form — npm's git-URL install path is fragile across versions, and pinning to a tag gives a stable artifact. Check https://github.com/funclosure/mindgraph for newer tags.

After install, you can confirm the CLI and reading UI work end-to-end with:

```bash
mindgraph view
```

With no args, this opens the bundled "Awakening from the Meaning Crisis — Episode 1" sample in the browser. If the graph + prose panel render, the install is healthy. Suggest this to the user when they've just installed for the first time, or whenever something behaves strangely and you want to rule out a broken install.

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

#### Acquiring the transcript

If the user gives you a path to a transcript file, skip this subsection. If they give you a URL or paste a video/podcast reference instead, you need a transcript on disk before Phase 1 can run. Approach by source type:

- **YouTube / video.** Try `yt-dlp --write-auto-sub --skip-download --sub-lang en --convert-subs srt -o "./transcripts/%(title)s.%(ext)s" <url>`, then move the resulting `.srt` to `./transcripts/<slug>.srt` with a clean slug. If `yt-dlp` is not installed, suggest `brew install yt-dlp` (macOS) or ask the user to paste the transcript directly. Do not try to scrape YouTube via WebFetch — the page rarely contains transcript text.
- **Articles, blog posts, papers (HTML).** Use the WebFetch tool to retrieve the article, save the readable text to `./transcripts/<slug>.txt`, then ingest with `--mode untimed`.
- **Podcasts.** If the show publishes a transcript page, treat it like an article. Otherwise ask the user for a transcript file or pasted text — audio-only ingestion is out of scope for this skill.
- **PDFs.** Local PDFs: read with the Read tool. Remote PDFs: WebFetch the URL, save the text to `./transcripts/<slug>.txt`.
- **Fallback.** Ask the user to paste the transcript inline. Save it to `./transcripts/<slug>.txt` so it's available for re-ingest later.

In a `mind-digest`-style workspace, `./transcripts/` is the canonical landing zone — keep all sources there. Outside that convention, place the file wherever the user prefers; the path you pass to `mindgraph build timeline` is what matters.

#### Building the timeline

Take the user's source file and produce a starter document with micro and meso frames already laid out:

```bash
mindgraph build timeline <source-file> [-o <output-file>] \
  [--title "Display Title"] \
  [--mode auto|timed-lines|captions|untimed] \
  [--speaker "Speaker Name"] \
  [--wpm 150] \
  [--meso-size 12]
```

When `-o` is omitted, the CLI defaults to `./graphs/<slug>.mindgraph.json` if a `./graphs/` directory exists in the current working directory (the slug is derived from `--title` or the source filename). In a `mind-digest`-style content workspace this is the recommended form — drop the `-o` and let the convention place the file. Outside a workspace, pass `-o` explicitly.

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

Then offer to open the reading UI for the user. **Ask before launching** — `mindgraph view` starts a local dev server that stays alive until stopped, and the user may want to open it on their own terms (different port, different time, after they finish another task). Phrase it as a confirmation, not an announcement:

> The mindgraph is ready at `<absolute-path-to-output-file>`. Want me to open the reading UI now? It'll start a local server at `http://127.0.0.1:4173` and open your browser. (You can also run it yourself later with `mindgraph view <absolute-path-to-output-file>`.)

If the user confirms (yes / sure / open it), run the command. The dev server keeps running until the user stops it (Ctrl+C in the terminal that hosts it, or close the process), so launch it in the background so it doesn't block your session:

```bash
mindgraph view <absolute-path-to-output-file> &
```

Then tell the user the URL is up:

> The UI is running at http://127.0.0.1:4173. Stop it later with `Ctrl+C` in the terminal, or by closing the process.

If the user declines, leave them with the command and move on — don't push.

If they want the UI on a different port (say 4173 is taken), pass `--port <n>`. The path arg is an absolute path; the user can leave the document anywhere on disk.

## Lifecycle operations (existing graphs)

Not every request is a fresh ingest. If the user is asking about a graph they've already built — opening it, listing what's around, adding to it, rebuilding it — route to one of the patterns below before reaching for Phase 1.

The convention in a `mind-digest`-style workspace is:

- `./graphs/<slug>.mindgraph.json` — built documents
- `./transcripts/<slug>.<ext>` — source material

Outside that convention, fall back to whatever path the user gives you.

### List

Triggers: "list my mindgraphs", "what graphs do I have", "show me what I've built".

```bash
ls -lt ./graphs/*.mindgraph.json
```

For each match, run `mindgraph inspect <file>` and report a one-line summary (title, concept counts, frame counts) so the user sees content, not just filenames.

### Open

Triggers: "open my last graph", "open the [X] graph", "let me read [X]".

Resolve the file:
- "last" / "the most recent" → newest mtime in `./graphs/`.
- Named → fuzzy-match against the slug, or use `mindgraph inspect` to compare titles when the slug is ambiguous.

Then apply the same "ask before launching" rule from Phase 3 — confirm before starting the dev server, then background it:

```bash
mindgraph view <absolute-path> &
```

### Refresh / annotate

Triggers: "add to the [X] graph", "I have more notes on [X]", "refresh the [X] mindgraph".

**Do not rebuild from scratch.** The CLI is idempotent — `concept upsert`, `relation upsert`, and `frame set-activations` update in place by id. Steps:

1. `mindgraph inspect <file>` to remind yourself of the current shape.
2. `mindgraph concept list <file>` and `mindgraph frame list <file> --level meso` to see what's already there.
3. Apply the user's new notes: upsert new concepts, attach activations to the relevant frames, upsert new relations. Re-running with the same id is safe — it updates instead of duplicating.
4. `mindgraph stats recompute <file>` and `mindgraph validate <file>` at the end.

### Rebuild from source

Triggers: "rebuild the [X] mindgraph", "the source transcript changed".

Only reach for this when the *transcript* itself has changed. If only the annotations are changing, use refresh.

1. Re-run Phase 1 with `-o ./graphs/<existing-slug>.mindgraph.json` passed explicitly — the explicit `-o` is required because the implicit-default path refuses to overwrite.
2. Re-run Phase 2 from scratch. Existing concept ids can be re-upserted; activations need to be reapplied to the freshly generated frames.
3. Phase 3 as usual.

## Heuristics and judgment

**On concept granularity.** Atomic concepts should be ideas the speaker would say without further breakdown — "meaning crisis", "wisdom", not "the Western intellectual tradition". If you're tempted to make a concept that's a whole sentence, split it.

**On activation weights.** Don't be fussy. 0.9 = clearly foreground. 0.5 = present but not central. 0.2 = barely mentioned. The graph behaviour is robust to small differences.

**On chapter boundaries.** Look for clear topic shifts — when the speaker says "now turning to..." or moves to a different domain. A 60-minute lecture typically has 4-6 macro chapters.

**On idempotency.** All `upsert` and `set-activations` commands are idempotent. Re-running them updates instead of creating duplicates. Use this freely — refine your work in passes.

**On scaling.** For very long sources (multi-hour lectures, full books), Phase 2 step 3 (set activations) scales linearly with meso frames. If the source has 100+ meso frames and you're hitting context limits, batch: do the first half, save, do the second half.

**On backfilling activations.** The reading UI's graph layout uses pair co-occurrence at the finest available frame level — concepts that appear together in many micro frames pull toward shorter spring distances. If you've annotated meso (and/or macro) frames but left micro empty (which is typical for any source long enough that per-sentence annotation isn't practical), the UI's clusters won't differentiate well. Run `mindgraph frame backfill-activations <file> --from meso --to micro` after you're done with Phase 2 step 3 (and before `stats recompute`) to broadcast each meso's `foregroundConcepts` down to all the micro frames it spans. The operation is idempotent and finishes in seconds — safe to include in routine workflows on coarse-annotation sources. Re-run `stats recompute` afterwards so derived stats reflect the new activations.

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
| `mindgraph frame backfill-activations <file> --from meso --to micro` | Broadcast a coarser level's activations onto all overlapping finer-level frames (idempotent; replaces, not merges) |
| `mindgraph stats recompute <file>` | Recompute aggregate stats |
| `mindgraph view <file>` | Open the reading UI in the browser (this is for the user) |

`mindgraph --help` always works as a quick reference.
