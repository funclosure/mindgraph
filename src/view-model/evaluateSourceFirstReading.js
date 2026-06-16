import { buildMindgraphViewModel } from './buildMindgraphViewModel.js';
import { buildProseChunks } from './buildProseChunks.js';

export function evaluateSourceFirstReading(document) {
  const vm = buildMindgraphViewModel(document);
  if (!vm.sourceFlow) {
    return {
      ok: false,
      totalFocusActivations: 0,
      boundFocusActivations: 0,
      unboundFocusActivations: 0,
      focusBindingRate: 0,
      unboundFocus: [],
      totalActiveRelations: 0,
      orphanedActiveRelations: 0,
      orphanedRelations: [],
      errors: ['Document is not source-first.'],
    };
  }

  const paragraphChunks = buildProseChunks(vm).filter((chunk) => chunk.kind === 'paragraph');
  const chunksBySegmentId = new Map();
  for (const chunk of paragraphChunks) {
    for (const id of chunk.segmentIds ?? []) chunksBySegmentId.set(id, chunk);
  }

  const sectionTitleByStepId = sectionTitlesByReaderStepId(vm);
  const unboundFocus = [];
  const orphanedRelations = [];
  let totalFocusActivations = 0;
  let totalActiveRelations = 0;

  for (const step of vm.sourceFlow.readerSteps ?? []) {
    const chunks = unique((step.sourceSegmentIds ?? []).map((id) => chunksBySegmentId.get(id)).filter(Boolean));
    const mentionedConceptIds = new Set(chunks.flatMap((chunk) => chunk.conceptMentions.map((mention) => mention.conceptId)));
    const foregroundIds = new Set((step.foregroundConcepts ?? []).map((activation) => activation.id));
    const sectionTitle = sectionTitleByStepId.get(step.id) ?? step.sectionId ?? '';

    for (const activation of step.foregroundConcepts ?? []) {
      if (activation.mode === 'latent') continue;
      totalFocusActivations += 1;
      if (mentionedConceptIds.has(activation.id)) continue;
      const concept = vm.concepts.byId?.[activation.id];
      unboundFocus.push({
        stepId: step.id,
        sectionTitle,
        conceptId: activation.id,
        label: concept?.label ?? activation.id,
        aliases: concept?.aliases ?? [],
      });
    }

    for (const activation of step.activeRelations ?? []) {
      const relation = activation.relation;
      if (!relation) continue;
      totalActiveRelations += 1;
      const missingEndpointIds = [relation.from, relation.to].filter((id) => !foregroundIds.has(id));
      if (!missingEndpointIds.length) continue;
      orphanedRelations.push({
        stepId: step.id,
        sectionTitle,
        relationId: relation.id,
        from: relation.from,
        to: relation.to,
        type: relation.type,
        missingEndpointIds,
      });
    }
  }

  const boundFocusActivations = totalFocusActivations - unboundFocus.length;
  const focusBindingRate = totalFocusActivations ? boundFocusActivations / totalFocusActivations : 1;
  return {
    ok: unboundFocus.length === 0 && orphanedRelations.length === 0,
    totalFocusActivations,
    boundFocusActivations,
    unboundFocusActivations: unboundFocus.length,
    focusBindingRate: Number(focusBindingRate.toFixed(3)),
    unboundFocus,
    totalActiveRelations,
    orphanedActiveRelations: orphanedRelations.length,
    orphanedRelations,
    errors: [],
  };
}

function sectionTitlesByReaderStepId(vm) {
  const map = new Map();
  for (const section of vm.sourceFlow?.sections ?? []) {
    for (const ref of section.sourceFrameRefs ?? []) {
      if (ref.level !== 'readerStep') continue;
      const step = vm.sourceFlow.readerSteps[ref.index];
      if (step?.id) map.set(step.id, section.title);
    }
  }
  return map;
}

function unique(values) {
  return [...new Set(values)];
}
