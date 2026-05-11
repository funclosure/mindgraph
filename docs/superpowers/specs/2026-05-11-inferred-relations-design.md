# Inferred relations — brainstorm seed

- **Status:** captured, not locked. Next session should run this through `superpowers:brainstorming` before implementation.
- **Date:** 2026-05-11
- **Origin:** Ingesting `Sean Kelly_Existentialism.txt` produced a mindgraph that included both **Hubert Dreyfus** and **Martin Heidegger** as concepts but no relation between them. Dreyfus is one of the most important 20th-century Heidegger interpreters — common knowledge to anyone in the field. The producer pipeline today only creates relations grounded in the source transcript, so this kind of "everyone knows" connection silently disappears from the graph.

## The gap

The current relation model has one provenance: "the speaker said this." Two failure modes:

1. **Loss of context** the source assumes. A lecture often takes for granted that the audience knows X interprets Y, X co-authored with Y, X is the founder of Z. The transcript may reference X and Y separately without ever stating their relationship. The graph then misses the structural connection.
2. **No epistemic distinction** for the user. Even if the LLM operator wanted to add the missing edges, there's no way to mark them as "I added this from world knowledge, not the author" — they'd be visually indistinguishable from source-derived edges, undermining the user's ability to trust the layout's implied structure.

The fix is to let the producer (the LLM agent) **add inferred relations** and have them **render distinctly** so the user knows at a glance what's from the source and what's the LLM's contribution.

## Proposed shape

### Schema

Add an optional `provenance` field on relations. Default (missing/undefined) = `'source'`, so existing documents render unchanged.

```js
{
  id: "dreyfus-interprets-heidegger",
  from: "hubert-dreyfus",
  to: "martin-heidegger",
  type: "interprets",
  label: "key Heidegger interpreter",
  provenance: "inferred"
}
```

Initial allowed values: `'source'` (default), `'inferred'`. Tri-state or richer taxonomies (e.g. `'corroborated'`, `'speculative'`) — open question for the brainstorm.

### CLI

```bash
mindgraph relation upsert <file> --id <id> --from <a> --to <b> --type <t> --provenance inferred
```

Omitting the flag preserves current behavior (source default).

### View-model

`buildGraphVM` carries `provenance` through to `edges[]`. Documented in `docs/ui-view-model-spec.md` under `GraphEdgeVM`.

### UI rendering

`ui/draw.js` `drawEdges` branches on `edge.provenance`:

- **`'source'`** — solid line, current warm-gold `rgba(218, 184, 116, alpha)` (unchanged).
- **`'inferred'`** — dashed (`ctx.setLineDash([4, 3])`), slightly cooler or dimmer tone so it reads "a different kind of edge" without being more visually loud than source edges.

Selection/active state continues to brighten both kinds. Width unchanged. Dash pattern reset (`ctx.setLineDash([])`) after the inferred edge is drawn so it doesn't leak into subsequent draws.

### Layout impact

**None on the math.** Inferred relations still get the `RELATION_STIFFNESS_MULT = 1.5` boost. The user has presumably approved the inference; treating it as second-class in physics would defeat the point. Visual differentiation is where the epistemic distinction lives, not in spring stiffness.

### SKILL.md heuristic

New paragraph under "Heuristics and judgment":

> **On inferred relations.** When you know a connection from world knowledge that the source doesn't explicitly state, add it via `mindgraph relation upsert ... --provenance inferred`. The UI renders inferred edges as dashed lines so the user can distinguish them from source-derived edges. **Use sparingly** and only for connections that are common knowledge in the field — e.g., "Dreyfus interpreted Heidegger", "Lakoff and Johnson co-authored *Metaphors We Live By*", "Csikszentmihalyi developed the flow-state concept". **Don't fabricate speculative links.** If you're not sure whether a domain expert would call it common knowledge, skip it.

## Open questions for the brainstorm

Lock these in `superpowers:brainstorming` next session before touching code:

