# Graph rendering v2 — post-merge tuning addendum

- **Status:** describes as-shipped behavior on `main` after v0.4.0
- **Date:** 2026-05-11 (same day as v2 spec, after the v2 commits landed and were exercised on the canonical Episode 1 sample)
- **Predecessor:** `2026-05-11-graph-rendering-v2-design.md` — the authoritative v2 design. This addendum captures empirical adjustments made *after* the spec landed when real-document behavior surfaced gaps the math hadn't anticipated.

## Why an addendum

The v2 design was built from first principles. When the integrated system was exercised on the canonical sample (`examples/out/episode-1-built.mindgraph.json`), four issues surfaced that the spec didn't anticipate:

1. **Period-2 explicit-Euler oscillation** on densely-connected concepts during warm phases ("shaking like crazy")
2. **Sparse co-occurrence data** (micro frames empty of activations) starved the spring math of the signal it was designed around
3. **A "valley of weakness"** in the linear `ideal_d` curve where moderately-co-occurring pairs got exiled to farther distances than unrelated pairs
4. **`D_MID = 100` miscalibrated** against the new curve range, leaving producer-asserted relationships looser than data-observed co-occurrence
5. **Camera fit silently broke** when macro-level foreground concepts were clusters (which have no positions in v2)

Each was fixed via a small, surgical adjustment. The v2 spec contract is preserved (locked-in decisions still hold); these tunings refine *how* the contract is implemented.

## Locked-in tunings

### 1. Sub-stepped integrator

**Symptom.** Densely-connected concepts oscillated visibly between two positions every other frame during warm phases. Empirical trace on `meaning-crisis`: 67 sign-flips in 120 frames, max single-frame displacement 32.6 world units.

**Diagnosis.** Explicit Euler is unstable when total incident spring stiffness on a node × α exceeds `2(1+d)` where `d = VELOCITY_DECAY = 0.4`. Stability threshold at α=1 is k ≈ 2.8. Measured worst-case incident stiffness on Episode 1 is k = 14.55 (on `meaning-crisis`) — **5× past threshold**. Velocity clamping doesn't restore stability; it produces a bounded limit cycle whose amplitude is exactly the clamp magnitude.

**Fix.** Each `sim.step()` now runs `SUBSTEPS = 6` sub-iterations at `α/N`, with per-substep damping `SUBSTEP_DECAY = VELOCITY_DECAY^(1/SUBSTEPS) ≈ 0.857` so the composed per-macro-frame retention equals the original `VELOCITY_DECAY`. Per-substep effective stiffness `k × (α/N) = 14.55/6 = 2.43` < per-substep threshold `2(1 + 0.857) = 3.71` — comfortably stable.

**Result.** Zero sign-flips on the same trace. Max single-frame dx drops from 32.6 → 0.03. Settle time after sustained scroll: 1788 ms → 617 ms. Tail bit-exact stable.

**Cost.** 6× force-pass work per step, but n=63 makes this trivial — ~64k × 6 = 384k ops/frame, well under 16 ms budget.

### 2. CLI subcommand: `frame backfill-activations`

**Symptom.** v2's layout produced cluster scatter rather than clear cluster regions on the canonical sample.

**Diagnosis.** Spring math depends on co-occurrence at the finest available frame level. The canonical Episode 1 sample had **all 814 micro frames empty of concept activations** — only meso (48/68) and macro (5/6) carried foreground concepts. With micro empty, the co-occurrence score distribution collapsed to a narrow band (min 44, median 52, max 162), SCORE_REF percentile landed near 100, and most pairs got nearly-identical `ideal_d` distances. Cluster structure couldn't differentiate.

**Fix.** New producer-side CLI subcommand:

```bash
mindgraph frame backfill-activations <file> --from meso --to micro
```

