import { parseAuthoringMarkdown } from './parse.js';
import { validateSourceFirstDocument } from './schema.js';

function asArray(value) {
  return Array.isArray(value) ? value : value == null ? [] : [value];
}

function firstString(value) {
  return Array.isArray(value) ? value[0] : value;
}

function relationIdForInline(item) {
  return `${item.from}-${item.type}-${item.to}`;
}

function sourceFrom(entry) {
  return {
    id: entry.id,
    type: String(entry.fields.type ?? 'text'),
    title: String(entry.fields.title ?? entry.id),
    ...(entry.fields.path ? { path: String(entry.fields.path) } : {}),
  };
}

function blockFrom(entry, order) {
  return {
    id: entry.id,
    sourceId: entry.attrs.source,
    kind: entry.attrs.kind ?? 'paragraph',
    text: entry.body,
    order,
    ...(entry.fields.skipped ? { skipped: Boolean(entry.fields.skipped) } : {}),
  };
}

function stepFrom(entry, relationIdBySignature) {
  const relationActivations = asArray(entry.fields.relations).map((item) => {
    const signature = `${item.from}|${item.type}|${item.to}`;
    return {
      id: relationIdBySignature.get(signature) ?? relationIdForInline(item),
      weight: item.weight,
    };
  });

  const blockIdsFromAttribute = entry.attrs.blocks
    ? String(entry.attrs.blocks)
        .split(',')
        .map((id) => id.trim())
        .filter(Boolean)
    : asArray(entry.fields.blocks);

  return {
    id: entry.id,
    sectionId: entry.attrs.section ?? entry.fields.section,
    sourceBlockIds: blockIdsFromAttribute,
    summary: String(entry.fields.summary ?? ''),
    focusConcepts: asArray(entry.fields.focus),
    focusRelations: relationActivations,
    ...(entry.fields.skipped ? { skipped: Boolean(entry.fields.skipped) } : {}),
  };
}

function sectionFrom(entry) {
  return {
    id: entry.id,
    title: String(entry.fields.title ?? entry.id),
    summary: String(entry.fields.summary ?? ''),
    readerStepIds: asArray(entry.fields.steps),
  };
}

function atomicConceptFrom(entry) {
  return {
    id: entry.id,
    label: String(entry.fields.label ?? entry.id),
    aliases: asArray(entry.fields.aliases),
    parentIds: asArray(entry.fields.cluster),
    firstSeenBlockId: firstString(entry.fields.first_seen),
  };
}

function clusterFrom(entry) {
  return {
    id: entry.id,
    label: String(entry.fields.label ?? entry.id),
    childIds: asArray(entry.fields.children),
  };
}

function relationFrom(entry) {
  const provenance = entry.fields.provenance ?? 'source';
  return {
    id: entry.id,
    from: String(entry.fields.from ?? ''),
    to: String(entry.fields.to ?? ''),
    type: String(entry.fields.type ?? ''),
    provenance,
    groundedInBlockIds: asArray(entry.fields.grounded_in),
    ...(entry.fields.rationale ? { rationale: String(entry.fields.rationale) } : {}),
  };
}

function inlineRelationFrom(item) {
  return {
    id: relationIdForInline(item),
    from: item.from,
    to: item.to,
    type: item.type,
    provenance: 'source',
    groundedInBlockIds: [],
  };
}

export function compileAuthoringModel(model) {
  const explicitRelations = model.relations.map(relationFrom);
  const explicitRelationKeys = new Map(
    explicitRelations.map((relation) => [`${relation.from}|${relation.type}|${relation.to}`, relation.id]),
  );

  const inlineRelations = [];
  const inlineSignatures = new Set(explicitRelationKeys.keys());
  for (const step of model.steps) {
    for (const item of asArray(step.fields.relations)) {
      const signature = `${item.from}|${item.type}|${item.to}`;
      if (inlineSignatures.has(signature)) continue;
      inlineSignatures.add(signature);
      inlineRelations.push(inlineRelationFrom(item));
    }
  }

  const document = {
    kind: 'mindgraph.source-first',
    version: 1,
    title: String(model.meta.title ?? 'Untitled Mindgraph'),
    sources: model.sources.map(sourceFrom),
    sourceBlocks: model.blocks.map(blockFrom),
    readerSteps: model.steps.map((step) => stepFrom(step, explicitRelationKeys)),
    sections: model.sections.map(sectionFrom),
    concepts: {
      atomic: model.concepts.map(atomicConceptFrom),
      clustered: model.clusters.map(clusterFrom),
    },
    relations: [...explicitRelations, ...inlineRelations],
    intakes: [],
    revisions: [],
    meta: {
      authoring: {
        kind: model.meta.kind,
        runtime: model.meta.runtime,
        filePath: model.filePath,
      },
    },
  };

  const validation = validateSourceFirstDocument(document);
  return { document, validation };
}

export function compileAuthoringMarkdown(markdown, opts = {}) {
  return compileAuthoringModel(parseAuthoringMarkdown(markdown, opts));
}