1. **Is binary enough?** `source` / `inferred` — or is there a meaningful third state? Candidates:
   - `'corroborated'`: source mentions both endpoints but doesn't state the relationship; LLM adds the verbalization
   - `'speculative'`: LLM is asserting a connection the source doesn't support and that isn't quite common-knowledge consensus
   - `'derived'`: machine-computed (e.g. co-occurrence threshold) without semantic interpretation
   - More granularity = more agent decision-fatigue. Probably not worth it for v0.5.0; revisit if a real use case shows up.
2. **Should inferred edges have a different stiffness?** Argument for same: it's a real semantic connection. Argument for lower: it's the LLM's guess, the user might not want it dominating the layout. Default proposed: same stiffness (1.5× multiplier). Open.
3. **Tooltip / inspector affordance?** Hovering an inferred edge could show "added from world knowledge: <type>" so users can decide whether to trust it. Out of v0.5.0 scope but worth keeping in mind for the inspector design.
4. **How does the SKILL.md guidance scale?** For a 2-hour lecture, an agent could plausibly add dozens of inferred relations — every domain has its known interconnections. Need a guideline for "what fraction of relations should be inferred." Probably "no more than ~20% inferred; if you find yourself wanting more, the source is probably underannotating its own claims."
5. **Backfill subcommand interaction?** Backfill currently copies `activeRelations` from coarser to finer. Should backfilled relations inherit the source frame's provenance, or be flagged as "inherited" themselves? Probably inherit unchanged — backfill is a producer-operation, not an inference.
6. **Visualization niche** — dashed line is the spec proposal. Alternatives: different color hue, different alpha, animated stroke, leader-line annotation. Want to keep visual budget small (the canvas already has a lot going on).

## Implementation scope

Rough touch list for v0.5.0 (~10 small file-touches, no breaking changes):

| File | Change |
|---|---|
| `src/core/schema.js` | Optionally validate `provenance` allowed-values; or leave permissive |
| `src/core/document.js` | `upsertRelation` accepts and writes `provenance` |
| `src/cli/index.js` | Parse `--provenance` flag on `relation upsert`; help text update |
| `src/view-model/buildMindgraphViewModel.js` | `buildGraphVM` carries `provenance` to `edges[]` |
| `ui/draw.js` | `drawEdges` branches dash style on `edge.provenance === 'inferred'`; reset `setLineDash([])` after |
| `docs/ui-view-model-spec.md` | Add `provenance` to `GraphEdgeVM` interface |
| `skills/mindgraph/SKILL.md` | New "On inferred relations" heuristic + command-table row mentioning the flag |
| `README.md` | Note the `--provenance` flag in actuator commands list |
| `package.json` test:smoke | Optional: exercise the new flag (cheap to add) |
| `docs/superpowers/specs/2026-05-11-inferred-relations-design.md` | This file, expanded into a locked spec after the brainstorm |

Suggested commit grouping for v0.5.0:
1. `feat(core+cli): relation upsert accepts --provenance`
2. `feat(view-model): expose relation provenance on GraphEdgeVM`
3. `feat(ui): render inferred relations as dashed edges`
4. `docs(skill): heuristic for adding inferred relations from world knowledge`
5. `chore(release): 0.5.0`

## Out of scope (parking lot)

- Inferred *concepts* (LLM adding concepts the source didn't mention). Concepts are the document's vocabulary — adding them out-of-band creates more risk than inferred relations between existing concepts. If a domain expert thinks the source is missing a concept, they're probably reading the wrong source.
- Inferred *activations* (LLM adding concept activations to frames the source didn't activate them in). Same risk profile — the producer pipeline should be conservative about what counts as "active" in a given micro/meso. Backfill already covers the legitimate broadcast case.
- Tagged relation styles beyond inferred/source (e.g. `'contradicts'` rendered differently from `'addresses'`). The v2 design explicitly rejected typed-edge variants as visual noise; that decision stands.

---

*Captured during the v0.4.1 wrap-up session. Surface for `superpowers:brainstorming` at the start of the next session.*
