export function parseJsonValue(value, label = 'JSON value') {
  try {
    return JSON.parse(value);
  } catch (error) {
    throw new Error(`Invalid ${label}: ${error.message}`);
  }
}

export function getFrameCollection(doc, level = 'micro') {
  const frames = doc.frames?.[level];
  if (!Array.isArray(frames)) {
    throw new Error(`Unknown frame level '${level}'. Expected one of: micro, meso, macro.`);
  }
  return frames;
}

export function getConceptCollection(doc, level = 'atomic') {
  const concepts = doc.concepts?.[level];
  if (!Array.isArray(concepts)) {
    throw new Error(`Unknown concept level '${level}'. Expected one of: atomic, clustered.`);
  }
  return concepts;
}

export function upsertConcept(doc, { level = 'atomic', id, label, description, aliases, firstSeenAt, speakers, stats, parentIds }) {
  if (!id) throw new Error('concept id is required');
  if (!label) throw new Error('concept label is required');

  const concepts = getConceptCollection(doc, level);
  const existing = concepts.find((concept) => concept.id === id);
  const next = {
    id,
    label,
    ...(description != null ? { description } : {}),
    ...(aliases != null ? { aliases } : {}),
    ...(typeof firstSeenAt === 'number' ? { firstSeenAt } : {}),
    ...(speakers != null ? { speakers } : {}),
    ...(stats != null ? { stats } : {}),
    ...(parentIds != null ? { parentIds } : {}),
  };

  if (existing) {
    Object.assign(existing, next);
    return existing;
  }

  concepts.push(next);
  return next;
}

export function upsertRelation(doc, { id, from, to, type, label, description, meta, provenance }) {
  if (!id) throw new Error('relation id is required');
  if (!from) throw new Error('relation from is required');
  if (!to) throw new Error('relation to is required');
  if (!type) throw new Error('relation type is required');
  if (provenance != null && provenance !== 'source' && provenance !== 'inferred') {
    throw new Error("relation provenance must be 'source' or 'inferred' when provided");
  }

  const relations = doc.relations ?? (doc.relations = []);
  const existing = relations.find((relation) => relation.id === id);
  const next = {
    id,
    from,
    to,
    type,
    ...(label != null ? { label } : {}),
    ...(description != null ? { description } : {}),
    ...(meta != null ? { meta } : {}),
    ...(provenance === 'inferred' ? { provenance: 'inferred' } : {}),
  };

  if (existing) {
    Object.assign(existing, next);
    // Explicit 'source' on an upsert strips any pre-existing provenance key — caller is
    // saying "set this relation back to source." Implicit (provenance === undefined) leaves
    // the existing value alone for idempotency.
    if (provenance === 'source' && existing.provenance != null) {
      delete existing.provenance;
    }
    return existing;
  }

  relations.push(next);
  return next;
}

export function setFrameActivations(doc, { level = 'micro', index, foregroundConcepts, backgroundConcepts, activeRelations, summary }) {
  if (!Number.isInteger(index) || index < 0) {
    throw new Error('frame index must be a non-negative integer');
  }

  const frames = getFrameCollection(doc, level);
  const frame = frames[index];
  if (!frame) throw new Error(`No frame found at ${level}[${index}]`);

  if (foregroundConcepts != null) frame.foregroundConcepts = foregroundConcepts;
  if (backgroundConcepts != null) frame.backgroundConcepts = backgroundConcepts;
  if (activeRelations != null) frame.activeRelations = activeRelations;
  if (summary != null) frame.summary = summary;

  return frame;
}

// Frame levels in coarsening order. Index = "rank"; lower index = finer grain.
const FRAME_LEVEL_RANK = { micro: 0, meso: 1, macro: 2 };

