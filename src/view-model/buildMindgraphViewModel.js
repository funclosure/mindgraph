function frameRefKey(level, index) {
  return `${level}:${index}`;
}

const SOURCE_FIRST_SEGMENT_SECONDS = 60;

function isSourceFirstDocument(document) {
  return document?.kind === 'mindgraph.source-first';
}

function sourceFirstSegmentSeconds(document, blockCount) {
  const durationSeconds = document?.meta?.durationSeconds;
  if (typeof durationSeconds === 'number' && Number.isFinite(durationSeconds) && durationSeconds > 0 && blockCount > 0) {
    return durationSeconds / blockCount;
  }
  return SOURCE_FIRST_SEGMENT_SECONDS;
}

function spanForIndexes(startIndex, count, segmentSeconds = SOURCE_FIRST_SEGMENT_SECONDS) {
  const start = startIndex * segmentSeconds;
  const end = Math.max(start + segmentSeconds, (startIndex + Math.max(1, count)) * segmentSeconds);
  return { start, end };
}

function unionSpan(spans) {
  const valid = spans.filter((span) => span && typeof span.start === 'number' && typeof span.end === 'number');
  if (!valid.length) return { start: 0, end: SOURCE_FIRST_SEGMENT_SECONDS };
  return {
    start: Math.min(...valid.map((span) => span.start)),
    end: Math.max(...valid.map((span) => span.end)),
  };
}

function toLegacyConcept(concept, firstSeenByBlockId) {
  return {
    ...concept,
    firstSeenAt: typeof concept.firstSeenAt === 'number'
      ? concept.firstSeenAt
      : firstSeenByBlockId[concept.firstSeenBlockId],
  };
}

function relationActivationFromStep(step, relationIdSet) {
  return (step.focusRelations ?? [])
    .filter((activation) => relationIdSet.has(activation.id))
    .map((activation) => ({ id: activation.id, weight: activation.weight }));
}

