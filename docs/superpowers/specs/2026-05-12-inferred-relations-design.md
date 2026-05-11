# Inferred relations — locked design

- **Status:** locked. Implement against this spec for v0.5.0.
- **Date:** 2026-05-12
- **Predecessor:** `2026-05-11-inferred-relations-design.md` (brainstorm seed). This file supersedes the seed; every open question has been resolved through the brainstorming pass on 2026-05-12.

## Motivation

The producer pipeline today only creates relations grounded in the source transcript. A lecture often takes for granted that the audience knows X interprets Y, X co-authored with Y, X founded Z — the transcript may reference X and Y separately without ever stating their relationship. The graph then misses the structural connection.

The concrete trigger was ingesting `Sean Kelly_Existentialism.txt` into a mindgraph that included both **Hubert Dreyfus** and **Martin Heidegger** as concepts but no relation between them. Dreyfus is one of the most important 20th-century Heidegger interpreters — common knowledge to anyone in the field. The transcript names them separately; the graph misses the link.

Two failure modes are at play:

1. **Loss of context the source assumes.** Field-canonical "everyone knows" connections silently disappear from the graph because the speaker never bothered to state them.
2. **No epistemic distinction for the user.** Even if the agent wanted to add the missing edges today, source-derived and agent-added edges would render identically — undermining the user's ability to trust the layout's implied structure.

This spec lets the producer (the LLM agent) add **inferred relations** that render distinctly so the user knows at a glance what's from the source and what's the LLM's contribution.

## Schema

Relations gain one optional field:

```js
{
  id: "dreyfus-interprets-heidegger",
  from: "hubert-dreyfus",
  to: "martin-heidegger",
  type: "interprets",
  label: "key Heidegger interpreter",
  provenance: "inferred"        // optional; missing/undefined ≡ "source"
}
```

Allowed values: `'source'` (default) and `'inferred'`. Validation rejects other strings. Missing key ≡ `'source'`, so existing documents validate and render unchanged.

**Provenance is entity-level only.** It lives on the relation entity in `doc.relations[]`. Frame `activeRelations[]` activation records remain `{id, weight}` — they don't carry kind information. When the UI or VM needs to know "is this edge inferred?", it looks up the relation by id.

The binary `source`/`inferred` split is sufficient for v0.5.0. A richer taxonomy (`'corroborated'`, `'speculative'`, `'derived'`) was considered and rejected — the user-facing distinction the user cares about is "did the speaker say this?", which is binary. The schema's default-undefined-means-source convention extends forward trivially if a real third-tier case ever surfaces.

## CLI

One flag added to one subcommand:

```bash
mindgraph relation upsert <doc> --id <id> --from <a> --to <b> --type <t> --provenance inferred
```

- Default omitted = `source` (no key written to JSON — keeps diffs clean for legacy documents).
- `upsertRelation()` in `src/core/document.js` accepts the field and writes the key only when the value is `'inferred'`. Explicit or implicit `'source'` writes no key.
- `mindgraph --help` documents the new flag.
- The post-write confirmation reads `Upserted relation '<id>' (inferred).` when applicable; unchanged otherwise.

## View-model

`buildGraphVM` in `src/view-model/buildMindgraphViewModel.js` threads `relation.provenance` onto each `GraphEdgeVM`:

```ts
interface GraphEdgeVM {
  id: string
  from: string
  to: string
  type: string
  label?: string
  visualWeight: number
  provenance?: 'source' | 'inferred'   // missing ≡ source
}
```

`RelationVM` (returned by `buildRelationsVM`) does **not** carry `provenance` in v0.5.0. The inspector treats source and inferred relations identically — the user surface for distinguishing them is the dashed-line render on the graph, nothing else. Threading provenance into the inspector is parked; revisit if a user reports they can't tell which relations are LLM-added.

## Rendering

`drawEdges` in `ui/draw.js` branches on `edge.provenance === 'inferred'`:

```js
for (const edge of vm.graph.edges) {
  // ... existing visibility / geometry / alpha / width calculations unchanged ...
  if (edge.provenance === 'inferred') ctx.setLineDash([4, 3]);
  ctx.beginPath();
  ctx.moveTo(x1, y1);
  ctx.lineTo(x2, y2);
  ctx.stroke();
  ctx.setLineDash([]);   // reset every iteration so the pattern can never leak
}
```

