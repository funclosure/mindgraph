import cytoscape from '../node_modules/cytoscape/dist/cytoscape.esm.mjs';
import {
  buildConceptInspectorVM,
  buildFrameInspectorVM,
  buildMindgraphViewModel,
} from '../src/view-model/buildMindgraphViewModel.js';
import { buildGraphRenderState } from '../src/view-model/buildGraphRenderState.js';

const DEFAULT_DOCUMENT_PATH = '../examples/out/episode-1-built.mindgraph.json';
const CLUSTER_COLORS = ['#b89461', '#7da0ad', '#b89461', '#b89461', '#7da0ad', '#b89461', '#8f7b61'];
const PROTOTYPE_CLUSTER_LAYOUT = {
  'cultural-convergences': { x: 200, y: 180, radius: 118 },
  'meaning-crisis-core': { x: 485, y: 295, radius: 108 },
  'transformative-consciousness': { x: 735, y: 180, radius: 104 },
  'expanded-epistemology': { x: 220, y: 455, radius: 108 },
  'evolutionary-cognitive-origins': { x: 760, y: 445, radius: 112 },
  'cultural-pathologies': { x: 525, y: 86, radius: 32 },
  'wisdom-response': { x: 410, y: 475, radius: 24 },
};
const GRAPH_CAMERA_PADDING = 80;

const state = {
  document: undefined,
  viewModel: undefined,
  playheadTime: 0,
  activeLevel: 'macro',
  selectedConceptId: undefined,
  selectedFrameRef: undefined,
  isPlaying: false,
  timerId: undefined,
  graphZoom: 1,
  graphPan: { x: 0, y: 0 },
  graphHasMounted: false,
  uiMounted: false,
  lastAutoFocusKey: undefined,
  cy: undefined,
  graphLayout: undefined,
  graphRenderState: undefined,
  overlayCanvas: undefined,
  overlayCtx: undefined,
  overlayRaf: undefined,
  debugInfo: {},
  renderQueued: false,
  lastRuntimeError: undefined,
};

const appEl = document.getElementById('app');

window.addEventListener('error', (event) => {
  state.lastRuntimeError = event.error?.stack || event.message || 'Unknown window error';
  syncRuntimeErrorPanel();
});
window.addEventListener('unhandledrejection', (event) => {
  state.lastRuntimeError = event.reason?.stack || String(event.reason);
  syncRuntimeErrorPanel();
});

bootstrap().catch((error) => {
  console.error(error);
  state.lastRuntimeError = error?.stack || String(error);
  appEl.innerHTML = `<div class="error-state">Couldn’t load the mindgraph UI shell.<br /><span class="muted">${escapeHtml(error.message || String(error))}</span></div>`;
});

async function bootstrap() {
  const response = await fetch(DEFAULT_DOCUMENT_PATH);
  if (!response.ok) throw new Error(`HTTP ${response.status} while loading ${DEFAULT_DOCUMENT_PATH}`);
  state.document = await response.json();
  state.viewModel = buildMindgraphViewModel(state.document);
  state.playheadTime = state.viewModel.frames.macro[0]?.span.start ?? state.viewModel.frames.meso[0]?.span.start ?? 0;
  render();
}

function render() {
  const vm = state.viewModel;
  if (!vm) return;

  snapshotGraphCamera();

  const activeFrames = vm.selectors.getActiveFramesAtTime(state.playheadTime);
  const activeFrame = activeFrames[state.activeLevel] ?? vm.frames[state.activeLevel][0];
  state.graphLayout = buildGraphLayout(vm);
  state.graphRenderState = buildGraphRenderState(vm, {
    selectedConceptId: state.selectedConceptId,
    selectedFrameRef: state.selectedFrameRef,
    playheadTime: state.playheadTime,
    activeLevel: state.activeLevel,
    zoomLevel: state.graphZoom,
  });

  if (!state.uiMounted) {
    renderAppShell();
    state.uiMounted = true;
  }

  updateAppShell({
    vm,
    activeFrames,
    activeFrame,
    inspectorHtml: renderInspector(vm),
    timelineHtml: renderTimeline(vm, activeFrames, state.graphRenderState),
  });

  bindEvents();
  mountGraph();
}

function refreshChromeOnly() {
  const vm = state.viewModel;
  if (!vm) return;
  const activeFrames = vm.selectors.getActiveFramesAtTime(state.playheadTime);
  const activeFrame = activeFrames[state.activeLevel] ?? vm.frames[state.activeLevel][0];
  state.graphRenderState = buildGraphRenderState(vm, {
    selectedConceptId: state.selectedConceptId,
    selectedFrameRef: state.selectedFrameRef,
    playheadTime: state.playheadTime,
    activeLevel: state.activeLevel,
    zoomLevel: state.graphZoom,
  });
  updateAppShell({
    vm,
    activeFrames,
    activeFrame,
    inspectorHtml: renderInspector(vm),
    timelineHtml: renderTimeline(vm, activeFrames, state.graphRenderState),
  });
  bindEvents();
}

