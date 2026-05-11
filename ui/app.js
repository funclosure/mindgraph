import {
  buildMindgraphViewModel,
} from '../src/view-model/buildMindgraphViewModel.js';
import { buildGraphRenderState } from '../src/view-model/buildGraphRenderState.js';
import { createLayoutSimulator } from './layout.js';
import { applyDpr, fitCameraToLayout } from './camera.js';
import { draw } from './draw.js';
import { bindEvents } from './events.js';
import { createAnimator } from './animator.js';
import { buildProseChunks } from '../src/view-model/buildProseChunks.js';
import { renderProse } from './panels/prose.js';
import { renderChapterStrip } from './panels/chapter-strip.js';
import { renderTopbar } from './panels/topbar.js';
import { renderViewPopover } from './panels/view-popover.js';
import { attachScrollBinding } from './scroll-binding.js';

// The dev server (src/ui/dev-server.js) serves whichever mindgraph
// document was passed via its --doc flag — or the canonical sample by
// default — at /doc.json. The UI doesn't need to know the path on disk.
const DOC_PATH = '/doc.json';

const canvas = document.getElementById('stage');
const ctx = canvas.getContext('2d');

// ---------------------------------------------------------------------------
// Single source of truth
// ---------------------------------------------------------------------------

const state = {
  document: undefined,
  viewModel: undefined,
  sim: undefined,                     // the live simulator; layout is a getter defined below
  // layout is now a getter; defined via Object.defineProperty after sim exists in bootstrap()
  graphRenderState: undefined,
  selectedConceptId: undefined,
  hoveredConceptId: undefined,
  selectedFrameRef: undefined,
  playheadTime: 0,
  activeLevel: 'macro',
  isPlaying: false,
  viewPopoverOpen: false,
  prosCollapsed: false,
  camera: { zoom: 1, pan: { x: 0, y: 0 } },
  viewport: { width: 0, height: 0 },
  cameraMode: 'auto',
  animator: undefined,
  animationLoopActive: false,
  proseChunks: undefined,
};

// ---------------------------------------------------------------------------
// Bootstrap
// ---------------------------------------------------------------------------

bootstrap().catch((error) => {
  console.error(error);
});

async function bootstrap() {
  const response = await fetch(DOC_PATH);
  if (!response.ok) throw new Error(`HTTP ${response.status} loading ${DOC_PATH}`);
  state.document = await response.json();
  state.viewModel = buildMindgraphViewModel(state.document);
  state.proseChunks = buildProseChunks(state.viewModel);
  state.sim = createLayoutSimulator(state.viewModel);
  Object.defineProperty(state, 'layout', {
    get() {
      return {
        nodes: state.sim.positions,
        bounds: state.sim.bounds,
      };
    },
    configurable: true,
  });
  state.playheadTime =
    state.viewModel.frames.macro[0]?.span.start ??
    state.viewModel.frames.meso[0]?.span.start ??
    0;
  state.viewport = applyDpr(canvas, ctx);
  // Initial fit uses the layout-fitter as a sensible start; the animator
  // will then lerp from there to the cameraTarget on the next frame.
  fitCameraToLayout(state.camera, state.layout, state.viewport);
  state.cameraMode = 'auto';
  state.animator = createAnimator();
  render();
  document.querySelector('.app').dataset.proseCollapsed = String(state.prosCollapsed);

  // Re-apply DPR + redraw whenever the canvas's box changes — window
  // resize, prose toggle, future drag-resize, all unified through one
  // ResizeObserver. rAF-coalesced so back-to-back layout shifts produce
  // a single re-fit.
  let resizeQueued = false;
  const onCanvasResize = () => {
    if (resizeQueued) return;
    resizeQueued = true;
    requestAnimationFrame(() => {
      resizeQueued = false;
      state.viewport = applyDpr(canvas, ctx);
      kickAnimationLoop();
    });
  };
  const ro = new ResizeObserver(onCanvasResize);
  ro.observe(canvas);

  attachScrollBinding({
    container: document.getElementById('prose'),
    getState: () => state,
    onChange: render,
  });

  console.info('mindgraph canvas POC ready', {
    nodes: Object.keys(state.layout.nodes).length,
  });
}

