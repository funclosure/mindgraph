function normalizeConceptCollections(concepts) {
  if (Array.isArray(concepts)) {
    return { atomic: concepts, clustered: [] };
  }

  return {
    atomic: concepts?.atomic ?? [],
    clustered: concepts?.clustered ?? [],
  };
}

function normalizeFrameCollections(frames) {
  if (Array.isArray(frames)) {
    return { micro: frames, meso: [], macro: [] };
  }

  return {
    micro: frames?.micro ?? [],
    meso: frames?.meso ?? [],
    macro: frames?.macro ?? [],
  };
}

export function createEmptyDocument(overrides = {}) {
  const concepts = normalizeConceptCollections(overrides.concepts);
  const frames = normalizeFrameCollections(overrides.frames);

  return {
    version: 1,
    kind: 'mindgraph.document',
    transcript: {
      title: 'Untitled Transcript',
      source: '',
      speakers: [],
      segments: [],
      ...overrides.transcript,
    },
    concepts,
    relations: overrides.relations ?? [],
    frames,
    meta: overrides.meta ?? {},
  };
}

function validateFrameCollection(name, frameList, conceptIds, relationIds, errors) {
  if (!Array.isArray(frameList)) {
    errors.push(`frames.${name} must be an array`);
    return;
  }

  for (const [i, frame] of frameList.entries()) {
    if (typeof frame?.t !== 'number') errors.push(`frames.${name}[${i}].t must be a number`);
    if (!frame?.span || typeof frame.span.start !== 'number' || typeof frame.span.end !== 'number') {
      errors.push(`frames.${name}[${i}].span.start and span.end must be numbers`);
    }
    if (!Array.isArray(frame?.speakers)) errors.push(`frames.${name}[${i}].speakers must be an array`);
    if (!Array.isArray(frame?.foregroundConcepts)) errors.push(`frames.${name}[${i}].foregroundConcepts must be an array`);
    if (frame?.backgroundConcepts != null && !Array.isArray(frame.backgroundConcepts)) {
      errors.push(`frames.${name}[${i}].backgroundConcepts must be an array when present`);
    }
    if (frame?.activeRelations != null && !Array.isArray(frame.activeRelations)) {
      errors.push(`frames.${name}[${i}].activeRelations must be an array when present`);
    }

    for (const fg of frame?.foregroundConcepts ?? []) {
      if (!conceptIds.has(fg.id)) errors.push(`frames.${name}[${i}] foregroundConcept '${fg.id}' references missing concept`);
      if (typeof fg.weight !== 'number') errors.push(`frames.${name}[${i}] foregroundConcept '${fg.id}' must include numeric weight`);
    }
    for (const bg of frame?.backgroundConcepts ?? []) {
      if (!conceptIds.has(bg.id)) errors.push(`frames.${name}[${i}] backgroundConcept '${bg.id}' references missing concept`);
      if (typeof bg.weight !== 'number') errors.push(`frames.${name}[${i}] backgroundConcept '${bg.id}' must include numeric weight`);
    }
    for (const rel of frame?.activeRelations ?? []) {
      if (!relationIds.has(rel.id)) errors.push(`frames.${name}[${i}] activeRelation '${rel.id}' references missing relation`);
      if (typeof rel.weight !== 'number') errors.push(`frames.${name}[${i}] activeRelation '${rel.id}' must include numeric weight`);
    }
  }
}