function renderAppShell() {
  appEl.innerHTML = `
    <div class="workspace">
      <header class="topbar">
        <div class="topbar__title" id="topbar-title"></div>
        <div class="topbar__controls">
          <div class="topbar__meta" id="topbar-meta"></div>
        </div>
      </header>

      <div class="main-layout">
        <div class="stage-column" id="stage-column">
          <section class="graph-panel">
            <div class="graph-panel__header">
              <div>
                <h2>Graph canvas</h2>
                <div class="muted">Cytoscape camera with ambient labels, progressive reveal, and selection callout.</div>
              </div>
              <div class="graph-toolbar" id="graph-toolbar"></div>
            </div>
            <div class="graph-stage" id="graph-stage">
              <div class="graph-canvas" id="cy-root"></div>
            </div>
            <div class="graph-panel__legend">
              <span class="legend-dot atomic">atomic concept</span>
              <span class="legend-dot active">active at playhead</span>
            </div>
            <pre class="graph-debug" id="graph-debug"></pre>
          </section>

          <section class="timeline-panel" id="timeline-panel"></section>
        </div>

        <aside class="inspector-panel" id="inspector-panel"></aside>
      </div>
    </div>
  `;
}

function updateAppShell({ vm, activeFrame, inspectorHtml, timelineHtml }) {
  const titleEl = document.getElementById('topbar-title');
  const metaEl = document.getElementById('topbar-meta');
  const stageColumnEl = document.getElementById('stage-column');
  const toolbarEl = document.getElementById('graph-toolbar');
  const timelineEl = document.getElementById('timeline-panel');
  const inspectorEl = document.getElementById('inspector-panel');
  const debugEl = document.getElementById('graph-debug');

  if (titleEl) {
    titleEl.innerHTML = `
      <h1>${escapeHtml(vm.documentMeta.title)}</h1>
      <p>${escapeHtml(state.document.transcript?.speakers?.join(', ') || 'Unknown speaker')} · ${formatTime(vm.documentMeta.durationSeconds)} total · ${vm.documentMeta.counts.atomicConcepts} atomic concepts</p>
    `;
  }

  if (metaEl) {
    metaEl.textContent = `${buildSelectionLabel(activeFrame)} · ${state.graphRenderState.viewportMode} · ${state.graphRenderState.focusMode}`;
  }

  if (stageColumnEl) stageColumnEl.className = `stage-column stage-column--${state.activeLevel}`;
  if (toolbarEl) toolbarEl.innerHTML = renderGraphToolbar();
  if (timelineEl) timelineEl.innerHTML = timelineHtml;
  if (inspectorEl) inspectorEl.innerHTML = inspectorHtml;
  if (debugEl) debugEl.textContent = formatDebugInfo();
}

function renderGraphToolbar() {
  return `
    <button type="button" class="ghost-button chip" data-action="zoom-out">−</button>
    <input class="graph-zoom-range" type="range" min="0.1" max="3" step="0.05" value="${state.graphZoom.toFixed(2)}" data-action="set-graph-zoom" />
    <button type="button" class="ghost-button chip" data-action="zoom-in">+</button>
    <button type="button" class="ghost-button chip" data-action="fit-all">Fit</button>
    <button type="button" class="ghost-button chip" data-action="fit-selection">Focus</button>
    <button type="button" class="ghost-button chip" data-action="reset-camera">Reset</button>
    <button type="button" class="ghost-button chip" data-action="clear-selection">Clear</button>
  `;
}