- **Color, alpha curve, width curve: identical to source edges.** Warm-gold `rgba(218, 184, 116, alpha)`. Passive alpha 0.16, selected/active alpha 0.95. Passive width 0.6, active 1.0, touching-selection 1.4.
- **Only the dash differs.** Single visual variable. Cooler tones or reduced alpha would say "less sure," which is the wrong message — inferred relations are confidently asserted common-knowledge facts, not speculation.
- **Selection/active branches work unchanged.** Clicking either endpoint lifts the dashed edge to bright alpha and full width; the dash remains visible. Coherent with "the agent vouches for this connection."
- **Reset every iteration**, not just after inferred edges. Defensive against ordering bugs; cost is one extra zero-length array assignment per edge.

### Browser verification (during implementation)

After landing the rendering change, run `npm run test:smoke` to produce `examples/out/awakening.mindgraph.json` with the inferred relation, then open it with `mindgraph view examples/out/awakening.mindgraph.json`. Confirm the dashed edge reads clearly at typical zoom and that clicking either endpoint lifts it to bright alpha while preserving the dash. If the dash gestalt blurs into "thin broken gold line" at passive alpha, tune in this priority:

1. Dash pattern `[4, 3]` → `[5, 4]`
2. Inferred-edge passive width `0.6` → `0.8`
3. Inferred-edge passive alpha `0.16` → `0.22`

If tuning changes the defaults, append a section to `docs/superpowers/specs/2026-05-11-graph-rendering-v2-tuning.md` documenting the as-shipped values.

## Layout

**Zero changes.** `buildPairs` in `ui/layout.js` already applies `RELATION_STIFFNESS_MULT = 1.5` whenever a relation exists between two atomic concepts; provenance does not enter the calculation. Inferred relations participate in physics identically to source relations.

This is intentional. The agent's act of adding an inferred relation is an assertion that the two concepts belong near each other in the map. Demoting the spring in layout while keeping the dashed edge on the canvas would be a contradictory message — "yes this is a real connection, but we'll lay them out as if it weren't." The dashed-line render is sufficient epistemic signaling; the geometry should reflect the asserted truth.

**Consequence to acknowledge:** an inferred relation between two concepts that have no co-occurrence (different mesos, different clusters) pulls them noticeably together via the `D_MID = 60` fallback with the 1.5× boost. Adding `inferred` *changes the geometry the user sees*. This puts editorial weight on the producer — which is precisely why the SKILL.md heuristic below constrains the kind of relations the agent should reach for.

## SKILL.md heuristic

New block inserted under **"Heuristics and judgment"** in `skills/mindgraph/SKILL.md`, between **"On idempotency"** and **"On scaling"**. The command-table row at the bottom of the file for `mindgraph relation upsert ...` is updated to show the `--provenance` flag in its example.

Proposed text:

