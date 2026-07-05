// ---------------------------------------------------------------------------
// author — one-command produce pipeline: source text → scaffold → semantic
// authoring (agent or stub) → compile → qa. The deterministic CLI can't do the
// semantic pass, so the "runner" step is where an LLM agent (or a canned stub)
// authors the .mindgraph.md. Everything around it — drafting the scaffold,
// compiling, QA — is deterministic and shared by both modes.
// ---------------------------------------------------------------------------

import fs from 'node:fs';
import path from 'node:path';
import { createAuthoringDraftFromText } from '../core/authoring/draft.js';
import { compileAuthoringMarkdown } from '../core/authoring/compile.js';
import { evaluateSourceFirstReading } from '../view-model/evaluateSourceFirstReading.js';

const noop = () => {};

// The stub runner: overwrites the scaffold with a small, deterministic, valid
// authoring document so the whole pipeline is exercisable without credentials.
// Concept labels appear verbatim in the block text so reading QA binds.
export function stubProducer({ mdPath, title = 'Untitled', onProgress = noop }) {
  onProgress('stub runner: writing a canned two-concept graph');
  const md = [
    '---',
    'kind: mindgraph.authoring',
    'version: 1',
    `title: ${title}`,
    '---',
    '',
    '# Sources',
    '@source stub-source',
    'type: text',
    `title: ${title}`,
    '',
    '# Source Blocks',
    '@block b001 source=stub-source kind=heading',
    title,
    '',
    '@block b002 source=stub-source kind=paragraph',
    'This stub graph names a Central Idea and a Supporting Idea so the produce '
      + 'pipeline compiles end-to-end. The Central Idea depends on the Supporting Idea.',
    '',
    '# Reader Steps',
    '@step s001 section=overview blocks=b001,b002',
    'summary: A stub reader step naming the two ideas.',
    'focus:',
    '  - central-idea 0.9 explicit',
    '  - supporting-idea 0.8 explicit',
    'relations:',
    '  - central-idea -> supporting-idea depends_on 0.85',
    '',
    '# Sections',
    '@section overview',
    'title: Overview',
    'steps: s001',
    '',
    '# Concepts',
    '@concept central-idea',
    'label: Central Idea',
    'first_seen: b002',
    '',
    '@concept supporting-idea',
    'label: Supporting Idea',
    'first_seen: b002',
    '',
    '# Relations',
    '@relation central-depends-supporting',
    'from: central-idea',
    'to: supporting-idea',
    'type: depends_on',
    'provenance: source',
    'grounded_in: b002',
    '',
  ].join('\n');
  fs.writeFileSync(mdPath, md, 'utf8');
}

async function resolveRealRunner() {
  const mod = await import('../server/producerRunner.js');
  return mod.producerRunner;
}

export async function authorGraph({
  sourceText,
  title,
  sourceId,
  outputMd,
  stub = false,
  runner,
  onProgress = noop,
}) {
  if (!outputMd) throw new Error('authorGraph requires an outputMd path.');

  // 1. Deterministic scaffold from the raw text (also validates the text is usable).
  const draft = createAuthoringDraftFromText(sourceText ?? '', { title, sourceId });
  fs.mkdirSync(path.dirname(path.resolve(outputMd)), { recursive: true });
  fs.writeFileSync(outputMd, draft.markdown, 'utf8');
  onProgress('scaffold drafted');

  // 2. Semantic authoring step: injected runner > stub > real agent.
  const run = runner ?? (stub
    ? (opts) => stubProducer(opts)
    : await resolveRealRunner());
  await run({ mdPath: outputMd, sourceText, title, onProgress });
  onProgress('authoring complete');

  // 3. Deterministic compile + QA.
  const markdown = fs.readFileSync(outputMd, 'utf8');
  const { document, validation } = compileAuthoringMarkdown(markdown, { filePath: outputMd });

  let jsonPath = null;
  let qa = null;
  if (validation.ok) {
    jsonPath = outputMd.replace(/\.mindgraph\.md$/, '.mindgraph.json').replace(/\.md$/, '.json');
    fs.writeFileSync(jsonPath, JSON.stringify(document, null, 2) + '\n', 'utf8');
    qa = evaluateSourceFirstReading(document);
  }

  return { mdPath: outputMd, jsonPath, document, validation, qa };
}
