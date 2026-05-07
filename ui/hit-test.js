// ---------------------------------------------------------------------------
// Hit-test — pointer-to-world-space node/cluster detection
// ---------------------------------------------------------------------------

export function hitTestAt(state, worldPoint) {
  // Hit-test only what is currently drawn. visibleNodeIds is already
  // gated by cumulative visibility (see buildGraphRenderState). Cluster
  // hits also need the cumulative cluster gate so empty cluster regions
  // don't accept clicks before the cluster has appeared.
  const visibleNodes = state.graphRenderState?.visibleNodeIds
    ? new Set(state.graphRenderState.visibleNodeIds)
    : null;
  const visibleClusters = state.graphRenderState?.cumulativeVisibleClusterIds
    ? new Set(state.graphRenderState.cumulativeVisibleClusterIds)
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
  for (const cluster of state.layout.clusters) {
    if (visibleClusters && !visibleClusters.has(cluster.id)) continue;
    const dx = worldPoint.x - cluster.x;
    const dy = worldPoint.y - cluster.y;
    if (dx * dx + dy * dy <= cluster.radius * cluster.radius) {
      return { kind: 'cluster', id: cluster.id };
    }
  }
  return null;
}
