import { ok, err, errorItem } from './result.js';
import { compileAuthoringMarkdown } from '../core/authoring/compile.js';
import { validateSourceFirstDocument } from '../core/authoring/schema.js';
import { validateDocument, summarizeDocument } from '../core/schema.js';
import { evaluateSourceFirstReading } from '../view-model/evaluateSourceFirstReading.js';
import { buildMindgraphViewModel } from '../view-model/buildMindgraphViewModel.js';

function isSourceFirst(document) {
  return document?.kind === 'mindgraph.source-first';
}

function summarizeSourceFirst(document) {
  return {
    kind: document.kind,
    title: document.title ?? '',
    counts: {
      sources: (document.sources ?? []).length,
      sourceBlocks: (document.sourceBlocks ?? []).length,
      readerSteps: (document.readerSteps ?? []).length,
      sections: (document.sections ?? []).length,
      conceptsAtomic: (document.concepts?.atomic ?? []).length,
      conceptsClustered: (document.concepts?.clustered ?? []).length,
      relations: (document.relations ?? []).length,
    },
  };
}

export const operations = [
  {
    name: 'compile',
    summary: 'Compile source-first authoring markdown to a runtime document.',
    inputSchema: {
      type: 'object',
      properties: { markdown: { type: 'string' }, filePath: { type: 'string' } },
      required: ['markdown'],
    },
    handler: ({ markdown, filePath }) => {
      const { document, validation } = compileAuthoringMarkdown(markdown, { filePath });
      return ok({ document, validation });
    },
  },
  {
    name: 'validate',
    summary: 'Validate a mindgraph document; routes by document kind.',
    inputSchema: { type: 'object', properties: { document: { type: 'object' } }, required: ['document'] },
    handler: ({ document }) => {
      const result = isSourceFirst(document) ? validateSourceFirstDocument(document) : validateDocument(document);
      return ok({ valid: result.ok, kind: document.kind, errors: result.errors ?? [] });
    },
  },
  {
    name: 'qa',
    summary: 'Source-first reading QA: focus binding and relation grounding.',
    inputSchema: { type: 'object', properties: { document: { type: 'object' } }, required: ['document'] },
    handler: ({ document }) => ok(evaluateSourceFirstReading(document)),
  },
  {
    name: 'inspect',
    summary: 'Summarize a mindgraph document; routes by document kind.',
    inputSchema: { type: 'object', properties: { document: { type: 'object' } }, required: ['document'] },
    handler: ({ document }) => {
      if (isSourceFirst(document)) return ok(summarizeSourceFirst(document));
      const validation = validateDocument(document);
      if (!validation.ok) {
        return err(validation.errors.map((message) => errorItem('invalid_document', message)));
      }
      return ok(summarizeDocument(document));
    },
  },
  {
    name: 'view_model',
    summary: 'Build the UI view model from a document.',
    inputSchema: { type: 'object', properties: { document: { type: 'object' } }, required: ['document'] },
    handler: ({ document }) => ok({ viewModel: buildMindgraphViewModel(document) }),
  },
];
