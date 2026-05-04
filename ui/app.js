import {
  buildConceptInspectorVM,
  buildFrameInspectorVM,
  buildMindgraphViewModel,
} from '../src/view-model/buildMindgraphViewModel.js';
import { buildGraphRenderState } from '../src/view-model/buildGraphRenderState.js';

const DOC_PATH = '../examples/out/episode-1-built.mindgraph.json';
const CANVAS_W = 1280;
const CANVAS_H = 800;

// Hand-placed cluster anchors. Stable across renders; chosen to give each
// cluster room to breathe inside the 1280x800 logical canvas.
const PROTOTYPE_CLUSTER_LAYOUT = {
  'cultural-convergences':          { x: 285,  y: 245, radius: 152 },
  'meaning-crisis-core':            { x: 640,  y: 400, radius: 142 },
  'transformative-consciousness':   { x: 1000, y: 245, radius: 138 },
  'expanded-epistemology':          { x: 295,  y: 590, radius: 142 },
  'evolutionary-cognitive-origins': { x: 1015, y: 590, radius: 145 },
  'cultural-pathologies':           { x: 705,  y: 110, radius: 42 },
  'wisdom-response':                { x: 540,  y: 615, radius: 32 },
};

// Mockup uses gold for most clusters and a single blue cluster as a different
// categorical state. Match that.
const CLUSTER_COLORS = {
  'cultural-convergences':          '#b89461',
  'meaning-crisis-core':            '#c79f6a',
  'transformative-consciousness':   '#b89461',
  'expanded-epistemology':          '#7da0ad',
  'evolutionary-cognitive-origins': '#b89461',
  'cultural-pathologies':           '#8f7b61',
  'wisdom-response':                '#7da0ad',
};

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
  applyDpr();
  fitCameraToLayout();
  render();

  console.info('mindgraph canvas POC ready', {
    clusters: state.layout.clusters.map((c) => ({ id: c.id, label: c.label, hasAnchor: !!PROTOTYPE_CLUSTER_LAYOUT[c.id] })),
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
  bindEvents();
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
  draw(state.viewModel, state.layout, state.graphRenderState);
}

// ---------------------------------------------------------------------------
// Sub-render stubs (wired progressively in later tasks)
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
  el.innerHTML = renderInspector(state.viewModel);
}

function updateTimelinePanel() {
  const el = document.getElementById('timeline-panel');
  if (!el) return;
  const activeFrames = state.viewModel.selectors.getActiveFramesAtTime(state.playheadTime);
  el.innerHTML = renderTimeline(state.viewModel, activeFrames, state.graphRenderState ?? { viewportMode: 'overview', focusMode: 'none' });
}

