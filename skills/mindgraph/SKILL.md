---
name: mindgraph
description: Use when the user asks to digest, ingest, summarize, map, visualize, repair, refresh, or iterate on learning material such as articles, transcripts, lectures, podcasts, videos, papers, pasted text, or an existing mindgraph.
---

# mindgraph

Turn source material into a living concept graph. The user brings material and reacts to the result; you operate the producer workflow.

## Core framing

mindgraph has a producer/consumer split:

- **Producer side is you, the agent.** You read the source, understand the argument, choose concepts, ground relations, design the reader journey, and repair the graph after user feedback. The CLI is your actuator: it prepares files, validates structure, compiles runtime JSON, and serves the UI. It does not replace your semantic judgment.
- **Consumer side is the user.** The UI reveals the current artifact. The user should not have to fix JSON or run CLI commands. They respond semantically: what feels wrong, missing, noisy, flat, or misleading.

For new living-graph work, prefer source-first authoring:

```text
source material
  -> agent semantic digest
  -> editable .mindgraph.md
  -> validate
  -> compile .mindgraph.json
  -> open UI
  -> user feedback
  -> agent repairs .mindgraph.md
```

The `.mindgraph.md` file is the source of truth for iteration. The compiled `.mindgraph.json` is a runtime artifact.

## First moves

1. If the user provides source material, save or locate it under `./transcripts/` or use the attachment path directly.
2. Create or update an editable authoring file under `./graphs/<slug>.mindgraph.md`.
3. Do the semantic digest yourself. Do not treat `authoring draft` as the real digest.
4. Validate and compile after every meaningful edit.
5. Run source-reading QA before presenting the result.
6. Open or refresh the UI so the user can react to the artifact.

Useful commands:

```bash
mindgraph authoring validate graphs/<slug>.mindgraph.md
mindgraph authoring qa graphs/<slug>.mindgraph.md
mindgraph authoring compile graphs/<slug>.mindgraph.md -o graphs/<slug>.mindgraph.json
mindgraph view graphs/<slug>.mindgraph.json
```

If starting from plain text and you need a skeleton, use:

```bash
mindgraph authoring draft <source.txt> -o graphs/<slug>.mindgraph.md --title "Title" --compile graphs/<slug>.mindgraph.json
```

But treat this as scaffolding only. A heuristic draft is not a finished mindgraph. Replace or rewrite it with a semantic pass before presenting it as a meaningful result. Keep the `-o` markdown slug and the `--compile`/recompile JSON slug matching (`<slug>.mindgraph.md` ↔ `<slug>.mindgraph.json`); the draft sets the `runtime:` pointer from the `-o` path, so a mismatched compile target will point the document at the wrong runtime file.

For timed transcripts, the draft step should produce clean `kind=transcript` source blocks without visible timestamps. If timestamps or authoring headings appear in the UI source pane, fix the parser/draft pipeline and recompile; do not edit compiled JSON by hand.

## Authoring format mental model

A source-first `.mindgraph.md` contains:

- `@source` — what material is being digested.
- `@block` — grounded source passages or source slices.
- `@step` — the reader journey: what should become visible at this point and why.
- `@section` — narrative groupings for the reading experience.
- `@concept` — atomic ideas worth navigating.
- `@cluster` — thematic concept groupings.
- `@relation` — typed concept edges, grounded in source blocks unless explicitly inferred.
- `@revision` / notes when present — why the graph changed.

Think in source-first primitives: source blocks, claims, concepts, relations, reader steps, sections, revisions. Do not make micro/meso/macro the authoring premise for new work; derive UI frames from source-first structure.

Frontmatter carries `title`, `runtime` (the compiled JSON filename, kept matching the `-o`/`--compile` target), and `duration_seconds` (set this for timed material so the UI shows the right duration — it is not inferred).

Structural invariants the validator enforces (satisfy them up front to avoid round-trips):

- Every non-skipped `@block` must be covered by at least one `@step`.
- A `@step` must name a real `@section`, and that section must list the step in its `steps:` — the link is bidirectional.
- Every `@step` needs at least one focus anchor (a focus concept or an active relation).
- A `source`-provenance `@relation` needs `grounded_in:` blocks; an `inferred` one needs a `rationale:`.

## Focus modes and QA rules

Each `@step` focus line is `<concept-id> <weight> [mode]`. Modes:

