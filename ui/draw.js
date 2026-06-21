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

export function edgeRenderStyle(edge, { touchesSelection = false, isActive = false, animOpacity = 1 } = {}) {
  const inferred = edge?.provenance === 'inferred';
  const alpha = touchesSelection || isActive
    ? 0.95
    : inferred ? 0.22 : 0.16;
  const lineWidth = touchesSelection
    ? 1.4
    : isActive ? 1.0 : inferred ? 0.8 : 0.6;
  const dash = inferred
    ? (touchesSelection || isActive ? [7, 4] : [6, 4])
    : [];
  return {
    alpha,
    strokeStyle: `rgba(218, 184, 116, ${alpha * animOpacity})`,
    lineWidth,
    dash,
  };
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

    const style = edgeRenderStyle(edge, { touchesSelection, isActive, animOpacity });
    ctx.strokeStyle = style.strokeStyle;
    ctx.lineWidth = style.lineWidth;

    // Inferred edges render dashed so the user can tell at a glance which
    // relations were added by the agent from world knowledge vs derived from
    // the source. Passive inferred edges get slightly more alpha/width than
    // passive source edges so the dash remains legible at overview zoom.
    ctx.setLineDash(style.dash);

    ctx.beginPath();
    ctx.moveTo(x1, y1);
    ctx.lineTo(x2, y2);
    ctx.stroke();

    ctx.setLineDash([]);
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
    const animState = animator?.getEntityState(node.id);
    const animOpacity = animState?.opacity ?? 1;
    if (animOpacity <= 0.001) continue;
    const animScale = animState?.scale ?? 1;
    const radius = dotRadius(node) * animScale;
    const isActive = active.has(node.id);
    const isDimmed = dimmed.has(node.id);
    const isSelected = selected.has(node.id);

    // Highlight tier (alpha + tint) is eased by the animator across frames so
    // active↔dim transitions slide instead of snapping. Fall back to inline
    // target values for the very first frame, before the animator has seeded.
    const hAlpha = animState?.highlightAlpha ?? (
      isSelected ? 1 : isDimmed ? 0.22 : isActive ? 0.95 : 0.85
    );
    const hTint = animState?.highlightTint ?? (isActive && !isDimmed ? 1 : 0);

    const parentClusterId = node.parentIds?.[0];
    const baseColor = parentClusterId ? clusterColor(parentClusterId) : '#b8a07a';
    const fillColor = hTint > 0.001
      ? lerpHex(baseColor, brightenForActive(baseColor), hTint)
      : baseColor;

    ctx.beginPath();
    ctx.fillStyle = fillColor;
    ctx.globalAlpha = hAlpha * animOpacity;
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

function lerpHex(a, b, t) {
  // Per-channel linear interpolation between two "#RRGGBB" strings, returning
  // the same shape. Drives the smooth tint transition between base cluster
  // color and brightenForActive() output as an atom moves in/out of the
  // active set. Both endpoints are precomputed by the caller per frame.
  const ma = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(a);
  const mb = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(b);
  if (!ma || !mb) return a;
  const clamped = Math.max(0, Math.min(1, t));
  const blend = (i) => {
    const x = Number.parseInt(ma[i], 16);
    const y = Number.parseInt(mb[i], 16);
    return Math.round(x + (y - x) * clamped).toString(16).padStart(2, '0');
  };
  return `#${blend(1)}${blend(2)}${blend(3)}`;
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
