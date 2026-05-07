import {
  buildMindgraphViewModel,
} from '../src/view-model/buildMindgraphViewModel.js';
import { buildGraphRenderState } from '../src/view-model/buildGraphRenderState.js';
import { computeLayout } from './layout.js';
import { applyDpr, fitCameraToLayout } from './camera.js';
import { draw } from './draw.js';
import { bindEvents } from './events.js';
import { createAnimator } from './animator.js';
import { buildProseChunks } from '../src/view-model/buildProseChunks.js';
import { renderProse } from './panels/prose.js';
import { escapeHtml, formatTime } from './util.js';

const DOC_PATH = '../examples/out/episode-1-built.mindgraph.json';

const canvas = document.getElementById('stage');
const ctx = canvas.getContext('2d');

// ---------------------------------------------------------------------------
// Single source of truth
// ---------------------------------------------------------------------------

const state = {
  document: undefined,
  viewModel: undefined,
  layout: undefined,
  graphRenderState: undefined,
  selectedConceptId: undefined,
  selectedFrameRef: undefined,
  playheadTime: 0,
  activeLevel: 'macro',
  isPlaying: false,
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
  state.layout = computeLayout(state.viewModel);
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

  // Re-apply DPR + redraw on viewport / display changes so the canvas
  // stays sharp on resize and across displays with different DPR.
  let resizeQueued = false;
  window.addEventListener('resize', () => {
    if (resizeQueued) return;
    resizeQueued = true;
    requestAnimationFrame(() => {
      resizeQueued = false;
      state.viewport = applyDpr(canvas, ctx);
      scheduleDraw();
    });
  });

  console.info('mindgraph canvas POC ready', {
    clusters: state.layout.clusters.map((c) => ({ id: c.id, label: c.label })),
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

function kickAnimationLoop() {
  if (state.animationLoopActive) return;
  state.animationLoopActive = true;
  let lastT = performance.now();
  function tick(now) {
    const dt = Math.min(0.1, (now - lastT) / 1000);
    lastT = now;
    const stillAnimating = state.animator.step(now / 1000, {
      cumulativeVisibleConceptIds: state.graphRenderState?.cumulativeVisibleConceptIds ?? [],
      cumulativeVisibleClusterIds: state.graphRenderState?.cumulativeVisibleClusterIds ?? [],
      cumulativeVisibleEdgeIds: state.graphRenderState?.cumulativeVisibleEdgeIds ?? [],
      cameraTarget: state.graphRenderState?.cameraTarget,
      cameraMode: state.cameraMode,
      camera: state.camera,
      viewport: state.viewport,
      activeLevel: state.activeLevel,
      dt,
    });
    draw(ctx, state);
    if (stillAnimating) {
      requestAnimationFrame(tick);
    } else {
      state.animationLoopActive = false;
    }
  }
  requestAnimationFrame(tick);
}

// Backwards-compat shim during transition: any callsite that still calls
// scheduleDraw() should now kick the animation loop. After all callsites
// are updated to call render() (which kicks the loop), this can be removed.
function scheduleDraw() {
  kickAnimationLoop();
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
  const el = document.getElementById('topbar-overlay');
  if (!el) return;
  const vm = state.viewModel;
  const speakers = (state.document.transcript?.speakers ?? []).join(', ') || 'Unknown speaker';
  el.innerHTML =
    `<div><h1>${escapeHtml(vm.documentMeta.title)}</h1></div>` +
    `<div class="meta">${escapeHtml(speakers)} · ${formatTime(vm.documentMeta.durationSeconds)}</div>`;
}

function updateProsePanel() {
  const el = document.getElementById('prose-overlay');
  if (!el) return;
  el.innerHTML = renderProse(state.proseChunks ?? [], state);
}

function updateChapterStrip() {
  // Filled in by Task 7. Leave the overlay empty for now.
  const el = document.getElementById('chapter-strip-overlay');
  if (el && !el.dataset.chapterStripBound) el.innerHTML = '';
}

function updateViewPopover() {
  // Filled in by Task 9.
  const el = document.getElementById('view-popover-overlay');
  if (el && !el.dataset.viewPopoverBound) el.innerHTML = '';
}
