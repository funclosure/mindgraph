function buildCumulativeVisibility(viewModel, playheadTime, currentConceptIds = []) {
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
  for (const id of currentConceptIds) conceptIds.add(id);
  const edgeIds = new Set();
  for (const edge of viewModel.graph.edges) {
    if (conceptIds.has(edge.from) && conceptIds.has(edge.to)) edgeIds.add(edge.id);
  }
  return { conceptIds, edgeIds };
}

function deriveCameraTarget(viewModel, layout, viewport, opts) {
  if (!layout || !viewport) return undefined;
  const { activeLevel, playheadTime, cumulative, selectedConceptIds = [] } = opts;
  const frame = viewModel.selectors.getActiveFrameAtTime(activeLevel, playheadTime);
  const rawFg = frame?.foregroundConcepts ?? [];

  const pointFor = (id) => layout.nodes[id];

  // Selection takes priority over playhead-foreground for the camera target.
  // When the user clicks a concept, the camera should focus on what they
  // selected — not stretch the viewport to include both the selection AND
  // the currently-active region (which can leave the selected dot tiny in a
  // corner of a wide zoom-out). Fit a bbox around the selected concept and
  // its immediate relation neighbors so the local relationship structure
  // around the selection stays legible. EXCEPT at "Whole map" focus, where the
  // reader wants to keep seeing the whole map — selecting a node should not zoom
  // the camera in; it just highlights.
  const selectionFramesCamera = activeLevel !== 'overview' && activeLevel !== 'macro';
  if (selectedConceptIds.length && selectionFramesCamera) {
    const selPoints = selectedConceptIds.map(pointFor).filter(Boolean);
    if (selPoints.length) {
      const neighborIds = unique(selectedConceptIds.flatMap(
        (id) => (viewModel.selectors.getConceptNeighbors(id) ?? []).map((c) => c.id),
      ));
      const points = [...selPoints, ...neighborIds.map(pointFor).filter(Boolean)];
      // Center on the centroid of the selected set so multi-selection stays framed.
      const cx0 = selPoints.reduce((s, p) => s + p.x, 0) / selPoints.length;
      const cy0 = selPoints.reduce((s, p) => s + p.y, 0) / selPoints.length;
      if (points.length === 1) {
        return boundsAroundPoint(selPoints[0], 120, viewport);
      }
      let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
      for (const p of points) {
        if (p.x < minX) minX = p.x;
        if (p.y < minY) minY = p.y;
        if (p.x > maxX) maxX = p.x;
        if (p.y > maxY) maxY = p.y;
      }
      return fitTarget(minX, minY, maxX, maxY, cx0, cy0, viewport, 0.2);
    }
  }

  // v2 doesn't render cluster anchors as physics nodes — only atomic concepts
  // have positions in layout.nodes. Macro frames typically nominate clustered
  // concepts as their foreground (e.g. "Evolutionary-Cognitive Origins"), which
  // have no position to fit a camera to. Expand each clustered foreground
  // concept into its atomic children so the camera fits the active region
  // rather than going dark on undefined-position lookups.
  const fg = rawFg.flatMap((a) => {
    const concept = viewModel.concepts.byId[a.id];
    if (concept?.level === 'atomic') return [a];
    if (concept?.level === 'clustered') {
      const childIds = viewModel.concepts.childrenByClusterId[a.id] ?? [];
      return childIds.map((id) => ({ id, weight: a.weight ?? 0.5 }));
    }
    return [];
  });

  // Helper: fit all cumulatively-visible atomic concepts. Used as Case 1 and
  // as a defensive fallback when foreground expansion produces no positions.
  function fitCumulativeAtomic() {
    const visibleIds = [...cumulative.conceptIds].filter((id) => layout.nodes[id]);
    if (!visibleIds.length) return undefined;
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const id of visibleIds) {
      const p = layout.nodes[id];
      if (p.x < minX) minX = p.x;
      if (p.y < minY) minY = p.y;
      if (p.x > maxX) maxX = p.x;
      if (p.y > maxY) maxY = p.y;
    }
    const cx = (minX + maxX) / 2;
    const cy = (minY + maxY) / 2;
    return fitTarget(minX, minY, maxX, maxY, cx, cy, viewport, 0.15);
  }

  // Case 1: no active frame → fit visible atomic nodes.
  if (!frame || !fg.length) return fitCumulativeAtomic();

  // Case 2: single foreground concept (after expansion) → focus around it.
  if (fg.length === 1) {
    const point = pointFor(fg[0].id);
    if (!point) return fitCumulativeAtomic();
    return boundsAroundPoint(point, 200, viewport);
  }

  // Case 3: multiple foreground concepts → weighted center, unweighted bbox, padded.
  const points = fg.map((a) => ({ pos: pointFor(a.id), weight: a.weight ?? 0.5 }))
    .filter((p) => p.pos);
  if (!points.length) return fitCumulativeAtomic();
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

