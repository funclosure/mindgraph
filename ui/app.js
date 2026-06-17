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
import { renderOverviewStrip } from './panels/overview-strip.js';
import { renderTopbar } from './panels/topbar.js';
import { renderViewPopover } from './panels/view-popover.js';
import { renderDigestInspector } from './panels/digest-inspector.js';
import { attachScrollBinding } from './scroll-binding.js';
import { createLayoutDebugPanel } from './layout-debug-panel.js';
import { registry } from '../src/operations/index.js';
import { renderDeepenThread } from './panels/deepen-thread.js';

// The dev server (src/ui/dev-server.js) serves whichever mindgraph
// document was passed via its --doc flag — or the canonical sample by
// default. Source-first authoring markdown is exposed at /doc.md and
// compiled to a runtime document IN THE BROWSER via the shared
// core/operations catalog; precompiled documents are served at /doc.json.
const DOC_PATH = '/doc.json';
const DOC_MARKDOWN_PATH = '/doc.md';
const DEBUG_LAYOUT = new URLSearchParams(window.location.search).has('debugLayout');

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
  digestExpanded: false,
  playheadTime: 0,
  activeLevel: 'macro',
  viewPopoverOpen: false,
  prosCollapsed: false,
  camera: { zoom: 1, pan: { x: 0, y: 0 } },
  viewport: { width: 0, height: 0 },
  cameraMode: 'auto',
  animator: undefined,
  animationLoopActive: false,
  proseChunks: undefined,
  sourceTab: 'source',
  deepen: { entries: [], busy: false, canUndo: false },
};

// ---------------------------------------------------------------------------
// Bootstrap
// ---------------------------------------------------------------------------

bootstrap().catch((error) => {
  console.error(error);
});

// Load the document the dev server is serving. If source-first authoring
// markdown is available at /doc.md, compile it to a runtime document IN THE
// BROWSER using the shared core/operations catalog — the exact same code the
// CLI runs. Otherwise fall back to a precompiled document at /doc.json.
async function loadDocument() {
  const mdResponse = await fetch(DOC_MARKDOWN_PATH);
  if (mdResponse.ok) {
    const markdown = await mdResponse.text();
    const result = registry.run('compile', { markdown });
    if (!result.ok) {
      throw new Error(`In-browser compile failed: ${result.errors.map((e) => e.message).join('; ')}`);
    }
    console.info('mindgraph: compiled source-first markdown in-browser via core/operations', {
      valid: result.value.validation.ok,
    });
    return result.value.document;
  }
  const response = await fetch(DOC_PATH);
  if (!response.ok) throw new Error(`HTTP ${response.status} loading ${DOC_PATH}`);
  return response.json();
}

async function bootstrap() {
  state.document = await loadDocument();
  state.viewModel = buildMindgraphViewModel(state.document);
  if (state.document.kind === 'mindgraph.source-first') {
    state.activeLevel = 'readerStep';
  }
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
    state.viewModel.sourceFlow?.overview?.[0]?.span.start ??
    state.viewModel.sourceFlow?.sections?.[0]?.span.start ??
    state.viewModel.frames?.macro?.[0]?.span.start ??
    state.viewModel.frames?.meso?.[0]?.span.start ??
    0;
  state.viewport = applyDpr(canvas, ctx);
  // Initial fit uses the layout-fitter as a sensible start; the animator
  // will then lerp from there to the cameraTarget on the next frame.
  fitCameraToLayout(state.camera, state.layout, state.viewport);
  state.cameraMode = 'auto';
  state.animator = createAnimator();
  if (DEBUG_LAYOUT) {
    createLayoutDebugPanel({
      sim: state.sim,
      animator: state.animator,
      onChange: () => {
        fitCameraToLayout(state.camera, state.layout, state.viewport);
        kickAnimationLoop();
      },
    });
  }
  render();
  bindProseTabs();
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
    container: document.getElementById('prose-source'),
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
  updateDeepenPanel();
  updateOverviewStrip();
  updateViewPopover();
  updateDigestInspector();
  kickAnimationLoop();
  bindEvents(state, render, kickAnimationLoop);
}