function bindEvents() {
  appEl.querySelectorAll('[data-action="set-level"]').forEach((button) => {
    button.addEventListener('click', () => {
      state.activeLevel = button.dataset.level;
      render();
    });
  });

  appEl.querySelector('[data-action="clear-selection"]')?.addEventListener('click', () => {
    state.selectedConceptId = undefined;
    state.selectedFrameRef = undefined;
    render();
  });

  appEl.querySelector('[data-action="zoom-in"]')?.addEventListener('click', () => {
    zoomGraphBy(1.2);
  });

  appEl.querySelector('[data-action="zoom-out"]')?.addEventListener('click', () => {
    zoomGraphBy(1 / 1.2);
  });

  appEl.querySelector('[data-action="fit-all"]')?.addEventListener('click', () => {
    fitGraphToVisible();
  });

  appEl.querySelector('[data-action="fit-selection"]')?.addEventListener('click', () => {
    fitGraphToSelection();
  });

  appEl.querySelector('[data-action="reset-camera"]')?.addEventListener('click', () => {
    state.selectedConceptId = undefined;
    state.selectedFrameRef = undefined;
    state.graphHasMounted = false;
    render();
  });

  appEl.querySelector('[data-action="set-graph-zoom"]')?.addEventListener('input', (event) => {
    setGraphZoom(Number(event.target.value));
  });

  appEl.querySelectorAll('[data-action="select-concept"]').forEach((el) => {
    el.addEventListener('click', () => {
      state.selectedConceptId = el.dataset.conceptId;
      state.selectedFrameRef = undefined;
      render();
    });
  });

  appEl.querySelectorAll('[data-action="select-frame"]').forEach((el) => {
    el.addEventListener('click', () => {
      const ref = { level: el.dataset.level, index: Number(el.dataset.index) };
      state.selectedFrameRef = ref;
      state.selectedConceptId = undefined;
      const frame = state.viewModel.selectors.getFrame(ref);
      if (frame) state.playheadTime = frame.span.start;
      render();
    });
  });

  appEl.querySelector('[data-action="toggle-play"]')?.addEventListener('click', togglePlayback);
  appEl.querySelector('[data-action="step-back"]')?.addEventListener('click', () => stepFrame(-1));
  appEl.querySelector('[data-action="step-forward"]')?.addEventListener('click', () => stepFrame(1));
  appEl.querySelector('.inspector-close')?.addEventListener('click', () => {
    state.selectedConceptId = undefined;
    state.selectedFrameRef = undefined;
    render();
  });

  const range = appEl.querySelector('[data-action="scrub-playhead"]');
  if (range) {
    range.addEventListener('input', (event) => {
      state.playheadTime = Number(event.target.value);
      syncSelectionToPlayhead(state.activeLevel);
      stopPlayback();
      render();
    });
  }

  appEl.querySelectorAll('.track__bar').forEach((trackBar) => {
    const beginTrackDrag = (event) => {
      event.preventDefault();
      const level = trackBar.dataset.level;
      state.timelineDrag = { pointerId: event.pointerId, level };
      trackBar.setPointerCapture?.(event.pointerId);
      scrubTimelineToPointer(trackBar, event, level);
    };

    trackBar.addEventListener('pointerdown', beginTrackDrag);
    trackBar.addEventListener('pointermove', (event) => {
      if (!state.timelineDrag || state.timelineDrag.pointerId !== event.pointerId) return;
      scrubTimelineToPointer(trackBar, event, state.timelineDrag.level);
    });

    const endTrackDrag = (event) => {
      if (!state.timelineDrag || state.timelineDrag.pointerId !== event.pointerId) return;
      state.timelineDrag = undefined;
      trackBar.releasePointerCapture?.(event.pointerId);
    };

    trackBar.addEventListener('pointerup', endTrackDrag);
    trackBar.addEventListener('pointercancel', endTrackDrag);
  });
}

function mountGraph() {
  const vm = state.viewModel;
  const layout = state.graphLayout;
  const graphRenderState = state.graphRenderState;
  const cyRoot = document.getElementById('cy-root');

  if (!vm || !layout || !graphRenderState || !cyRoot) return;

  if (!state.cy) {
    state.cy = cytoscape({
      container: cyRoot,
      elements: [],
      layout: { name: 'preset', fit: false },
      minZoom: 0.1,
      maxZoom: 3,
      wheelSensitivity: 0.2,
      style: buildCytoscapeStyles(),
    });

    state.cy.on('tap', 'node', (event) => {
      state.selectedConceptId = event.target.id();
      state.selectedFrameRef = undefined;
      refreshChromeOnly();
      applyExternalFocusState();
    });

    state.cy.on('tap', (event) => {
      if (event.target !== state.cy) return;
      state.selectedConceptId = undefined;
      state.selectedFrameRef = undefined;
      refreshChromeOnly();
      applyExternalFocusState();
    });

    state.cy.on('zoom pan render resize', () => {
      snapshotGraphCamera();
      syncGraphZoomInput();
    });
  }

  const elements = buildCytoscapeElements(vm, layout, graphRenderState);
  state.cy.batch(() => {
    state.cy.elements().remove();
    state.cy.add(elements);
    state.cy.style(buildCytoscapeStyles());
  });

  state.debugInfo = {
    graphNodes: vm.graph.nodes.length,
    graphEdges: vm.graph.edges.length,
    cyNodes: state.cy.nodes().length,
    cyEdges: state.cy.edges().length,
    selectedConceptId: state.selectedConceptId ?? 'none',
    selectedFrameRef: state.selectedFrameRef ? `${state.selectedFrameRef.level}:${state.selectedFrameRef.index}` : 'none',
    lastRuntimeError: state.lastRuntimeError ?? 'none',
  };

  requestAnimationFrame(() => {
    if (!state.cy) return;
    state.cy.resize();
    if (!state.graphHasMounted) {
      state.cy.fit(state.cy.elements(), GRAPH_CAMERA_PADDING);
      state.graphHasMounted = true;
    } else if (Number.isFinite(state.graphZoom) && Number.isFinite(state.graphPan?.x) && Number.isFinite(state.graphPan?.y)) {
      state.cy.zoom(clamp(state.graphZoom, state.cy.minZoom(), state.cy.maxZoom()));
      state.cy.pan(state.graphPan);
    } else {
      state.cy.fit(state.cy.elements(), GRAPH_CAMERA_PADDING);
    }
    applyExternalFocusState();
  });
}