- default (no mode) — a **bound** foreground concept. QA requires its label or one of its `aliases:` to appear as a whole-word match in that step's block text.
- `latent` — focus the concept without requiring it to appear in the text. Use this to anchor a relation whose endpoint is not phrased in the current blocks, or to keep a recurring idea warm across steps. Latent concepts are exempt from the binding check.

`authoring qa` enforces exactly two things, per step:

1. Every non-`latent` focus concept is textually grounded (label/alias whole-word match in the step's blocks). If your semantic name differs from the source wording, add the source phrase to `aliases:` rather than renaming the concept.
2. Every active relation has **both** endpoints present in that step's focus list (any mode, including `latent`).

So: to light up a relation in a step, put both of its concepts in that step's focus — mark whichever one the source doesn't phrase here as `latent`.

## Semantic digest protocol

When digesting a new article, transcript, or paper:

1. **Read for the thesis.** Identify the central claim and the pressure driving the source. Name this explicitly before choosing many concepts.
2. **Segment by argument, not just layout.** Source blocks should preserve enough text for grounding, but reader steps should follow the source's argument and teaching path.
3. **Extract claims.** For each section, write what the source is doing: defining, motivating, contrasting, warning, proposing, defending, or concluding.
4. **Choose concepts conservatively.** Prefer durable ideas the user would want to see again. Avoid generic words, whole-sentence concepts, and one-off labels.
5. **Ground relations.** A relation should say something useful: `motivates`, `constrains`, `enables`, `threatens`, `mitigates`, `depends_on`, `contrasts_with`, `reframes`, `supports`.
6. **Connect the arcs.** After grounding the obvious within-section relations, check the whole graph for connectivity: no orphan concepts, and the source's major arcs should join into one (or few) connected components. Add source-grounded bridge edges where the source itself links two arcs. See the Connectivity judgment rule.
7. **Design reader steps.** Each step should reveal a small semantic movement, not merely “paragraph N happened.”
8. **Bind focus to source.** Every non-latent focused concept should have a label or alias that appears in that step's source blocks. Use aliases for semantic names whose exact phrase differs from the source; use `latent` mode for relation-anchor concepts the source does not phrase here (see Focus modes and QA rules).
9. **Validate/QA/compile.** Run `authoring validate`, `authoring qa`, then `authoring compile`. Fix the `.mindgraph.md`, never the generated JSON.
10. **Review in UI.** Ask whether the graph reveals the argument. If it feels bad, repair the authoring source semantically.

`authoring qa` is a semantic hygiene check, not a substitute for judgment. It catches active concepts that cannot be highlighted in the current source blocks and active relations whose endpoints are not foregrounded. Passing QA means the reader can see the digest in the source; it does not mean the digest is deep enough.

## UI review protocol

After compiling a source-first graph, run the dev server against that JSON and inspect it in the browser:

```bash
npm run ui:dev -- --doc graphs/<slug>.mindgraph.json
```

Check:

- title and duration look right
- source pane contains original source only, with no timestamps, generated summaries, tags, or authoring headings
- active source highlights appear while reading
- digest card is generated understanding outside the source pane
- collapsed digest card is quiet: header/title/summary preview only
- click/tap expands the digest card to reveal concept chips and relations; hover must not expand it
- scrolling source changes the active section; scrolling to the very end shows overview
- graph focuses the active concepts without surprising style changes

## Repair loop

When the user says the result is bad, assume the graph is semantically wrong until proven otherwise.

Do:

- Re-read the source and the current `.mindgraph.md`.
- Identify the failure mode: missed thesis, wrong sections, generic concepts, noisy relations, weak grounding, bad reader order, over-compression, or UI derivation issue.
- Edit the `.mindgraph.md` directly.
- Re-run validate, QA, and compile.
- Refresh the UI and report what changed semantically.

Do not:

- Defend a valid-but-bad graph because validation passed.
- Keep improving the deterministic splitter when the problem is interpretation.
- Ask the user to edit JSON.
- Present `authoring draft` output as the real digest.

## Node conversation ("Ask") and crystallize

Selecting a node opens an **Ask** conversation grounded in its source:

- **Talk** is the default: the agent answers questions about the node from the source (web opt-in, attributed). Talk is fast and never changes the graph — it writes nothing.
- **Add to graph** crystallizes the conversation into a new `@source` of `type: discussion`: 1–3 derived `@concept`s (each binding verbatim to a discussion block), the anchor as `latent`, and cross-source `@relation`s to existing concepts. Agent proposes; Undo reverts the whole woven turn.
- Discussions are readable via the Source-tab source switcher. Titles are written unquoted (the parser keeps surrounding quotes literally).

## Existing graph operations

For list/open requests:

```bash
ls -lt ./graphs/*.mindgraph.json
mindgraph inspect <file>
mindgraph view <file>
```

For source-first graphs, prefer editing the paired `.mindgraph.md` and recompiling.

If a graph already exists for the source and you are regenerating from scratch (rather than iterating on the existing `.mindgraph.md`), archive the old pair instead of overwriting it: `mkdir -p _archive && mv graphs/<slug>.mindgraph.{md,json} _archive/`. `graphs/` holds untracked working artifacts, so the move is cheap and keeps the prior digest available for comparison.

If only a legacy `.mindgraph.json` exists, use the older CLI workflow (`concept upsert`, `relation upsert`, `frame set-activations`, `frame merge`, `stats recompute`) only when needed. For new living-graph work, regenerate or migrate into `.mindgraph.md` rather than preserving legacy structure.

## Judgment rules

**Concept granularity.** Atomic concepts should be reusable ideas, not sentences. If an id needs more than a short phrase, split or rename it.

**Concept count vs legibility.** Conservatism is also a readability constraint, not just a quality one. The overview graph has to stay legible on the canvas — past roughly 35–40 nodes the layout strains and the structure gets hard to read. If the overview looks like noise, you have too many concepts: merge sub-points into their parent idea before adding more.

**Relation quality.** Prefer fewer, stronger relations. A graph with generic `related_to` edges is worse than a sparse graph with meaningful typed edges.

**Connectivity.** Sparseness is not fragmentation. "Fewer, stronger relations" is about *quality*, not about leaving the graph in pieces — do not read it as license to ship a constellation of disconnected pairs and orphan nodes. Check the overview before presenting: there should be **no zero-relation concepts**, and the major arcs of the source should link into **one (or very few) connected components**, not isolated islands. When a section's concepts only connect to each other, add a source-grounded bridge edge at an honest joint (the place the source itself makes the link) so the arc joins the body. A thesis-central concept stranded in its own island is a failure mode, even if every individual relation is good. Balance against over-connection: bridges must be real, typed, and grounded — not "these co-occur."

**Source vs inferred.** Source-derived relations are grounded in blocks. Inferred relations are allowed only for common-knowledge scaffolding the source clearly assumes, not for interpretive bridges the source did not make.

Use inferred relations for biographical, foundational, or attributional facts a field-introducing text would state: “X influenced Y,” “X founded Y,” “X is a standard interpreter of Y.” Do not infer contested claims, causal claims, analogies, evaluations, or “these topics often co-occur.”

**Reader journey.** The user should feel the graph unfolding with the argument. If everything appears at once, or if sections are just layout headings with no semantic movement, repair the reader steps.

**Validation is structural.** Passing validation means the artifact is well-formed, not that the digest is good.

## Success criteria

A good mindgraph:

- exposes the source’s central thesis quickly
- has sections that match the argument’s movement
- uses concepts the user would recognize and reuse
- grounds source-derived relations in specific blocks
- connects into one (or few) components with no orphan concepts — the overview reads as one argument, not scattered islands
- keeps inferred structure visibly editorial and conservative
- reads coherently in the UI
- improves when the user gives semantic feedback

When the user opens the UI and says “this shows what the piece is doing,” the producer loop is working.

## Command reference

| Command | Purpose |
| --- | --- |
| `mindgraph authoring draft <source> -o <file.md> --compile <file.json>` | Create a scaffold from plain text; not a final semantic digest |
| `mindgraph authoring validate <file.md>` | Validate source-first authoring structure |
| `mindgraph authoring qa <file.md>` | Check active concepts and relations against visible source grounding |
| `mindgraph authoring compile <file.md> -o <file.json>` | Compile editable authoring source to runtime JSON |
| `mindgraph view <file.json>` | Open the reading UI for review |
| `mindgraph inspect <file.json>` | Inspect legacy/runtime document summary where supported |
| `mindgraph digest <source>` | Legacy starter timeline path for old JSON workflow |