function buildFocusSets(viewModel, { selectedConceptIds, selectedFrameRef, playheadTime, activeLevel }) {
  const focusMode = selectedConceptIds.length
    ? 'concept'
    : selectedFrameRef
      ? 'frame'
      : 'playhead';

  const frameConceptIds = selectedFrameRef
    ? viewModel.selectors.getFrameConcepts(selectedFrameRef).map((a) => a.id)
    : [];

  const selectedNodeIds = unique([...selectedConceptIds, ...frameConceptIds]);

  const activeNodeIds = unique(viewModel.selectors.getActiveConceptIdsAtTime(playheadTime, activeLevel));
  const playheadRelationIds = unique(viewModel.selectors.getActiveRelationActivationsAtTime(playheadTime, activeLevel).map((a) => a.id));

  const primaryFocusIds = selectedConceptIds.length
    ? selectedConceptIds
    : selectedFrameRef
      ? frameConceptIds
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
  selectedConceptIds,
  selectedFrameRef,
  playheadTime,
  activeLevel = 'meso',
  zoomLevel = 1,
  layout,
  viewport,
} = {}) {
  // Accept a selection set; fall back to the single id for back-compat.
  const selectedIds = selectedConceptIds ?? (selectedConceptId ? [selectedConceptId] : []);
  const focus = buildFocusSets(viewModel, { selectedConceptIds: selectedIds, selectedFrameRef, playheadTime, activeLevel });
  const cumulative = buildCumulativeVisibility(viewModel, playheadTime, focus.activeNodeIds);
  // Overview frames may nominate clusters (not atoms) in their foreground.
  // To make that convention legible, fan a clustered foreground entry out to
  // its member atoms. The result is pure data — what to *render* with this
  // signal is the renderer's call. Always derived from the macro frame
  // regardless of activeLevel: chapter context is the same backdrop whether
  // the reader is zoomed at source-step, section, or overview. Excludes atoms already in
  // activeNodeIds so consumers can treat the two sets as disjoint tiers.
  const chapterActiveAtomicIds = deriveChapterActiveAtomicIds(
    viewModel,
    playheadTime,
    new Set(focus.activeNodeIds),
  );
  const viewportMode = inferViewportMode({ zoomLevel, focusMode: focus.focusMode });
  const nodeScores = new Map();
  const activeEdgeIds = new Set();
  const neighborNodeIds = new Set(focus.nearContextIds);
  const selectedNodeIds = new Set(focus.selectedNodeIds);
  const activeNodeIds = new Set(focus.activeNodeIds);
  const visibleNodeIds = new Set();
  const visibleEdgeIds = new Set();
  const dimmedNodeIds = new Set();

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

  // v3: render every bloomed-in atomic dot at every zoom level. The previous
  // overview/region caps made the graph look broken at default zoom because
  // dots and their incident edges appeared only after zooming in. Density is
  // managed by ui/labels.js's importance threshold + collision avoidance, not
  // by hiding topology.
  const atomicVisibleCount = Infinity;

  for (const cluster of viewModel.concepts.clustered) {
    visibleNodeIds.add(cluster.id);
  }

  for (const node of sortedAtomic.slice(0, atomicVisibleCount)) {
    visibleNodeIds.add(node.id);
  }

  for (const id of [...focus.primaryFocusIds, ...focus.nearContextIds, ...focus.activeNodeIds]) {
    visibleNodeIds.add(id);
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
      // Persistent relational backdrop: any edge whose both endpoints are
      // currently rendered as dots stays visible. drawEdges paints these at
      // baseAlpha 0.16 (the existing "non-active" branch) so the graph's
      // topology doesn't flicker on/off as the playhead moves through the
      // active cascade. Active/selection-adjacent edges still pop bright.
      || bothVisible
      || (viewportMode !== 'overview' && touchesNear && bothVisible)
      || (viewportMode === 'local' && bothVisible && sameRegion)
      || (viewportMode === 'overview' && bothVisible && touchesPrimary)
    );

    if (shouldShow) visibleEdgeIds.add(edge.id);
  }

  // One scalar names the single real decision: are we spotlighting a selection,
  // or following the reading playhead? Everything downstream (node dimming, edge
  // dimming) reads this instead of re-asking "is there a selection?".
  const mode = selectedNodeIds.size > 0 ? 'spotlight' : 'reading';

  // Dimming. In spotlight mode only the selected node + its neighbors stay
  // bright, everything else dims — at EVERY focus level. (At Whole map the
  // overview frame marks nearly every concept "active", so we must ignore that
  // exemption when there's a selection, or nothing would dim.) In reading mode we
  // follow playhead focus: keep the currently-active nodes bright.
  for (const node of viewModel.graph.nodes) {
    if (!visibleNodeIds.has(node.id)) {
      dimmedNodeIds.add(node.id);
      continue;
    }
    if (node.level === 'clustered') continue;
    const keepBright = mode === 'spotlight'
      ? (selectedNodeIds.has(node.id) || neighborNodeIds.has(node.id))
      : (activeNodeIds.has(node.id) || neighborNodeIds.has(node.id));
    if (!keepBright) dimmedNodeIds.add(node.id);
  }

  // Cumulative gate: nothing introduced after the playhead is visible — EXCEPT
  // an explicitly selected node (and its edges to already-visible neighbors).
  // Selecting a concept that first appears later in the timeline should still
  // reveal it on the graph, in place, without scrolling the reader's prose away.
  for (const id of [...visibleNodeIds]) {
    if (!cumulative.conceptIds.has(id) && !selectedNodeIds.has(id)) visibleNodeIds.delete(id);
  }
  for (const edge of viewModel.graph.edges) {
    if (!visibleEdgeIds.has(edge.id)) continue;
    const touchesSelected = selectedNodeIds.has(edge.from) || selectedNodeIds.has(edge.to);
    const endpointsVisible = visibleNodeIds.has(edge.from) && visibleNodeIds.has(edge.to);
    const keep = (cumulative.edgeIds.has(edge.id) || touchesSelected) && endpointsVisible;
    if (!keep) visibleEdgeIds.delete(edge.id);
  }

  // Edge spotlight, producer-owned (mirrors the node dimming): in spotlight mode,
  // every visible edge that does NOT touch the selection dims. Computed once here
  // so the renderer doesn't re-derive it inline.
  const dimmedEdgeIds = new Set();
  if (mode === 'spotlight') {
    for (const edge of viewModel.graph.edges) {
      if (!visibleEdgeIds.has(edge.id)) continue;
      if (!(selectedNodeIds.has(edge.from) || selectedNodeIds.has(edge.to))) dimmedEdgeIds.add(edge.id);
    }
  }

  const cameraTarget = deriveCameraTarget(viewModel, layout, viewport, {
    activeLevel,
    playheadTime,
    cumulative,
    selectedConceptIds: selectedIds,
  });

  return {
    mode,
    viewportMode,
    focusMode: focus.focusMode,
    visibleNodeIds: [...visibleNodeIds],
    visibleEdgeIds: [...visibleEdgeIds],
    activeNodeIds: [...activeNodeIds],
    activeEdgeIds: [...activeEdgeIds],
    selectedNodeIds: [...selectedNodeIds],
    neighborNodeIds: [...neighborNodeIds],
    dimmedNodeIds: [...dimmedNodeIds],
    dimmedEdgeIds: [...dimmedEdgeIds],
    nodeScores: Object.fromEntries(nodeScores.entries()),
    cumulativeVisibleConceptIds: [...cumulative.conceptIds],
    cumulativeVisibleEdgeIds: [...cumulative.edgeIds],
    cameraTarget,
    conceptImportance: viewModel.graph.conceptImportance ?? {},
    chapterActiveAtomicIds,
  };
}

function deriveChapterActiveAtomicIds(viewModel, playheadTime, excludeAtomicIds) {
  // string[] of atomic ids belonging to any cluster that appears in the
  // currently-active overview frame's foregroundConcepts. Disjoint from the
  // exclude set passed in (the caller scopes that to the active source step
  // tier so the two sets don't collide).
  const overviewLevel = viewModel.sourceFlow ? 'overview' : 'macro';
  const overviewFrame = viewModel.selectors.getActiveFrameAtTime(overviewLevel, playheadTime);
  if (!overviewFrame) return [];
  const out = [];
  const seen = new Set();
  for (const activation of overviewFrame.foregroundConcepts ?? []) {
    const concept = viewModel.concepts.byId[activation.id];
    if (concept?.level !== 'clustered') continue;
    const childIds = viewModel.concepts.childrenByClusterId[activation.id] ?? [];
    for (const childId of childIds) {
      if (excludeAtomicIds.has(childId)) continue;
      if (seen.has(childId)) continue;
      seen.add(childId);
      out.push(childId);
    }
  }
  return out;
}