export function backfillFrameActivations(doc, { fromLevel = 'meso', toLevel = 'micro' } = {}) {
  // Copy each from-level frame's activations onto every to-level frame whose
  // span overlaps it most. Intended for the "broadcast down" case (meso → micro
  // or macro → meso) where finer frames lack their own activation annotations
  // and should inherit context from their coarser-level parent.
  //
  // Each to-frame gets the activations of the from-frame with maximum span
  // overlap. Existing to-frame activations are REPLACED (this is a backfill,
  // not a merge) — if the to-frame already had its own annotations they get
  // overwritten. Callers should not run this on documents whose target level
  // has been hand-annotated.
  if (fromLevel === toLevel) {
    throw new Error('backfill --from and --to must be different frame levels');
  }
  const fromRank = FRAME_LEVEL_RANK[fromLevel];
  const toRank = FRAME_LEVEL_RANK[toLevel];
  if (fromRank === undefined || toRank === undefined) {
    throw new Error(`Unknown frame level. Expected one of: micro, meso, macro.`);
  }
  if (fromRank < toRank) {
    // Reverse direction: --from finer --to coarser. This would pick the single
    // finer-grained frame with maximum overlap (likely a 30 s micro under a
    // 600 s macro) and OVERWRITE the coarser frame's activations with it —
    // destructive to hand-curated meso/macro annotations. Reject explicitly;
    // use `frame merge` instead for aggregating finer into coarser.
    throw new Error(
      `backfill is broadcast-down only: --from ${fromLevel} → --to ${toLevel} would overwrite coarser activations with a single finer frame. ` +
      `Use \`mindgraph frame merge\` to aggregate finer frames into a coarser one.`,
    );
  }
  const fromFrames = getFrameCollection(doc, fromLevel);
  const toFrames = getFrameCollection(doc, toLevel);

  let updated = 0;
  for (const toFrame of toFrames) {
    if (!toFrame.span) continue;
    const toStart = toFrame.span.start ?? 0;
    const toEnd = toFrame.span.end ?? toStart;
    let best = null;
    let bestOverlap = 0;
    for (const fromFrame of fromFrames) {
      if (!fromFrame.span) continue;
      const fromStart = fromFrame.span.start ?? 0;
      const fromEnd = fromFrame.span.end ?? fromStart;
      const overlap = Math.max(0, Math.min(toEnd, fromEnd) - Math.max(toStart, fromStart));
      if (overlap > bestOverlap) {
        bestOverlap = overlap;
        best = fromFrame;
      }
    }
    if (!best) continue;
    toFrame.foregroundConcepts = (best.foregroundConcepts ?? []).map((a) => ({ ...a }));
    toFrame.backgroundConcepts = (best.backgroundConcepts ?? []).map((a) => ({ ...a }));
    toFrame.activeRelations = (best.activeRelations ?? []).map((a) => ({ ...a }));
    updated += 1;
  }

  return { updated, total: toFrames.length };
}

function mergeActivationLists(frames, key) {
  const merged = new Map();

  for (const frame of frames) {
    for (const item of frame[key] ?? []) {
      const current = merged.get(item.id) ?? { ...item, weight: 0 };
      current.weight = Math.max(current.weight ?? 0, item.weight ?? 0);
      if (item.mode && !current.mode) current.mode = item.mode;
      merged.set(item.id, current);
    }
  }

  return Array.from(merged.values()).sort((a, b) => (b.weight ?? 0) - (a.weight ?? 0));
}

export function mergeFrames(doc, { fromLevel = 'micro', toLevel = 'meso', startIndex, endIndex, summary, title }) {
  if (!Number.isInteger(startIndex) || !Number.isInteger(endIndex) || startIndex < 0 || endIndex < startIndex) {
    throw new Error('startIndex/endIndex must be non-negative integers with endIndex >= startIndex');
  }

  const sourceFrames = getFrameCollection(doc, fromLevel);
  const targetFrames = getFrameCollection(doc, toLevel);
  const slice = sourceFrames.slice(startIndex, endIndex + 1);
  if (slice.length === 0) throw new Error(`No frames found in ${fromLevel}[${startIndex}..${endIndex}]`);

  const speakerSet = new Set(slice.flatMap((frame) => frame.speakers ?? []));
  const sourceSegmentIds = slice.flatMap((frame) => frame.sourceSegmentIds ?? []);
  const mergedFrame = {
    id: `${toLevel}-${targetFrames.length + 1}`,
    t: slice[0].t,
    span: {
      start: slice[0].span.start,
      end: slice[slice.length - 1].span.end,
    },
    speakers: Array.from(speakerSet),
    foregroundConcepts: mergeActivationLists(slice, 'foregroundConcepts'),
    backgroundConcepts: mergeActivationLists(slice, 'backgroundConcepts'),
    activeRelations: mergeActivationLists(slice, 'activeRelations'),
    summary: summary ?? slice.map((frame) => frame.summary).filter(Boolean).join(' '),
    title: title ?? undefined,
    sourceFrameRefs: slice.map((_, index) => ({ level: fromLevel, index: startIndex + index })),
    sourceSegmentIds,
  };

  targetFrames.push(mergedFrame);
  return mergedFrame;
}

