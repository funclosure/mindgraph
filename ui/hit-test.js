// ---------------------------------------------------------------------------
// Hit-test — pointer-to-world-space node/cluster detection
// ---------------------------------------------------------------------------

export function hitTestAt(state, worldPoint) {
  // Hit-test only what's currently drawn — what you see is what you can click.
  // visibleNodeIds reflects the render-state at the current zoom / selection.
  const visible = state.graphRenderState?.visibleNodeIds
    ? new Set(state.graphRenderState.visibleNodeIds)
    : null;

  // Atomic nodes win first (smaller hit zones, drawn on top conceptually).
  for (const node of state.viewModel.graph.nodes) {
    if (node.level === 'clustered') continue;
    if (visible && !visible.has(node.id)) continue;
    const pos = state.layout.nodes[node.id];
    if (!pos) continue;
    const radius = 6 + (node.visualWeight ?? 0.5) * 1.8;
    const dx = worldPoint.x - pos.x;
    const dy = worldPoint.y - pos.y;
    if (dx * dx + dy * dy <= radius * radius) {
      return { kind: 'concept', id: node.id };
    }
  }
  // Cluster regions next. Cluster bodies are always drawn, so always hit-testable.
  for (const cluster of state.layout.clusters) {
    const dx = worldPoint.x - cluster.x;
    const dy = worldPoint.y - cluster.y;
    if (dx * dx + dy * dy <= cluster.radius * cluster.radius) {
      return { kind: 'cluster', id: cluster.id };
    }
  }
  return null;
}
