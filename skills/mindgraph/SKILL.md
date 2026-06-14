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
5. Open or refresh the UI so the user can react to the artifact.

Useful commands:

```bash
mindgraph authoring validate graphs/<slug>.mindgraph.md
mindgraph authoring compile graphs/<slug>.mindgraph.md -o graphs/<slug>.mindgraph.json
mindgraph view graphs/<slug>.mindgraph.json
```

If starting from plain text and you need a skeleton, use:

```bash
mindgraph authoring draft <source.txt> -o graphs/<slug>.mindgraph.md --title "Title" --compile graphs/<slug>.mindgraph.json
```

But treat this as scaffolding only. A heuristic draft is not a finished mindgraph. Replace or rewrite it with a semantic pass before presenting it as a meaningful result.

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

## Semantic digest protocol

When digesting a new article, transcript, or paper:

1. **Read for the thesis.** Identify the central claim and the pressure driving the source. Name this explicitly before choosing many concepts.
2. **Segment by argument, not just layout.** Source blocks should preserve enough text for grounding, but reader steps should follow the source's argument and teaching path.
3. **Extract claims.** For each section, write what the source is doing: defining, motivating, contrasting, warning, proposing, defending, or concluding.
4. **Choose concepts conservatively.** Prefer durable ideas the user would want to see again. Avoid generic words, whole-sentence concepts, and one-off labels.
5. **Ground relations.** A relation should say something useful: `motivates`, `constrains`, `enables`, `threatens`, `mitigates`, `depends_on`, `contrasts_with`, `reframes`, `supports`.
6. **Design reader steps.** Each step should reveal a small semantic movement, not merely “paragraph N happened.”
7. **Validate/compile.** Run the authoring commands. Fix the `.mindgraph.md`, never the generated JSON.
8. **Review in UI.** Ask whether the graph reveals the argument. If it feels bad, repair the authoring source semantically.

## Repair loop

When the user says the result is bad, assume the graph is semantically wrong until proven otherwise.

Do:

- Re-read the source and the current `.mindgraph.md`.
- Identify the failure mode: missed thesis, wrong sections, generic concepts, noisy relations, weak grounding, bad reader order, over-compression, or UI derivation issue.
- Edit the `.mindgraph.md` directly.
- Re-run validate and compile.
- Refresh the UI and report what changed semantically.

Do not:

- Defend a valid-but-bad graph because validation passed.
- Keep improving the deterministic splitter when the problem is interpretation.
- Ask the user to edit JSON.
- Present `authoring draft` output as the real digest.

## Existing graph operations

For list/open requests:

```bash
ls -lt ./graphs/*.mindgraph.json
mindgraph inspect <file>
mindgraph view <file>
```

For source-first graphs, prefer editing the paired `.mindgraph.md` and recompiling.

If only a legacy `.mindgraph.json` exists, use the older CLI workflow (`concept upsert`, `relation upsert`, `frame set-activations`, `frame merge`, `stats recompute`) only when needed. For new living-graph work, regenerate or migrate into `.mindgraph.md` rather than preserving legacy structure.

## Judgment rules

**Concept granularity.** Atomic concepts should be reusable ideas, not sentences. If an id needs more than a short phrase, split or rename it.

**Relation quality.** Prefer fewer, stronger relations. A graph with generic `related_to` edges is worse than a sparse graph with meaningful typed edges.

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
- keeps inferred structure visibly editorial and conservative
- reads coherently in the UI
- improves when the user gives semantic feedback

When the user opens the UI and says “this shows what the piece is doing,” the producer loop is working.

## Command reference

| Command | Purpose |
| --- | --- |
| `mindgraph authoring draft <source> -o <file.md> --compile <file.json>` | Create a scaffold from plain text; not a final semantic digest |
| `mindgraph authoring validate <file.md>` | Validate source-first authoring structure |
| `mindgraph authoring compile <file.md> -o <file.json>` | Compile editable authoring source to runtime JSON |
| `mindgraph view <file.json>` | Open the reading UI for review |
| `mindgraph inspect <file.json>` | Inspect legacy/runtime document summary where supported |
| `mindgraph digest <source>` | Legacy starter timeline path for old JSON workflow |