export function listFrames(doc, { level = 'micro', offset = 0, limit = 10 } = {}) {
  const frames = getFrameCollection(doc, level);
  return frames.slice(offset, offset + limit).map((frame, index) => ({
    index: offset + index,
    id: frame.id,
    t: frame.t,
    span: frame.span,
    title: frame.title,
    summary: frame.summary,
    foregroundConcepts: frame.foregroundConcepts ?? [],
    activeRelations: frame.activeRelations ?? [],
  }));
}

export function getFrame(doc, { level = 'micro', index }) {
  if (!Number.isInteger(index) || index < 0) {
    throw new Error('frame index must be a non-negative integer');
  }
  const frames = getFrameCollection(doc, level);
  const frame = frames[index];
  if (!frame) throw new Error(`No frame found at ${level}[${index}]`);
  return frame;
}

export function listConcepts(doc, { level = 'atomic' } = {}) {
  const concepts = getConceptCollection(doc, level);
  return concepts.map((concept) => ({
    id: concept.id,
    label: concept.label,
    firstSeenAt: concept.firstSeenAt,
    stats: concept.stats,
    parentIds: concept.parentIds,
  }));
}

export function getConcept(doc, { level = 'atomic', id }) {
  if (!id) throw new Error('concept id is required');
  const concepts = getConceptCollection(doc, level);
  const concept = concepts.find((item) => item.id === id);
  if (!concept) throw new Error(`No concept found with id '${id}' in ${level} concepts`);
  return concept;
}

export function recomputeConceptStats(doc) {
  const allConcepts = [
    ...(doc.concepts?.atomic ?? []),
    ...(doc.concepts?.clustered ?? []),
  ];
  const conceptMap = new Map(allConcepts.map((concept) => [concept.id, concept]));
  const aggregates = new Map();

  for (const concept of allConcepts) {
    aggregates.set(concept.id, {
      recurrenceCount: 0,
      totalActivation: 0,
      peakActivation: 0,
      firstFrameT: null,
      lastFrameT: null,
    });
  }

  for (const frameLevel of ['micro', 'meso', 'macro']) {
    for (const frame of doc.frames?.[frameLevel] ?? []) {
      for (const bucketName of ['foregroundConcepts', 'backgroundConcepts']) {
        for (const activation of frame[bucketName] ?? []) {
          const agg = aggregates.get(activation.id);
          if (!agg) continue;
          agg.recurrenceCount += 1;
          agg.totalActivation += activation.weight ?? 0;
          agg.peakActivation = Math.max(agg.peakActivation, activation.weight ?? 0);
          agg.firstFrameT = agg.firstFrameT == null ? frame.t : Math.min(agg.firstFrameT, frame.t);
          agg.lastFrameT = agg.lastFrameT == null ? frame.t : Math.max(agg.lastFrameT, frame.t);
        }
      }
    }
  }

  for (const [conceptId, agg] of aggregates.entries()) {
    const concept = conceptMap.get(conceptId);
    const persistence = agg.firstFrameT == null || agg.lastFrameT == null
      ? 0
      : agg.lastFrameT - agg.firstFrameT;

    concept.stats = {
      recurrenceCount: agg.recurrenceCount,
      totalActivation: Number(agg.totalActivation.toFixed(4)),
      peakActivation: Number(agg.peakActivation.toFixed(4)),
      persistence,
    };
  }

  return doc;
}
