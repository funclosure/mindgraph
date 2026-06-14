import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { parseAuthoringMarkdown } from '../src/core/authoring/parse.js';

const fixturePath = 'examples/authoring/recursive-self-improvement.mindgraph.md';

test('parseAuthoringMarkdown parses frontmatter and directives', () => {
  const markdown = fs.readFileSync(fixturePath, 'utf8');
  const model = parseAuthoringMarkdown(markdown, { filePath: fixturePath });

  assert.equal(model.meta.kind, 'mindgraph.authoring');
  assert.equal(model.meta.version, 1);
  assert.equal(model.meta.title, 'Recursive Self-Improvement');
  assert.equal(model.sources[0].id, 'rsi-note');
  assert.equal(model.sources[0].fields.title, 'Recursive Self-Improvement Notes');
  assert.equal(model.blocks[1].id, 'b002');
  assert.equal(model.blocks[1].attrs.source, 'rsi-note');
  assert.match(model.blocks[1].body, /feedback process/);
  assert.equal(model.steps[0].fields.summary, 'The source introduces recursive self-improvement as a capability feedback loop.');
  assert.deepEqual(model.steps[0].fields.focus, [
    { id: 'recursive-self-improvement', weight: 0.95, mode: 'explicit' },
    { id: 'feedback-loop', weight: 0.8, mode: 'explicit' },
  ]);
  assert.deepEqual(model.steps[0].fields.relations, [
    { from: 'recursive-self-improvement', to: 'feedback-loop', type: 'depends_on', weight: 0.85 },
  ]);
});

test('parseAuthoringMarkdown rejects documents without frontmatter', () => {
  assert.throws(
    () => parseAuthoringMarkdown('@source x\n type: text\n'),
    /Missing frontmatter/,
  );
});

test('parseAuthoringMarkdown rejects unknown directives', () => {
  assert.throws(
    () => parseAuthoringMarkdown('---\nkind: mindgraph.authoring\nversion: 1\ntitle: X\n---\n\n@unknown x\n'),
    /Unknown directive '@unknown'/,
  );
});