// Rebuild the whole reactive chain from a freshly-produced document and redraw.
// Used after a deepen (see applyDeepenedDocument) and after undo.
function rebuildFromDocument(nextDocument) {
  state.document = nextDocument;
  state.viewModel = buildMindgraphViewModel(nextDocument);
  state.proseChunks = buildProseChunks(state.viewModel);
  state.sim = createLayoutSimulator(state.viewModel);
  state.viewport = applyDpr(canvas, ctx);
  fitCameraToLayout(state.camera, state.layout, state.viewport);
  state.cameraMode = 'auto';
  render();
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
      highlightTargets: computeHighlightTargets(state),
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

function computeHighlightTargets(state) {
  // Per-atom target alpha + tint for the easing pass in the animator. Tier
  // semantics: selected wins (alpha 1), then active (alpha 0.95 + tint 1),
  // then dimmed (alpha 0.22), else revealed default (alpha 0.85). The values
  // mirror the inline cascade that drawAtomicNodes previously hard-coded —
  // moving them here lets the animator ease between them across frames.
  const grs = state.graphRenderState;
  if (!grs) return undefined;
  const visible = grs.visibleNodeIds ?? [];
  if (!visible.length) return {};
  const active = new Set(grs.activeNodeIds ?? []);
  const dimmed = new Set(grs.dimmedNodeIds ?? []);
  const selected = new Set(grs.selectedNodeIds ?? []);
  const out = {};
  for (const id of visible) {
    const isSelected = selected.has(id);
    const isActive = active.has(id);
    const isDimmed = dimmed.has(id);
    out[id] = {
      alpha: isSelected ? 1.0 : isActive ? 0.95 : isDimmed ? 0.22 : 0.85,
      tint: isActive ? 1.0 : 0.0,
    };
  }
  return out;
}

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

function bindProseTabs() {
  document.querySelectorAll('.prose-tab').forEach((btn) => {
    btn.addEventListener('click', () => setSourceTab(btn.dataset.tab));
  });
}

function setSourceTab(tab) {
  state.sourceTab = tab;
  document.getElementById('tab-source')?.classList.toggle('is-active', tab === 'source');
  document.getElementById('tab-deepen')?.classList.toggle('is-active', tab === 'deepen');
  document.getElementById('prose-source')?.classList.toggle('is-hidden', tab !== 'source');
  document.getElementById('prose-deepen')?.classList.toggle('is-hidden', tab !== 'deepen');
}

function updateProsePanel() {
  const el = document.getElementById('prose-source');
  if (!el) return;
  // Save scrollTop across innerHTML replacement (carried from v2 Task 8 fix).
  const saved = el.scrollTop;
  el.innerHTML = renderProse(state.proseChunks ?? [], state);
  el.scrollTop = saved;
}

// ---------------------------------------------------------------------------
// Deepen tab — node-anchored conversation
// ---------------------------------------------------------------------------

let lastDeepenAnchor;

function updateDeepenPanel() {
  const el = document.getElementById('prose-deepen');
  if (!el) return;
  const conceptId = state.selectedConceptId;
  // When the anchored concept changes, reset the thread and reveal the tab.
  if (conceptId && conceptId !== lastDeepenAnchor) {
    lastDeepenAnchor = conceptId;
    state.deepen = { entries: [], busy: false, canUndo: false };
    setSourceTab('deepen');
  }
  const concept = conceptId ? state.viewModel?.concepts?.byId?.[conceptId] : null;
  el.innerHTML = renderDeepenThread({
    conceptId,
    conceptLabel: concept?.label ?? conceptId ?? '',
    busy: state.deepen.busy,
    entries: state.deepen.entries,
    canUndo: state.deepen.canUndo,
  });
  bindDeepenControls();
}

function bindDeepenControls() {
  const run = document.querySelector('[data-action="deepen-run"]');
  if (run) run.addEventListener('click', () => {
    const prompt = document.getElementById('deepen-prompt')?.value?.trim() || '';
    runDeepen(state.selectedConceptId, prompt);
  });
  const undo = document.querySelector('[data-action="deepen-undo"]');
  if (undo) undo.addEventListener('click', runUndo);
  const input = document.getElementById('deepen-prompt');
  if (input) input.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      runDeepen(state.selectedConceptId, input.value.trim());
    }
  });
}

function pushDeepen(role, text) {
  state.deepen.entries.push({ role, text });
  updateDeepenPanel();
}

function applyDeepenedDocument(nextDocument, anchorId) {
  rebuildFromDocument(nextDocument);
  // Keep the deepened concept selected so it stays highlighted as the anchor.
  // NOTE: a full rebuild starts a fresh layout, so true in-place "local growth"
  // (preserving neighbor positions, captureAnchor) is a follow-up; for now the
  // rebuild reveals the updated graph.
  if (anchorId && state.viewModel?.concepts?.byId?.[anchorId]) {
    state.selectedConceptId = anchorId;
    render();
  }
}

function runDeepen(conceptId, prompt) {
  if (!conceptId || state.deepen.busy) return;
  state.deepen.busy = true;
  if (prompt) pushDeepen('you', prompt);
  pushDeepen('agent', `Deepening “${conceptId}” …`);
  const qs = new URLSearchParams({ concept: conceptId });
  if (prompt) qs.set('prompt', prompt);
  const source = new EventSource(`/deepen?${qs.toString()}`);
  const finish = () => { source.close(); state.deepen.busy = false; updateDeepenPanel(); };
  source.addEventListener('progress', (event) => {
    try { pushDeepen('agent', JSON.parse(event.data).message); } catch { /* ignore */ }
  });
  source.addEventListener('document', (event) => {
    try {
      applyDeepenedDocument(JSON.parse(event.data).document, conceptId);
      pushDeepen('result', 'Applied. Graph updated.');
      state.deepen.canUndo = true;
    } catch (error) {
      pushDeepen('error', `Failed: ${error.message}`);
    }
    finish();
  });
  source.addEventListener('error', (event) => {
    let message = 'connection lost';
    try { message = JSON.parse(event.data).message; } catch { /* native error has no data */ }
    pushDeepen('error', `Error: ${message}`);
    finish();
  });
}

function runUndo() {
  if (state.deepen.busy) return;
  fetch('/undo')
    .then((response) => response.json())
    .then((result) => {
      if (!result.ok) { pushDeepen('error', `Undo: ${result.message}`); return; }
      rebuildFromDocument(result.document);
      state.deepen.canUndo = false;
      pushDeepen('result', 'Reverted the last deepen.');
    })
    .catch((error) => pushDeepen('error', `Undo failed: ${error.message}`));
}

function updateOverviewStrip() {
  const el = document.getElementById('overview-strip');
  if (!el) return;
  el.innerHTML = renderOverviewStrip(state.viewModel, state);
}

function updateViewPopover() {
  const el = document.getElementById('view-popover');
  if (!el) return;
  el.innerHTML = renderViewPopover(state);
}

function updateDigestInspector() {
  const el = document.getElementById('digest-inspector');
  if (!el) return;
  el.innerHTML = renderDigestInspector(state.viewModel, state);
}
