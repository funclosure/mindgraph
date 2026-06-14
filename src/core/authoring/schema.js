function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function isObject(value) {
  return value != null && typeof value === 'object' && !Array.isArray(value);
}

function addDuplicateErrors(items, name, errors) {
  const seen = new Set();
  for (const item of items) {
    if (!item?.id) continue;
    if (seen.has(item.id)) errors.push(`${name}.${item.id} is duplicated`);
    seen.add(item.id);
  }
}

function collectIds(items) {
  return new Set(asArray(items).map((item) => item?.id).filter(Boolean));
}

function hasText(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

export function validateSourceFirstDocument(doc) {
  const errors = [];

  if (!isObject(doc)) return { ok: false, errors: ['Document must be an object.'] };
  if (doc.kind !== 'mindgraph.source-first') errors.push("kind must be 'mindgraph.source-first'");
  if (doc.version !== 1) errors.push('version must be 1');
  if (!hasText(doc.title)) errors.push('title must be a non-empty string');

  for (const key of ['sources', 'sourceBlocks', 'readerSteps', 'sections', 'relations', 'intakes', 'revisions']) {
    if (!Array.isArray(doc[key])) errors.push(`${key} must be an array`);
  }
  if (!isObject(doc.concepts)) errors.push('concepts must be an object');
  if (!Array.isArray(doc.concepts?.atomic)) errors.push('concepts.atomic must be an array');
  if (!Array.isArray(doc.concepts?.clustered)) errors.push('concepts.clustered must be an array');

  const sources = asArray(doc.sources);
  const blocks = asArray(doc.sourceBlocks);
  const steps = asArray(doc.readerSteps);
  const sections = asArray(doc.sections);
  const atomic = asArray(doc.concepts?.atomic);
  const clustered = asArray(doc.concepts?.clustered);
  const relations = asArray(doc.relations);

  if (!sources.length) errors.push('sources must include at least one source');
  if (!blocks.length) errors.push('sourceBlocks must include at least one block');
  if (!steps.length) errors.push('readerSteps must include at least one step');
  if (!sections.length) errors.push('sections must include at least one section');

  addDuplicateErrors(sources, 'sources', errors);
  addDuplicateErrors(blocks, 'sourceBlocks', errors);
  addDuplicateErrors(steps, 'readerSteps', errors);
  addDuplicateErrors(sections, 'sections', errors);
  addDuplicateErrors(atomic, 'concepts.atomic', errors);
  addDuplicateErrors(clustered, 'concepts.clustered', errors);
  addDuplicateErrors(relations, 'relations', errors);

  const sourceIds = collectIds(sources);
  const blockIds = collectIds(blocks);
  const stepIds = collectIds(steps);
  const sectionIds = collectIds(sections);
  const conceptIds = new Set([...collectIds(atomic), ...collectIds(clustered)]);
  const relationIds = collectIds(relations);

  for (const source of sources) {
    if (!hasText(source.id)) errors.push('sources entry id is required');
    if (!hasText(source.type)) errors.push(`sources.${source.id ?? '?'} type is required`);
    if (!hasText(source.title)) errors.push(`sources.${source.id ?? '?'} title is required`);
  }

  for (const block of blocks) {
    if (!hasText(block.id)) errors.push('sourceBlocks entry id is required');
    if (!sourceIds.has(block.sourceId)) errors.push(`sourceBlocks.${block.id ?? '?'} references missing source '${block.sourceId}'`);
    if (!hasText(block.kind)) errors.push(`sourceBlocks.${block.id ?? '?'} kind is required`);
    if (typeof block.text !== 'string') errors.push(`sourceBlocks.${block.id ?? '?'} text must be a string`);
    if (typeof block.order !== 'number') errors.push(`sourceBlocks.${block.id ?? '?'} order must be a number`);
  }

  for (const concept of atomic) {
    if (!hasText(concept.id)) errors.push('concepts.atomic entry id is required');
    if (!hasText(concept.label)) errors.push(`concepts.${concept.id ?? '?'} label is required`);
    for (const parentId of asArray(concept.parentIds)) {
      if (!collectIds(clustered).has(parentId)) errors.push(`concepts.${concept.id} references missing cluster '${parentId}'`);
    }
    if (concept.firstSeenBlockId != null && !blockIds.has(concept.firstSeenBlockId)) {
      errors.push(`concepts.${concept.id} firstSeenBlockId references missing block '${concept.firstSeenBlockId}'`);
    }
  }

  for (const cluster of clustered) {
    if (!hasText(cluster.id)) errors.push('concepts.clustered entry id is required');
    if (!hasText(cluster.label)) errors.push(`concepts.${cluster.id ?? '?'} label is required`);
    for (const childId of asArray(cluster.childIds)) {
      if (!collectIds(atomic).has(childId)) errors.push(`concepts.${cluster.id} references missing child concept '${childId}'`);
    }
  }

  for (const relation of relations) {
    if (!hasText(relation.id)) errors.push('relations entry id is required');
    if (!conceptIds.has(relation.from)) errors.push(`relations.${relation.id ?? '?'} .from references missing concept '${relation.from}'`.replace(' .from', '.from'));
    if (!conceptIds.has(relation.to)) errors.push(`relations.${relation.id ?? '?'} .to references missing concept '${relation.to}'`.replace(' .to', '.to'));
    if (!hasText(relation.type)) errors.push(`relations.${relation.id ?? '?'} type is required`);
    const provenance = relation.provenance ?? 'source';
    if (provenance !== 'source' && provenance !== 'inferred') errors.push(`relations.${relation.id ?? '?'} provenance must be 'source' or 'inferred'`);
    if (provenance === 'source' && !asArray(relation.groundedInBlockIds).some((id) => blockIds.has(id))) {
      errors.push(`relations.${relation.id ?? '?'} source provenance requires groundedInBlockIds`);
    }
    if (provenance === 'inferred' && !hasText(relation.rationale)) {
      errors.push(`relations.${relation.id ?? '?'} inferred provenance requires rationale`);
    }
  }

  for (const step of steps) {
    if (!hasText(step.id)) errors.push('readerSteps entry id is required');
    for (const blockId of asArray(step.sourceBlockIds)) {
      if (!blockIds.has(blockId)) errors.push(`readerSteps.${step.id ?? '?'} references missing sourceBlock '${blockId}'`);
    }
    if (!sectionIds.has(step.sectionId)) errors.push(`readerSteps.${step.id ?? '?'} references missing section '${step.sectionId}'`);
    for (const activation of asArray(step.focusConcepts)) {
      if (!conceptIds.has(activation.id)) errors.push(`readerSteps.${step.id ?? '?'} focusConcept '${activation.id}' references missing concept`);
      if (typeof activation.weight !== 'number') errors.push(`readerSteps.${step.id ?? '?'} focusConcept '${activation.id}' must include numeric weight`);
    }
    for (const activation of asArray(step.focusRelations)) {
      if (!relationIds.has(activation.id)) errors.push(`readerSteps.${step.id ?? '?'} focusRelation '${activation.id}' references missing relation`);
      if (typeof activation.weight !== 'number') errors.push(`readerSteps.${step.id ?? '?'} focusRelation '${activation.id}' must include numeric weight`);
    }
    if (!step.skipped && !asArray(step.focusConcepts).length && !asArray(step.focusRelations).length) {
      errors.push(`readerSteps.${step.id ?? '?'} has no focus anchors`);
    }
  }

  for (const section of sections) {
    if (!hasText(section.id)) errors.push('sections entry id is required');
    if (!hasText(section.title)) errors.push(`sections.${section.id ?? '?'} title is required`);
    for (const stepId of asArray(section.readerStepIds)) {
      if (!stepIds.has(stepId)) errors.push(`sections.${section.id ?? '?'} references missing readerStep '${stepId}'`);
    }
  }

  const coveredBlockIds = new Set(steps.flatMap((step) => asArray(step.sourceBlockIds)));
  for (const block of blocks) {
    if (!block.skipped && !coveredBlockIds.has(block.id)) {
      errors.push(`sourceBlocks.${block.id} is not covered by any readerStep`);
    }
  }

  return { ok: errors.length === 0, errors };
}

export function formatSourceFirstValidationErrors(result) {
  return asArray(result?.errors).map((error) => `- ${error}`).join('\n');
}
