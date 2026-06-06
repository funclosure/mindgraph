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
5. Keep the implementation model-agnostic and deterministic; no provider calls in this slice.

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

## Implementation notes

- Keep source extraction in `src/core/source.js` deterministic and dependency-free.
- Prefer improving existing HTML-to-text extraction before adding dependencies.
- Add tests with a local HTTP server serving HTML with several paragraphs/headings.
- Add tests for single-block HTML to ensure the warning fires.
- Add tests for `evaluateDigest` UX warnings.

## Success criteria

- A readable HTML article with multiple paragraphs becomes multiple transcript segments and micro frames.
- A collapsed single-block source produces an explicit UX-readiness warning.
- `digest evaluate --json` reports UX readiness.
- MCP build/evaluate tool responses include readiness signals.
- Existing smoke tests and digest tests continue to pass.
