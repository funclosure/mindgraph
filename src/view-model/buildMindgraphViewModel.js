function frameRefKey(level, index) {
  return `${level}:${index}`;
}

function durationFromSpan(span) {
  return Math.max(0, (span?.end ?? 0) - (span?.start ?? 0));
}

function computeConceptImportance(nodes) {
  // Importance score per the design spec:
  //   base(c) = 0.4·degreeFactor + 0.3·peakActivation + 0.3·persistence
  // where degreeFactor is normalised against the max-degree atomic concept,
  // and peakActivation/persistence are read from concept.stats (clamped to
  // [0, 1] in case the stats step hasn't run yet).
  //
  // Returns Record<conceptId, number> where value ∈ [0, 1].
  const importance = {};
  const atomic = nodes.filter((n) => n.level === 'atomic');
  if (!atomic.length) return importance;
  const maxDegree = Math.max(1, ...atomic.map((n) => n.degree ?? 0));
  for (const node of atomic) {
    const degreeFactor = (node.degree ?? 0) / maxDegree;
    const peak = clamp01(node.stats?.peakActivation ?? 0);
    const persistence = clamp01(node.stats?.persistence ?? 0);
    importance[node.id] = 0.4 * degreeFactor + 0.3 * peak + 0.3 * persistence;
  }
  return importance;
}

function clamp01(n) {
  if (typeof n !== 'number' || Number.isNaN(n)) return 0;
  if (n < 0) return 0;
  if (n > 1) return 1;
  return n;
}

function normalizeConcept(rawConcept, level) {
  return {
    id: rawConcept.id,
    label: rawConcept.label,
    level,
    description: rawConcept.description,
    aliases: rawConcept.aliases ?? [],
    parentIds: rawConcept.parentIds ?? [],
    childIds: [],
    stats: rawConcept.stats,
    firstSeenAt: rawConcept.firstSeenAt,
  };
}

function deriveFirstSeenAt(document) {
  // For each concept id, find the earliest frame.span.start where the
  // concept appears in foregroundConcepts or backgroundConcepts at any
  // level. Returns { conceptId: firstSeenAt }.
  const firstSeen = {};
  const allFrames = [
    ...(document.frames?.micro ?? []),
    ...(document.frames?.meso ?? []),
    ...(document.frames?.macro ?? []),
  ];
  for (const frame of allFrames) {
    const start = frame.span?.start;
    if (typeof start !== 'number') continue;
    for (const list of [frame.foregroundConcepts ?? [], frame.backgroundConcepts ?? []]) {
      for (const activation of list) {
        const prev = firstSeen[activation.id];
        if (prev === undefined || start < prev) {
          firstSeen[activation.id] = start;
        }
      }
    }
  }
  return firstSeen;
}

function buildTranscriptVM(document) {
  const segments = (document.transcript?.segments ?? []).map((segment) => ({
    id: segment.id,
    start: segment.start,
    end: segment.end,
    speaker: segment.speaker,
    text: segment.text,
    duration: Math.max(0, segment.end - segment.start),
  }));

  return {
    segments,
    byId: Object.fromEntries(segments.map((segment) => [segment.id, segment])),
  };
}

function buildConceptsVM(document) {
  const derivedFirstSeen = deriveFirstSeenAt(document);
  const applyFirstSeen = (concept) => {
    if (typeof concept.firstSeenAt === 'number') return concept;
    const derived = derivedFirstSeen[concept.id];
    if (typeof derived === 'number') concept.firstSeenAt = derived;
    return concept;
  };

  const clustered = (document.concepts?.clustered ?? [])
    .map((concept) => normalizeConcept(concept, 'clustered'))
    .map(applyFirstSeen);
  const atomic = (document.concepts?.atomic ?? [])
    .map((concept) => normalizeConcept(concept, 'atomic'))
    .map(applyFirstSeen);

  const byId = Object.fromEntries([...clustered, ...atomic].map((concept) => [concept.id, concept]));
  const childrenByClusterId = {};
  const clustersByAtomicId = {};

  for (const concept of clustered) {
    childrenByClusterId[concept.id] = [];
  }

  for (const concept of atomic) {
    clustersByAtomicId[concept.id] = concept.parentIds ?? [];
    for (const parentId of concept.parentIds ?? []) {
      if (!childrenByClusterId[parentId]) childrenByClusterId[parentId] = [];
      childrenByClusterId[parentId].push(concept.id);
    }
  }

  for (const cluster of clustered) {
    cluster.childIds = childrenByClusterId[cluster.id] ?? [];
  }

  return {
    atomic,
    clustered,
    byId,
    childrenByClusterId,
    clustersByAtomicId,
  };
}

