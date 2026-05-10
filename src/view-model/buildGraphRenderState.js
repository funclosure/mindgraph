function buildCumulativeVisibility(viewModel, playheadTime) {
  const conceptIds = new Set();
  const clusterIds = new Set();
  // viewModel.graph.nodes does not carry firstSeenAt — the field lives on
  // viewModel.concepts.{atomic,clustered} where it was derived in Task 1.
  for (const concept of [...viewModel.concepts.atomic, ...viewModel.concepts.clustered]) {
    if (typeof concept.firstSeenAt !== 'number') continue;
    if (concept.firstSeenAt <= playheadTime) {
      conceptIds.add(concept.id);
    }
  }
  // A cluster is visible if at least one of its members is visible.
  // (Cluster nodes themselves use the cluster's own firstSeenAt — set during
  // buildConceptsVM derivation — but we also include any cluster whose
  // children are visible, in case the cluster itself has no activation.)
  for (const cluster of viewModel.concepts.clustered) {
    if (conceptIds.has(cluster.id)) {
      clusterIds.add(cluster.id);
      continue;
    }
    const childIds = viewModel.concepts.childrenByClusterId[cluster.id] ?? [];
    if (childIds.some((id) => conceptIds.has(id))) clusterIds.add(cluster.id);
  }
  // Make sure clusters that are visible are also in the conceptIds set
  // (cluster-level concepts share id space with the graph's "clustered" nodes).
  for (const id of clusterIds) conceptIds.add(id);
  const edgeIds = new Set();
  for (const edge of viewModel.graph.edges) {
    if (conceptIds.has(edge.from) && conceptIds.has(edge.to)) edgeIds.add(edge.id);
  }
  return { conceptIds, clusterIds, edgeIds };
}

function deriveCameraTarget(viewModel, layout, viewport, opts) {
  if (!layout || !viewport) return undefined;
  const { activeLevel, playheadTime, cumulative } = opts;
  const frame = viewModel.selectors.getActiveFrameAtTime(activeLevel, playheadTime);
  const fg = frame?.foregroundConcepts ?? [];

  const pointFor = (id) => layout.nodes[id];

  // Case 1: no active frame → fit visible clusters.
  if (!frame || !fg.length) {
    const clusters = layout.clusters.filter((c) => cumulative.clusterIds.has(c.id));
    if (!clusters.length) return undefined;
    return boundsOfClusters(clusters, viewport, 0.15);
  }

  // Case 2: single foreground concept → use its parent cluster.
  if (fg.length === 1) {
    const concept = viewModel.concepts.byId[fg[0].id];
    const parentClusterId = concept?.parentIds?.[0] ?? concept?.id;
    const cluster = layout.clusters.find((c) => c.id === parentClusterId);
    if (cluster) return boundsOfClusters([cluster], viewport, 0.20);
    const point = pointFor(fg[0].id);
    if (!point) return undefined;
    return boundsAroundPoint(point, 200, viewport);
  }

  // Case 3: multiple foreground concepts → weighted center, unweighted bbox, padded.
  const points = fg.map((a) => ({ pos: pointFor(a.id), weight: a.weight ?? 0.5 }))
    .filter((p) => p.pos);
  if (!points.length) return undefined;
  const totalWeight = points.reduce((s, p) => s + p.weight, 0) || 1;
  const cx = points.reduce((s, p) => s + p.pos.x * p.weight, 0) / totalWeight;
  const cy = points.reduce((s, p) => s + p.pos.y * p.weight, 0) / totalWeight;
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const p of points) {
    if (p.pos.x < minX) minX = p.pos.x;
    if (p.pos.y < minY) minY = p.pos.y;
    if (p.pos.x > maxX) maxX = p.pos.x;
    if (p.pos.y > maxY) maxY = p.pos.y;
  }
  return fitTarget(minX, minY, maxX, maxY, cx, cy, viewport, 0.15);
}

