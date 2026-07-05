import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { authorGraph } from '../src/produce/authorGraph.js';

function tmpMd() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'author-'));
  return { dir, outputMd: path.join(dir, 'demo.mindgraph.md') };
}

test('authorGraph --stub produces a valid, non-skeleton, qa-clean graph', async () => {
  const { dir, outputMd } = tmpMd();
  try {
    const result = await authorGraph({
      sourceText: 'A short source about a topic.\n\nA second paragraph that elaborates on the topic.',
      title: 'Demo Topic',
      outputMd,
      stub: true,
    });
    assert.equal(result.validation.ok, true, result.validation.errors?.join('; '));
    assert.ok(result.document.concepts.atomic.length > 0, 'has concepts (not a skeleton)');
    assert.ok(fs.existsSync(result.jsonPath), 'compiled json written next to the md');
    assert.equal(result.qa.ok, true, `qa should pass: ${JSON.stringify(result.qa?.unboundFocus)}`);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('authorGraph writes authoring markdown to the output path', async () => {
  const { dir, outputMd } = tmpMd();
  try {
    await authorGraph({ sourceText: 'alpha beta gamma delta', title: 'T', outputMd, stub: true });
    const md = fs.readFileSync(outputMd, 'utf8');
    assert.match(md, /kind: mindgraph\.authoring/);
    assert.match(md, /@concept/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('authorGraph passes an injected runner (dependency seam for the real agent)', async () => {
  const { dir, outputMd } = tmpMd();
  let ran = false;
  try {
    await authorGraph({
      sourceText: 'text',
      title: 'T',
      outputMd,
      runner: async ({ mdPath }) => {
        ran = true;
        assert.equal(mdPath, outputMd);
        fs.writeFileSync(mdPath, [
          '---', 'kind: mindgraph.authoring', 'version: 1', 'title: T', '---', '',
          '# Sources', '@source s', 'type: text', 'title: T', '',
          '# Source Blocks', '@block b001 source=s kind=paragraph', 'Idea One and Idea Two appear here.', '',
          '# Reader Steps', '@step st1 section=sec blocks=b001',
          'summary: A step.', 'focus:', '  - idea-one 0.9 explicit', '  - idea-two 0.8 explicit',
          'relations:', '  - idea-one -> idea-two relates_to 0.8', '',
          '# Sections', '@section sec', 'title: Sec', 'steps: st1', '',
          '# Concepts', '@concept idea-one', 'label: Idea One', 'first_seen: b001', '',
          '@concept idea-two', 'label: Idea Two', 'first_seen: b001', '',
          '# Relations', '@relation r1', 'from: idea-one', 'to: idea-two', 'type: relates_to',
          'provenance: source', 'grounded_in: b001', '',
        ].join('\n'));
      },
    });
    assert.equal(ran, true, 'injected runner was invoked');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
