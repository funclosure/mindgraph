import {
  backfillFrameActivations,
  mergeFrames,
  recomputeConceptStats,
  setFrameActivations,
  upsertConcept,
  upsertRelation,
} from './document.js';

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function normalizeActivationList(value) {
  return asArray(value).map((item) => ({ ...item }));
}

function withGroundingMeta(entity) {
  if (entity?.grounding == null) return entity;
  const { grounding, meta, ...rest } = entity;
  return {
    ...rest,
    meta: {
      ...(meta ?? {}),
      grounding,
    },
  };
}

function applyFrameActivation(doc, level, entry) {
  setFrameActivations(doc, {
    level,
    index: entry.index,
    foregroundConcepts: entry.foreground != null ? normalizeActivationList(entry.foreground) : undefined,
    backgroundConcepts: entry.background != null ? normalizeActivationList(entry.background) : undefined,
    activeRelations: entry.relations != null ? normalizeActivationList(entry.relations) : undefined,
    summary: entry.summary,
  });
}

export function applyDigestPlan(doc, plan = {}) {
  const summary = {
    clustersUpserted: 0,
    conceptsUpserted: 0,
    relationsUpserted: 0,
    microActivationsSet: 0,
    mesoActivationsSet: 0,
    macroActivationsSet: 0,
    macroFramesCreated: 0,
    ignoredSpansSet: 0,
    backfilled: null,
    statsRecomputed: false,
  };

  for (const cluster of asArray(plan.clusters)) {
    upsertConcept(doc, { ...withGroundingMeta(cluster), level: 'clustered' });
    summary.clustersUpserted += 1;
  }

  for (const concept of asArray(plan.concepts)) {
    upsertConcept(doc, { ...withGroundingMeta(concept), level: concept.level ?? 'atomic' });
    summary.conceptsUpserted += 1;
  }

  for (const relation of asArray(plan.relations)) {
    upsertRelation(doc, withGroundingMeta(relation));
    summary.relationsUpserted += 1;
  }

  for (const entry of asArray(plan.microActivations)) {
    applyFrameActivation(doc, 'micro', entry);
    summary.microActivationsSet += 1;
  }

  for (const entry of asArray(plan.mesoActivations)) {
    applyFrameActivation(doc, 'meso', entry);
    summary.mesoActivationsSet += 1;
  }

  if (plan.macroFrames != null && plan.replaceMacroFrames !== false) {
    doc.frames.macro = [];
  }

  for (const frame of asArray(plan.macroFrames)) {
    const merged = mergeFrames(doc, {
      fromLevel: frame.fromLevel ?? 'meso',
      toLevel: 'macro',
      startIndex: frame.startIndex,
      endIndex: frame.endIndex,
      summary: frame.summary,
      title: frame.title,
    });
    if (frame.foreground != null || frame.background != null || frame.relations != null) {
      setFrameActivations(doc, {
        level: 'macro',
        index: doc.frames.macro.indexOf(merged),
        foregroundConcepts: frame.foreground != null ? normalizeActivationList(frame.foreground) : undefined,
        backgroundConcepts: frame.background != null ? normalizeActivationList(frame.background) : undefined,
        activeRelations: frame.relations != null ? normalizeActivationList(frame.relations) : undefined,
      });
    }
    summary.macroFramesCreated += 1;
  }

  for (const entry of asArray(plan.macroActivations)) {
    applyFrameActivation(doc, 'macro', entry);
    summary.macroActivationsSet += 1;
  }

  if (plan.ignoredSpans != null) {
    doc.meta = doc.meta ?? {};
    doc.meta.ignoredSpans = asArray(plan.ignoredSpans).map((span) => ({ ...span }));
    summary.ignoredSpansSet = doc.meta.ignoredSpans.length;
  }

  if (plan.backfill) {
    summary.backfilled = backfillFrameActivations(doc, {
      fromLevel: plan.backfill.from ?? plan.backfill.fromLevel ?? 'meso',
      toLevel: plan.backfill.to ?? plan.backfill.toLevel ?? 'micro',
    });
  }

  if (plan.recomputeStats !== false) {
    recomputeConceptStats(doc);
    summary.statsRecomputed = true;
  }

  return summary;
}

function spansOverlap(a, b) {
  return Math.max(0, Math.min(a.end, b.end) - Math.max(a.start, b.start)) > 0;
}

function isIgnoredFrame(frame, ignoredSpans) {
  const span = frame?.span;
  if (!span) return false;
  return ignoredSpans.some((ignored) => spansOverlap(span, ignored));
}

function collectActivatedConceptIds(doc) {
  const ids = new Set();
  for (const level of ['micro', 'meso', 'macro']) {
    for (const frame of doc.frames?.[level] ?? []) {
      for (const activation of [...(frame.foregroundConcepts ?? []), ...(frame.backgroundConcepts ?? [])]) {
        ids.add(activation.id);
      }
    }
  }
  return ids;
}

