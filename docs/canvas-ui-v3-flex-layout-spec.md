# Canvas UI v3 — Flex Layout + Icon Refresh Spec

**Status:** approved 2026-05-07. Successor to v2 (`canvas-ui-v2-reading-driven-spec.md`).

## Goal

Replace v2's floating-overlay layout with a structured CSS grid: a thin header on top, the graph canvas and the chapter strip stacked in the left column, the prose as a real right-side column. The chrome stops floating; the graph canvas is a real flex item whose pixel size equals the visible region.

Two reasons:
- **Camera bug.** With the prose floating over a full-window canvas, the camera's "viewport" was the whole window, so when the camera centered on a target it placed it behind the prose. A real flex layout makes `canvas.getBoundingClientRect()` already equal to the visible region. The camera math doesn't have to compensate.
- **Chrome polish.** The current header pill, the `⚙ ✕ ▶ ⌄ ●` text/emoji icons, and the floating panels all feel ad-hoc. v3 swaps the emoji glyphs for inline SVG icons (Lucide-style, hand-bundled, no dependency) and fits the chrome into a single thin header bar.

The reading-driven dynamic from v2 (cumulative reveal, bloom, scroll-to-playhead, click-bidirectional, drift, chapter jump) all carry over unchanged.

## Architecture

The pipeline (state → buildGraphRenderState → animator → draw) and the prose pipeline (chunks → renderProse → DOM) stay exactly as in v2. v3 changes the **layout** and the **chrome rendering** — nothing in the data or animation layer changes.

The new layout uses CSS Grid:

```
.app
├─ grid-template-columns: minmax(0, 1fr) auto       (graph col | prose col)
├─ grid-template-rows: auto minmax(0, 1fr) auto      (header | mid | strip)
└─ grid-template-areas:
     "header  prose"
     "graph   prose"
     "strip   prose"
```

The prose column spans all three rows on the right. The left column has the header on top, the graph in the middle (filling its cell), and the chapter strip on the bottom. The graph canvas is sized to its grid cell.

When the prose collapses, its column width goes to 0 (`display: none` on the prose element). The grid relayouts; the graph and strip naturally reflow to full width. No JavaScript layout math.

## Layout

```
┌────────────────────────────────────┬──────────┐
│  header (single thin row)          │          │
├────────────────────────────────────┤          │
│                                    │          │
│       graph canvas                 │  prose   │
│       (fills its grid cell)        │  column  │
│                                    │  (≈620   │
│                                    │   px)    │
│                                    │          │
├────────────────────────────────────┤          │
│  chapter strip (graph-width only)  │          │
└────────────────────────────────────┴──────────┘
```

**Header** — full width across the left column. Contains: title (left), speaker + duration (next), and on the right a small group of icon-only buttons. Default content: `[settings]` (view popover), `[panel-right-close]` (toggle prose). Background: very thin border-bottom, no rounded pill, no backdrop blur. Height ≈40 px.

**Graph canvas** — fills its grid cell. The animator's `applyDpr` already reads `canvas.getBoundingClientRect()`, so the canvas's pixel buffer matches its laid-out size automatically. Camera's viewport = canvas's box.

**Chapter strip** — same width as the graph column (since both occupy the grid's left column). Contents same as v2: `chapters` label, segment track, drift button, collapse button. Background: thin border-top, no pill, no blur. Height ≈40 px.

**Prose column** — fixed width (`auto` size from a CSS variable, default `min(620px, 44vw)`). Background flat dark, no blur. Internal layout same as v2: sticky header strip with close button, then chapters and paragraphs. Concept mention styling unchanged.

**View popover** — opened from the header's settings icon. Anchored under the icon (top-right of the header row). Content same as v2.

## Icons

A new module `ui/icons.js` exports inline SVG markup for each icon used in the chrome. Style: 18 × 18 viewport, 1.5-stroke `currentColor`, line-based, matches Lucide aesthetic. Paths borrowed from the Lucide source (MIT licensed).

Icons needed:
- `settings` — header settings button
- `panelRightClose` — header prose toggle (when prose is open)
- `panelRightOpen` — header prose toggle (when prose is collapsed)
- `play` — drift forward (replaces `▶`)
- `pause` — drift active (replaces `▶` highlighted state)
- `x` — close button inside prose (replaces `✕`)
- `chevronUp` / `chevronDown` — strip collapse (replaces `⌄ ●`)

Each export returns an SVG element node (or string) that consumers inject. The module is a pure utility — no state, no side effects.

## What Carries from v2 (unchanged)

- Reveal pipeline (cumulative + bloom)
- Reverse fade
- Camera lerp toward `cameraTarget`
- `cameraMode` transitions
- Scroll-to-playhead binding
- Click-bidirectional linking
- Chapter strip click-to-jump
- Drift-forward (button visual changes; mechanism unchanged)
- View popover with macro/meso/micro level toggle
- `firstSeenAt` derivation in view-model

## What Changes from v2

- **Layout:** floating overlays → CSS grid columns/rows. The `.overlay` rules disappear. Each section has its own grid area instead of `position: absolute`.
- **Header:** floating pill at top-of-window → flat thin row anchored to the grid's first row. Settings + prose-toggle icons live here.
- **Prose toggle:** the prose's `✕` button moves to the header. The prose's sticky internal header is dropped (saves vertical space, less duplicated chrome). Reopening the prose is via the same header button (now showing `panelRightOpen`).
- **Chapter strip:** "floating pill at the bottom" → flat thin row anchored to the grid's bottom-left cell. Width follows the graph column naturally.
- **Icons:** all `⚙ ✕ ▶ ⌄ ●` glyphs replaced with inline SVG (`ui/icons.js`).
- **Camera-fit math:** `applyDpr` already reads the canvas's actual bounding rect, so no code change. The camera *fix* is just a side effect of the layout — the canvas size now equals the visible area.
- **Topbar collapse:** removed. The header is already minimal; collapsing it doesn't free much space.

## Out of Scope

- Drag-to-resize the prose column (binary collapse only).
- Mobile / small-screen layout.
- Theme switching, light mode.
- Keyboard shortcuts.
- Animations on collapse (`display: none` snap is fine).

## Verification

Per project convention:

- `npm run ui:check` clean.
- Browser at `http://127.0.0.1:4173/`:
  - **Reload at t=0**: header thin row at top with title + speaker + 2 icons; graph fills the left middle area with seed clusters; chapter strip thin row below the graph; prose column on right with "Opening Convergences..." chapter and paragraphs.
  - **Click the graph** → hit-test still works; the camera lerps to the cluster — and the cluster is now centered in the *visible* graph area, not behind the prose.
  - **Scroll the prose down** → graph reveals concepts, camera follows. Behavior same as v2.
  - **Click the prose-toggle icon in the header** → prose hides; graph + strip expand to full width; icon switches from "panel-right-close" to "panel-right-open". Click again → prose returns.
  - **Click drift `play` icon** → drift starts; icon switches to `pause`. Click again → stops.
  - **Click chapter segment** → playhead jumps; prose smooth-scrolls; camera lerps.
  - **Click view-settings icon** → popover anchored under the icon; macro/meso/micro toggle.
  - **Resize the window** → graph and strip reflow with the left column; prose stays at its fixed width until window is small enough that the prose `vw` clamp shrinks it. No camera math glitches.
- Visual: no floating pills with backdrop blur; no emoji glyphs anywhere in the chrome; everything is one cohesive flat layout.