function buildRelationsVM(document) {
  const all = (document.relations ?? []).map((relation) => ({
    id: relation.id,
    from: relation.from,
    to: relation.to,
    type: relation.type,
    label: relation.label,
    description: relation.description,
    meta: relation.meta,
  }));

  const byId = Object.fromEntries(all.map((relation) => [relation.id, relation]));
  const outgoingByConceptId = {};
  const incomingByConceptId = {};

  for (const relation of all) {
    if (!outgoingByConceptId[relation.from]) outgoingByConceptId[relation.from] = [];
    if (!incomingByConceptId[relation.to]) incomingByConceptId[relation.to] = [];
    outgoingByConceptId[relation.from].push(relation.id);
    incomingByConceptId[relation.to].push(relation.id);
  }

  return { all, byId, outgoingByConceptId, incomingByConceptId };
}

function resolveActivation(rawActivation, conceptsVM) {
  const concept = conceptsVM.byId[rawActivation.id];
  return {
    id: rawActivation.id,
    label: concept?.label ?? `[missing concept: ${rawActivation.id}]`,
    weight: rawActivation.weight,
    mode: rawActivation.mode,
    parentClusterIds: concept?.parentIds ?? [],
  };
}

function resolveRelationActivation(rawActivation, relationsVM) {
  return {
    id: rawActivation.id,
    weight: rawActivation.weight,
    relation: relationsVM.byId[rawActivation.id],
  };
}

function normalizeFrame(rawFrame, level, index, conceptsVM, relationsVM) {
  return {
    ref: { level, index },
    key: frameRefKey(level, index),
    id: rawFrame.id,
    title: rawFrame.title,
    t: rawFrame.t,
    span: rawFrame.span,
    duration: durationFromSpan(rawFrame.span),
    speakers: rawFrame.speakers ?? [],
    summary: rawFrame.summary ?? '',
    foregroundConcepts: (rawFrame.foregroundConcepts ?? []).map((a) => resolveActivation(a, conceptsVM)),
    backgroundConcepts: (rawFrame.backgroundConcepts ?? []).map((a) => resolveActivation(a, conceptsVM)),
    activeRelations: (rawFrame.activeRelations ?? []).map((a) => resolveRelationActivation(a, relationsVM)),
    sourceSegmentIds: rawFrame.sourceSegmentIds ?? [],
    sourceFrameRefs: rawFrame.sourceFrameRefs ?? [],
    ancestry: {},
  };
}

function buildFramesVM(document, conceptsVM, relationsVM) {
  const micro = (document.frames?.micro ?? []).map((frame, index) => normalizeFrame(frame, 'micro', index, conceptsVM, relationsVM));
  const meso = (document.frames?.meso ?? []).map((frame, index) => normalizeFrame(frame, 'meso', index, conceptsVM, relationsVM));
  const macro = (document.frames?.macro ?? []).map((frame, index) => normalizeFrame(frame, 'macro', index, conceptsVM, relationsVM));

  const byRef = Object.fromEntries([...micro, ...meso, ...macro].map((frame) => [frame.key, frame]));

  for (const mesoFrame of meso) {
    mesoFrame.ancestry.micro = mesoFrame.sourceFrameRefs.filter((ref) => ref.level === 'micro');
  }

  for (const macroFrame of macro) {
    macroFrame.ancestry.meso = macroFrame.sourceFrameRefs.find((ref) => ref.level === 'meso');
    macroFrame.ancestry.micro = [];
  }

  return { micro, meso, macro, byRef };
}

