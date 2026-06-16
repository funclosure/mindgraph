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

test('parseAuthoringMarkdown preserves block body lines that resemble fields or headings', () => {
  const markdown = `---
kind: mindgraph.authoring
version: 1
title: Body Field Noise
---

@block b001 source=demo kind=paragraph
Note: this is important note text.
http://example.com/resource
#hashtag should stay
### fake heading line
`;

  const model = parseAuthoringMarkdown(markdown);
  const { fields, body } = model.blocks[0];

  assert.deepEqual(fields, {});
  assert.match(body, /Note: this is important note text\./);
  assert.match(body, /http:\/\/example\.com\/resource/);
  assert.match(body, /#hashtag should stay/);
  assert.match(body, /### fake heading line/);
});

test('parseAuthoringMarkdown does not include authoring section headings in directive bodies', () => {
  const markdown = `---
kind: mindgraph.authoring
version: 1
title: Section Boundary
---

# Source Blocks

@block b001 source=demo kind=paragraph
Pure source text.

# Reader Steps

@step s001 section=setup blocks=b001
summary: Focused source.
focus:
  - source-text 0.9 explicit
`;

  const model = parseAuthoringMarkdown(markdown);

  assert.equal(model.blocks[0].body, 'Pure source text.');
  assert.equal(model.steps[0].id, 's001');
});

test('parseAuthoringMarkdown rejects malformed focus item entries', () => {
  const markdown = `---
kind: mindgraph.authoring
version: 1
title: Focus Parse
---

@step s001 section=setup
focus:
  - concept explicit
`;

  assert.throws(
    () => parseAuthoringMarkdown(markdown),
    /Invalid focus item 'concept explicit'/,
  );
});

test('parseFrontmatter parses CRLF files', () => {
  const markdown = `---\r\nkind: mindgraph.authoring\r\nversion: 1\r\ntitle: CRLF Example\r\n---\r\n@source x\r\ntype: text\r\ntitle: Source Title\r\n`;
  const model = parseAuthoringMarkdown(markdown);

  assert.equal(model.meta.kind, 'mindgraph.authoring');
  assert.equal(model.meta.version, 1);
  assert.equal(model.meta.title, 'CRLF Example');
});