For each micro frame, finds the meso frame with maximum span overlap and copies its `foregroundConcepts` / `backgroundConcepts` / `activeRelations` down. Idempotent (replaces; doesn't merge). Not "true" sentence-grain co-occurrence — every micro under one meso ends up with identical activations — but the score distribution widens substantially, and the layout becomes visibly more legible.

After applying to Episode 1: 576/814 micro frames carry activations (the other 238 fell under mesos with empty foreground themselves).

### 3. Exponential `ideal_d` curve

**Symptom.** Pair "Dark Factors ↔ Buddhism" (zero co-occurrence, different clusters, no relation) sat *closer* than "Dark Factors ↔ Nihilism" (moderate co-occurrence, same cluster). Intuition-violating: a half-related pair ended up farther than a completely unrelated pair.

**Diagnosis.** The linear curve `ideal_d = D_MAX − (D_MAX − D_MIN) × normalized` put pairs at 50% of SCORE_REF at `ideal_d ≈ 110`. Pairs with **zero** co-occurrence had **no spring at all** and were only governed by charge — which could equilibrate them at much shorter distances (~40-70) depending on neighborhood. Weakly-co-occurring pairs were *worse off* than unrelated pairs.

**Fix.** Replace the linear curve with exponential decay:

```
ideal_d = D_MIN + (D_MAX − D_MIN) × exp(−SCORE_REF_CURVE_K × score/scoreRef)
SCORE_REF_CURVE_K = 4
```

Pulls weakly-co-occurring pairs in much harder: a pair at 25% of SCORE_REF moves from `ideal_d = 145` (linear) to ~88 (exp); at 50% from 110 to 55; at 90% from 118 to 38. Strongly-co-occurring pairs still asymptote to D_MIN. Letting `normalized` exceed 1 just pushes the result closer to D_MIN — no clamping needed.

### 4. `D_MID` retune 100 → 60

**Symptom.** "Trade Rituals ↔ Broader Trading Networks" (explicit `requires` relation, same cluster, but zero measured co-occurrence) sat at `ideal_d = 100` (D_MID fallback) while "Broader Trading Networks ↔ Sociocognitive Response" (`creates` relation, same cluster, score 214 → `ideal_d = 38`) sat much closer. The pair with the producer's strongest assertion (`requires`) got the *loosest* spring.

**Diagnosis.** Under the linear curve, typical co-occurrence-driven `ideal_d` sat in the 100-118 range. `D_MID = 100` matched the midpoint reasonably. Under the new exp curve, co-occurrence `ideal_d` cluster around 38-62 (median 55). `D_MID = 100` was now *farther* than even weakly-co-occurring pairs.

**Fix.** Lower `D_MID` from 100 to 60 to match the typical co-occurrence-driven distance under the exp curve. Producer-asserted-but-not-co-occurring pairs now land at roughly the same range as moderate-co-occurrence pairs.

### 5. Unrelated-pair repulsion at `D_FAR`

**Symptom.** After fixes 3 and 4, mid-distance pairs collapsed inward but unrelated pairs had nothing pushing them apart — they relied entirely on charge balance, which let them drift into cluster space. Layout felt crowded; cluster structure muddled by floating unrelated dots.

**Diagnosis.** Force budget had attraction (springs for related pairs) and weak universal charge. Genuinely-unrelated pairs had no spatial preference — only "stay this far apart via charge" which is weak at distance.

**Fix.** Add a fallback spring for pairs with no co-occurrence AND no relation AND no shared cluster:

```js
// In buildPairs, after the relation-or-sibling branch:
} else {
  idealD = D_FAR;                    // 150
  stiffness = UNRELATED_STIFFNESS;   // 0.05
}
```

`D_FAR = 150` is the "preferred minimum distance" for unrelated pairs. `UNRELATED_STIFFNESS = 0.05` is intentionally gentle — it provides global guidance toward "unrelated = farther than related" without overwhelming cluster-internal attractive springs (which run at 0.5–0.97 stiffness).

**Stability impact.** Max incident stiffness on `meaning-crisis` goes from 14.55 to ~17 (47 new tiny springs at 0.05). Sub-step N=6 threshold is `k × (α/N) < 3.71` → max sustainable k = 22.3. We sit at 17, margin shrunk from 7.7 to 5.3, still comfortably safe.

**Convergence impact.** Settle time after sustained scroll: 617 → 117 ms. More forces = more guidance to equilibrium = faster convergence.

### 6. Camera fit: expand clustered foreground to atomic children

**Symptom.** At mid-document playhead, the camera stopped updating. Recently-bloomed atomic concepts at the edges of the layout drifted offscreen (Dark Factors, Mental Health Crisis appeared cut off at the bottom of the viewport).

**Diagnosis.** Macro-level frames typically nominate **clustered** concepts as their foreground (e.g. "Evolutionary-Cognitive Origins", "Meaning Crisis Core"). v2 dropped cluster anchors from physics — clustered concepts have no entry in `layout.nodes`. `deriveCameraTarget`'s Case 3 looked up positions for the foreground ids, found none, filtered to `points = []`, returned `undefined`. The animator's lerp gate skipped, and the camera stayed at whatever fit was last set — typically the initial fit-to-layout from bootstrap. As the layout continued to bloom and spread, the camera never caught up.

**Fix.** In `deriveCameraTarget`, expand each clustered foreground concept into its atomic children before computing the camera bbox:

```js
const fg = rawFg.flatMap((a) => {
  const concept = viewModel.concepts.byId[a.id];
  if (concept?.level === 'atomic') return [a];
  if (concept?.level === 'clustered') {
    const childIds = viewModel.concepts.childrenByClusterId[a.id] ?? [];
    return childIds.map((id) => ({ id, weight: a.weight ?? 0.5 }));
  }
  return [];
});
```

Plus a `fitCumulativeAtomic()` helper used as a defensive fallback in all three cases when expansion-then-filter still leaves zero positionable points.

## Constants snapshot (as shipped)

For when you want to retune empirically:

| Constant | Value | Role |
|---|---|---|
| `SUBSTEPS` | 6 | Sub-iterations per `step()` for explicit-Euler stability |
| `SUBSTEP_DECAY` | `0.4^(1/6) ≈ 0.857` | Per-substep velocity damping (preserves macro retention) |
| `MAX_VELOCITY_PER_ITER` | 50 | Velocity clamp (defensive; with substepping rarely activates) |
| `D_MIN` | 35 | Strongest-co-occurrence ideal distance |
| `D_MAX` | 180 | Weakest-co-occurrence ideal distance |
| `D_MID` | 60 | Fallback for relation/sibling pairs with no co-occurrence |
| `D_FAR` | 150 | Target distance for fully-unrelated pairs |
| `SCORE_REF_CURVE_K` | 4 | Exponential decay constant in the `ideal_d` curve |
| `SCORE_REF_PERCENTILE` | 0.9 | Reference score = 90th percentile of positive scores |
| `BASE_STIFFNESS` | 0.5 | Base spring stiffness |
| `RELATION_STIFFNESS_MULT` | 1.5 | Boost when an explicit relation exists |
| `SIBLING_STIFFNESS_MULT` | 1.3 | Boost when concepts share a cluster |
| `UNRELATED_STIFFNESS` | 0.05 | Stiffness for the D_FAR repulsion spring |

All live at the top of `ui/layout.js`. Tunable in one place.

## Co-occurrence is foreground-only

The implementation originally counted any pair appearing in `foreground ∪ background` of the same frame. That conflated "co-topic" with "both peripherally active" and inflated the SCORE_REF noise floor on documents with rich background sets (each background-only frame contributes `C(N, 2)` pair-increments without adding discrimination). Restricting to `foregroundConcepts` only makes the score sharper: "both concepts were the topic at the same time."

On the canonical Episode 1 sample this is a no-op (background is empty everywhere — pre-backfill at meso/macro and post-backfill by inheritance), so the change ships without affecting the released layout. The effect surfaces only on future documents that genuinely annotate background activations.

Background concepts are still represented in the layout via explicit relations (stiffness multiplier), cluster siblings (stiffness multiplier + D_MID fallback), and charge balance — they're just not counted as evidence of co-topic-ness.

## On `firstSeenAt` shifting after backfill

A consequence of `frame backfill-activations --from meso --to micro` worth knowing about: `firstSeenAt` for atomic concepts is derived from the earliest frame appearance (across all three levels) by `deriveFirstSeenAt`. When you backfill, every micro inside a meso inherits that meso's `foregroundConcepts`, so concepts active in the meso end up appearing in many more (earlier-starting) frames than they did before.

In practice this barely shifts `firstSeenAt` because `mergeFrames` constructs meso spans as `meso.span.start = sourceFrames[0].span.start` — so a concept that first appeared in meso N already had `firstSeenAt = first-micro-of-meso-N's-start` whether backfill ran or not. The shift only materially affects concepts that were **hand-annotated only on a specific late micro** of an earlier meso (i.e., the concept's first surfacing was a specific moment inside a meso whose other content is unrelated). Backfill replaces that micro's foreground with the meso's, **destroying** the hand-annotated activation and resetting `firstSeenAt` to the meso's start.

This is consistent with backfill's documented "replaces, not merges" contract: the operator chose to broadcast meso annotations down, so the prior micro-level annotations are by design overwritten. The bloom-in UX consequence (more concepts visible from doc-load, less progressive reveal during early reading) is the explicit downstream effect of that contract — accepted, not worked around.

Don't run backfill on documents whose finer-level frames carry hand-curated activations you want to preserve.

## Concerns flagged during the merge but not addressed here

Code-review smells that were deferred:

- `state.layout` getter recomputes `bounds` on every access (M2 from Task 2 review). O(n) per call, currently ~7.6k ops/sec — not a perf problem at n=63 but a code smell. Memoization candidate.
- `_maxVelocity` written inside `integrate()` before `sim` is `const`-declared (M1). Works at runtime via closure; a refactor that calls integrate from a constructor-time path would TDZ-fault.
- `step(dt)` accepts but ignores `dt`. Documented; if framerate drops dramatically (background tab), the simulator runs slower in wall-clock time. Not framerate-independent.

Parking-lot items from the v2 spec that remain deferred:

- Barnes-Hut quadtree for charge/collision (would kick in around n ≥ 500)
- Auto-normalize per-level co-occurrence weights by total level duration
- Per-document layout overrides via `meta.layoutWeights` schema field
- "Watch the concept map assemble itself" replay mode
- Multi-finger drag / pinch-to-zoom on touch
- Sticky drag (long-press to pin permanently)
- Reheat on document mutation (requires VM diffing)
- Dev-only `?perf=1` overlay (avg/max `step()` ms, avg alpha, warm-iter count). The v2 design called for it as a verification gate; deferred at shipping time because `_maxVelocity` plus the rAF runaway guard cover the most-urgent observability needs. Re-open if a perf regression demands granular per-frame instrumentation.

---

*Captured 2026-05-11 after the v0.4.0 release. Future tuning rounds should append here as new sections rather than mutate the original v2 spec — the spec records the *design*; this addendum records the *as-shipped*.*