function boundsOfClusters(clusters, viewport, pad) {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const c of clusters) {
    minX = Math.min(minX, c.x - c.radius);
    minY = Math.min(minY, c.y - c.radius);
    maxX = Math.max(maxX, c.x + c.radius);
    maxY = Math.max(maxY, c.y + c.radius);
  }
  const cx = (minX + maxX) / 2;
  const cy = (minY + maxY) / 2;
  return fitTarget(minX, minY, maxX, maxY, cx, cy, viewport, pad);
}

function boundsAroundPoint(point, radius, viewport) {
  return fitTarget(
    point.x - radius, point.y - radius,
    point.x + radius, point.y + radius,
    point.x, point.y, viewport, 0.15,
  );
}

function fitTarget(minX, minY, maxX, maxY, cx, cy, viewport, pad) {
  const worldW = Math.max(1, maxX - minX);
  const worldH = Math.max(1, maxY - minY);
  const padFactor = 1 + pad * 2;
  const screenW = Math.max(1, viewport.width);
  const screenH = Math.max(1, viewport.height);
  const zoom = Math.min(
    screenW / (worldW * padFactor),
    screenH / (worldH * padFactor),
  );
  return { cx, cy, zoom: Math.max(0.2, Math.min(4, zoom)) };
}

function scoreNodeBase(node) {
  return (
    (node.stats?.peakActivation ?? node.visualWeight ?? 0.5) * 0.45
    + Math.min(1, (node.stats?.recurrenceCount ?? 0) / 12) * 0.35
    + Math.min(1, (node.stats?.totalActivation ?? 0) / 10) * 0.2
  );
}

function addWeight(map, id, amount) {
  if (!id) return;
  map.set(id, (map.get(id) ?? 0) + amount);
}

function unique(ids) {
  return [...new Set(ids.filter(Boolean))];
}

function inferViewportMode({ zoomLevel, focusMode }) {
  if (focusMode === 'concept' || focusMode === 'frame') return 'local';
  if (zoomLevel >= 1.75) return 'local';
  if (zoomLevel >= 1.15) return 'region';
  return 'overview';
}

function buildFocusSets(viewModel, { selectedConceptId, selectedFrameRef, playheadTime, activeLevel }) {
  const focusMode = selectedConceptId
    ? 'concept'
    : selectedFrameRef
      ? 'frame'
      : 'playhead';

  const selectedNodeIds = unique([
    selectedConceptId,
    ...(selectedFrameRef ? viewModel.selectors.getFrameConcepts(selectedFrameRef).map((a) => a.id) : []),
  ]);

  const activeNodeIds = unique(viewModel.selectors.getActiveConceptIdsAtTime(playheadTime, activeLevel));
  const playheadRelationIds = unique(viewModel.selectors.getActiveRelationActivationsAtTime(playheadTime, activeLevel).map((a) => a.id));

  const primaryFocusIds = selectedConceptId
    ? [selectedConceptId]
    : selectedFrameRef
      ? unique(viewModel.selectors.getFrameConcepts(selectedFrameRef).map((a) => a.id))
      : activeNodeIds;

  const nearContextIds = unique(primaryFocusIds.flatMap((id) => viewModel.selectors.getConceptNeighbors(id).map((concept) => concept.id)));
  const farContextIds = unique(nearContextIds.flatMap((id) => viewModel.selectors.getConceptNeighbors(id).map((concept) => concept.id)));
  const selectedClusterIds = unique(primaryFocusIds.flatMap((id) => viewModel.selectors.getConceptClusters(id).map((concept) => concept.id)));

  return {
    focusMode,
    selectedNodeIds,
    activeNodeIds,
    playheadRelationIds,
    primaryFocusIds,
    nearContextIds,
    farContextIds,
    selectedClusterIds,
  };
}