function buildCytoscapeElements(vm, layout, graphRenderState) {
  const selectedId = state.selectedConceptId;
  const frameConceptIds = state.selectedFrameRef
    ? vm.selectors.getFrameConcepts(state.selectedFrameRef).map((activation) => activation.id)
    : [];
  const primaryFocusIds = new Set(selectedId ? [selectedId] : frameConceptIds);
  const neighborIds = new Set([...primaryFocusIds].flatMap((id) => vm.selectors.getConceptNeighbors(id).map((concept) => concept.id)));
  const activeNodeIds = new Set(graphRenderState.activeNodeIds);
  const hasFocus = primaryFocusIds.size > 0;

  const nodeElements = vm.graph.nodes
    .filter((node) => node.level !== 'clustered')
    .map((node) => {
      const position = layout.nodes[node.id];
      const size = 26 + (node.visualWeight || 0.5) * 10;
      const isPrimary = primaryFocusIds.has(node.id);
      const isNeighbor = neighborIds.has(node.id);
      const shouldFade = hasFocus && !isPrimary && !isNeighbor;
      const classes = [
        'atomic-node',
        shouldFade ? 'faded' : '',
      ].filter(Boolean).join(' ');

      return {
        data: {
          id: node.id,
          label: node.label,
          displayLabel: node.label,
          nodeLevel: node.level,
          color: clusterColorForNode(node.id, vm),
          size,
          regionKey: node.regionKey || '',
        },
        position,
        classes,
        selectable: false,
        grabbable: false,
        locked: true,
      };
    });

  const visibleAtomicIds = new Set(nodeElements.map((element) => element.data.id));

  const edgeElements = vm.graph.edges
    .filter((edge) => visibleAtomicIds.has(edge.from) && visibleAtomicIds.has(edge.to))
    .map((edge) => {
    const touchesPrimary = primaryFocusIds.has(edge.from) || primaryFocusIds.has(edge.to);
    const touchesNeighbor = neighborIds.has(edge.from) || neighborIds.has(edge.to);
    const classes = [
      touchesPrimary || touchesNeighbor ? 'focused-edge' : '',
      hasFocus && !touchesPrimary && !touchesNeighbor ? 'faded' : '',
    ].filter(Boolean).join(' ');

    return {
      data: {
        id: edge.id,
        source: edge.from,
        target: edge.to,
      },
      classes,
      selectable: false,
      grabbable: false,
      locked: true,
    };
  });

  return [...nodeElements, ...edgeElements];
}

function buildCytoscapeStyles() {
  return [
    {
      selector: 'node',
      style: {
        label: 'data(label)',
        width: 'data(size)',
        height: 'data(size)',
        'background-color': 'data(color)',
        color: '#f5ead2',
        'font-size': 12,
        'text-wrap': 'wrap',
        'text-max-width': 110,
        'text-valign': 'center',
        'text-halign': 'center',
        'overlay-opacity': 0,
        'border-width': 1.5,
        'border-color': 'rgba(255,255,255,0.12)',
      },
    },
    {
      selector: 'edge',
      style: {
        width: 2,
        'curve-style': 'bezier',
        'line-color': 'rgba(184, 148, 97, 0.45)',
        'target-arrow-shape': 'none',
        'overlay-opacity': 0,
      },
    },
    {
      selector: 'node:selected',
      style: {
        'border-width': 3,
        'border-color': '#fff4db',
        'background-color': '#f4cf86',
      },
    },
    {
      selector: '.faded',
      style: {
        opacity: 0.18,
      },
    },
    {
      selector: '.focused-edge',
      style: {
        width: 3,
        'line-color': '#f4cf86',
        opacity: 0.9,
      },
    },
  ];
}

function renderInspector(vm) {
  if (state.selectedConceptId) return renderConceptInspector(vm, state.selectedConceptId);
  if (state.selectedFrameRef) return renderFrameInspector(vm, state.selectedFrameRef);

  const activeFrames = vm.selectors.getActiveFramesAtTime(state.playheadTime);
  const activeFrame = activeFrames[state.activeLevel];
  const activeConcepts = vm.selectors.getActiveConceptActivationsAtTime(state.playheadTime, state.activeLevel).slice(0, 8);

  return `
    ${renderInspectorChrome('Details')}
    <div class="inspector-scroll">
      <section class="section">
        <h3>Current frame</h3>
        ${activeFrame ? renderFrameChip(activeFrame, true) : '<div class="empty-state">No active frame at this playhead.</div>'}
      </section>
      <section class="section">
        <h3>Active concepts</h3>
        <div class="list">
          ${activeConcepts.map((activation) => `
            <div class="list-item"><button type="button" data-action="select-concept" data-concept-id="${activation.id}">${escapeHtml(activation.label)} <span class="muted">· ${activation.weight.toFixed(2)}</span></button></div>
          `).join('') || '<div class="empty-state">No concept activations in this frame.</div>'}
        </div>
      </section>
      <section class="section">
        <h3>How to use this shell</h3>
        <div class="muted">Click a concept in the graph or a frame in the timeline. The right panel will switch into a real concept or frame inspector instead of this live overview.</div>
      </section>
    </div>
  `;
}