function bindEvents() {
  const range = document.querySelector('[data-action="scrub-playhead"]');
  if (range) {
    range.addEventListener('input', (e) => {
      state.playheadTime = Number(e.target.value);
      render();
    });
  }
  document.querySelectorAll('[data-action="set-level"]').forEach((btn) => {
    btn.addEventListener('click', () => {
      state.activeLevel = btn.dataset.level;
      render();
    });
  });
  document.querySelectorAll('[data-action="select-frame"]').forEach((btn) => {
    btn.addEventListener('click', () => {
      state.selectedFrameRef = { level: btn.dataset.level, index: Number(btn.dataset.index) };
      state.selectedConceptId = undefined;
      const frame = state.viewModel.selectors.getFrame(state.selectedFrameRef);
      if (frame) state.playheadTime = frame.span.start;
      render();
    });
  });
  document.querySelectorAll('[data-action="select-concept"]').forEach((btn) => {
    btn.addEventListener('click', () => {
      state.selectedConceptId = btn.dataset.conceptId;
      state.selectedFrameRef = undefined;
      render();
    });
  });

  // Toolbar camera buttons — static DOM, bind once only.
  const toolbar = document.querySelector('.graph-toolbar');
  if (toolbar && !toolbar.dataset.boundCameraEvents) {
    toolbar.dataset.boundCameraEvents = '1';
    document.querySelector('[data-action="zoom-in"]')?.addEventListener('click', () => {
      zoomAroundCenter(1.2);
    });
    document.querySelector('[data-action="zoom-out"]')?.addEventListener('click', () => {
      zoomAroundCenter(1 / 1.2);
    });
    document.querySelector('[data-action="fit"]')?.addEventListener('click', () => {
      fitCameraToLayout();
      render();
    });
    document.querySelector('[data-action="reset-camera"]')?.addEventListener('click', () => {
      state.selectedConceptId = undefined;
      state.selectedFrameRef = undefined;
      fitCameraToLayout();
      render();
    });
  }

  // Canvas wheel + drag — bind once only.
  const canvasEl = document.getElementById('stage');
  if (canvasEl && !canvasEl.dataset.boundCameraEvents) {
    canvasEl.dataset.boundCameraEvents = '1';

    canvasEl.addEventListener('wheel', (e) => {
      e.preventDefault();
      const rect = canvasEl.getBoundingClientRect();
      const point = { x: e.clientX - rect.left, y: e.clientY - rect.top };
      const factor = Math.exp(-e.deltaY * 0.0015);
      zoomAround(point, factor);
      render();
    }, { passive: false });

    let dragging = false;
    let lastX = 0;
    let lastY = 0;
    canvasEl.addEventListener('pointerdown', (e) => {
      dragging = true;
      lastX = e.clientX;
      lastY = e.clientY;
      canvasEl.setPointerCapture(e.pointerId);
      canvasEl.style.cursor = 'grabbing';
    });
    canvasEl.addEventListener('pointermove', (e) => {
      if (!dragging) return;
      state.camera.pan.x += e.clientX - lastX;
      state.camera.pan.y += e.clientY - lastY;
      lastX = e.clientX;
      lastY = e.clientY;
      scheduleDraw();
    });
    canvasEl.addEventListener('pointerup', (e) => {
      if (!dragging) return;
      dragging = false;
      try { canvasEl.releasePointerCapture(e.pointerId); } catch (_) {}
      canvasEl.style.cursor = 'grab';
      render();
    });
    canvasEl.style.cursor = 'grab';

    let downAt = null;
    canvasEl.addEventListener('pointerdown', (e) => {
      downAt = { x: e.clientX, y: e.clientY };
    });
    canvasEl.addEventListener('click', (e) => {
      // Suppress click if the pointer moved more than a few px (= drag, not click).
      if (downAt && Math.hypot(e.clientX - downAt.x, e.clientY - downAt.y) > 4) {
        downAt = null;
        return;
      }
      downAt = null;
      const rect = canvasEl.getBoundingClientRect();
      const screen = { x: e.clientX - rect.left, y: e.clientY - rect.top };
      const world = screenToWorld(screen);
      const hit = hitTestAt(world);
      if (hit && hit.kind === 'concept') {
        state.selectedConceptId = hit.id;
        state.selectedFrameRef = undefined;
      } else if (hit && hit.kind === 'cluster') {
        state.selectedConceptId = hit.id;
        state.selectedFrameRef = undefined;
      } else {
        state.selectedConceptId = undefined;
        state.selectedFrameRef = undefined;
      }
      render();
    });
  }
}

// ---------------------------------------------------------------------------
// Layout
// ---------------------------------------------------------------------------

function applyDpr() {
  const dpr = window.devicePixelRatio || 1;
  canvas.width = CANVAS_W * dpr;
  canvas.height = CANVAS_H * dpr;
  canvas.style.width = `${CANVAS_W}px`;
  canvas.style.height = `${CANVAS_H}px`;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
}

function computeLayout(vm) {
  const clusters = vm.concepts.clustered.map((cluster) => {
    const proto = PROTOTYPE_CLUSTER_LAYOUT[cluster.id] ?? { x: 640, y: 400, radius: 80 };
    return {
      id: cluster.id,
      label: cluster.label,
      x: proto.x,
      y: proto.y,
      radius: proto.radius,
      color: CLUSTER_COLORS[cluster.id] ?? '#b89461',
    };
  });

  const nodes = {};
  for (const cluster of clusters) {
    nodes[cluster.id] = { x: cluster.x, y: cluster.y };
    const children = vm.selectors.getClusterChildren(cluster.id);
    if (!children.length) continue;
    const startAngle = deterministicAngle(cluster.id);
    const baseRing = Math.max(28, cluster.radius - 38);
    children.forEach((child, idx) => {
      const angle = startAngle + (Math.PI * 2 * idx) / children.length;
      const ringScale = 0.55 + seededUnit(`${cluster.id}:${child.id}`) * 0.32;
      nodes[child.id] = {
        x: cluster.x + Math.cos(angle) * baseRing * ringScale,
        y: cluster.y + Math.sin(angle) * baseRing * ringScale,
      };
    });
  }

  return { clusters, nodes };
}