function assignFrameAncestry(framesVM) {
  const mesoParentsByMicroKey = {};
  for (const mesoFrame of framesVM.meso) {
    for (const ref of mesoFrame.sourceFrameRefs) {
      if (ref.level === 'micro') mesoParentsByMicroKey[frameRefKey(ref.level, ref.index)] = mesoFrame.ref;
    }
  }

  const macroParentsByMesoKey = {};
  for (const macroFrame of framesVM.macro) {
    for (const ref of macroFrame.sourceFrameRefs) {
      if (ref.level === 'meso') macroParentsByMesoKey[frameRefKey(ref.level, ref.index)] = macroFrame.ref;
    }
  }

  for (const microFrame of framesVM.micro) {
    const mesoRef = mesoParentsByMicroKey[microFrame.key];
    if (mesoRef) microFrame.ancestry.meso = mesoRef;
    const macroRef = mesoRef ? macroParentsByMesoKey[frameRefKey(mesoRef.level, mesoRef.index)] : undefined;
    if (macroRef) microFrame.ancestry.macro = macroRef;
  }

  for (const mesoFrame of framesVM.meso) {
    const macroRef = macroParentsByMesoKey[mesoFrame.key];
    if (macroRef) mesoFrame.ancestry.macro = macroRef;
  }
}

function buildGraphVM(conceptsVM, relationsVM) {
  const nodes = [...conceptsVM.clustered, ...conceptsVM.atomic].map((concept) => ({
    id: concept.id,
    label: concept.label,
    level: concept.level,
    parentIds: concept.parentIds,
    childIds: concept.childIds,
    stats: concept.stats,
    regionKey: concept.level === 'atomic' ? concept.parentIds?.[0] : concept.id,
    visualWeight: concept.stats?.peakActivation ?? 0.5,
    degree: 0,
  }));

  const edges = relationsVM.all.map((relation) => ({
    id: relation.id,
    from: relation.from,
    to: relation.to,
    type: relation.type,
    label: relation.label,
    visualWeight: 0.5,
  }));

  const nodeById = Object.fromEntries(nodes.map((node) => [node.id, node]));
  const edgesByNodeId = {};
  for (const edge of edges) {
    if (nodeById[edge.from]) nodeById[edge.from].degree += 1;
    if (nodeById[edge.to]) nodeById[edge.to].degree += 1;
    if (!edgesByNodeId[edge.from]) edgesByNodeId[edge.from] = [];
    if (!edgesByNodeId[edge.to]) edgesByNodeId[edge.to] = [];
    edgesByNodeId[edge.from].push(edge.id);
    edgesByNodeId[edge.to].push(edge.id);
  }

  const conceptImportance = computeConceptImportance(nodes);

  return { nodes, edges, nodeById, edgesByNodeId, conceptImportance };
}

function buildIndexesVM(conceptsVM, framesVM, transcriptVM) {
  const conceptToFrameRefs = {};
  const conceptToTranscriptSegmentIds = {};
  const frameToTranscriptSegments = {};
  const frameChildren = {};
  const frameParent = {};

  for (const frame of [...framesVM.micro, ...framesVM.meso, ...framesVM.macro]) {
    frameToTranscriptSegments[frame.key] = frame.sourceSegmentIds.map((id) => transcriptVM.byId[id]).filter(Boolean);
    frameChildren[frame.key] = frame.sourceFrameRefs ?? [];
    frameParent[frame.key] = frame.ancestry.meso || frame.ancestry.macro;

    const allActivations = [...frame.foregroundConcepts, ...frame.backgroundConcepts];
    const conceptIdsInFrame = new Set(allActivations.map((a) => a.id));
    for (const conceptId of conceptIdsInFrame) {
      if (!conceptToFrameRefs[conceptId]) conceptToFrameRefs[conceptId] = [];
      conceptToFrameRefs[conceptId].push(frame.key);
      if (!conceptToTranscriptSegmentIds[conceptId]) conceptToTranscriptSegmentIds[conceptId] = [];
      for (const segmentId of frame.sourceSegmentIds) {
        if (!conceptToTranscriptSegmentIds[conceptId].includes(segmentId)) conceptToTranscriptSegmentIds[conceptId].push(segmentId);
      }
    }
  }

  return {
    conceptToFrameRefs,
    conceptToTranscriptSegmentIds,
    frameToTranscriptSegments,
    frameChildren,
    frameParent,
  };
}

