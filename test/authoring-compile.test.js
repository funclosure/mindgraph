import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { compileAuthoringMarkdown } from '../src/core/authoring/compile.js';

const fixturePath = 'examples/authoring/recursive-self-improvement.mindgraph.md';

test('compileAuthoringMarkdown emits valid source-first JSON', () => {
  const markdown = fs.readFileSync(fixturePath, 'utf8');
  const { document, validation } = compileAuthoringMarkdown(markdown, { filePath: fixturePath });

  assert.equal(validation.ok, true);
  assert.equal(document.kind, 'mindgraph.source-first');
  assert.equal(document.version, 1);
  assert.equal(document.title, 'Recursive Self-Improvement');
  assert.equal(document.sources[0].id, 'rsi-note');
  assert.deepEqual(document.sourceBlocks.map((block) => block.id), ['b001', 'b002']);
  assert.deepEqual(document.readerSteps[0].sourceBlockIds, ['b001', 'b002']);
  assert.deepEqual(document.readerSteps[0].focusConcepts.map((concept) => concept.id), ['recursive-self-improvement', 'feedback-loop']);
  assert.deepEqual(document.sections[0].readerStepIds, ['s001']);
  assert.deepEqual(document.concepts.atomic.map((concept) => concept.id), ['recursive-self-improvement', 'feedback-loop']);
  assert.deepEqual(document.concepts.clustered.map((concept) => concept.id), ['ai-capability-growth', 'systems-dynamics']);
  assert.equal(document.relations[0].id, 'rsi-depends-on-feedback');
  assert.deepEqual(document.relations[0].groundedInBlockIds, ['b002']);
  assert.equal(document.readerSteps[0].focusRelations[0].id, 'rsi-depends-on-feedback');
});

test('compileAuthoringMarkdown returns validation errors for broken references', () => {
  const markdown = `---
kind: mindgraph.authoring
version: 1
title: Broken
---

@source src
type: text
title: Source

@block b001 source=src kind=paragraph
Text.

@step s001 section=setup blocks=missing-block
summary: Broken.
focus:
  - missing-concept 1 explicit

@section setup
title: Setup
steps: s001
`;

  const { validation } = compileAuthoringMarkdown(markdown);
  assert.equal(validation.ok, false);
  assert.match(validation.errors.join('\n'), /readerSteps\.s001 references missing sourceBlock 'missing-block'/);
  assert.match(validation.errors.join('\n'), /readerSteps\.s001 focusConcept 'missing-concept' references missing concept/);
});

test('compileAuthoringMarkdown grounds inline step relations in the step source blocks', () => {
  const markdown = `---
kind: mindgraph.authoring
version: 1
title: Inline Relation
---

@source src
type: text
title: Source

@block b001 source=src kind=paragraph
Text.

@step s001 section=setup blocks=b001
summary: Inline relation.
focus:
  - recursive-self-improvement 1 explicit
relations:
  - recursive-self-improvement -> feedback-loop depends_on 0.75

@section setup
title: Setup
steps: s001

@concept recursive-self-improvement
label: Recursive Self-Improvement
first_seen: b001

@concept feedback-loop
label: Feedback Loop
first_seen: b001
`;

  const { document, validation } = compileAuthoringMarkdown(markdown);
  assert.equal(validation.ok, true, validation.errors.join('\n'));
  assert.equal(document.relations[0].id, 'recursive-self-improvement-depends_on-feedback-loop');
  assert.deepEqual(document.relations[0].groundedInBlockIds, ['b001']);
  assert.equal(document.readerSteps[0].focusRelations[0].id, 'recursive-self-improvement-depends_on-feedback-loop');
});

test('compileAuthoringMarkdown carries the source url into the compiled document', () => {
  const markdown = `---
kind: mindgraph.authoring
version: 1
title: With URL
---

@source src
type: article
title: Source
url: https://example.com/article

@block b001 source=src kind=paragraph
Text.

@step s001 section=setup blocks=b001
summary: Sourced.
focus:
  - sourced-idea 1 explicit

@section setup
title: Setup
steps: s001

@concept sourced-idea
label: Sourced Idea
first_seen: b001
`;

  const { document, validation } = compileAuthoringMarkdown(markdown);
  assert.equal(validation.ok, true, validation.errors.join('\n'));
  assert.equal(document.sources[0].url, 'https://example.com/article');
});

test('compileAuthoringMarkdown carries source duration metadata', () => {
  const markdown = `---
kind: mindgraph.authoring
version: 1
title: Timed Source
duration_seconds: 90
---

@source src
type: transcript
title: Source

@block b001 source=src kind=transcript
Opening.

@step s001 section=setup blocks=b001
summary: Timed source.
focus:
  - timed-source 1 explicit

@section setup
title: Setup
steps: s001

@concept timed-source
label: Timed Source
first_seen: b001
`;

  const { document, validation } = compileAuthoringMarkdown(markdown);
  assert.equal(validation.ok, true, validation.errors.join('\n'));
  assert.equal(document.meta.durationSeconds, 90);
});

test('CLI validates and compiles authoring markdown', () => {
  const outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mindgraph-authoring-cli-'));
  const outPath = path.join(outDir, 'compiled.mindgraph.json');

  const validate = spawnSync(process.execPath, ['src/cli/index.js', 'authoring', 'validate', fixturePath], {
    cwd: process.cwd(),
    encoding: 'utf8',
  });
  assert.equal(validate.status, 0, validate.stderr);
  assert.match(validate.stdout, /OK: .* is a valid mindgraph authoring document/);

  const compile = spawnSync(process.execPath, ['src/cli/index.js', 'authoring', 'compile', fixturePath, '-o', outPath], {
    cwd: process.cwd(),
    encoding: 'utf8',
  });
  assert.equal(compile.status, 0, compile.stderr);
  assert.match(compile.stdout, /Compiled .* to .*/);

  const compiled = JSON.parse(fs.readFileSync(outPath, 'utf8'));
  assert.equal(compiled.kind, 'mindgraph.source-first');
  assert.equal(compiled.title, 'Recursive Self-Improvement');
});

test('CLI reports validation failures for broken authoring markdown', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mindgraph-authoring-broken-'));
  const filePath = path.join(dir, 'broken.mindgraph.md');
  fs.writeFileSync(filePath, `---
kind: mindgraph.authoring
version: 1
title: Broken
---

@source src
type: text
title: Source
`, 'utf8');

  const result = spawnSync(process.execPath, ['src/cli/index.js', 'authoring', 'validate', filePath], {
    cwd: process.cwd(),
    encoding: 'utf8',
  });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /INVALID:/);
  assert.match(result.stderr, /sourceBlocks must include at least one block/);
  assert.match(result.stderr, /readerSteps must include at least one step/);
  assert.match(result.stderr, /sections must include at least one section/);
});