// ---------------------------------------------------------------------------
// Draw
// ---------------------------------------------------------------------------

function draw(vm, layout, grs) {
  ctx.save();
  ctx.setTransform(window.devicePixelRatio || 1, 0, 0, window.devicePixelRatio || 1, 0, 0);
  drawBackground();
  ctx.restore();

  ctx.save();
  const dpr = window.devicePixelRatio || 1;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.translate(state.camera.pan.x, state.camera.pan.y);
  ctx.scale(state.camera.zoom, state.camera.zoom);

  drawClusterBodies(layout, grs);
  drawEdges(vm, layout, grs);
  drawAtomicNodes(vm, layout, grs);
  drawClusterLabels(layout, grs);
  drawAtomicLabels(vm, layout, grs);

  ctx.restore();
}

function screenToWorld(point) {
  return {
    x: (point.x - state.camera.pan.x) / state.camera.zoom,
    y: (point.y - state.camera.pan.y) / state.camera.zoom,
  };
}

function worldToScreen(point) {
  return {
    x: point.x * state.camera.zoom + state.camera.pan.x,
    y: point.y * state.camera.zoom + state.camera.pan.y,
  };
}

function hitTestAt(worldPoint) {
  // Atomic nodes win first (smaller hit zones, drawn on top conceptually).
  for (const node of state.viewModel.graph.nodes) {
    if (node.level === 'clustered') continue;
    const pos = state.layout.nodes[node.id];
    if (!pos) continue;
    const radius = 6 + (node.visualWeight ?? 0.5) * 1.8;
    const dx = worldPoint.x - pos.x;
    const dy = worldPoint.y - pos.y;
    if (dx * dx + dy * dy <= radius * radius) {
      return { kind: 'concept', id: node.id };
    }
  }
  // Cluster regions next.
  for (const cluster of state.layout.clusters) {
    const dx = worldPoint.x - cluster.x;
    const dy = worldPoint.y - cluster.y;
    if (dx * dx + dy * dy <= cluster.radius * cluster.radius) {
      return { kind: 'cluster', id: cluster.id };
    }
  }
  return null;
}

function clamp(v, lo, hi) {
  return Math.max(lo, Math.min(hi, v));
}

function zoomAround(screenPoint, factor) {
  const before = screenToWorld(screenPoint);
  state.camera.zoom = clamp(state.camera.zoom * factor, 0.2, 4);
  const after = screenToWorld(screenPoint);
  state.camera.pan.x += (after.x - before.x) * state.camera.zoom;
  state.camera.pan.y += (after.y - before.y) * state.camera.zoom;
}

function zoomAroundCenter(factor) {
  const cx = CANVAS_W / 2;
  const cy = CANVAS_H / 2;
  zoomAround({ x: cx, y: cy }, factor);
  render();
}

function fitCameraToLayout(padding = 60) {
  const clusters = state.layout.clusters;
  if (!clusters.length) return;
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const c of clusters) {
    minX = Math.min(minX, c.x - c.radius);
    minY = Math.min(minY, c.y - c.radius);
    maxX = Math.max(maxX, c.x + c.radius);
    maxY = Math.max(maxY, c.y + c.radius);
  }
  const worldW = maxX - minX;
  const worldH = maxY - minY;
  const screenW = CANVAS_W - padding * 2;
  const screenH = CANVAS_H - padding * 2;
  const zoom = Math.min(screenW / worldW, screenH / worldH);
  state.camera.zoom = zoom;
  state.camera.pan.x = padding - minX * zoom + (screenW - worldW * zoom) / 2;
  state.camera.pan.y = padding - minY * zoom + (screenH - worldH * zoom) / 2;
}

function drawBackground() {
  const bg = ctx.createRadialGradient(CANVAS_W / 2, CANVAS_H / 2, 80, CANVAS_W / 2, CANVAS_H / 2, 760);
  bg.addColorStop(0, '#1c1916');
  bg.addColorStop(1, '#0f0e0d');
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);
}

