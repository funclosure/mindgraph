import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  applyDigestPlanOperation,
  buildStarterDigestOperation,
  evaluateDigestOperation,
  inspectDocumentOperation,
  prepareSourceOperation,
} from '../src/core/journey.js';

function makeTempWorkspace() {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'mindgraph-journey-'));
  fs.mkdirSync(path.join(workspace, 'graphs'), { recursive: true });
  return workspace;
}

test('prepareSourceOperation wraps source preparation with workspace-safe paths', async () => {
  const workspace = makeTempWorkspace();
  const transcript = path.join(workspace, 'source.txt');
  fs.writeFileSync(transcript, 'One paragraph about wisdom.\n\nAnother paragraph about meaning.', 'utf8');

  const result = await prepareSourceOperation({ source: transcript, workspaceDir: workspace, title: 'Wisdom Source' });

  assert.equal(result.ok, true);
  assert.equal(result.source.kind, 'file');
  assert.equal(result.source.preparedPath, transcript);
});

test('buildStarterDigestOperation imports source, builds timeline, validates, and writes report', async () => {
  const workspace = makeTempWorkspace();
  const transcript = path.join(workspace, 'source.txt');
  const output = path.join(workspace, 'graphs', 'wisdom.mindgraph.json');
  fs.writeFileSync(transcript, 'Wisdom is trained attention.\n\nMeaning grows through practice.', 'utf8');

  const result = await buildStarterDigestOperation({
    source: transcript,
    outputPath: output,
    workspaceDir: workspace,
    title: 'Wisdom Practice',
    mode: 'untimed',
    wordsPerMinute: 150,
    mesoSize: 2,
  });

  assert.equal(result.ok, true);
  assert.equal(result.documentPath, output);
  assert.equal(fs.existsSync(output), true);
  assert.equal(result.summary.title, 'Wisdom Practice');
  assert.equal(result.summary.frameCounts.micro, 2);
  assert.deepEqual(result.next.agentAction, 'create-digest-plan');
});

test('apply, evaluate, and inspect operations share one document contract', async () => {
  const workspace = makeTempWorkspace();
  const transcript = path.join(workspace, 'source.txt');
  const output = path.join(workspace, 'graphs', 'wisdom.mindgraph.json');
  const planFile = path.join(workspace, 'plan.json');
  fs.writeFileSync(transcript, 'Wisdom addresses meaning crisis.\n\nPractice cultivates wisdom.', 'utf8');
  await buildStarterDigestOperation({ source: transcript, outputPath: output, workspaceDir: workspace, title: 'Wisdom Practice', mode: 'untimed', mesoSize: 1 });
  fs.writeFileSync(planFile, JSON.stringify({
    concepts: [{ id: 'wisdom', label: 'Wisdom', firstSeenAt: 0 }, { id: 'meaning-crisis', label: 'Meaning Crisis', firstSeenAt: 0 }],
    relations: [{ id: 'wisdom-addresses-meaning-crisis', from: 'wisdom', to: 'meaning-crisis', type: 'addresses' }],
    mesoActivations: [{ index: 0, foreground: [{ id: 'wisdom', weight: 1, mode: 'explicit' }, { id: 'meaning-crisis', weight: 0.8, mode: 'explicit' }], relations: [{ id: 'wisdom-addresses-meaning-crisis', weight: 0.9 }] }],
    recomputeStats: true,
  }), 'utf8');

  const applied = await applyDigestPlanOperation({ documentPath: output, planPath: planFile });
  const evaluation = await evaluateDigestOperation({ documentPath: output });
  const inspected = await inspectDocumentOperation({ documentPath: output });

  assert.equal(applied.ok, true);
  assert.equal(applied.summary.conceptsUpserted, 2);
  assert.equal(evaluation.ok, true);
  assert.deepEqual(evaluation.report.inactiveRelationIds, []);
  assert.equal(inspected.ok, true);
  assert.equal(inspected.summary.conceptCounts.atomic, 2);
});
