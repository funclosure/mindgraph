// ---------------------------------------------------------------------------
// Draw — canvas rendering: background, edges, nodes, labels
// ---------------------------------------------------------------------------

import { computeVisibleLabels } from './labels.js';
import { clusterColor } from './layout.js';

export function draw(ctx, state) {
  const { viewModel: vm, layout, graphRenderState: grs, viewport, animator } = state;
  const dpr = window.devicePixelRatio || 1;

  // Background — screen space.
  ctx.save();
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  drawBackground(ctx, viewport);
  ctx.restore();

  // World-space layer: edges, dots.
  ctx.save();
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.translate(state.camera.pan.x, state.camera.pan.y);
  ctx.scale(state.camera.zoom, state.camera.zoom);

  drawEdges(ctx, vm, layout, grs, animator);
  drawAtomicNodes(ctx, vm, layout, grs, animator);

  ctx.restore();

  // Screen-space layer: labels.
  ctx.save();
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  drawLabels(ctx, state);
  ctx.restore();
}

function drawBackground(ctx, viewport) {
  const w = viewport?.width ?? 0;
  const h = viewport?.height ?? 0;
  const cx = w / 2;
  const cy = h / 2;
  const radius = Math.max(w, h);
  const bg = ctx.createRadialGradient(cx, cy, Math.min(80, radius * 0.1), cx, cy, radius);
  bg.addColorStop(0, '#1c1916');
  bg.addColorStop(1, '#0f0e0d');
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, w, h);
}

function dotRadius(node) {
  return Math.max(2.5, Math.min(6, 2.5 + (node?.degree ?? 0) * 0.4));
}

function drawEdges(ctx, vm, layout, grs, animator) {
  const visible = grs?.visibleEdgeIds ? new Set(grs.visibleEdgeIds) : null;
  const activeEdge = new Set(grs?.activeEdgeIds ?? []);
  const selectedNode = new Set(grs?.selectedNodeIds ?? []);

  // Small visual gap between line endpoint and dot perimeter, so the line
  // doesn't kiss the dot — feels less crowded at typical zooms.
  const gap = 1.5;

  ctx.lineCap = 'round';
  for (const edge of vm.graph.edges) {
    if (visible && !visible.has(edge.id)) continue;
    const animOpacity = animator?.getEntityState(edge.id)?.opacity ?? 1;
    if (animOpacity <= 0.001) continue;
    const from = layout.nodes[edge.from];
    const to = layout.nodes[edge.to];
    if (!from || !to) continue;

    // Back the line off each endpoint by that node's dot radius (+ a small
    // gap), so edges terminate at the dot's perimeter rather than running
    // under the dot's interior.
    const dx = to.x - from.x;
    const dy = to.y - from.y;
    const dist = Math.sqrt(dx * dx + dy * dy);
    if (dist < 0.001) continue;
    const ux = dx / dist;
    const uy = dy / dist;
    const fromR = dotRadius(vm.graph.nodeById[edge.from]) + gap;
    const toR = dotRadius(vm.graph.nodeById[edge.to]) + gap;
    if (fromR + toR >= dist) continue; // dots overlap; skip rather than draw a weird stub
    const x1 = from.x + ux * fromR;
    const y1 = from.y + uy * fromR;
    const x2 = to.x - ux * toR;
    const y2 = to.y - uy * toR;

    const touchesSelection = selectedNode.has(edge.from) || selectedNode.has(edge.to);
    const isActive = activeEdge.has(edge.id);

    const baseAlpha = touchesSelection || isActive ? 0.95 : 0.16;
    ctx.strokeStyle = `rgba(218, 184, 116, ${baseAlpha * animOpacity})`;
    ctx.lineWidth = touchesSelection ? 1.4 : isActive ? 1.0 : 0.6;

    ctx.beginPath();
    ctx.moveTo(x1, y1);
    ctx.lineTo(x2, y2);
    ctx.stroke();
  }
}

function drawAtomicNodes(ctx, vm, layout, grs, animator) {
  const visible = new Set(grs?.visibleNodeIds ?? vm.graph.nodes.map((n) => n.id));
  const active = new Set(grs?.activeNodeIds ?? []);
  const dimmed = new Set(grs?.dimmedNodeIds ?? []);
  const selected = new Set(grs?.selectedNodeIds ?? []);

  for (const node of vm.graph.nodes) {
    if (node.level === 'clustered') continue;
    if (!visible.has(node.id)) continue;
    const pos = layout.nodes[node.id];
    if (!pos) continue;
    const animOpacity = animator?.getEntityState(node.id)?.opacity ?? 1;
    if (animOpacity <= 0.001) continue;
    const animScale = animator?.getEntityState(node.id)?.scale ?? 1;
    const radius = dotRadius(node) * animScale;
    const isActive = active.has(node.id);
    const isDimmed = dimmed.has(node.id);
    const isSelected = selected.has(node.id);

    const parentClusterId = node.parentIds?.[0];
    const fillColor = parentClusterId ? clusterColor(parentClusterId) : '#b8a07a';

    ctx.beginPath();
    ctx.fillStyle = isActive
      ? brightenForActive(fillColor)
      : fillColor;
    ctx.globalAlpha = (isSelected ? 1 : isActive ? 0.95 : isDimmed ? 0.22 : 0.85) * animOpacity;
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

function drawLabels(ctx, state) {
  const labels = computeVisibleLabels({
    viewModel: state.viewModel,
    layout: state.layout,
    camera: state.camera,
    viewport: state.viewport,
    renderState: state.graphRenderState,
    ctx,
    hoveredConceptId: state.hoveredConceptId,
    selectedConceptId: state.selectedConceptId,
  });

  ctx.font = "11px 'Inter', system-ui, sans-serif";
  ctx.textAlign = 'center';
  ctx.textBaseline = 'bottom';
  for (const label of labels) {
    ctx.fillStyle = `rgba(234, 227, 213, ${label.alpha})`;
    ctx.fillText(label.text, label.x, label.y);
  }
}

function brightenForActive(hex) {
  // hex is "#RRGGBB" — bump each channel toward white by ~20% for active state.
  // Approximates a gentle "glow" without re-doing HSL math.
  const m = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex);
  if (!m) return hex;
  const lift = (c) => {
    const n = Number.parseInt(c, 16);
    return Math.min(255, Math.round(n + (255 - n) * 0.20)).toString(16).padStart(2, '0');
  };
  return `#${lift(m[1])}${lift(m[2])}${lift(m[3])}`;
}