function drawClusterBodies(layout, grs) {
  const dimmedRegions = new Set(grs?.dimmedRegionIds ?? []);
  const emphasisByRegion = grs?.regionEmphasis ?? {};
  for (const cluster of layout.clusters) {
    const emphasis = emphasisByRegion[cluster.id] ?? 0.35;
    const isDimmed = dimmedRegions.has(cluster.id);
    const fillAlpha = isDimmed ? 0.06 : 0.10 + emphasis * 0.14;
    const strokeAlpha = isDimmed ? 0.16 : 0.28 + emphasis * 0.22;

    ctx.beginPath();
    ctx.fillStyle = hexToRgba(cluster.color, fillAlpha);
    ctx.strokeStyle = hexToRgba(cluster.color, strokeAlpha);
    ctx.lineWidth = 1.2;
    ctx.arc(cluster.x, cluster.y, cluster.radius, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();

    ctx.beginPath();
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.04)';
    ctx.arc(cluster.x, cluster.y, cluster.radius - 7, 0, Math.PI * 2);
    ctx.stroke();
  }
}

function drawEdges(vm, layout, grs) {
  const visible = grs?.visibleEdgeIds ? new Set(grs.visibleEdgeIds) : null;
  const activeEdge = new Set(grs?.activeEdgeIds ?? []);
  const activeNode = new Set(grs?.activeNodeIds ?? []);
  const selectedNode = new Set(grs?.selectedNodeIds ?? []);

  ctx.lineCap = 'round';
  for (const edge of vm.graph.edges) {
    if (visible && !visible.has(edge.id)) continue;
    const from = layout.nodes[edge.from];
    const to = layout.nodes[edge.to];
    if (!from || !to) continue;

    const sameCluster = sharedCluster(vm, edge.from, edge.to);
    const isActive = activeEdge.has(edge.id) || (activeNode.has(edge.from) && activeNode.has(edge.to));
    const touchesSelection = selectedNode.has(edge.from) || selectedNode.has(edge.to);

    const dx = to.x - from.x;
    const dy = to.y - from.y;
    const norm = Math.max(1, Math.hypot(dx, dy));
    const lift = sameCluster ? 14 : 38;
    const cx = (from.x + to.x) / 2 - (dy / norm) * lift;
    const cy = (from.y + to.y) / 2 + (dx / norm) * lift;

    ctx.beginPath();
    ctx.moveTo(from.x, from.y);
    ctx.quadraticCurveTo(cx, cy, to.x, to.y);
    ctx.strokeStyle = touchesSelection || isActive
      ? 'rgba(218, 184, 116, 0.95)'
      : sameCluster
        ? 'rgba(212, 188, 135, 0.30)'
        : 'rgba(143, 183, 199, 0.22)';
    ctx.lineWidth = touchesSelection ? 2 : isActive ? 1.4 : 0.85;
    ctx.stroke();
  }
}

function sharedCluster(vm, fromId, toId) {
  const from = vm.concepts.byId?.[fromId];
  const to = vm.concepts.byId?.[toId];
  const fromParent = from?.parentIds?.[0];
  const toParent = to?.parentIds?.[0];
  return fromParent && fromParent === toParent;
}

function drawAtomicNodes(vm, layout, grs) {
  const visible = new Set(grs?.visibleNodeIds ?? vm.graph.nodes.map((n) => n.id));
  const active = new Set(grs?.activeNodeIds ?? []);
  const dimmed = new Set(grs?.dimmedNodeIds ?? []);
  const selected = new Set(grs?.selectedNodeIds ?? []);

  for (const node of vm.graph.nodes) {
    if (node.level === 'clustered') continue;
    if (!visible.has(node.id)) continue;
    const pos = layout.nodes[node.id];
    if (!pos) continue;
    const radius = 3.2 + (node.visualWeight ?? 0.5) * 1.8;
    const isActive = active.has(node.id);
    const isDimmed = dimmed.has(node.id);
    const isSelected = selected.has(node.id);

    ctx.beginPath();
    ctx.fillStyle = isActive ? '#f4cf86' : '#b8a07a';
    ctx.globalAlpha = isSelected ? 1 : isActive ? 0.94 : isDimmed ? 0.28 : 0.7;
    ctx.arc(pos.x, pos.y, radius + (isSelected ? 1.5 : 0), 0, Math.PI * 2);
    ctx.fill();
    ctx.globalAlpha = 1;

    if (isSelected) {
      ctx.beginPath();
      ctx.strokeStyle = '#fff4db';
      ctx.lineWidth = 1.6;
      ctx.arc(pos.x, pos.y, radius + 4, 0, Math.PI * 2);
      ctx.stroke();
    }
  }
}

function drawClusterLabels(layout, grs) {
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.font = "500 18px 'Inter', system-ui, sans-serif";
  ctx.fillStyle = 'rgba(245, 234, 210, 0.92)';
  for (const cluster of layout.clusters) {
    const lines = wrapLabel(cluster.label, 2);
    const lineHeight = 22;
    const top = -((lines.length - 1) * lineHeight) / 2;
    lines.forEach((line, i) => {
      ctx.fillText(line, cluster.x, cluster.y + top + i * lineHeight);
    });
  }
}