function normalizeSourceFirstForViewModel(document) {
  const orderedBlocks = [...(document.sourceBlocks ?? [])].sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
  const segmentSeconds = sourceFirstSegmentSeconds(document, orderedBlocks.length);
  const blockIndexById = Object.fromEntries(orderedBlocks.map((block, index) => [block.id, index]));
  const blockSpanById = {};
  const segments = orderedBlocks.map((block, index) => {
    const span = spanForIndexes(index, 1, segmentSeconds);
    blockSpanById[block.id] = span;
    return {
      id: block.id,
      sourceId: block.sourceId ?? null,
      start: span.start,
      end: span.end,
      speaker: '',
      text: block.text ?? '',
    };
  });

  const firstSeenByBlockId = Object.fromEntries(Object.entries(blockSpanById).map(([id, span]) => [id, span.start]));
  const relationIdSet = new Set((document.relations ?? []).map((relation) => relation.id));
  const readerSteps = (document.readerSteps ?? []).map((step, index) => {
    const sortedBlockIds = [...(step.sourceBlockIds ?? [])].sort((a, b) => (blockIndexById[a] ?? 0) - (blockIndexById[b] ?? 0));
    const span = unionSpan(sortedBlockIds.map((id) => blockSpanById[id]));
    return {
      id: step.id,
      title: step.summary,
      t: span.start,
      span,
      summary: step.summary,
      sourceSegmentIds: sortedBlockIds,
      foregroundConcepts: (step.focusConcepts ?? []).map((activation) => ({
        id: activation.id,
        weight: activation.weight,
        mode: activation.mode,
      })),
      backgroundConcepts: [],
      activeRelations: relationActivationFromStep(step, relationIdSet),
      sourceFrameRefs: [],
      meta: { sourceFirstStepId: step.id, readerStepIndex: index },
    };
  });

  const readerStepIndexById = Object.fromEntries((document.readerSteps ?? []).map((step, index) => [step.id, index]));
  const sections = (document.sections ?? []).map((section, index) => {
    const sourceFrameRefs = (section.readerStepIds ?? [])
      .map((stepId) => readerStepIndexById[stepId])
      .filter((readerStepIndex) => readerStepIndex != null)
      .map((readerStepIndex) => ({ level: 'readerStep', index: readerStepIndex }));
    const childFrames = sourceFrameRefs.map((ref) => readerSteps[ref.index]).filter(Boolean);
    const span = unionSpan(childFrames.map((frame) => frame.span));
    return {
      id: section.id,
      title: section.title,
      t: span.start,
      span,
      summary: section.summary,
      foregroundConcepts: mergeConceptActivations(childFrames.flatMap((frame) => frame.foregroundConcepts)),
      backgroundConcepts: [],
      activeRelations: mergeRelationActivations(childFrames.flatMap((frame) => frame.activeRelations)),
      sourceSegmentIds: unique(childFrames.flatMap((frame) => frame.sourceSegmentIds)),
      sourceFrameRefs,
      meta: { sourceFirstSectionId: section.id, sectionIndex: index },
    };
  });

  const overviewSpan = unionSpan(sections.map((frame) => frame.span));
  const overview = [{
    id: 'source-first-overview',
    title: document.title ?? 'Untitled Mindgraph',
    t: overviewSpan.start,
    span: overviewSpan,
    summary: (document.sections ?? []).map((section) => section.summary).filter(Boolean).join(' '),
    foregroundConcepts: mergeConceptActivations(sections.flatMap((frame) => frame.foregroundConcepts)),
    backgroundConcepts: [],
    activeRelations: mergeRelationActivations(sections.flatMap((frame) => frame.activeRelations)),
    sourceSegmentIds: unique(sections.flatMap((frame) => frame.sourceSegmentIds)),
    sourceFrameRefs: sections.map((_, index) => ({ level: 'section', index })),
    meta: { sourceFirst: true },
  }];

  return {
    ...document,
    transcript: {
      title: document.title ?? 'Untitled Mindgraph',
      source: document.sources?.[0]?.path ?? document.sources?.[0]?.title ?? '',
      speakers: [document.sources?.[0]?.type === 'article' ? 'Article' : 'Source'],
      segments,
    },
    concepts: {
      atomic: (document.concepts?.atomic ?? []).map((concept) => toLegacyConcept(concept, firstSeenByBlockId)),
      clustered: document.concepts?.clustered ?? [],
    },
    sourceFlow: { readerSteps, sections, overview },
  };
}

function unique(values) {
  return [...new Set(values.filter((value) => value != null))];
}

function mergeConceptActivations(activations) {
  const byId = new Map();
  for (const activation of activations) {
    const existing = byId.get(activation.id);
    if (!existing || activation.weight > existing.weight) byId.set(activation.id, activation);
  }
  return [...byId.values()];
}

