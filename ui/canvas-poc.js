import { buildMindgraphViewModel } from '../src/view-model/buildMindgraphViewModel.js';

const DOC_PATH = '../examples/out/episode-1-built.mindgraph.json';
const CANVAS_W = 1280;
const CANVAS_H = 800;

// Hand-placed cluster anchors, taken from the cytoscape spike but rescaled
// to the larger 1280x800 canvas so each cluster has room to breathe.
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
  draw(state.viewModel, state.layout);
}

// ---------------------------------------------------------------------------
// Sub-render stubs (wired progressively in later tasks)
// ---------------------------------------------------------------------------

function computeGraphRenderState() {
  return undefined; // wired in Task 6
}

function updateTopbar() {
  const titleEl = document.getElementById('topbar-title');
  const statusEl = document.getElementById('topbar-status');
  if (titleEl) titleEl.innerHTML =
    `<h1>${escapeHtml(state.viewModel.documentMeta.title)}</h1>` +
    `<p class="muted">${escapeHtml((state.document.transcript?.speakers || []).join(', ') || 'Unknown speaker')} · ${state.viewModel.documentMeta.counts.atomicConcepts} atomic concepts</p>`;
  if (statusEl) statusEl.textContent = '';
}

function updateInspectorPanel() {
  // wired in Task 3
}

function updateTimelinePanel() {
  // wired in Task 4
}

function bindEvents() {
  // wired progressively in later tasks
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

function draw(vm, layout) {
  drawBackground();
  drawClusterBodies(layout);
  drawEdges(vm, layout);
  drawAtomicNodes(vm, layout);
  drawClusterLabels(layout);
  drawAtomicLabels(vm, layout);
}

function drawBackground() {
  const bg = ctx.createRadialGradient(CANVAS_W / 2, CANVAS_H / 2, 80, CANVAS_W / 2, CANVAS_H / 2, 760);
  bg.addColorStop(0, '#1c1916');
  bg.addColorStop(1, '#0f0e0d');
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);
}

function drawClusterBodies(layout) {
  for (const cluster of layout.clusters) {
    ctx.beginPath();
    ctx.fillStyle = hexToRgba(cluster.color, 0.16);
    ctx.strokeStyle = hexToRgba(cluster.color, 0.34);
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

function drawEdges(vm, layout) {
  ctx.lineCap = 'round';
  for (const edge of vm.graph.edges) {
    const from = layout.nodes[edge.from];
    const to = layout.nodes[edge.to];
    if (!from || !to) continue;
    const sameCluster = sharedCluster(vm, edge.from, edge.to);

    const dx = to.x - from.x;
    const dy = to.y - from.y;
    const norm = Math.max(1, Math.hypot(dx, dy));
    const lift = sameCluster ? 14 : 38;
    const cx = (from.x + to.x) / 2 - (dy / norm) * lift;
    const cy = (from.y + to.y) / 2 + (dx / norm) * lift;

    ctx.beginPath();
    ctx.moveTo(from.x, from.y);
    ctx.quadraticCurveTo(cx, cy, to.x, to.y);
    ctx.strokeStyle = sameCluster
      ? 'rgba(212, 188, 135, 0.30)'
      : 'rgba(143, 183, 199, 0.22)';
    ctx.lineWidth = 0.85;
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

function drawAtomicNodes(vm, layout) {
  for (const node of vm.graph.nodes) {
    if (node.level === 'clustered') continue;
    const pos = layout.nodes[node.id];
    if (!pos) continue;
    const radius = 3.2 + (node.visualWeight ?? 0.5) * 1.8;
    ctx.beginPath();
    ctx.fillStyle = '#b8a07a';
    ctx.globalAlpha = 0.78;
    ctx.arc(pos.x, pos.y, radius, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalAlpha = 1;
  }
}

function drawClusterLabels(layout) {
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

function drawAtomicLabels(vm, layout) {
  ctx.font = "11px 'Inter', system-ui, sans-serif";
  ctx.fillStyle = 'rgba(234, 227, 213, 0.55)';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'bottom';
  for (const node of vm.graph.nodes) {
    if (node.level === 'clustered') continue;
    const pos = layout.nodes[node.id];
    if (!pos) continue;
    ctx.fillText(node.label, pos.x, pos.y - 8);
  }
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