function drawAtomicLabels(vm, layout, grs) {
  const labelVisible = new Set(grs?.labelVisibleNodeIds ?? vm.graph.nodes.map((n) => n.id));
  const active = new Set(grs?.activeNodeIds ?? []);
  const dimmed = new Set(grs?.dimmedNodeIds ?? []);

  ctx.font = "11px 'Inter', system-ui, sans-serif";
  ctx.textAlign = 'center';
  ctx.textBaseline = 'bottom';

  for (const node of vm.graph.nodes) {
    if (node.level === 'clustered') continue;
    if (!labelVisible.has(node.id)) continue;
    const pos = layout.nodes[node.id];
    if (!pos) continue;
    const isActive = active.has(node.id);
    const isDimmed = dimmed.has(node.id);
    ctx.fillStyle = `rgba(234, 227, 213, ${isDimmed ? 0.34 : isActive ? 0.92 : 0.7})`;
    ctx.fillText(node.label, pos.x, pos.y - 8);
  }
}

// ---------------------------------------------------------------------------
// Timeline renderers (copied from ui/app.js lines 611–663)
// ---------------------------------------------------------------------------

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
          const leftPct = (frame.span.start / total) * 100;
          const widthPct = (frame.duration / total) * 100;
          const isSelected = state.selectedFrameRef && state.selectedFrameRef.level === level && state.selectedFrameRef.index === frame.ref.index;
          const isActive = activeFrame?.ref.index === frame.ref.index;
          return `<button type="button" class="frame-segment ${isSelected ? 'selected-frame' : ''} ${isActive ? 'active-frame' : ''}" style="left:${leftPct}%;width:${widthPct}%" title="${escapeHtml(`${frameLabel(frame)} · ${formatTime(frame.span.start)} → ${formatTime(frame.span.end)}`)}" data-action="select-frame" data-level="${level}" data-index="${frame.ref.index}"></button>`;
        }).join('')}
        <div class="playhead" style="left: calc(${Math.min(100, Math.max(0, playheadPct))}% - 1px)"></div>
      </div>
    </div>
  `;
}

// ---------------------------------------------------------------------------
// Utilities
// ---------------------------------------------------------------------------

function wrapLabel(label, maxLines = 2) {
  const words = String(label).split(/\s+/).filter(Boolean);
  if (words.length <= 1) return [String(label)];
  const perLine = Math.ceil(words.length / maxLines);
  const out = [];
  for (let i = 0; i < words.length; i += perLine) {
    out.push(words.slice(i, i + perLine).join(' '));
  }
  return out.slice(0, maxLines);
}

function deterministicAngle(value) {
  return seededUnit(value) * Math.PI * 2;
}

function seededUnit(value) {
  let h = 0;
  for (let i = 0; i < value.length; i += 1) {
    h = ((h << 5) - h + value.charCodeAt(i)) | 0;
  }
  return (Math.abs(h) % 1000) / 1000;
}

function hexToRgba(hex, alpha) {
  const v = hex.replace('#', '');
  const n = Number.parseInt(v, 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${alpha})`;
}

function escapeHtml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

// ---------------------------------------------------------------------------
// Inspector helpers
// ---------------------------------------------------------------------------

function formatTime(seconds) {
  const total = Math.max(0, Math.floor(seconds || 0));
  const hh = Math.floor(total / 3600);
  const mm = Math.floor((total % 3600) / 60);
  const ss = total % 60;
  if (hh > 0) return `${hh}:${String(mm).padStart(2, '0')}:${String(ss).padStart(2, '0')}`;
  return `${mm}:${String(ss).padStart(2, '0')}`;
}

function frameLabel(frame) {
  return `${frame.ref.level} ${frame.ref.index + 1}${frame.title ? ` · ${frame.title}` : ''}`;
}

function numberOrDash(value, digits = 2) {
  return value == null ? '—' : Number(value).toFixed(digits);
}

function renderStat(label, value) {
  return `
    <div class="stat-card">
      <div class="label">${escapeHtml(label)}</div>
      <div class="value">${escapeHtml(String(value))}</div>
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

// ---------------------------------------------------------------------------
// Inspector renderers (copied from ui/app.js)
// ---------------------------------------------------------------------------

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