function buildDocumentMetaVM(document, conceptsVM, relationsVM, framesVM, transcriptVM) {
  const allFrames = [...framesVM.micro, ...framesVM.meso, ...framesVM.macro];
  const durationSeconds = allFrames.length ? Math.max(...allFrames.map((frame) => frame.span.end)) : 0;

  return {
    title: document.transcript?.title ?? 'Untitled Transcript',
    source: document.transcript?.source ?? '',
    speakers: document.transcript?.speakers ?? [],
    durationSeconds,
    counts: {
      transcriptSegments: transcriptVM.segments.length,
      atomicConcepts: conceptsVM.atomic.length,
      clusteredConcepts: conceptsVM.clustered.length,
      relations: relationsVM.all.length,
      microFrames: framesVM.micro.length,
      mesoFrames: framesVM.meso.length,
      macroFrames: framesVM.macro.length,
    },
  };
}

function buildSelectors(viewModel) {
  const { concepts, relations, frames, transcript, indexes } = viewModel;

  function getFrame(ref) {
    return frames.byRef[frameRefKey(ref.level, ref.index)];
  }

  function getActiveFrameAtTime(level, time) {
    return frames[level].find((frame) => frame.span.start <= time && time < frame.span.end);
  }

  function getActiveFramesAtTime(time) {
    return {
      micro: getActiveFrameAtTime('micro', time),
      meso: getActiveFrameAtTime('meso', time),
      macro: getActiveFrameAtTime('macro', time),
    };
  }

  function getActiveConceptActivationsAtTime(time, level) {
    const frame = getActiveFrameAtTime(level, time);
    if (!frame) return [];
    return [...frame.foregroundConcepts, ...frame.backgroundConcepts];
  }

  function getActiveConceptIdsAtTime(time, level) {
    return [...new Set(getActiveConceptActivationsAtTime(time, level).map((a) => a.id))];
  }

  function getActiveRelationActivationsAtTime(time, level) {
    const frame = getActiveFrameAtTime(level, time);
    return frame?.activeRelations ?? [];
  }

  function getConceptById(id) {
    return concepts.byId[id];
  }

  function getConceptNeighbors(id) {
    const outgoing = (relations.outgoingByConceptId[id] ?? []).map((relId) => relations.byId[relId]?.to).filter(Boolean);
    const incoming = (relations.incomingByConceptId[id] ?? []).map((relId) => relations.byId[relId]?.from).filter(Boolean);
    return [...new Set([...outgoing, ...incoming])].map((conceptId) => concepts.byId[conceptId]).filter(Boolean);
  }

  function getConceptIncomingRelations(id) {
    return (relations.incomingByConceptId[id] ?? []).map((relId) => relations.byId[relId]).filter(Boolean);
  }

  function getConceptOutgoingRelations(id) {
    return (relations.outgoingByConceptId[id] ?? []).map((relId) => relations.byId[relId]).filter(Boolean);
  }

  function getConceptStrongestFrames(id, limit = 5) {
    const frameKeys = indexes.conceptToFrameRefs[id] ?? [];
    return frameKeys
      .map((key) => frames.byRef[key])
      .filter(Boolean)
      .sort((a, b) => {
        const maxA = Math.max(0, ...[...a.foregroundConcepts, ...a.backgroundConcepts].filter((c) => c.id === id).map((c) => c.weight));
        const maxB = Math.max(0, ...[...b.foregroundConcepts, ...b.backgroundConcepts].filter((c) => c.id === id).map((c) => c.weight));
        return maxB - maxA;
      })
      .slice(0, limit);
  }

  function getConceptTranscriptExcerpts(id, limit = 5) {
    return (indexes.conceptToTranscriptSegmentIds[id] ?? []).map((segmentId) => transcript.byId[segmentId]).filter(Boolean).slice(0, limit);
  }

  function getFrameTranscriptSegments(ref) {
    return indexes.frameToTranscriptSegments[frameRefKey(ref.level, ref.index)] ?? [];
  }

  function getFrameParent(ref) {
    const parentRef = indexes.frameParent[frameRefKey(ref.level, ref.index)];
    return parentRef ? getFrame(parentRef) : undefined;
  }

  function getFrameChildren(ref) {
    return (indexes.frameChildren[frameRefKey(ref.level, ref.index)] ?? []).map((childRef) => getFrame(childRef)).filter(Boolean);
  }

  function getFrameConcepts(ref) {
    const frame = getFrame(ref);
    return frame ? [...frame.foregroundConcepts, ...frame.backgroundConcepts] : [];
  }

  function getClusterChildren(clusterId) {
    return (concepts.childrenByClusterId[clusterId] ?? []).map((id) => concepts.byId[id]).filter(Boolean);
  }

  function getConceptClusters(conceptId) {
    return (concepts.clustersByAtomicId[conceptId] ?? []).map((id) => concepts.byId[id]).filter(Boolean);
  }

  function getClusterStrongestFrames(clusterId, limit = 5) {
    const children = getClusterChildren(clusterId);
    const collected = new Map();
    for (const child of children) {
      for (const frame of getConceptStrongestFrames(child.id, limit)) {
        collected.set(frame.key, frame);
      }
    }
    return Array.from(collected.values())
      .sort((a, b) => a.span.start - b.span.start)
      .slice(0, limit);
  }

  return {
    getFrame,
    getActiveFrameAtTime,
    getActiveFramesAtTime,
    getActiveConceptActivationsAtTime,
    getActiveConceptIdsAtTime,
    getActiveRelationActivationsAtTime,
    getConceptById,
    getConceptNeighbors,
    getConceptIncomingRelations,
    getConceptOutgoingRelations,
    getConceptStrongestFrames,
    getConceptTranscriptExcerpts,
    getFrameTranscriptSegments,
    getFrameParent,
    getFrameChildren,
    getFrameConcepts,
    getClusterChildren,
    getConceptClusters,
    getClusterStrongestFrames,
  };
}

