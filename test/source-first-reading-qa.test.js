import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { compileAuthoringMarkdown } from '../src/core/authoring/compile.js';
import { evaluateSourceFirstReading } from '../src/view-model/evaluateSourceFirstReading.js';

function compile(markdown) {
  const { document, validation } = compileAuthoringMarkdown(markdown);
  assert.equal(validation.ok, true, validation.errors.join('\n'));
  return document;
}

test('evaluateSourceFirstReading reports active concepts that do not bind source phrasing', () => {
  const doc = compile(`---
kind: mindgraph.authoring
version: 1
title: QA Fixture
---

@source src
type: text
title: Source

@block b001 source=src kind=paragraph
The source says economic substitute, not the abstract graph label.

@step s001 section=setup blocks=b001
summary: A semantic concept should bind to source wording.
focus:
  - labor-substitution 1 explicit

@section setup
title: Setup
steps: s001

@concept labor-substitution
label: Labor Substitution
first_seen: b001
`);

  const report = evaluateSourceFirstReading(doc);

  assert.equal(report.ok, false);
  assert.equal(report.totalFocusActivations, 1);
  assert.equal(report.boundFocusActivations, 0);
  assert.equal(report.unboundFocusActivations, 1);
  assert.equal(report.focusBindingRate, 0);
  assert.deepEqual(report.unboundFocus[0], {
    stepId: 's001',
    sectionTitle: 'Setup',
    conceptId: 'labor-substitution',
    label: 'Labor Substitution',
    aliases: [],
  });
});

test('evaluateSourceFirstReading accepts aliases that bind semantic concepts to source text', () => {
  const doc = compile(`---
kind: mindgraph.authoring
version: 1
title: QA Fixture
---

@source src
type: text
title: Source

@block b001 source=src kind=paragraph
The source says economic substitute, not the abstract graph label.

@step s001 section=setup blocks=b001
summary: A semantic concept should bind to source wording.
focus:
  - labor-substitution 1 explicit

@section setup
title: Setup
steps: s001

@concept labor-substitution
label: Labor Substitution
aliases: economic substitute
first_seen: b001
`);

  const report = evaluateSourceFirstReading(doc);

  assert.equal(report.ok, true);
  assert.equal(report.totalFocusActivations, 1);
  assert.equal(report.boundFocusActivations, 1);
  assert.equal(report.unboundFocusActivations, 0);
  assert.equal(report.focusBindingRate, 1);
  assert.deepEqual(report.unboundFocus, []);
});

test('evaluateSourceFirstReading does not require latent focus concepts to bind source phrasing', () => {
  const doc = compile(`---
kind: mindgraph.authoring
version: 1
title: Latent QA Fixture
---

@source src
type: text
title: Source

@block b001 source=src kind=paragraph
Claude Code changes work, while Mythos changes cybersecurity access.

@step s001 section=setup blocks=b001
summary: Latent themes may connect source-bound concepts without appearing verbatim.
focus:
  - claude-code 1 explicit
  - capability-vs-control 0.8 latent
relations:
  - capability-vs-control -> claude-code frames 0.7

@section setup
title: Setup
steps: s001

@concept claude-code
label: Claude Code
first_seen: b001

@concept capability-vs-control
label: Capability vs Control
first_seen: b001
`);

  const report = evaluateSourceFirstReading(doc);

  assert.equal(report.ok, true);
  assert.equal(report.totalFocusActivations, 1);
  assert.equal(report.boundFocusActivations, 1);
  assert.equal(report.unboundFocusActivations, 0);
  assert.equal(report.focusBindingRate, 1);
  assert.deepEqual(report.unboundFocus, []);
});

test('evaluateSourceFirstReading reports active relations whose endpoints are not foregrounded', () => {
  const doc = compile(`---
kind: mindgraph.authoring
version: 1
title: Relation QA Fixture
---

@source src
type: text
title: Source

@block b001 source=src kind=paragraph
Alpha clearly supports beta in the source.

@step s001 section=setup blocks=b001
summary: Relation endpoint is missing from focus.
focus:
  - alpha 1 explicit
relations:
  - alpha -> beta supports 1

@section setup
title: Setup
steps: s001

@concept alpha
label: Alpha
first_seen: b001

@concept beta
label: Beta
first_seen: b001
`);

  const report = evaluateSourceFirstReading(doc);

  assert.equal(report.ok, false);
  assert.equal(report.totalActiveRelations, 1);
  assert.equal(report.orphanedActiveRelations, 1);
  assert.deepEqual(report.orphanedRelations[0], {
    stepId: 's001',
    sectionTitle: 'Setup',
    relationId: 'alpha-supports-beta',
    from: 'alpha',
    to: 'beta',
    type: 'supports',
    missingEndpointIds: ['beta'],
  });
});

test('CLI authoring qa exits nonzero for unbound active concepts', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mindgraph-authoring-qa-'));
  const filePath = path.join(dir, 'qa.mindgraph.md');
  fs.writeFileSync(filePath, `---
kind: mindgraph.authoring
version: 1
title: QA Fixture
---

@source src
type: text
title: Source

@block b001 source=src kind=paragraph
The source says economic substitute.

@step s001 section=setup blocks=b001
summary: Missing alias.
focus:
  - labor-substitution 1 explicit

@section setup
title: Setup
steps: s001

@concept labor-substitution
label: Labor Substitution
first_seen: b001
`, 'utf8');

  const result = spawnSync(process.execPath, ['src/cli/index.js', 'authoring', 'qa', filePath, '--json'], {
    cwd: process.cwd(),
    encoding: 'utf8',
  });

  assert.equal(result.status, 1);
  const payload = JSON.parse(result.stdout);
  assert.equal(payload.ok, false);
  assert.equal(payload.report.unboundFocusActivations, 1);
});
