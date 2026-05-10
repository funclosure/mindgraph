// ---------------------------------------------------------------------------
// Hit-test — pointer-to-world-space node detection
// ---------------------------------------------------------------------------

export function hitTestAt(state, worldPoint) {
  // Hit-test only what is currently drawn. visibleNodeIds is already
  // gated by cumulative visibility (see buildGraphRenderState).
  const visibleNodes = state.graphRenderState?.visibleNodeIds
    ? new Set(state.graphRenderState.visibleNodeIds)
    : null;

  for (const node of state.viewModel.graph.nodes) {
    if (node.level === 'clustered') continue;
    if (visibleNodes && !visibleNodes.has(node.id)) continue;
    const pos = state.layout.nodes[node.id];
    if (!pos) continue;
    const radius = 6 + (node.visualWeight ?? 0.5) * 1.8;
    const dx = worldPoint.x - pos.x;
    const dy = worldPoint.y - pos.y;
    if (dx * dx + dy * dy <= radius * radius) {
      return { kind: 'concept', id: node.id };
    }
  }
  return null;
}