function renderConceptInspector(vm, conceptId) {
  const inspector = buildConceptInspectorVM(vm, conceptId, { strongestFrameLimit: 6, excerptLimit: 5 });
  if (!inspector) return '<div class="error-state">Missing concept inspector.</div>';

  const concept = inspector.concept;
  const stats = concept.stats ?? {};
  const parentClusters = inspector.parentClusters.length
    ? inspector.parentClusters.map((cluster) => `<span class="chip">${escapeHtml(cluster.label)}</span>`).join('')
    : '<span class="muted">No parent cluster</span>';

  return `
    ${renderInspectorChrome('Details', concept.label, concept.id)}
    <div class="inspector-scroll">
      <section class="section">
        <h3>Grounding</h3>
        <div class="chip-row">${parentClusters}</div>
      </section>
      <section class="section">
        <h3>Stats</h3>
        <div class="stat-grid">
          ${renderStat('Recurrence', stats.recurrenceCount ?? '—')}
          ${renderStat('Peak activation', numberOrDash(stats.peakActivation, 2))}
          ${renderStat('Total activation', numberOrDash(stats.totalActivation, 2))}
          ${renderStat('Persistence', stats.persistence != null ? `${Math.round(stats.persistence)}s` : '—')}
        </div>
      </section>
      <section class="section">
        <h3>Related concepts</h3>
        <div class="list">
          ${inspector.relatedConcepts.map((related) => `
            <div class="list-item"><button type="button" data-action="select-concept" data-concept-id="${related.id}">${escapeHtml(related.label)}</button></div>
          `).join('') || '<div class="empty-state">No one-hop neighbors.</div>'}
        </div>
      </section>
      <section class="section">
        <h3>Strongest frames</h3>
        <div class="list">
          ${inspector.strongestFrames.map((frame) => renderFrameChip(frame)).join('') || '<div class="empty-state">No frames found.</div>'}
        </div>
      </section>
      <section class="section">
        <h3>Transcript grounding</h3>
        <div class="transcript-list">
          ${inspector.transcriptExcerpts.map((segment) => renderTranscriptItem(segment)).join('') || '<div class="empty-state">No transcript excerpts available.</div>'}
        </div>
      </section>
    </div>
  `;
}

function renderFrameInspector(vm, frameRef) {
  const inspector = buildFrameInspectorVM(vm, frameRef);
  if (!inspector) return '<div class="error-state">Missing frame inspector.</div>';

  return `
    ${renderInspectorChrome('Details', `${inspector.frame.ref.level} ${inspector.frame.ref.index + 1}`, `${formatTime(inspector.frame.span.start)} → ${formatTime(inspector.frame.span.end)}`)}
    <div class="inspector-scroll">
      <section class="section">
        <h3>Summary</h3>
        <div class="muted">${escapeHtml(inspector.frame.summary || inspector.frame.title || 'No summary yet — this shell still shows the structural payload cleanly.')}</div>
      </section>
      <section class="section">
        <h3>Active concepts</h3>
        <div class="list">
          ${[...inspector.foregroundConcepts, ...inspector.backgroundConcepts].map((activation) => `
            <div class="list-item"><button type="button" data-action="select-concept" data-concept-id="${activation.id}">${escapeHtml(activation.label)} <span class="muted">· ${activation.weight.toFixed(2)}</span></button></div>
          `).join('') || '<div class="empty-state">No concept activations.</div>'}
        </div>
      </section>
      <section class="section">
        <h3>Active relations</h3>
        <div class="list">
          ${inspector.activeRelations.map((relationActivation) => {
            const relation = relationActivation.relation;
            const label = relation ? `${relation.from} → ${relation.to} · ${relation.type}` : relationActivation.id;
            return `<div class="list-item">${escapeHtml(label)} <span class="muted">· ${relationActivation.weight.toFixed(2)}</span></div>`;
          }).join('') || '<div class="empty-state">No relation activations.</div>'}
        </div>
      </section>
      <section class="section">
        <h3>Provenance</h3>
        <div class="breadcrumbs">
          ${inspector.parentFrame ? `<span class="breadcrumb">parent · <button type="button" class="link-button" data-action="select-frame" data-level="${inspector.parentFrame.ref.level}" data-index="${inspector.parentFrame.ref.index}">${escapeHtml(frameLabel(inspector.parentFrame))}</button></span>` : ''}
          ${inspector.childFrames.map((frame) => `<span class="breadcrumb">child · <button type="button" class="link-button" data-action="select-frame" data-level="${frame.ref.level}" data-index="${frame.ref.index}">${escapeHtml(frameLabel(frame))}</button></span>`).join('') || '<span class="muted">No linked child frames</span>'}
        </div>
      </section>
      <section class="section">
        <h3>Transcript grounding</h3>
        <div class="transcript-list">
          ${inspector.transcriptSegments.map((segment) => renderTranscriptItem(segment)).join('') || '<div class="empty-state">No transcript segments attached.</div>'}
        </div>
      </section>
    </div>
  `;
}