export function validateDocument(doc) {
  const errors = [];

  if (!doc || typeof doc !== 'object') {
    return { ok: false, errors: ['Document must be an object.'] };
  }

  if (doc.version !== 1) errors.push('version must be 1');
  if (doc.kind !== 'mindgraph.document') errors.push("kind must be 'mindgraph.document'");

  if (!doc.transcript || typeof doc.transcript !== 'object') {
    errors.push('transcript must be an object');
  } else {
    if (typeof doc.transcript.title !== 'string') errors.push('transcript.title must be a string');
    if (!Array.isArray(doc.transcript.speakers)) errors.push('transcript.speakers must be an array');
    if (doc.transcript.segments != null && !Array.isArray(doc.transcript.segments)) {
      errors.push('transcript.segments must be an array when present');
    }
  }

  const concepts = normalizeConceptCollections(doc.concepts);
  const frames = normalizeFrameCollections(doc.frames);

  if (!Array.isArray(concepts.atomic)) errors.push('concepts.atomic must be an array');
  if (!Array.isArray(concepts.clustered)) errors.push('concepts.clustered must be an array');
  if (!Array.isArray(doc.relations)) errors.push('relations must be an array');

  for (const [i, segment] of (doc.transcript?.segments ?? []).entries()) {
    if (typeof segment?.start !== 'number') errors.push(`transcript.segments[${i}].start must be a number`);
    if (typeof segment?.end !== 'number') errors.push(`transcript.segments[${i}].end must be a number`);
    if (typeof segment?.text !== 'string') errors.push(`transcript.segments[${i}].text must be a string`);
    if (segment?.speaker != null && typeof segment.speaker !== 'string') {
      errors.push(`transcript.segments[${i}].speaker must be a string when present`);
    }
  }

  const conceptIds = new Set();
  for (const [collectionName, conceptList] of Object.entries(concepts)) {
    for (const [i, concept] of conceptList.entries()) {
      if (!concept?.id) errors.push(`concepts.${collectionName}[${i}].id is required`);
      if (!concept?.label) errors.push(`concepts.${collectionName}[${i}].label is required`);
      if (concept?.stats != null) {
        if (typeof concept.stats.recurrenceCount !== 'number') errors.push(`concepts.${collectionName}[${i}].stats.recurrenceCount must be a number`);
        if (typeof concept.stats.totalActivation !== 'number') errors.push(`concepts.${collectionName}[${i}].stats.totalActivation must be a number`);
        if (typeof concept.stats.peakActivation !== 'number') errors.push(`concepts.${collectionName}[${i}].stats.peakActivation must be a number`);
        if (typeof concept.stats.persistence !== 'number') errors.push(`concepts.${collectionName}[${i}].stats.persistence must be a number`);
      }
      if (concept?.id) conceptIds.add(concept.id);
    }
  }

  const relationIds = new Set();
  for (const [i, relation] of (doc.relations ?? []).entries()) {
    if (!relation?.id) errors.push(`relations[${i}].id is required`);
    if (!relation?.from) errors.push(`relations[${i}].from is required`);
    if (!relation?.to) errors.push(`relations[${i}].to is required`);
    if (relation?.from && !conceptIds.has(relation.from)) errors.push(`relations[${i}].from references missing concept '${relation.from}'`);
    if (relation?.to && !conceptIds.has(relation.to)) errors.push(`relations[${i}].to references missing concept '${relation.to}'`);
    if (relation?.provenance != null && relation.provenance !== 'source' && relation.provenance !== 'inferred') {
      errors.push(`relations[${i}].provenance must be 'source' or 'inferred' when present`);
    }
    if (relation?.id) relationIds.add(relation.id);
  }

  validateFrameCollection('micro', frames.micro, conceptIds, relationIds, errors);
  validateFrameCollection('meso', frames.meso, conceptIds, relationIds, errors);
  validateFrameCollection('macro', frames.macro, conceptIds, relationIds, errors);

  return { ok: errors.length === 0, errors };
}

export function summarizeDocument(doc) {
  const concepts = normalizeConceptCollections(doc.concepts);
  const frames = normalizeFrameCollections(doc.frames);
  const microFrames = frames.micro ?? [];
  const firstFrame = microFrames[0] ?? frames.meso?.[0] ?? frames.macro?.[0];
  const lastFrame = microFrames[microFrames.length - 1] ?? frames.meso?.[frames.meso.length - 1] ?? frames.macro?.[frames.macro.length - 1];

  return {
    title: doc.transcript?.title ?? 'Untitled Transcript',
    speakers: doc.transcript?.speakers ?? [],
    segmentCount: doc.transcript?.segments?.length ?? 0,
    conceptCounts: {
      atomic: concepts.atomic.length,
      clustered: concepts.clustered.length,
    },
    relationCount: doc.relations?.length ?? 0,
    frameCounts: {
      micro: frames.micro.length,
      meso: frames.meso.length,
      macro: frames.macro.length,
    },
    timeRange: firstFrame && lastFrame
      ? { start: firstFrame.span?.start ?? firstFrame.t, end: lastFrame.span?.end ?? lastFrame.t }
      : null,
  };
}