export function buildGraphRenderState(viewModel, {
  selectedConceptId,
  selectedFrameRef,
  playheadTime,
  activeLevel = 'meso',
  zoomLevel = 1,
  layout,
  viewport,
} = {}) {
  const focus = buildFocusSets(viewModel, { selectedConceptId, selectedFrameRef, playheadTime, activeLevel });
  const cumulative = buildCumulativeVisibility(viewModel, playheadTime);
  const viewportMode = inferViewportMode({ zoomLevel, focusMode: focus.focusMode });
  const nodeScores = new Map();
  const activeEdgeIds = new Set();
  const neighborNodeIds = new Set(focus.nearContextIds);
  const selectedNodeIds = new Set(focus.selectedNodeIds);
  const activeNodeIds = new Set(focus.activeNodeIds);
  const labelVisibleNodeIds = new Set();
  const visibleNodeIds = new Set();
  const visibleClusterIds = new Set();
  const visibleEdgeIds = new Set();
  const dimmedNodeIds = new Set();
  const dimmedRegionIds = new Set();
  const regionEmphasis = {};

  for (const node of viewModel.graph.nodes) {
    const base = scoreNodeBase(node);
    addWeight(nodeScores, node.id, base);

    if (node.level === 'clustered') addWeight(nodeScores, node.id, 1.2);
    if (focus.primaryFocusIds.includes(node.id)) addWeight(nodeScores, node.id, 2.8);
    if (focus.nearContextIds.includes(node.id)) addWeight(nodeScores, node.id, 1.1);
    if (focus.farContextIds.includes(node.id)) addWeight(nodeScores, node.id, 0.35);
    if (focus.activeNodeIds.includes(node.id)) addWeight(nodeScores, node.id, 1.35);
    if (focus.selectedClusterIds.includes(node.id)) addWeight(nodeScores, node.id, 1.6);
    if (node.regionKey && focus.selectedClusterIds.includes(node.regionKey)) addWeight(nodeScores, node.id, 0.95);
  }

  const atomicNodes = viewModel.graph.nodes.filter((node) => node.level === 'atomic');
  const sortedAtomic = [...atomicNodes].sort((a, b) => (nodeScores.get(b.id) ?? 0) - (nodeScores.get(a.id) ?? 0));

  const atomicVisibleCount = viewportMode === 'overview' ? 16 : viewportMode === 'region' ? 30 : 48;
  const atomicLabelCount = viewportMode === 'overview' ? 8 : viewportMode === 'region' ? 16 : 28;

  for (const cluster of viewModel.concepts.clustered) {
    visibleNodeIds.add(cluster.id);
    visibleClusterIds.add(cluster.id);
    labelVisibleNodeIds.add(cluster.id);
  }

  for (const node of sortedAtomic.slice(0, atomicVisibleCount)) {
    visibleNodeIds.add(node.id);
    if (node.regionKey) visibleClusterIds.add(node.regionKey);
  }

  for (const id of [...focus.primaryFocusIds, ...focus.nearContextIds, ...focus.activeNodeIds]) {
    visibleNodeIds.add(id);
    const node = viewModel.graph.nodeById[id];
    if (node?.regionKey) visibleClusterIds.add(node.regionKey);
  }

  for (const node of sortedAtomic.slice(0, atomicLabelCount)) labelVisibleNodeIds.add(node.id);
  for (const id of [...focus.primaryFocusIds, ...focus.nearContextIds, ...focus.activeNodeIds, ...focus.selectedClusterIds]) {
    labelVisibleNodeIds.add(id);
  }

  for (const edge of viewModel.graph.edges) {
    const touchesSelected = selectedNodeIds.has(edge.from) || selectedNodeIds.has(edge.to);
    const touchesPrimary = focus.primaryFocusIds.includes(edge.from) || focus.primaryFocusIds.includes(edge.to);
    const touchesNear = neighborNodeIds.has(edge.from) || neighborNodeIds.has(edge.to);
    const bothVisible = visibleNodeIds.has(edge.from) && visibleNodeIds.has(edge.to);
    const bothActive = activeNodeIds.has(edge.from) && activeNodeIds.has(edge.to);
    const sameRegion = viewModel.graph.nodeById[edge.from]?.regionKey && viewModel.graph.nodeById[edge.from]?.regionKey === viewModel.graph.nodeById[edge.to]?.regionKey;

    if (bothActive || focus.playheadRelationIds.includes(edge.id)) activeEdgeIds.add(edge.id);

    const shouldShow = (
      bothActive
      || touchesSelected
      || touchesPrimary
      || (viewportMode !== 'overview' && touchesNear && bothVisible)
      || (viewportMode === 'local' && bothVisible && sameRegion)
      || (viewportMode === 'overview' && bothVisible && touchesPrimary)
    );

    if (shouldShow) visibleEdgeIds.add(edge.id);
  }

  for (const cluster of viewModel.concepts.clustered) {
    const childIds = viewModel.concepts.childrenByClusterId[cluster.id] ?? [];
    const visibleChildren = childIds.filter((id) => visibleNodeIds.has(id)).length;
    const activeChildren = childIds.filter((id) => activeNodeIds.has(id)).length;
    const emphasis = Math.min(1, (visibleChildren / Math.max(1, Math.min(childIds.length, 8))) * 0.55 + activeChildren * 0.18 + (focus.selectedClusterIds.includes(cluster.id) ? 0.45 : 0));
    regionEmphasis[cluster.id] = emphasis;
    if (!visibleChildren && !focus.selectedClusterIds.includes(cluster.id) && viewportMode !== 'overview') dimmedRegionIds.add(cluster.id);
  }

  for (const node of viewModel.graph.nodes) {
    if (!visibleNodeIds.has(node.id)) {
      dimmedNodeIds.add(node.id);
      continue;
    }
    if (!activeNodeIds.has(node.id) && !selectedNodeIds.has(node.id) && !neighborNodeIds.has(node.id) && node.level !== 'clustered' && !labelVisibleNodeIds.has(node.id)) {
      dimmedNodeIds.add(node.id);
    }
  }

  // Cumulative gate: nothing introduced after the playhead is visible.
  for (const id of [...visibleNodeIds]) {
    if (!cumulative.conceptIds.has(id)) visibleNodeIds.delete(id);
  }
  for (const id of [...visibleClusterIds]) {
    if (!cumulative.clusterIds.has(id)) visibleClusterIds.delete(id);
  }
  for (const id of [...visibleEdgeIds]) {
    if (!cumulative.edgeIds.has(id)) visibleEdgeIds.delete(id);
  }
  for (const id of [...labelVisibleNodeIds]) {
    if (!cumulative.conceptIds.has(id)) labelVisibleNodeIds.delete(id);
  }

  const cameraTarget = deriveCameraTarget(viewModel, layout, viewport, {
    activeLevel,
    playheadTime,
    cumulative,
  });

  return {
    viewportMode,
    focusMode: focus.focusMode,
    visibleNodeIds: [...visibleNodeIds],
    visibleEdgeIds: [...visibleEdgeIds],
    activeNodeIds: [...activeNodeIds],
    activeEdgeIds: [...activeEdgeIds],
    selectedNodeIds: [...selectedNodeIds],
    neighborNodeIds: [...neighborNodeIds],
    labelVisibleNodeIds: [...labelVisibleNodeIds],
    visibleClusterIds: [...visibleClusterIds],
    dimmedNodeIds: [...dimmedNodeIds],
    dimmedRegionIds: [...dimmedRegionIds],
    regionEmphasis,
    nodeScores: Object.fromEntries(nodeScores.entries()),
    cumulativeVisibleConceptIds: [...cumulative.conceptIds],
    cumulativeVisibleClusterIds: [...cumulative.clusterIds],
    cumulativeVisibleEdgeIds: [...cumulative.edgeIds],
    cameraTarget,
    conceptImportance: viewModel.graph.conceptImportance ?? {},
  };
}