export function buildMindgraphViewModel(document) {
  const transcript = buildTranscriptVM(document);
  const concepts = buildConceptsVM(document);
  const relations = buildRelationsVM(document);
  const frames = buildFramesVM(document, concepts, relations);
  assignFrameAncestry(frames);
  const graph = buildGraphVM(concepts, relations);
  const indexes = buildIndexesVM(concepts, frames, transcript);
  const documentMeta = buildDocumentMetaVM(document, concepts, relations, frames, transcript);

  const viewModel = {
    documentMeta,
    transcript,
    concepts,
    relations,
    frames,
    graph,
    indexes,
  };

  return {
    ...viewModel,
    selectors: buildSelectors(viewModel),
  };
}

export function buildConceptInspectorVM(viewModel, conceptId, { strongestFrameLimit = 5, excerptLimit = 5 } = {}) {
  const concept = viewModel.selectors.getConceptById(conceptId);
  if (!concept) return undefined;

  return {
    concept,
    parentClusters: viewModel.selectors.getConceptClusters(conceptId),
    incomingRelations: viewModel.selectors.getConceptIncomingRelations(conceptId),
    outgoingRelations: viewModel.selectors.getConceptOutgoingRelations(conceptId),
    relatedConcepts: viewModel.selectors.getConceptNeighbors(conceptId),
    strongestFrames: viewModel.selectors.getConceptStrongestFrames(conceptId, strongestFrameLimit),
    transcriptExcerpts: viewModel.selectors.getConceptTranscriptExcerpts(conceptId, excerptLimit),
  };
}

export function buildFrameInspectorVM(viewModel, frameRef) {
  const frame = viewModel.selectors.getFrame(frameRef);
  if (!frame) return undefined;

  return {
    frame,
    foregroundConcepts: frame.foregroundConcepts,
    backgroundConcepts: frame.backgroundConcepts,
    activeRelations: frame.activeRelations,
    transcriptSegments: viewModel.selectors.getFrameTranscriptSegments(frameRef),
    parentFrame: viewModel.selectors.getFrameParent(frameRef),
    childFrames: viewModel.selectors.getFrameChildren(frameRef),
  };
}