> **On inferred relations.** When you know a connection from world knowledge that the source assumes but doesn't state, add it via `mindgraph relation upsert ... --provenance inferred`. The UI renders these as dashed lines and they participate in the layout at the same stiffness as source-derived edges — adding `inferred` *changes the geometry the user sees*, not just decoration. Treat it as an editorial choice.
>
> **What qualifies.** Inferred relations are *only* for biographical, foundational, or attributional facts the source's audience would treat as common knowledge — facts the speaker is silently presupposing rather than asserting. Examples: "X interpreted Y", "X is a student of Y", "X co-authored Z with W", "X founded movement Z", "X developed concept Y". These are connections any introductory text in the field would state as part of its scaffolding.
>
> **Two tests, apply both.** **(1) Introductory-textbook test** — would an introductory text in this field state this connection as part of the scaffolding the field is built on? If no, don't add it. **(2) Audience-eye-roll gut-check** — would a knowledgeable audience member be mildly bored if the speaker stopped to explain this? If yes, it's table-stakes; safe to add. If they'd lean in because it's contested or interesting, it's not table-stakes — that's the speaker's editorial territory, not yours. Fail-safe to "don't add" when both tests aren't clearly satisfied.
>
> **What does NOT qualify.** Don't infer *inferential bridges*: "X causes Y", "X is similar to Y", "X opposes Y", "X anticipates Y", or any connection that interprets, compares, or evaluates. Those are the speaker's editorial territory — if the speaker didn't make the bridge, you don't either. Don't infer connections that a domain expert *might* assert but isn't field-consensus (specific scholarly theses). Don't infer topical co-occurrence ("both come up in this field") — that's what cluster siblings and co-occurrence already capture.
>
> **Worked example — Sean Kelly *Existentialism* lecture.** Yes-add: `hubert-dreyfus → martin-heidegger` (interprets — Dreyfus is the canonical 20th-century Heidegger interpreter); `søren-kierkegaard → jean-paul-sartre` (influences — Kierkegaard is a foundational existentialist precursor any intro treats as such). No-add: `heidegger → derrida` ("anticipates deconstruction" — specific scholarly thesis, not common knowledge); `sartre ↔ camus` ("opposed each other politically" — inferential bridge, speaker's territory); `existentialism → phenomenology` ("draws methodologically from" — too interpretive, even if defensible).
>
> **Don't activate inferred relations in frames.** Inferred relations exist as latent structural facts — they're visible on the graph once both endpoints have first-appeared, and clicking either endpoint lights them up. Don't add them to any frame's `--relations-json` activations, because the speaker didn't activate them. Adding them to `activeRelations` would say "the speaker is foregrounding the connection they didn't make" — incoherent.

The "don't activate in frames" rule is enforced by SKILL.md guidance, not by the schema. Permitting it costs nothing — `activeRelations` already accepts any relation id — and if a future use case wants to break the rule on a specific document, it can. Backfill therefore needs no special-casing: provenance is an entity-level property, backfill operates on activation references, and if no inferred relations are activated, none propagate.

## Smoke test extension

`package.json`'s `test:smoke` and `test:smoke:node` scripts gain steps exercising the new flag end-to-end. The added concept and relation are chosen to satisfy the SKILL.md heuristic (biographical/attributional, not an inferential bridge), so the smoke test also serves as an editorial example for future readers:

```bash
# inserted after the existing `concept upsert ... wisdom ...` step
mindgraph concept upsert examples/out/awakening.mindgraph.json \
  --id john-vervaeke --label "John Vervaeke" --first-seen-at 0

# inserted after the existing `relation upsert ... responds-to ...` step
mindgraph relation upsert examples/out/awakening.mindgraph.json \
  --id vervaeke-coined-meaning-crisis \
  --from john-vervaeke --to meaning-crisis \
  --type coined-term \
  --provenance inferred
```

John Vervaeke is the speaker of the *Awakening from the Meaning Crisis* lecture series that this sample is named after; he is widely credited with popularizing the "meaning crisis" framing in the cognitive-science / wisdom-studies community. The relation passes both heuristic tests — introductory-textbook (an intro to Vervaeke's work would state this) and audience-eye-roll (anyone familiar with the field would be bored by an explanation).

The produced `examples/out/awakening.mindgraph.json` now contains one inferred relation. Loading it in `mindgraph view` exercises the dashed-edge render path with zero further setup — the verification step described in **Rendering > Browser verification** runs against this document.

## Implementation scope

| File | Change |
|---|---|
| `src/core/schema.js` | Validate `relation.provenance` ∈ `{'source', 'inferred'}` when present; field is optional. |
| `src/core/document.js` | `upsertRelation` accepts `provenance`; writes the key only when the value is `'inferred'` (explicit or implicit `'source'` writes no key, keeping legacy-document diffs clean). |
| `src/cli/index.js` | Parse `--provenance` flag on `relation upsert`; update help text and the printed confirmation when applicable. |
| `src/view-model/buildMindgraphViewModel.js` | `buildGraphVM` threads `relation.provenance` onto `GraphEdgeVM`. `RelationVM` unchanged. |
| `docs/ui-view-model-spec.md` | Add optional `provenance` field to `GraphEdgeVM` interface (§8); short paragraph stating "missing ≡ source, dashed render for inferred". |
| `ui/draw.js` | `drawEdges` applies `setLineDash([4, 3])` for inferred edges; `setLineDash([])` after every edge. |
| `skills/mindgraph/SKILL.md` | New "On inferred relations" heuristic block; update the command-table row example for `relation upsert` to show the flag. |
| `README.md` | Add `--provenance` to the `relation upsert` example under the actuator commands list. |
| `package.json` | Extend `test:smoke` and `test:smoke:node` with a `john-vervaeke` concept upsert and an inferred-provenance relation upsert exercising the new flag. |
| `docs/superpowers/specs/2026-05-12-inferred-relations-design.md` | This locked spec (new file). |

## Commit grouping

Five commits. Each leaves the project in a working state; the smoke test passes after commit 1 and continues to pass through every subsequent commit.

1. **`feat(core+cli): relation upsert accepts --provenance`** — schema validation, `upsertRelation` change, CLI flag wiring, help-text update, and the smoke-test extension. The new behavior is tested from the moment the flag exists.
2. **`feat(view-model): expose relation provenance on GraphEdgeVM`** — `buildGraphVM` change; `docs/ui-view-model-spec.md` update.
3. **`feat(ui): render inferred relations as dashed edges`** — `drawEdges` change. Includes the browser-verification step: load the smoke-test output in `npm run ui:dev`, confirm the dashed edge reads clearly at typical zoom and selection state, tune dash/width/alpha per the priority list under **Rendering** if it reads poorly. If defaults change, append a section to the v2 tuning addendum.
4. **`docs(skill): heuristic for adding inferred relations from world knowledge`** — SKILL.md heuristic block + command-table flag; README actuator example.
5. **`chore(release): 0.5.0`** — version bump in `package.json`, update SKILL.md's prerequisite-check install command from `#v0.4.1` to `#v0.5.0`.

## Out of scope

- **Inferred concepts.** LLM adding concepts the source didn't name. The document's vocabulary is the speaker's vocabulary; adding concepts out-of-band creates more risk than inferred relations between existing concepts. If a domain expert thinks the source is missing a concept, they're probably reading the wrong source.
- **Inferred activations.** LLM adding concept activations to frames the source didn't activate them in. Same risk profile — the producer pipeline must be conservative about what counts as "active" at a given moment. Backfill already covers the legitimate broadcast case.
- **`'corroborated'` or `'speculative'` provenance tiers.** Binary is sufficient for v0.5.0; the schema's default-undefined-means-source convention extends forward trivially if a real third-tier use case ever surfaces.
- **Canvas hover tooltip on edges.** No edge hit-testing today, no precedent for canvas tooltips. Separate UX project.
- **`RelationVM.provenance` and inspector marker.** Threaded onto `GraphEdgeVM` only; inspector revisits if a user reports they can't tell which relations are LLM-added.
- **Tagged relation styles beyond provenance.** Typed-edge visual variants (e.g. `contradicts` rendered differently from `addresses`) were explicitly rejected in the v2 design as visual noise; that decision stands.

## Parking lot

- **v0.5.1 — Macro-firstSeenAt fix.** Separate concern discovered while ingesting the Sean Kelly transcript. `state.activeLevel = 'macro'` in `ui/app.js` combines with the cluster-only-macro annotation pattern (which exists so atomic `firstSeenAt` doesn't collapse to chapter-start) to produce a broken highlighting pipeline: `getActiveConceptIdsAtTime(time, 'macro')` returns only cluster ids, no atomic concept is ever "currently active," and the prose highlight signal degrades to global-importance baseline. The cleanest fix is to decouple `firstSeenAt` derivation from the active-set pipeline: `deriveFirstSeenAt` in `buildMindgraphViewModel.js` should (a) skip macro-level frames and (b) restrict to `foregroundConcepts` only (matching the foreground-only co-occurrence policy already shipped in v0.4.1). Macros can then carry rich atomic foregrounds again, fixing the highlighting at macro level without regressing the staggered reveal. Ships as a separate v0.5.1 patch release after v0.5.0; needs its own brief brainstorm-or-plan session.

---

*Locked 2026-05-12 after the brainstorming pass. Supersedes the 2026-05-11 seed.*