function collectActiveRelationIds(doc) {
  const ids = new Set();
  for (const level of ['micro', 'meso', 'macro']) {
    for (const frame of doc.frames?.[level] ?? []) {
      for (const activation of frame.activeRelations ?? []) ids.add(activation.id);
    }
  }
  return ids;
}

function hasSourceGrounding(entity) {
  const grounding = entity?.meta?.grounding;
  return grounding?.kind === 'source'
    && typeof grounding.sourceSpan?.start === 'number'
    && typeof grounding.sourceSpan?.end === 'number'
    && typeof grounding.quote === 'string'
    && grounding.quote.trim().length > 0;
}

function hasInferenceRationale(relation) {
  const grounding = relation?.meta?.grounding;
  return grounding?.kind === 'agent-inference'
    && typeof grounding.rationale === 'string'
    && grounding.rationale.trim().length > 0;
}

function inferenceValidationStatus(relation) {
  return relation?.meta?.grounding?.validation?.status;
}

function webValidationHasSources(relation) {
  const sources = relation?.meta?.grounding?.validation?.sources;
  return Array.isArray(sources) && sources.some((source) => source?.url && source?.title);
}

export function evaluateDigest(doc) {
  const ignoredSpans = asArray(doc.meta?.ignoredSpans);
  const mesoFrames = doc.frames?.meso ?? [];
  const ignoredMesoFrameIndexes = [];
  const emptyMesoFrameIndexes = [];

  for (const [index, frame] of mesoFrames.entries()) {
    if (isIgnoredFrame(frame, ignoredSpans)) {
      ignoredMesoFrameIndexes.push(index);
      continue;
    }
    if (!(frame.foregroundConcepts ?? []).length && !(frame.backgroundConcepts ?? []).length) {
      emptyMesoFrameIndexes.push(index);
    }
  }

  const activatedConceptIds = collectActivatedConceptIds(doc);
  const activeRelationIds = collectActiveRelationIds(doc);
  const concepts = [...(doc.concepts?.atomic ?? []), ...(doc.concepts?.clustered ?? [])];
  const atomicConcepts = doc.concepts?.atomic ?? [];
  const relations = doc.relations ?? [];
  const inferredRelations = relations.filter((relation) => relation.provenance === 'inferred');
  const sourceRelations = relations.filter((relation) => relation.provenance !== 'inferred');
  const inferredRelationsActiveInFrames = inferredRelations
    .filter((relation) => activeRelationIds.has(relation.id))
    .map((relation) => relation.id);

  return {
    counts: {
      atomicConcepts: doc.concepts?.atomic?.length ?? 0,
      clusteredConcepts: doc.concepts?.clustered?.length ?? 0,
      relations: doc.relations?.length ?? 0,
      microFrames: doc.frames?.micro?.length ?? 0,
      mesoFrames: doc.frames?.meso?.length ?? 0,
      macroFrames: doc.frames?.macro?.length ?? 0,
    },
    ignoredSpans,
    ignoredMesoFrameIndexes,
    emptyMesoFrameIndexes,
    unusedConceptIds: concepts
      .filter((concept) => concept.level !== 'clustered')
      .filter((concept) => !activatedConceptIds.has(concept.id))
      .map((concept) => concept.id),
    inactiveRelationIds: (doc.relations ?? [])
      .filter((relation) => !activeRelationIds.has(relation.id))
      .map((relation) => relation.id),
    grounding: {
      sourceConceptsWithoutGrounding: atomicConcepts
        .filter((concept) => !hasSourceGrounding(concept))
        .map((concept) => concept.id),
      sourceRelationsWithoutGrounding: sourceRelations
        .filter((relation) => !hasSourceGrounding(relation))
        .map((relation) => relation.id),
      inferredRelationIds: inferredRelations.map((relation) => relation.id),
      inferredRelationRatio: relations.length ? Number((inferredRelations.length / relations.length).toFixed(4)) : 0,
      inferredRelationsWithoutRationale: inferredRelations
        .filter((relation) => !hasInferenceRationale(relation))
        .map((relation) => relation.id),
      inferredRelationsWithoutValidationStatus: inferredRelations
        .filter((relation) => !inferenceValidationStatus(relation))
        .map((relation) => relation.id),
      inferredRelationsNeedingValidation: inferredRelations
        .filter((relation) => inferenceValidationStatus(relation) === 'needs-validation')
        .map((relation) => relation.id),
      webValidatedInferredRelationsMissingSources: inferredRelations
        .filter((relation) => inferenceValidationStatus(relation) === 'web-validated' && !webValidationHasSources(relation))
        .map((relation) => relation.id),
      inferredRelationsActiveInFrames,
    },
    topConcepts: concepts
      .filter((concept) => concept.stats?.recurrenceCount > 0)
      .sort((a, b) => (b.stats?.totalActivation ?? 0) - (a.stats?.totalActivation ?? 0))
      .slice(0, 15)
      .map((concept) => ({
        id: concept.id,
        label: concept.label,
        recurrenceCount: concept.stats.recurrenceCount,
        totalActivation: concept.stats.totalActivation,
        peakActivation: concept.stats.peakActivation,
      })),
  };
}
