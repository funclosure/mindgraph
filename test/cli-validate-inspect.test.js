import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { registry } from '../src/operations/index.js';

function writeSourceFirstJson() {
  const md = fs.readFileSync('examples/authoring/recursive-self-improvement.mindgraph.md', 'utf8');
  const { value } = registry.run('compile', { markdown: md, filePath: 'fixture.md' });
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mg-cli-'));
  const file = path.join(dir, 'doc.mindgraph.json');
  fs.writeFileSync(file, JSON.stringify(value.document, null, 2));
  return file;
}

function runCli(args) {
  return spawnSync('node', ['src/cli/index.js', ...args], { encoding: 'utf8' });
}

test('CLI validate ACCEPTS a compiled source-first document', () => {
  const file = writeSourceFirstJson();
  const out = runCli(['validate', file]);
  assert.equal(out.status, 0, out.stderr);
  assert.match(out.stdout, /OK/);
});

test('CLI inspect SUMMARIZES a source-first document', () => {
  const file = writeSourceFirstJson();
  const out = runCli(['inspect', file]);
  assert.equal(out.status, 0, out.stderr);
  assert.match(out.stdout, /mindgraph\.source-first/);
});

test('CLI validate on a missing file yields a structured error, not a raw stack', () => {
  const out = runCli(['validate', '/nonexistent/does-not-exist.json']);
  assert.equal(out.status, 1);
  assert.match(out.stderr, /^mindgraph: /m);
  assert.doesNotMatch(out.stderr, /at Object\.<anonymous>|at \w+ \(/); // no JS stack frames
});