function renderTimeline(vm, activeFrames, graphRenderState) {
  const levels = getVisibleTimelineLevels();
  return `
    <div class="timeline-panel__header">
      <div class="timeline-heading">
        <h2>Timeline</h2>
        <div class="muted">${graphRenderState.viewportMode} · ${graphRenderState.focusMode}</div>
      </div>
      <div class="timeline-toolbar">
        <button type="button" class="playback-button ${state.isPlaying ? 'active' : ''}" data-action="toggle-play">${state.isPlaying ? 'Pause' : 'Play'}</button>
        <button type="button" class="playback-button" data-action="step-back">←</button>
        <button type="button" class="playback-button" data-action="step-forward">→</button>
        <input class="timeline-range" type="range" min="0" max="${Math.max(1, Math.round(vm.documentMeta.durationSeconds))}" value="${Math.round(state.playheadTime)}" data-action="scrub-playhead" />
        <div class="timeline-time muted">${formatTime(state.playheadTime)} / ${formatTime(vm.documentMeta.durationSeconds)}</div>
        <div class="level-toggle timeline-level-toggle" role="tablist" aria-label="Active frame level">
          ${['macro', 'meso', 'micro'].map((level) => `
            <button type="button" data-action="set-level" data-level="${level}" class="${state.activeLevel === level ? 'active' : ''}">${level}</button>
          `).join('')}
        </div>
      </div>
    </div>
    <div class="track-list track-list--${levels.length}">
      ${levels.map((level) => renderTrack(vm, level, activeFrames[level])).join('')}
    </div>
  `;
}

function getVisibleTimelineLevels() {
  if (state.activeLevel === 'micro') return ['macro', 'meso', 'micro'];
  if (state.activeLevel === 'meso') return ['macro', 'meso'];
  return ['macro'];
}

function renderTrack(vm, level, activeFrame) {
  const frames = vm.frames[level];
  const total = Math.max(1, vm.documentMeta.durationSeconds);
  const playheadPct = (state.playheadTime / total) * 100;
  return `
    <div class="track track--${level}">
      <div class="track__label">${level}</div>
      <div class="track__bar" data-level="${level}">
        ${frames.map((frame) => {
          const width = Math.max(0.6, (frame.duration / total) * 100);
          const isSelected = state.selectedFrameRef && state.selectedFrameRef.level === level && state.selectedFrameRef.index === frame.ref.index;
          const isActive = activeFrame?.ref.index === frame.ref.index;
          return `<button type="button" class="frame-segment ${isSelected ? 'selected-frame' : ''} ${isActive ? 'active-frame' : ''}" style="width:${width}%" title="${escapeHtml(`${frameLabel(frame)} · ${formatTime(frame.span.start)} → ${formatTime(frame.span.end)}`)}" data-action="select-frame" data-level="${level}" data-index="${frame.ref.index}"></button>`;
        }).join('')}
        <div class="playhead" style="left: calc(${Math.min(100, Math.max(0, playheadPct))}% - 1px)"></div>
      </div>
    </div>
  `;
}

function buildGraphLayout(vm) {
  const clusters = vm.concepts.clustered.map((cluster) => {
    const proto = PROTOTYPE_CLUSTER_LAYOUT[cluster.id] ?? { x: 490, y: 310, radius: 88 };
    return {
      id: cluster.id,
      label: cluster.label,
      x: proto.x,
      y: proto.y,
      radius: proto.radius,
    };
  });

  const nodes = {};

  clusters.forEach((cluster) => {
    nodes[cluster.id] = { x: cluster.x, y: cluster.y };
    const children = vm.selectors.getClusterChildren(cluster.id);
    const childRadius = Math.max(26, cluster.radius - 30);
    const startAngle = deterministicAngle(cluster.id);

    children.forEach((child, idx) => {
      const angle = startAngle + (Math.PI * 2 * idx) / Math.max(children.length, 1);
      const ring = 0.58 + (seededUnit(`${cluster.id}:${child.id}`) * 0.28);
      const x = cluster.x + Math.cos(angle) * childRadius * ring;
      const y = cluster.y + Math.sin(angle) * childRadius * ring;
      nodes[child.id] = { x, y };
    });
  });

  const fallbackCluster = clusters[0] ?? { x: 490, y: 310, radius: 88 };
  const missingNodes = vm.graph.nodes.filter((node) => !nodes[node.id]);
  missingNodes.forEach((node, idx) => {
    const parentCluster = node.regionKey ? clusters.find((cluster) => cluster.id === node.regionKey) : undefined;
    const anchor = parentCluster ?? fallbackCluster;
    const angle = deterministicAngle(`fallback:${node.id}`) + ((Math.PI * 2 * idx) / Math.max(1, missingNodes.length));
    const radius = (anchor.radius ?? 88) + 42 + (idx % 3) * 14;
    nodes[node.id] = {
      x: anchor.x + Math.cos(angle) * radius,
      y: anchor.y + Math.sin(angle) * radius,
    };
  });

  return { clusters, nodes };
}

function renderInspectorChrome(activeTab, title = 'Inspector', subtitle = 'Live semantic window') {
  return `
    <div class="inspector-panel__header inspector-header-shell">
      <div class="inspector-header-label">Details</div>
      <button type="button" class="inspector-close" aria-label="Close">×</button>
    </div>
    <div class="inspector-title-block">
      <h2>${escapeHtml(title)}</h2>
      <div class="muted">${escapeHtml(subtitle)}</div>
    </div>
  `;
}

