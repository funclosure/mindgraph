# Article segmentation and UX-readiness design

- **Status:** approved through brainstorm
- **Date:** 2026-06-05
- **Context:** The first MCP/article trial succeeded structurally but imported a web article as one untimed segment, producing a valid graph that did not evolve meaningfully while reading.

## Problem

mindgraph currently treats readable web articles as extracted plain text. For some pages, extraction collapses the whole article into one block. The digest can still become semantically rich, but the reading experience degrades:

- one micro frame
- one meso frame
- one macro chapter
- all concepts appear at the same moment
- scroll-driven graph reveal has little value
- evaluation can pass while UX quality is poor

The agent noticed this manually. The tool should preserve article structure and warn when a source is not ready for a good mindgraph reading experience.

## Goals

1. Preserve article paragraph/heading structure during web import.
2. Ensure article digestion produces multiple transcript segments and frames when the source contains multiple paragraphs.
3. Add UX-readiness signals to evaluation, separate from schema validity and semantic quality.
4. Return actionable warnings through CLI and MCP so agents know when to resegment or adjust strategy.
5. Tune viewer layout so sparse article graphs remain visually cohesive instead of scattering disconnected components across the canvas.
6. Keep the implementation model-agnostic and deterministic; no provider calls in this slice.

## Non-goals

- Full browser-grade readability extraction.
- YouTube transcript fetching.
- PDF structural parsing.
- Built-in model auto-digest.
- Perfect semantic sectioning of all arbitrary webpages.

## Design

### 1. Article extraction should emit blocks

`src/core/source.js` should gain an article-block extraction path. Instead of only returning a flattened string, web import should preserve blocks such as:

- heading
- paragraph
- list item
- blockquote

The prepared text file should separate meaningful blocks with blank lines. The existing untimed transcript parser already treats paragraph blocks as separate segments, so preserving blank-line-separated blocks is enough to produce multiple frames.

Example prepared article text:

```text
Recursive Self-Improvement

Introduction

First paragraph...

Second paragraph...

Risks and Implications

Third paragraph...
```

### 2. Starter digest should report source/frame warnings

`buildStarterDigestOperation` should include a `readiness` object:

```js
{
  ux: {
    status: 'ready' | 'warning',
    warnings: [
      {
        code: 'single-segment-source',
        message: 'Source produced only one transcript segment; graph reveal will be flat.',
        recommendedAction: 'Provide paragraph-separated source text or re-run after improving extraction.'
      }
    ],
    counts: {
      transcriptSegments: 1,
      microFrames: 1,
      mesoFrames: 1,
      macroFrames: 0
    }
  }
}
```

Warnings should include at least:

- `single-segment-source` when transcript segment count is 1.
- `few-micro-frames` when micro frame count is below a small threshold, e.g. 3.
- `flat-concept-reveal` in evaluation when most activated atomic concepts share the same first-seen time.

### 3. Digest evaluation should include UX readiness

`evaluateDigest(doc)` should add a `ux` section:

```js
ux: {
  status: 'ready' | 'warning',
  warnings: UXReadinessWarning[],
  frameCounts: {
    micro: number,
    meso: number,
    macro: number
  },
  transcriptSegments: number,
  distinctAtomicFirstSeenTimes: number
}
```

This should not make a valid document invalid. It is a quality signal for agents and users.

### 4. CLI output should surface warnings

`mindgraph digest <source>` text output should print warnings after the frame counts:

```text
Warnings:
  - single-segment-source: Source produced only one transcript segment; graph reveal will be flat.
```

`mindgraph digest evaluate` should print a UX section. `--json` should include the full structured `ux` object.

### 5. MCP responses should carry readiness data

`mindgraph_build_starter_digest` already returns JSON text. The returned JSON should include the same `readiness` object. `mindgraph_evaluate_digest` should include `report.ux`.

This lets MCP agents adapt without relying on natural-language inference.

### 6. Viewer layout should use adaptive cohesion, not stronger global gravity

The current continuous layout allows disconnected or weakly connected components to drift too far apart. This is especially visible for article imports where the source may have sparse relations and weak temporal co-occurrence. However, testing the canonical Meaning Crisis sample shows the opposite failure mode: simply increasing global center gravity makes healthy dense graph regions feel too tight.

The layout fix should therefore be adaptive rather than a constant bump.

Desired behavior:

- Dense hubs, such as “Meaning Crisis”, keep enough local breathing room for labels and edges to remain legible.
- Sparse disconnected or weakly connected components do not drift far off-canvas or create large empty regions.
- The whole graph reads as a coherent field, but local clusters remain distinct.

Initial policy direction in `ui/layout.js`:

- Compute graph-shape signals during simulator setup: node count, relation density, connected component count, largest component ratio, and current warm-start bounds.
- Apply stronger cohesion only when the graph is fragmented or the warm-start bounds are too large relative to node count.
- Prefer a component-aware pull, e.g. gently pull each component centroid toward the global center, rather than applying the same inward force to every node.
- Keep node-level collision and unrelated-node separation strong enough that dense hubs do not collapse.
- Ensure unrelated-node repulsion is not weaker/shorter than relation attraction. In the current force model, relation springs target a rest length while unrelated separation only acts below a slightly smaller local floor, allowing unrelated nodes to sit inside a relationship corridor.
- Treat edge/corridor avoidance as the next layout design problem: if node C sits near the line segment A—B for an unrelated relation edge, it should be pushed away from that corridor rather than relying only on point-to-point node repulsion.
- Keep canonical dense documents as regression fixtures; they should not become tighter just because sparse article graphs need more cohesion.

The intended feel is:

```text
Sparse article graph before: small components scattered across the viewport with large empty regions.
Sparse article graph after: components remain distinct, but orbit closer to a shared visual center.
Dense Meaning Crisis graph before: readable clustered hubs.
Dense Meaning Crisis graph after: similarly readable; no global squeeze.
```

This is a viewer concern, not a document-schema concern. It should be verified against both sparse one-article graphs and the canonical sample document.

Follow-up layout principle: relationship edges should not behave like rigid sticks in empty space. The renderer should either protect the visual corridor around important edges or move toward a softer attraction-field model where relation proximity is encouraged without creating brittle fixed-length spokes.

## Implementation notes

- Keep source extraction in `src/core/source.js` deterministic and dependency-free.
- Prefer improving existing HTML-to-text extraction before adding dependencies.
- Add tests with a local HTTP server serving HTML with several paragraphs/headings.
- Add tests for single-block HTML to ensure the warning fires.
- Add tests for `evaluateDigest` UX warnings.
- Add or update layout tests for bounds/compactness so sparse disconnected graphs remain within a tighter radius after warm start.
- Run `npm run ui:check` and inspect the viewer with a sparse article graph screenshot/manual check.

## Success criteria

- A readable HTML article with multiple paragraphs becomes multiple transcript segments and micro frames.
- A collapsed single-block source produces an explicit UX-readiness warning.
- `digest evaluate --json` reports UX readiness.
- MCP build/evaluate tool responses include readiness signals.
- Sparse viewer graphs are visibly more centered and less scattered while still avoiding node overlap.
- Existing smoke tests, digest tests, layout tests, and UI syntax checks continue to pass.
