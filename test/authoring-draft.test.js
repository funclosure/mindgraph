import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { createAuthoringDraftFromText } from '../src/core/authoring/draft.js';
import { compileAuthoringMarkdown } from '../src/core/authoring/compile.js';

const article = `Policy on Fast Systems

1. Regulation

Fast systems create risks before institutions can react. Public safety depends on testing and clear authority.

2. Adaptation

Economic adaptation requires measurement, incentives, and shared prosperity when automation changes work.
`;

test('createAuthoringDraftFromText emits valid authoring markdown from article text', () => {
  const { markdown } = createAuthoringDraftFromText(article, {
    title: 'Policy on Fast Systems',
    sourceId: 'fast-systems',
    sourcePath: 'article.txt',
    runtime: 'fast-systems.mindgraph.json',
  });

  assert.match(markdown, /kind: mindgraph\.authoring/);
  assert.match(markdown, /@source fast-systems/);
  assert.match(markdown, /@block b001 source=fast-systems/);
  assert.match(markdown, /@step s001 section=/);

  const { document, validation } = compileAuthoringMarkdown(markdown);
  assert.equal(validation.ok, true, validation.errors.join('\n'));
  assert.equal(document.title, 'Policy on Fast Systems');
  assert.equal(document.sources[0].id, 'fast-systems');
  assert.equal(document.sourceBlocks.length, 2);
  assert.equal(document.readerSteps.length, 2);
  assert.equal(document.sections.length, 2);
  assert.ok(document.concepts.atomic.length >= 3);
  assert.ok(document.relations.length >= 2);
});

test('createAuthoringDraftFromText writes a url line when sourceUrl is given', () => {
  const { markdown } = createAuthoringDraftFromText(article, {
    title: 'Policy on Fast Systems',
    sourceId: 'fast-systems',
    sourcePath: 'article.txt',
    sourceUrl: 'https://example.com/policy',
  });

  assert.match(markdown, /^url: https:\/\/example\.com\/policy$/m);

  const { document, validation } = compileAuthoringMarkdown(markdown);
  assert.equal(validation.ok, true, validation.errors.join('\n'));
  assert.equal(document.sources[0].url, 'https://example.com/policy');
});

test('createAuthoringDraftFromText omits the url line when sourceUrl is absent', () => {
  const { markdown } = createAuthoringDraftFromText(article, {
    title: 'Policy on Fast Systems',
    sourceId: 'fast-systems',
    sourcePath: 'article.txt',
  });
  assert.doesNotMatch(markdown, /^url:/m);
});

test('createAuthoringDraftFromText separates numbered heading lines from following paragraphs', () => {
  const compactArticle = `Policy on Fast Systems
1. Regulation
Fast systems create risks before institutions can react.
2. Adaptation
Economic adaptation requires measurement and incentives.
`;

  const { document, validation } = compileAuthoringMarkdown(
    createAuthoringDraftFromText(compactArticle, { title: 'Policy on Fast Systems' }).markdown,
  );

  assert.equal(validation.ok, true, validation.errors.join('\n'));
  assert.deepEqual(document.sections.map((section) => section.id), ['regulation', 'adaptation']);
  assert.deepEqual(document.sections.map((section) => section.title), ['Regulation', 'Adaptation']);
  assert.equal(document.sourceBlocks.length, 2);
});

test('CLI drafts authoring markdown and compiles runtime JSON in one pass', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mindgraph-authoring-draft-'));
  const inputPath = path.join(dir, 'article.txt');
  const markdownPath = path.join(dir, 'article.mindgraph.md');
  const jsonPath = path.join(dir, 'article.mindgraph.json');
  fs.writeFileSync(inputPath, article, 'utf8');

  const result = spawnSync(process.execPath, [
    'src/cli/index.js',
    'authoring',
    'draft',
    inputPath,
    '-o',
    markdownPath,
    '--title',
    'Policy on Fast Systems',
    '--source-id',
    'fast-systems',
    '--compile',
    jsonPath,
    '--json',
  ], {
    cwd: process.cwd(),
    encoding: 'utf8',
  });

  assert.equal(result.status, 0, result.stderr);
  const payload = JSON.parse(result.stdout);
  assert.equal(payload.ok, true);
  assert.equal(payload.outputFile, markdownPath);
  assert.equal(payload.compiledFile, jsonPath);

  const markdown = fs.readFileSync(markdownPath, 'utf8');
  assert.match(markdown, /@source fast-systems/);

  const compiled = JSON.parse(fs.readFileSync(jsonPath, 'utf8'));
  assert.equal(compiled.kind, 'mindgraph.source-first');
  assert.equal(compiled.title, 'Policy on Fast Systems');
  assert.equal(compiled.sourceBlocks.length, 2);
});

test('authoring draft turns timestamped caption transcripts into clean source blocks', () => {
  const raw = [
    'Video Title',
    'https://example.com/watch',
    '',
    '[0:04] Opening line.',
    '[0:20] More setup.',
    '[1:05] First argument.',
    '[1:50] More first argument.',
    '[2:20] Second argument.',
    '[3:10] Closing argument.',
  ].join('\n');

  const result = createAuthoringDraftFromText(raw, {
    title: 'Video Title',
    sourceId: 'video-title',
    sourcePath: '/tmp/video.txt',
  });

  assert.equal(result.validation.ok, true);
  assert.ok(result.document.sourceBlocks.length > 1);
  assert.ok(result.document.sourceBlocks.every((block) => block.kind === 'transcript'));
  assert.match(result.document.sourceBlocks[0].text, /Opening line/);
  assert.doesNotMatch(result.document.sourceBlocks[0].text, /\[\d{1,2}:\d{2}(?::\d{2})?\]/);
  assert.match(result.markdown, /@block b001 source=video-title kind=transcript/);
});