function renderFrameChip(frame, isLive = false) {
  return `
    <div class="frame-chip">
      <button type="button" data-action="select-frame" data-level="${frame.ref.level}" data-index="${frame.ref.index}">
        <strong>${escapeHtml(frameLabel(frame))}</strong>
        <div class="muted">${formatTime(frame.span.start)} → ${formatTime(frame.span.end)}${isLive ? ' · live now' : ''}</div>
      </button>
    </div>
  `;
}

function renderTranscriptItem(segment) {
  return `
    <div class="transcript-item">
      <div class="muted">${formatTime(segment.start)} → ${formatTime(segment.end)}${segment.speaker ? ` · ${escapeHtml(segment.speaker)}` : ''}</div>
      <div>${escapeHtml(segment.text)}</div>
    </div>
  `;
}

function renderStat(label, value) {
  return `
    <div class="stat-card">
      <div class="label">${escapeHtml(label)}</div>
      <div class="value">${escapeHtml(String(value))}</div>
    </div>
  `;
}

function togglePlayback() {
  if (state.isPlaying) {
    stopPlayback();
    render();
    return;
  }

  state.isPlaying = true;
  state.timerId = window.setInterval(() => {
    const duration = state.viewModel.documentMeta.durationSeconds;
    state.playheadTime = Math.min(duration, state.playheadTime + 3);
    if (state.playheadTime >= duration) stopPlayback();
    render();
  }, 250);
  render();
}

function stopPlayback() {
  state.isPlaying = false;
  if (state.timerId) window.clearInterval(state.timerId);
  state.timerId = undefined;
}

function stepFrame(direction) {
  stopPlayback();
  const frames = state.viewModel.frames[state.activeLevel];
  const current = state.viewModel.selectors.getActiveFrameAtTime(state.activeLevel, state.playheadTime) ?? frames[0];
  const nextIndex = Math.max(0, Math.min(frames.length - 1, current.ref.index + direction));
  const nextFrame = frames[nextIndex];
  state.playheadTime = nextFrame.span.start;
  state.selectedFrameRef = nextFrame.ref;
  state.selectedConceptId = undefined;
  render();
}

function buildSelectionLabel(activeFrame) {
  if (state.selectedConceptId) {
    const concept = state.viewModel.selectors.getConceptById(state.selectedConceptId);
    return concept ? `Concept · ${concept.label}` : 'Concept';
  }
  if (state.selectedFrameRef) {
    const frame = state.viewModel.selectors.getFrame(state.selectedFrameRef);
    return frame ? `Frame · ${frame.ref.level} ${frame.ref.index + 1}` : 'Frame';
  }
  return activeFrame ? `Live · ${activeFrame.ref.level} ${activeFrame.ref.index + 1}` : 'Live';
}

function zoomGraphBy(multiplier) {
  if (!state.cy) return;
  const container = state.cy.container().getBoundingClientRect();
  state.cy.zoom({
    level: clamp(state.cy.zoom() * multiplier, state.cy.minZoom(), state.cy.maxZoom()),
    renderedPosition: { x: container.width / 2, y: container.height / 2 },
  });
}

function setGraphZoom(nextZoom) {
  if (!state.cy) {
    state.graphZoom = clamp(nextZoom, 0.1, 3);
    return;
  }
  const container = state.cy.container().getBoundingClientRect();
  state.cy.zoom({
    level: clamp(nextZoom, state.cy.minZoom(), state.cy.maxZoom()),
    renderedPosition: { x: container.width / 2, y: container.height / 2 },
  });
}

function fitGraphToVisible() {
  if (!state.cy) return;
  const elements = state.cy.elements();
  if (elements.length) {
    state.cy.fit(elements, GRAPH_CAMERA_PADDING);
    snapshotGraphCamera();
  }
}

function fitGraphToSelection() {
  if (!state.cy) return;
  const focusTarget = getSelectionFocusCollection();
  if (!focusTarget || !focusTarget.length) return;
  state.cy.fit(focusTarget, 120);
  snapshotGraphCamera();
}

function getSelectionFocusCollection() {
  if (!state.cy || !state.viewModel) return undefined;
  if (state.selectedConceptId) {
    const selected = state.cy.$id(state.selectedConceptId);
    return selected.length ? selected.closedNeighborhood() : undefined;
  }
  if (state.selectedFrameRef) {
    const conceptIds = state.viewModel.selectors.getFrameConcepts(state.selectedFrameRef).map((activation) => activation.id);
    const nodes = conceptIds.map((id) => state.cy.$id(id)).filter((node) => node.length);
    if (!nodes.length) return undefined;
    return nodes.reduce((collection, node) => collection.union(node.closedNeighborhood()), state.cy.collection());
  }
  return undefined;
}

