# Canvas UI v2 — Reading-Driven Spec

**Status:** approved 2026-05-07. Successor to v1.5 (`canvas-ui-v1.5-evolving-graph-spec.md`).

## Goal

Reframe mindgraph from a "watch the lecture unfold" surface into a **reading surface**. The graph fills the window as a background map. The right side is an overlay panel showing the source as **cohesive prose** — chapters, paragraphs, no timestamps in view. The user reads at their own pace; scroll position drives the playhead; the graph reveals concepts as they are introduced. There is no required "play" mode.

The current v1.5 inspector — stats, recurrence numbers, related-concept lists — is replaced. Those numbers are useful but they are not how a learner grounds an idea. The original prose is. The structured-info side panel is gone in v2.

The point: time is internal plumbing for mapping concepts to text positions; the user only sees the natural flow of thinking. Works the same for timed sources (lectures, podcasts) and untimed sources (articles, papers).

## Architecture

The v1.5 pipeline stays:

```
state → buildGraphRenderState (pure)
     → animator (rAF, per-frame interp)
     → draw (canvas)
```

v2 adds a **prose-scroll-to-playhead** binding and a **prose layer** (DOM, not canvas):

```
prose scroll → readingPosition → playheadTime (state)
                                      ↓
                            buildGraphRenderState (pure)
                                      ↓
                                  animator → draw
```

The prose panel is plain DOM (HTML + CSS). Concept-mention markup is injected per-paragraph by a small renderer that reads the document's transcript segments + concept references. The graph below stays canvas. Two surfaces, one playhead.

## Layout

The window is divided into one full-window canvas and three floating overlays. Each overlay is collapsible.

```
┌──────────────────────────────────────────────────────┐
│  ▏ Awakening from the Meaning Crisis · John Vervaeke │  ← topbar
├──────────────────────────────────────────────────────┤
│                                                      │
│       (graph clusters, atomic nodes, edges          │
│        rendered to canvas — full window)            │
│                                  ┌─────────────────┐ │
│                                  │  2. Dark        │ │
│                                  │  Factors,       │ │
│                                  │  Crisis...      │ │
│                                  │                 │ │  ← prose
│                                  │  The lecture    │ │    overlay
│                                  │  turns toward   │ │    (right,
│                                  │  the dark side: │ │    ≈620 px)
│                                  │  mental         │ │
│                                  │  illness...     │ │
│                                  └─────────────────┘ │
│                                                      │
├──────────────────────────────────────────────────────┤
│  chapters  ▏▎▏▎▎▎▎▎▎▎▎▎▎▎▎▎▎▎▎▎▎▎▎▎  ▶  drift     │  ← bottom strip
└──────────────────────────────────────────────────────┘
```

**Topbar** — thin floating pill at the top edge (~38 px). Document title, speaker, total duration. Click ⌄ to collapse to a small dot (still tappable to expand). Default open.

