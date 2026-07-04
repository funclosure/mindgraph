import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { buildZshCompletion, COMMAND_TREE } from '../src/cli/completions.js';

test('COMMAND_TREE covers the dispatched CLI surface', () => {
  const names = COMMAND_TREE.map((command) => command.name);
  for (const expected of [
    'init', 'validate', 'inspect', 'authoring', 'source', 'digest', 'mcp',
    'ingest', 'build', 'concept', 'relation', 'frame', 'stats', 'view', 'open', 'completions',
  ]) {
    assert.ok(names.includes(expected), `expected COMMAND_TREE to include '${expected}'`);
  }
  const authoring = COMMAND_TREE.find((command) => command.name === 'authoring');
  assert.deepEqual(authoring.sub.map((s) => s.name), ['validate', 'compile', 'draft', 'qa']);
});

test('buildZshCompletion generates a compdef script with commands and file globs', () => {
  const script = buildZshCompletion();
  assert.match(script, /^#compdef mindgraph/);
  assert.match(script, /'open:/, 'expected open in top-level command descriptions');
  assert.match(script, /'authoring:/, 'expected authoring in top-level command descriptions');
  // open/view offer only mindgraph documents…
  assert.match(script, /(?:open\|view|view\|open)\)[\s\S]*?\*\.mindgraph\.\(json\|md\)/);
  // …and list documents under ./graphs directly, since `open` resolves name
  // fragments against that directory (typing from the repo root must show them).
  assert.match(script, /(?:open\|view|view\|open)\)[\s\S]*?graphs\/\*\.mindgraph\.\(json\|md\)\(N\)/);
  assert.match(script, /_alternative/);
  // authoring markdown subcommands offer only authoring markdown
  assert.match(script, /\*\.mindgraph\.md/);
  // nested subcommands complete at position 3
  assert.match(script, /'transcript:/, 'expected ingest transcript subcommand');
});

test('mindgraph completions zsh prints the script and exits 0', () => {
  const result = spawnSync(process.execPath, ['src/cli/index.js', 'completions', 'zsh'], { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /^#compdef mindgraph/);
});

test('generated zsh completion passes a zsh syntax check when zsh is available', () => {
  const probe = spawnSync('zsh', ['--version'], { encoding: 'utf8' });
  if (probe.error) return; // zsh not installed; structural checks above still hold
  const check = spawnSync('zsh', ['-n', '-c', buildZshCompletion()], { encoding: 'utf8' });
  assert.equal(check.status, 0, `zsh syntax check failed:\n${check.stderr}`);
});