function applyExternalFocusState() {
  if (!state.cy) return;
  state.cy.elements().removeClass('faded focused-edge');
  state.cy.elements().unselect();

  if (state.selectedConceptId) {
    const selected = state.cy.$id(state.selectedConceptId);
    if (!selected.length) return;
    selected.select();
    const neighborhood = selected.closedNeighborhood();
    state.cy.elements().difference(neighborhood).addClass('faded');
    neighborhood.edges().addClass('focused-edge');
    return;
  }

  if (state.selectedFrameRef) {
    const focusTarget = getSelectionFocusCollection();
    if (!focusTarget || !focusTarget.length) return;
    state.cy.elements().difference(focusTarget).addClass('faded');
    focusTarget.edges().addClass('focused-edge');
  }
}

function snapshotGraphCamera() {
  if (!state.cy) return;
  state.graphZoom = state.cy.zoom();
  state.graphPan = state.cy.pan();
}

function scheduleOverlayDraw() {}

function syncGraphZoomInput() {
  const input = appEl.querySelector('[data-action="set-graph-zoom"]');
  if (input) input.value = state.graphZoom.toFixed(2);
}

function scrubTimelineToPointer(trackBar, event, level) {
  const rect = trackBar.getBoundingClientRect();
  const pct = clamp((event.clientX - rect.left) / Math.max(1, rect.width), 0, 1);
  const total = Math.max(1, state.viewModel.documentMeta.durationSeconds);
  state.activeLevel = level;
  state.playheadTime = total * pct;
  state.selectedConceptId = undefined;
  syncSelectionToPlayhead(level);
  stopPlayback();
  render();
}

function syncSelectionToPlayhead(level = state.activeLevel) {
  const frame = state.viewModel?.selectors.getActiveFrameAtTime(level, state.playheadTime);
  state.selectedFrameRef = frame ? frame.ref : undefined;
}

function renderMultilineLabel(label, maxLines = 2) {
  const words = String(label).split(/\s+/).filter(Boolean);
  if (words.length <= 1) return [String(label)];
  const midpoint = Math.ceil(words.length / maxLines);
  const lines = [];
  for (let i = 0; i < words.length; i += midpoint) lines.push(words.slice(i, i + midpoint).join(' '));
  return lines.slice(0, maxLines);
}

function deterministicAngle(value) {
  return seededUnit(value) * Math.PI * 2;
}

function seededUnit(value) {
  let hash = 0;
  for (let i = 0; i < value.length; i += 1) hash = ((hash << 5) - hash + value.charCodeAt(i)) | 0;
  return (Math.abs(hash) % 1000) / 1000;
}

function frameLabel(frame) {
  return `${frame.ref.level} ${frame.ref.index + 1}${frame.title ? ` · ${frame.title}` : ''}`;
}

function formatTime(seconds) {
  const total = Math.max(0, Math.floor(seconds || 0));
  const hh = Math.floor(total / 3600);
  const mm = Math.floor((total % 3600) / 60);
  const ss = total % 60;
  if (hh > 0) return `${hh}:${String(mm).padStart(2, '0')}:${String(ss).padStart(2, '0')}`;
  return `${mm}:${String(ss).padStart(2, '0')}`;
}

function numberOrDash(value, digits = 2) {
  return value == null ? '—' : Number(value).toFixed(digits);
}

function clusterColorForNode(nodeId, vm) {
  const clusterIndex = vm.concepts.clustered.findIndex((cluster) => cluster.id === nodeId);
  if (clusterIndex >= 0) return CLUSTER_COLORS[clusterIndex % CLUSTER_COLORS.length];
  const node = vm.graph.nodeById[nodeId];
  const regionKey = node?.regionKey;
  const regionIndex = vm.concepts.clustered.findIndex((cluster) => cluster.id === regionKey);
  return CLUSTER_COLORS[(regionIndex >= 0 ? regionIndex : 0) % CLUSTER_COLORS.length];
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function hexToRgba(hex, alpha) {
  const value = hex.replace('#', '');
  const bigint = Number.parseInt(value, 16);
  const r = (bigint >> 16) & 255;
  const g = (bigint >> 8) & 255;
  const b = bigint & 255;
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

function queueRender() {
  if (state.renderQueued) return;
  state.renderQueued = true;
  requestAnimationFrame(() => {
    state.renderQueued = false;
    render();
  });
}

function syncRuntimeErrorPanel() {
  const debugEl = document.getElementById('graph-debug');
  if (!debugEl) return;
  debugEl.textContent = formatDebugInfo();
}

function formatDebugInfo() {
  const preferredOrder = [
    'lastRuntimeError',
    'graphNodes',
    'graphEdges',
    'cyNodes',
    'cyEdges',
    'selectedConceptId',
    'selectedFrameRef',
  ];
  const entries = Object.entries(state.debugInfo || {});
  entries.sort((a, b) => {
    const ai = preferredOrder.indexOf(a[0]);
    const bi = preferredOrder.indexOf(b[0]);
    return (ai === -1 ? 999 : ai) - (bi === -1 ? 999 : bi);
  });
  return entries
    .map(([key, value]) => {
      if (Array.isArray(value) || (value && typeof value === 'object')) {
        return `${key}: ${JSON.stringify(value)}`;
      }
      return `${key}: ${value}`;
    })
    .join('\n');
}

function escapeHtml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}