**Graph** — fills the entire window. The prose overlay sits on top; the graph remains visible to the left of the prose and slightly dimmed underneath (the prose has a translucent background but its own opaque inner panel, so the graph is partly visible behind the panel's edges). The graph is interactive even with prose open.

**Prose overlay** — right-aligned, ≈620 px wide, full canvas height minus the chrome. Solid dark inner panel (readable text needs solid background); thin border + soft drop shadow blend it against the graph. Default open.

**Bottom chapter strip** — thin floating pill at the bottom edge (~38 px). Macro chapters as proportional segments. Active chapter glows. Click a segment to jump the playhead (and scroll the prose to that chapter). The drift-forward button (▶) is anchored at the right end of the strip.

Collapse rules:
- Topbar collapse: title becomes a small dot at top-left.
- Prose collapse: panel slides off the right edge; a thin "Read" handle/tab on the right edge expands it back.
- Bottom strip collapse: the strip becomes a thin progress bar (no chapter ticks); click anywhere to expand.

## Prose Format

The prose is rendered from `transcript.segments`, joined and broken into paragraphs and chapters using the existing frame structure.

**Chapter heading** comes from each macro frame's `title` (e.g., "2. Dark Factors, Crisis, and the Turn to Wisdom"). Macro frames are the chapter boundary.

**Paragraph break** triggers in this order:
1. Speaker change between adjacent micro segments.
2. Otherwise, when the running paragraph has accumulated about **150 words** of single-speaker prose. The exact threshold is approximate; we don't break mid-sentence — the next sentence boundary closes the paragraph.

Inside a paragraph, sentences flow. No bullet marks. No `[10:16] John Vervaeke:` prefixes.

**Concept mentions** are detected from the document's existing concept structure: for each concept `c` and each transcript segment `s`, if `s.id` ∈ `vm.indexes.conceptToTranscriptSegmentIds[c.id]`, then the concept's label (and aliases) are wrapped in the prose as a clickable span:

```html
<span class="concept" data-concept-id="meaning-crisis-core">meaning crisis</span>
```

Visual style:
- Default mention: muted gold underline (`color: var(--gold-muted)`, `border-bottom: 1px dotted`)
- **Active mention** (concept is in the active frame's foreground at the current playhead): brighter gold + soft background tint
- **Selected mention** (concept is currently selected via click): brightest gold, solid underline, small focus ring

Multiple mentions of the same concept across paragraphs are independently styled — each occurrence gets the appropriate style based on the global active/selected state.

## Reading-Driven Coupling (scroll → playhead)

The prose panel is the primary navigation surface. As the user scrolls, the system reads which paragraph is closest to the **vertical center** of the panel's viewport — specifically, the paragraph whose box most closely overlaps the center line; if the center line falls in the gap between two paragraphs, the paragraph above wins. That paragraph maps to a time span (the union of its source segment spans). The playhead is set to the **start time** of that span.

```
prose-scroll → centered-paragraph → time-span → playheadTime
```

The mapping fires on every scroll event, throttled to ≤60 Hz via rAF. Bloom and fade animations from v1.5 work as before — if the user scrolls forward fast, concepts cross their `firstSeenAt` thresholds and bloom in batch. If they scroll back, concepts fade out. The animator is already idempotent; this just exercises it from a new input source.

**No play button**, no scrubber. Time is plumbing. The drift-forward button (described below) is the only "auto" affordance.

**Chapter jump**: clicking a segment in the bottom chapter strip sets the playhead to that macro frame's `span.start` AND smooth-scrolls the prose to the chapter heading. The two are bound: a chapter jump on the strip = prose scroll = playhead change.

## Bidirectional Linking (graph ↔ prose)

**Click a concept on the graph:**
1. Selection set: `selectedConceptId = clicked.id`.
2. Camera enters `selection` mode and lerps to the concept's parent cluster (v1.5 behavior).
3. Prose **smooth-scrolls** to the concept's first mention (`firstSeenAt`). Smooth-scroll duration ≈ 400 ms ease-out. The scroll updates the playhead automatically via the reading-driven binding, so cumulative reveal catches up if needed.
4. All mentions of the concept in the prose glow brighter (selected style).

**Click a concept word in the prose:**
1. Selection set: `selectedConceptId = data-concept-id of the clicked span`.
2. Camera enters `selection` mode and lerps to the concept on the graph.
3. The prose stays where it is (you clicked a word in your current view; you don't want to be teleported elsewhere).
4. All mentions glow brighter.

**Click a frame segment in the bottom chapter strip:** as described above (chapter jump). `selectedFrameRef` is set; `cameraMode = 'selection'`; camera lerps; prose smooth-scrolls to the chapter heading.

**Click empty area on the graph:** selection clears, `cameraMode = 'auto'`, mentions return to default style.

**Reset button** (still exists, top-right of graph or in a small overlay): clears selection, `cameraMode = 'auto'`, no prose change.

## Drift-Forward

A small ▶ button at the right end of the bottom chapter strip. Click toggles auto-scroll.

When ON, the prose smooth-scrolls **downward at the speech rate** of the source — i.e., the rate at which the reader's scroll position naturally crosses through time matches real-time playback. For timed sources this is the actual speech pace; for untimed sources it uses the producer's `wordsPerMinute` (defaults to 150 wpm).

Manual scroll while drifting cancels drift. Click the button again to re-engage. Drift never auto-restarts; it's an explicit user gesture.

## Camera Behaviour (carries v1.5)

Camera target derivation (`cameraTarget`), exponential-damping lerp (~700 ms), `cameraMode` transitions (`auto` / `manual` / `selection`), and 5-frame moving-average smoothing at micro level — all stay as in v1.5. Nothing changes in `buildGraphRenderState` for camera logic.

The macro/meso/micro **level toggle** still exists; it controls camera cadence (which level's foreground concepts drive the camera target). It's moved out of the bottom chapter strip and into a small "View" popover anchored at the top-right corner of the graph (a single icon button). Default macro. Most users won't open this.

## Untimed Sources

The view-model and frames already handle untimed sources via `wordsPerMinute`-derived synthetic timestamps. The reading-driven model needs no special case: scroll → centered paragraph → its time span → playhead. The user never sees a timestamp.

Verification: ingest an article with `mindgraph ingest transcript --mode untimed article.txt`, build through to macro frames, load in the v2 UI. The reading experience should be indistinguishable from a lecture (other than the lack of speaker tags inside paragraphs).

## What Goes Away from v1.5

- The structured inspector panel (the right-side "Stats / Active concepts / Strongest frames / Transcript grounding" panel) — replaced by the prose overlay.
- The big bottom timeline panel (Play, ←, →, scrubber, time display, level toggle in-place) — replaced by the thin chapter strip + drift-forward button. Level toggle moves to the View popover.
- The "topbar status pill" showing `Live · macro 1 · overview · playhead` — gone in v2. Status is implicit in selection visuals.

## Out of Scope

- Speaker switching across panels (e.g., Q&A transcripts where speakers alternate frequently). v2 handles speaker change via paragraph break, but does not show speaker names inline. Add speaker chips later if the use case demands.
- Searching the prose. Useful but separable.
- Annotations / notes. Useful but separable.
- Multi-document side-by-side reading. Out.
- Mobile / small screen layout. v2 is desktop-first; small-screen handling is later.
- Collapse animations beyond simple slide / fade. Polish later.
- Hover preview (highlight on hover without click). Useful polish; settle in a later round.
- Mid-paragraph highlight of the exact sentence at the playhead. Possible refinement; default is paragraph-grain.

## Verification

Per project convention:

- `npm run vm:example` should still run.
- `npm run ui:check` for module syntax.
- `npm run ui:dev` and in browser:
  - **Reload at t=0**: graph fills window; prose panel open on right; first chapter heading + opening paragraph visible; seed concepts visible on graph.
  - **Scroll the prose down**: graph reveals concepts as they appear in the text; bloom and fade animate as in v1.5; camera lerps between cluster regions following the active frame's foreground.
  - **Scroll up**: concepts fade out below the new playhead.
  - **Click a concept word in the prose**: camera flies to it on the graph; all mentions glow.
  - **Click a concept on the graph**: prose smooth-scrolls to first mention; mentions glow.
  - **Click a chapter segment in the bottom strip**: playhead jumps; prose scrolls to chapter heading; camera lerps.
  - **Click the drift ▶ button**: prose begins auto-scrolling at speech rate; click again to stop; manual scroll cancels.
  - **Collapse the prose** (handle on right edge): graph fills the entire window; the right-edge handle remains visible to expand again.
  - **Collapse the topbar / bottom strip**: each shrinks to a thin dot/line.
  - **Untimed source**: load an article via the producer pipeline (`--mode untimed`), open in the UI, verify the reading experience is the same.

No new test runner. Visual verification via Playwright screenshots, as in v1 / v1.5.
