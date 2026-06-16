import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { registry } from '../src/operations/index.js';

const md = fs.readFileSync('examples/authoring/recursive-self-improvement.mindgraph.md', 'utf8');

function compileFixture() {
  const r = registry.run('compile', { markdown: md, filePath: 'fixture.md' });
  assert.equal(r.ok, true);
  assert.equal(r.value.validation.ok, true);
  return r.value.document;
}

test('compile returns a source-first document and passing validation', () => {
  const doc = compileFixture();
  assert.equal(doc.kind, 'mindgraph.source-first');
});

test('validate ACCEPTS a source-first document (regression for kind-routing bug)', () => {
  const doc = compileFixture();
  const r = registry.run('validate', { document: doc });
  assert.equal(r.ok, true);
  assert.equal(r.value.valid, true);
  assert.equal(r.value.kind, 'mindgraph.source-first');
});

test('validate reports invalid for a malformed document instead of throwing', () => {
  const r = registry.run('validate', { document: { kind: 'mindgraph.source-first', version: 1 } });
  assert.equal(r.ok, true);
  assert.equal(r.value.valid, false);
  assert.ok(r.value.errors.length > 0);
});

test('qa returns the reading report as value', () => {
  const doc = compileFixture();
  const r = registry.run('qa', { document: doc });
  assert.equal(r.ok, true);
  assert.equal(typeof r.value.focusBindingRate, 'number');
});

test('inspect summarizes a source-first document', () => {
  const doc = compileFixture();
  const r = registry.run('inspect', { document: doc });
  assert.equal(r.ok, true);
  assert.equal(r.value.kind, 'mindgraph.source-first');
  assert.equal(typeof r.value.counts.sourceBlocks, 'number');
});

test('view_model builds a view model from a document', () => {
  const doc = compileFixture();
  const r = registry.run('view_model', { document: doc });
  assert.equal(r.ok, true);
  assert.ok(r.value.viewModel.concepts);
});
