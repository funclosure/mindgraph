# Source-first timing: word-proportional estimates — design

**Date:** 2026-07-04
**Status:** approved
**Problem:** repo-health finding #4 — source-first timing is synthetic and invisible.

## Problem

Source-first documents carry no timestamps, so the view model fabricates them:
every block gets a uniform slice — `duration_seconds / blockCount` when the
authoring frontmatter declares a total, otherwise a flat 60 s per block. That
fabrication silently drives:

- concept `firstSeenAt` and frame spans (camera targets, progressive reveal),
- duration-weighted co-occurrence (graph layout distances),
- the topbar duration label, which renders a fabricated `40:00` as if real.

A 5-word heading weighs the same as a 300-word paragraph, and neither the
producer nor `authoring qa` can see which timing mode a document is using.

## Design

No document schema change. Timing stays a view-model-derived concern — the
source-first document continues to carry no fabricated data.

### 1. Word-proportional derivation (`src/view-model/buildMindgraphViewModel.js`)

- Per-block duration: `max(MIN_BLOCK_SECONDS, words / WORDS_PER_MINUTE * 60)`
  with `WORDS_PER_MINUTE = 220`, `MIN_BLOCK_SECONDS = 4` (headings and short
  lines keep a visible span).
- When `meta.durationSeconds` is declared: scale the proportional durations so
  they sum to the declared total (replacing today's uniform split).
- Block spans become cumulative sums over blocks sorted by `order`. Step,
  section, and `firstSeenAt` spans need no separate handling — they derive
  from block spans already.
- The VM exposes the mode:
  `documentMeta.timing = { mode: 'declared' | 'estimated', totalSeconds }`.
- Legacy `mindgraph.document` transcripts are untouched — they have real
  timestamps and never enter this path.

### 2. Honest display (`ui/panels/topbar.js`)

- `timing.mode === 'estimated'` → render `~N min read` (rounded up, minimum
  `~1 min read`).
- `declared` (and legacy transcript docs) → keep the `mm:ss` clock format.

### 3. Producer visibility (`authoring qa`)

`evaluateSourceFirstReading` gains a `timing` field (mode, totalSeconds,
blockCount) and the `authoring qa` text output prints one informational line,
e.g. `Timing: estimated (~7 min read across 40 blocks)` or
`Timing: declared (40:00 across 40 blocks)`. Informational only — estimates
are legitimate for articles; no exit-code change.

## Consequences

- Layout shifts subtly on existing source-first graphs: co-occurrence is
  duration-weighted, so long passages now weigh more than headings. This is
  the intended correction, not a regression.
- Scroll↔playhead binding is unaffected structurally (it maps prose position
  to block spans, whatever their widths).

## Testing

- Unit (view-model): proportionality (more words → longer span), the 4 s
  floor, declared-total scaling (spans sum to `durationSeconds`, longer block
  gets more), `documentMeta.timing` exposure, legacy docs unaffected.
- Unit (qa): report includes the timing line in both modes.
- UI: `npm run ui:check`, then load a real estimated-mode document in the
  browser and confirm the `~N min read` label and normal graph behavior.
- Sweep: `mindgraph validate` + `vm:example` on canonical samples.

## Rejected alternatives

- **Per-block authored durations** — most control, but real authoring burden
  and a format change; nothing needs that precision today.
- **Visibility-only** — smallest change, but leaves the heading-equals-
  paragraph weighting distortion in place.
