import {
  buildMindgraphViewModel,
} from '../src/view-model/buildMindgraphViewModel.js';
import { buildGraphRenderState } from '../src/view-model/buildGraphRenderState.js';
import { computeLayout } from './layout.js';
import { applyDpr, fitCameraToLayout } from './camera.js';
import { draw } from './draw.js';
import { bindEvents } from './events.js';
import { renderTimeline } from './panels/timeline.js';
import { renderInspector } from './panels/inspector.js';
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
  drawScheduled: false,
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
  state.layout = computeLayout(state.viewModel);
  state.playheadTime =
    state.viewModel.frames.macro[0]?.span.start ??
    state.viewModel.frames.meso[0]?.span.start ??
    0;
  state.viewport = applyDpr(canvas, ctx);
  fitCameraToLayout(state.camera, state.layout, state.viewport);
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
  updateInspectorPanel();
  updateTimelinePanel();
  scheduleDraw();
  bindEvents(state, render, scheduleDraw);
}

function scheduleDraw() {
  if (state.drawScheduled) return;
  state.drawScheduled = true;
  requestAnimationFrame(() => {
    state.drawScheduled = false;
    drawAll();
  });
}

function drawAll() {
  draw(ctx, state);
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
  });
}

function updateTopbar() {
  const titleEl = document.getElementById('topbar-title');
  const statusEl = document.getElementById('topbar-status');
  const vm = state.viewModel;
  if (titleEl) titleEl.innerHTML =
    `<h1>${escapeHtml(vm.documentMeta.title)}</h1>` +
    `<p class="muted">${escapeHtml((state.document.transcript?.speakers || []).join(', ') || 'Unknown speaker')} · ${formatTime(vm.documentMeta.durationSeconds)} total · ${vm.documentMeta.counts.atomicConcepts} atomic concepts</p>`;
  if (statusEl) {
    const grs = state.graphRenderState;
    const activeFrame = vm.selectors.getActiveFrameAtTime(state.activeLevel, state.playheadTime);
    const viewportMode = grs?.viewportMode ?? 'overview';
    const focusMode = grs?.focusMode ?? 'playhead';
    let contextLabel;
    if (state.selectedConceptId) {
      const concept = vm.concepts.byId?.[state.selectedConceptId];
      contextLabel = concept ? concept.label : state.selectedConceptId;
    } else if (state.selectedFrameRef) {
      contextLabel = `${state.selectedFrameRef.level} ${state.selectedFrameRef.index + 1}`;
    } else {
      contextLabel = activeFrame ? `${state.activeLevel} ${activeFrame.ref.index + 1}` : `${state.activeLevel} —`;
    }
    const liveOrFrame = state.selectedFrameRef ? 'Frame' : state.selectedConceptId ? 'Concept' : 'Live';
    statusEl.textContent = `${liveOrFrame} · ${contextLabel} · ${viewportMode} · ${focusMode}`;
  }
}

function updateInspectorPanel() {
  const el = document.getElementById('inspector-panel');
  if (!el) return;
  el.innerHTML = renderInspector(state.viewModel, state);
}

function updateTimelinePanel() {
  const el = document.getElementById('timeline-panel');
  if (!el) return;
  const activeFrames = state.viewModel.selectors.getActiveFramesAtTime(state.playheadTime);
  el.innerHTML = renderTimeline(
    state.viewModel,
    activeFrames,
    state.graphRenderState ?? { viewportMode: 'overview', focusMode: 'none' },
    state,
  );
}