function mergeRelationActivations(activations) {
  const byId = new Map();
  for (const activation of activations) {
    const existing = byId.get(activation.id);
    if (!existing || activation.weight > existing.weight) byId.set(activation.id, activation);
  }
  return [...byId.values()];
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

function flowFrames(timelineVM) {
  if (!timelineVM) return [];
  return Object.values(timelineVM)
    .filter(Array.isArray)
    .flat();
}

function computeCoOccurrence(timelineVM, nodes) {
  // Per spec § Spring forces — co-occurrence-driven distance.
  //
  //   score(i, j) = w_micro × Σ duration(f) over micro frames where both i,j ∈ foreground
  //               + w_meso  × Σ duration(f) over meso  frames where both i,j ∈ foreground
  //               + w_macro × Σ duration(f) over macro frames where both i,j ∈ foreground
  //
  // Stored sparse: Record<id, Record<id, score>>, only pairs with score > 0.
  // Symmetric — both directions written so the simulator can look up either way.
  //
  // **Foreground-only.** The earlier implementation counted any pair appearing
  // in `foreground ∪ background`. That conflated "co-topic" with "both peripherally
  // active", and on documents with rich background sets it diluted the SCORE_REF
  // percentile (background pair-contributions inflate the noise floor without
  // adding discrimination). Restricting to foreground means co-occurrence
  // measures "both were the topic of this frame at the same time" — sharper
  // semantic, and background concepts are still represented in the layout via
  // explicit relations, cluster siblings, and charge balance.
  const DEFAULT_FRAME_DURATION = 30; // 30 s fallback for any frame with non-positive computed duration — including open-ended end-of-doc frames

  const atomicIds = new Set(nodes.filter((n) => n.level === 'atomic').map((n) => n.id));
  const result = {};

  for (const frame of flowFrames(timelineVM)) {
      const dur = Math.max(0, (frame.span?.end ?? 0) - (frame.span?.start ?? 0)) || DEFAULT_FRAME_DURATION;
      const contribution = dur;

      // Concepts in this frame, foreground-only, atomic-only, deduped.
      const ids = [];
      const seen = new Set();
      for (const activation of frame.foregroundConcepts ?? []) {
        const id = activation.id;
        if (!atomicIds.has(id)) continue;
        if (seen.has(id)) continue;
        seen.add(id);
        ids.push(id);
      }

      // Accumulate over all unordered pairs (i, j) in the frame.
      for (let i = 0; i < ids.length; i += 1) {
        for (let j = i + 1; j < ids.length; j += 1) {
          const a = ids[i];
          const b = ids[j];
          if (!result[a]) result[a] = {};
          if (!result[b]) result[b] = {};
          result[a][b] = (result[a][b] ?? 0) + contribution;
          result[b][a] = (result[b][a] ?? 0) + contribution;
        }
      }
  }

  return result;
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
    ...(document.sourceFlow?.readerSteps ?? []),
    ...(document.sourceFlow?.sections ?? []),
    ...(document.sourceFlow?.overview ?? []),
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
    ...(segment.sourceId != null ? { sourceId: segment.sourceId } : {}),
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

function buildLegacyFramesVM(document, conceptsVM, relationsVM) {
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

function buildSourceFlowVM(document, conceptsVM, relationsVM) {
  const readerSteps = (document.sourceFlow?.readerSteps ?? []).map((frame, index) => normalizeFrame(frame, 'readerStep', index, conceptsVM, relationsVM));
  const sections = (document.sourceFlow?.sections ?? []).map((frame, index) => normalizeFrame(frame, 'section', index, conceptsVM, relationsVM));
  const overview = (document.sourceFlow?.overview ?? []).map((frame, index) => normalizeFrame(frame, 'overview', index, conceptsVM, relationsVM));
  const byRef = Object.fromEntries([...readerSteps, ...sections, ...overview].map((frame) => [frame.key, frame]));
  return { readerSteps, sections, overview, byRef };
}

function assignLegacyFrameAncestry(framesVM) {
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

function assignSourceFlowAncestry(sourceFlowVM) {
  const sectionParentsByReaderStepKey = {};
  for (const section of sourceFlowVM.sections) {
    section.ancestry.readerStep = section.sourceFrameRefs.filter((ref) => ref.level === 'readerStep');
    for (const ref of section.sourceFrameRefs) {
      if (ref.level === 'readerStep') sectionParentsByReaderStepKey[frameRefKey(ref.level, ref.index)] = section.ref;
    }
  }

  const overviewParentsBySectionKey = {};
  for (const overview of sourceFlowVM.overview) {
    overview.ancestry.section = overview.sourceFrameRefs.find((ref) => ref.level === 'section');
    overview.ancestry.readerStep = [];
    for (const ref of overview.sourceFrameRefs) {
      if (ref.level === 'section') overviewParentsBySectionKey[frameRefKey(ref.level, ref.index)] = overview.ref;
    }
  }

  for (const readerStep of sourceFlowVM.readerSteps) {
    const sectionRef = sectionParentsByReaderStepKey[readerStep.key];
    if (sectionRef) readerStep.ancestry.section = sectionRef;
    const overviewRef = sectionRef ? overviewParentsBySectionKey[frameRefKey(sectionRef.level, sectionRef.index)] : undefined;
    if (overviewRef) readerStep.ancestry.overview = overviewRef;
  }

  for (const section of sourceFlowVM.sections) {
    const overviewRef = overviewParentsBySectionKey[section.key];
    if (overviewRef) section.ancestry.overview = overviewRef;
  }
}

function buildGraphVM(conceptsVM, relationsVM, timelineVM, rawRelations) {
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

  // Build a quick id → provenance lookup from the raw document relations.
  // RelationVM intentionally does not carry provenance (the inspector is parked
  // for v0.5.0); GraphEdgeVM is the only consumer-side surface that exposes it.
  const provenanceById = {};
  for (const rel of rawRelations) {
    if (rel?.id && rel.provenance === 'inferred') provenanceById[rel.id] = 'inferred';
  }

  const edges = relationsVM.all.map((relation) => ({
    id: relation.id,
    from: relation.from,
    to: relation.to,
    type: relation.type,
    label: relation.label,
    visualWeight: 0.5,
    ...(provenanceById[relation.id] === 'inferred' ? { provenance: 'inferred' } : {}),
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
  const coOccurrence = computeCoOccurrence(timelineVM, nodes);

  return { nodes, edges, nodeById, edgesByNodeId, conceptImportance, coOccurrence };
}

function buildIndexesVM(conceptsVM, timelineVM, transcriptVM) {
  const conceptToFrameRefs = {};
  const conceptToTranscriptSegmentIds = {};
  const frameToTranscriptSegments = {};
  const frameChildren = {};
  const frameParent = {};

  for (const frame of flowFrames(timelineVM)) {
    frameToTranscriptSegments[frame.key] = frame.sourceSegmentIds.map((id) => transcriptVM.byId[id]).filter(Boolean);
    frameChildren[frame.key] = frame.sourceFrameRefs ?? [];
    frameParent[frame.key] = frame.ancestry.section || frame.ancestry.overview || frame.ancestry.meso || frame.ancestry.macro;

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

function buildDocumentMetaVM(document, conceptsVM, relationsVM, timelineVM, transcriptVM) {
  const allFrames = flowFrames(timelineVM);
  const durationSeconds = allFrames.length ? Math.max(...allFrames.map((frame) => frame.span.end)) : 0;
  const sourceFirst = Boolean(document.sourceFlow);

  return {
    title: document.transcript?.title ?? 'Untitled Transcript',
    source: document.transcript?.source ?? '',
    speakers: document.transcript?.speakers ?? [],
    sources: (document.sources ?? []).map((s) => ({ id: s.id, title: s.title ?? '', type: s.type ?? 'source' })),
    durationSeconds,
    counts: {
      transcriptSegments: transcriptVM.segments.length,
      atomicConcepts: conceptsVM.atomic.length,
      clusteredConcepts: conceptsVM.clustered.length,
      relations: relationsVM.all.length,
      ...(sourceFirst
        ? {
            readerSteps: timelineVM.readerSteps.length,
            sections: timelineVM.sections.length,
            overview: timelineVM.overview.length,
          }
        : {
            microFrames: timelineVM.micro.length,
            mesoFrames: timelineVM.meso.length,
            macroFrames: timelineVM.macro.length,
          }),
    },
  };
}

function buildSelectors(viewModel) {
  const { concepts, relations, transcript, indexes } = viewModel;
  const timeline = viewModel.sourceFlow ?? viewModel.frames;

  function collectionForLevel(level) {
    if (!viewModel.sourceFlow) return timeline[level];
    if (level === 'readerStep') return timeline.readerSteps;
    if (level === 'section') return timeline.sections;
    if (level === 'overview') return timeline.overview;
    return undefined;
  }

  function activeFrameSequence(level, time) {
    if (viewModel.sourceFlow) {
      if (level === 'overview') return [getActiveFrameAtTime('overview', time), getActiveFrameAtTime('section', time)];
      if (level === 'section') return [getActiveFrameAtTime('section', time)];
      return [getActiveFrameAtTime('readerStep', time)];
    }
    if (level === 'macro') return [getActiveFrameAtTime('macro', time), getActiveFrameAtTime('meso', time)];
    if (level === 'meso') return [getActiveFrameAtTime('meso', time)];
    return [getActiveFrameAtTime(level, time)];
  }

  function getFrame(ref) {
    return timeline.byRef[frameRefKey(ref.level, ref.index)];
  }

  function getActiveFrameAtTime(level, time) {
    const collection = collectionForLevel(level);
    let active;
    for (const frame of collection ?? []) {
      if (frame.span.start <= time && time < frame.span.end) active = frame;
    }
    return active;
  }

  function getActiveFramesAtTime(time) {
    return viewModel.sourceFlow
      ? {
          readerStep: getActiveFrameAtTime('readerStep', time),
          section: getActiveFrameAtTime('section', time),
          overview: getActiveFrameAtTime('overview', time),
        }
      : {
          micro: getActiveFrameAtTime('micro', time),
          meso: getActiveFrameAtTime('meso', time),
          macro: getActiveFrameAtTime('macro', time),
        };
  }

  function getActiveConceptActivationsAtTime(time, level) {
    // Cascade through coarser levels for highlighting: at activeLevel='macro' a
    // reader scrolling within a chapter still expects step-by-step changes as
    // they move between paragraphs. Returning ONLY the macro's foreground (which
    // is constant across the whole chapter) makes highlighting feel frozen for
    // long stretches. Cascading unions the macro's chapter-grain set with the
    // current meso's paragraph-grain set — the highlighted concepts then change
    // every time the playhead crosses a meso boundary, while the chapter-level
    // context remains visible. Camera framing (getActiveFrameAtTime, used by
    // deriveCameraTarget) is unaffected — it still uses the macro frame for
    // chapter-grain zoom.
    const ids = [];
    const seen = new Set();
    const push = (frame) => {
      if (!frame) return;
      for (const list of [frame.foregroundConcepts ?? [], frame.backgroundConcepts ?? []]) {
        for (const a of list) {
          if (seen.has(a.id)) continue;
          seen.add(a.id);
          ids.push(a);
        }
      }
    };
    for (const frame of activeFrameSequence(level, time)) push(frame);
    return ids;
  }

  function getActiveConceptIdsAtTime(time, level) {
    return [...new Set(getActiveConceptActivationsAtTime(time, level).map((a) => a.id))];
  }

  function getActiveRelationActivationsAtTime(time, level) {
    // Mirror the concept-activation cascade: at macro level, include the meso
    // frame's active relations so per-paragraph relation highlighting works.
    if ((viewModel.sourceFlow && level === 'overview') || (!viewModel.sourceFlow && level === 'macro')) {
      const seen = new Set();
      const result = [];
      for (const frame of activeFrameSequence(level, time)) {
        for (const a of frame?.activeRelations ?? []) {
          if (seen.has(a.id)) continue;
          seen.add(a.id);
          result.push(a);
        }
      }
      return result;
    }
    const frame = activeFrameSequence(level, time)[0];
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
      .map((key) => timeline.byRef[key])
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
  const sourceFirst = isSourceFirstDocument(document);
  const normalizedDocument = isSourceFirstDocument(document) ? normalizeSourceFirstForViewModel(document) : document;
  const transcript = buildTranscriptVM(normalizedDocument);
  const concepts = buildConceptsVM(normalizedDocument);
  const relations = buildRelationsVM(normalizedDocument);
  const timeline = sourceFirst
    ? buildSourceFlowVM(normalizedDocument, concepts, relations)
    : buildLegacyFramesVM(normalizedDocument, concepts, relations);
  if (sourceFirst) assignSourceFlowAncestry(timeline);
  else assignLegacyFrameAncestry(timeline);
  const graph = buildGraphVM(concepts, relations, timeline, normalizedDocument.relations ?? []);
  const indexes = buildIndexesVM(concepts, timeline, transcript);
  const documentMeta = buildDocumentMetaVM(normalizedDocument, concepts, relations, timeline, transcript);

  const viewModel = {
    documentMeta,
    transcript,
    concepts,
    relations,
    ...(sourceFirst
      ? { sourceFlow: timeline }
      : { frames: timeline }),
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