// ---------------------------------------------------------------------------
// Render orchestrator
// ---------------------------------------------------------------------------

function render() {
  if (!state.viewModel) return;
  state.graphRenderState = computeGraphRenderState();
  updateTopbar();
  updateProsePanel();
  updateChapterStrip();
  updateViewPopover();
  kickAnimationLoop();
  bindEvents(state, render, kickAnimationLoop);
}

// If the rAF loop runs this many consecutive frames without settling, something
// is wrong (sim oscillating, ResizeObserver loop, etc.). Force-stop and warn
// once so the failure surfaces instead of silently burning a CPU core. 1800
// frames ≈ 30 s at 60 fps; typical settle is <1 s after the last reheat, so
// this guard is far above any healthy steady-state.
const ANIMATION_LOOP_RUNAWAY_FRAMES = 1800;

function kickAnimationLoop() {
  if (state.animationLoopActive) return;
  state.animationLoopActive = true;
  let lastT = performance.now();
  let runawayFrames = 0;
  function tick(now) {
    const dt = Math.min(0.1, (now - lastT) / 1000);
    lastT = now;
    const stillAnimating = state.animator.step(now / 1000, {
      cumulativeVisibleConceptIds: state.graphRenderState?.cumulativeVisibleConceptIds ?? [],
      cumulativeVisibleEdgeIds: state.graphRenderState?.cumulativeVisibleEdgeIds ?? [],
      cameraTarget: state.graphRenderState?.cameraTarget,
      cameraMode: state.cameraMode,
      camera: state.camera,
      viewport: state.viewport,
      activeLevel: state.activeLevel,
      sim: state.sim,
      dt,
    });
    draw(ctx, state);
    if (stillAnimating) {
      runawayFrames += 1;
      if (runawayFrames >= ANIMATION_LOOP_RUNAWAY_FRAMES) {
        console.warn(
          `mindgraph: animation loop ran ${ANIMATION_LOOP_RUNAWAY_FRAMES} frames without settling; force-stopping. ` +
          `If this happens repeatedly, the simulator's stability margin may be too tight for this document — ` +
          `try raising SUBSTEPS in ui/layout.js.`,
        );
        state.animationLoopActive = false;
        return;
      }
      requestAnimationFrame(tick);
    } else {
      state.animationLoopActive = false;
    }
  }
  requestAnimationFrame(tick);
}

// ---------------------------------------------------------------------------
// Panel updaters
// ---------------------------------------------------------------------------

function computeGraphRenderState() {
  return buildGraphRenderState(state.viewModel, {
    selectedConceptId: state.selectedConceptId,
    selectedFrameRef: state.selectedFrameRef,
    playheadTime: state.playheadTime,
    activeLevel: state.activeLevel,
    zoomLevel: state.camera.zoom,
    layout: state.layout,
    viewport: state.viewport,
  });
}

function updateTopbar() {
  const el = document.getElementById('topbar');
  if (!el) return;
  el.innerHTML = renderTopbar(state.viewModel, state.document, state);
}

function updateProsePanel() {
  const el = document.getElementById('prose');
  if (!el) return;
  // Save scrollTop across innerHTML replacement (carried from v2 Task 8 fix).
  const saved = el.scrollTop;
  el.innerHTML = renderProse(state.proseChunks ?? [], state);
  el.scrollTop = saved;
}

function updateChapterStrip() {
  const el = document.getElementById('chapter-strip');
  if (!el) return;
  el.innerHTML = renderChapterStrip(state.viewModel, state);
}

function updateViewPopover() {
  const el = document.getElementById('view-popover');
  if (!el) return;
  el.innerHTML = renderViewPopover(state);
}
