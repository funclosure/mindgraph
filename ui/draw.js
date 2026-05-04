// ---------------------------------------------------------------------------
// Draw — canvas rendering: background, clusters, edges, nodes, labels
// ---------------------------------------------------------------------------

import { hexToRgba, wrapLabel } from './util.js';

const CANVAS_W = 1280;
const CANVAS_H = 800;

export function draw(ctx, state) {
  const { viewModel: vm, layout, graphRenderState: grs } = state;

  ctx.save();
  ctx.setTransform(window.devicePixelRatio || 1, 0, 0, window.devicePixelRatio || 1, 0, 0);
  drawBackground(ctx);
  ctx.restore();

  ctx.save();
  const dpr = window.devicePixelRatio || 1;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.translate(state.camera.pan.x, state.camera.pan.y);
  ctx.scale(state.camera.zoom, state.camera.zoom);

  drawClusterBodies(ctx, layout, grs);
  drawEdges(ctx, vm, layout, grs);
  drawAtomicNodes(ctx, vm, layout, grs);
  drawClusterLabels(ctx, layout, grs);
  drawAtomicLabels(ctx, vm, layout, grs);

  ctx.restore();
}

function drawBackground(ctx) {
  const bg = ctx.createRadialGradient(CANVAS_W / 2, CANVAS_H / 2, 80, CANVAS_W / 2, CANVAS_H / 2, 760);
  bg.addColorStop(0, '#1c1916');
  bg.addColorStop(1, '#0f0e0d');
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);
}

function drawClusterBodies(ctx, layout, grs) {
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

function sharedCluster(vm, fromId, toId) {
  const from = vm.concepts.byId?.[fromId];
  const to = vm.concepts.byId?.[toId];
  const fromParent = from?.parentIds?.[0];
  const toParent = to?.parentIds?.[0];
  return fromParent && fromParent === toParent;
}

function drawEdges(ctx, vm, layout, grs) {
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

function drawAtomicNodes(ctx, vm, layout, grs) {
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

function drawClusterLabels(ctx, layout, grs) {
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

function drawAtomicLabels(ctx, vm, layout, grs) {
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
