// ---------------------------------------------------------------------------
// Draw — canvas rendering: background, clusters, edges, nodes, labels
// ---------------------------------------------------------------------------

import { hexToRgba } from './util.js';
import { computeVisibleLabels } from './labels.js';

export function draw(ctx, state) {
  const { viewModel: vm, layout, graphRenderState: grs, viewport, animator } = state;
  const dpr = window.devicePixelRatio || 1;

  // Background — screen space.
  ctx.save();
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  drawBackground(ctx, viewport);
  ctx.restore();

  // World-space layer: clusters, edges, dots.
  ctx.save();
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.translate(state.camera.pan.x, state.camera.pan.y);
  ctx.scale(state.camera.zoom, state.camera.zoom);

  drawClusterBodies(ctx, layout, grs, animator);
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

function drawClusterBodies(ctx, layout, grs, animator) {
  const dimmedRegions = new Set(grs?.dimmedRegionIds ?? []);
  const emphasisByRegion = grs?.regionEmphasis ?? {};
  const visibleClusters = new Set(grs?.cumulativeVisibleClusterIds ?? []);
  for (const cluster of layout.clusters) {
    if (!visibleClusters.has(cluster.id)) continue;
    const animOpacity = animator?.getEntityState(cluster.id)?.opacity ?? 1;
    if (animOpacity <= 0.001) continue;
    const animScale = animator?.getEntityState(cluster.id)?.scale ?? 1;
    const emphasis = emphasisByRegion[cluster.id] ?? 0.35;
    const isDimmed = dimmedRegions.has(cluster.id);
    const fillAlpha = (isDimmed ? 0.06 : 0.10 + emphasis * 0.14) * animOpacity;
    const strokeAlpha = (isDimmed ? 0.16 : 0.28 + emphasis * 0.22) * animOpacity;

    ctx.beginPath();
    ctx.fillStyle = hexToRgba(cluster.color, fillAlpha);
    ctx.strokeStyle = hexToRgba(cluster.color, strokeAlpha);
    ctx.lineWidth = 1.2;
    ctx.arc(cluster.x, cluster.y, cluster.radius * animScale, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();

    ctx.beginPath();
    ctx.strokeStyle = `rgba(255, 255, 255, ${0.04 * animOpacity})`;
    ctx.arc(cluster.x, cluster.y, (cluster.radius - 7) * animScale, 0, Math.PI * 2);
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

function drawEdges(ctx, vm, layout, grs, animator) {
  const visible = grs?.visibleEdgeIds ? new Set(grs.visibleEdgeIds) : null;
  const activeEdge = new Set(grs?.activeEdgeIds ?? []);
  const activeNode = new Set(grs?.activeNodeIds ?? []);
  const selectedNode = new Set(grs?.selectedNodeIds ?? []);

  ctx.lineCap = 'round';
  for (const edge of vm.graph.edges) {
    if (visible && !visible.has(edge.id)) continue;
    const animOpacity = animator?.getEntityState(edge.id)?.opacity ?? 1;
    if (animOpacity <= 0.001) continue;
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
    const baseAlpha = touchesSelection || isActive ? 0.95 : sameCluster ? 0.30 : 0.22;
    const baseColor = touchesSelection || isActive
      ? `rgba(218, 184, 116, ${baseAlpha * animOpacity})`
      : sameCluster
        ? `rgba(212, 188, 135, ${baseAlpha * animOpacity})`
        : `rgba(143, 183, 199, ${baseAlpha * animOpacity})`;
    ctx.strokeStyle = baseColor;
    ctx.lineWidth = touchesSelection ? 2 : isActive ? 1.4 : 0.85;
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
    const radius = Math.max(2.5, Math.min(6, 2.5 + (node.degree ?? 0) * 0.4)) * animScale;
    const isActive = active.has(node.id);
    const isDimmed = dimmed.has(node.id);
    const isSelected = selected.has(node.id);

    ctx.beginPath();
    ctx.fillStyle = isActive ? '#f4cf86' : '#b8a07a';
    ctx.globalAlpha = (isSelected ? 1 : isActive ? 0.94 : isDimmed ? 0.28 : 0.7) * animOpacity;
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
