# Portable Agent MCP Journey Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the first cohesive product slice: shared source/journey operations, high-level CLI commands, and a minimal MCP server for external-agent operation.

**Architecture:** Add focused core modules for source preparation and journey orchestration, then make the CLI and MCP server thin adapters over those modules. This slice supports the external-agent path: it imports local files and readable web articles, builds starter timeline documents, applies/evaluates digest plans, inspects documents, and opens the viewer; built-in model-provider auto-digest remains outside this plan.

**Tech Stack:** Node 18+ ES modules, built-in `fs/path/child_process/http` APIs, existing core document/transcript/digest modules, Node test runner, no bundler, no UI framework, no runtime npm dependency.

---

## Scope decision

This plan implements the first slice from `docs/superpowers/specs/2026-06-03-portable-agent-and-auto-digest-ux-design.md`:

- Shared journey operations.
- High-level CLI commands.
- MCP server wrapping those operations.
- External-agent operation only.

This plan intentionally does not implement hosted web, provider adapters, or built-in auto-digest model calls. Those need their own plans after this slice lands.

## File structure

- Create `src/core/source.js`
  - Source classification and preparation.
  - Local file passthrough.
  - HTTP/HTTPS readable article fetch with lightweight HTML-to-text extraction.
  - YouTube URL detection with a clear structured unsupported result in this slice.

- Create `src/core/journey.js`
  - Product-level operations shared by CLI and MCP.
  - `prepareSourceOperation`, `buildStarterDigestOperation`, `inspectDocumentOperation`, `applyDigestPlanOperation`, `evaluateDigestOperation`.

- Modify `src/cli/index.js`
  - Import journey operations.
  - Add `mindgraph source import <source>`.
  - Add high-level `mindgraph digest <source>` alias for starter document creation.
  - Keep existing low-level commands.
  - Add `mindgraph mcp` command to start the MCP server.

- Create `src/mcp/server.js`
  - Minimal JSON-RPC over stdio MCP server with `initialize`, `tools/list`, and `tools/call`.
  - Tools wrap journey operations.
  - Explicit workspace root passed with `--workspace <dir>` or default process cwd.

- Modify `package.json`
  - Add bin `mindgraph-mcp` pointing to `./src/mcp/server.js`.
  - Add scripts `test:source`, `test:journey`, `test:mcp`.

- Create `test/source.test.js`
  - Tests local file preparation, article import, slugging, and YouTube unsupported classification.

- Create `test/journey.test.js`
  - Tests high-level starter digest operation and plan apply/evaluate operation.

- Create `test/mcp.test.js`
  - Tests MCP initialize, tools/list, and tool call behavior through stdio.

- Modify `README.md`
  - Add concise documentation for the journey CLI and MCP usage.

- Modify `skills/mindgraph/SKILL.md`
  - Teach agents to prefer high-level journey commands while keeping low-level repair commands available.

---

### Task 1: Add source preparation core

**Files:**
- Create: `src/core/source.js`
- Test: `test/source.test.js`

- [ ] **Step 1: Write failing source tests**

Create `test/source.test.js` with this content:

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { classifySource, prepareSource, slugifySourceTitle } from '../src/core/source.js';

function makeTempWorkspace() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'mindgraph-source-'));
}

function startArticleServer() {
  const server = http.createServer((req, res) => {
    res.setHeader('content-type', 'text/html; charset=utf-8');
    res.end(`<!doctype html>
      <html><head><title>Readable Article</title><script>window.noise = true;</script></head>
      <body><nav>Navigation</nav><article><h1>Readable Article</h1><p>First useful paragraph.</p><p>Second useful paragraph.</p></article></body></html>`);
  });
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      resolve({
        url: `http://127.0.0.1:${address.port}/article`,
        close: () => new Promise((done) => server.close(done)),
      });
    });
  });
}

test('classifySource detects local files, web articles, and YouTube URLs', () => {
  assert.equal(classifySource('./notes.txt').kind, 'file');
  assert.equal(classifySource('https://example.com/post').kind, 'web');
  assert.equal(classifySource('https://youtu.be/abc123').kind, 'youtube');
  assert.equal(classifySource('https://www.youtube.com/watch?v=abc123').kind, 'youtube');
});

test('slugifySourceTitle creates stable filesystem slugs', () => {
  assert.equal(slugifySourceTitle('Meaning, Crisis & Wisdom!'), 'meaning-crisis-wisdom');
  assert.equal(slugifySourceTitle('   '), 'source');
});

test('prepareSource passes through local file sources', async () => {
  const workspace = makeTempWorkspace();
  const sourcePath = path.join(workspace, 'input transcript.txt');
  fs.writeFileSync(sourcePath, 'A local transcript paragraph.', 'utf8');

  const result = await prepareSource({ source: sourcePath, workspaceDir: workspace, title: 'Local Title' });

  assert.equal(result.kind, 'file');
  assert.equal(result.preparedPath, sourcePath);
  assert.equal(result.title, 'Local Title');
  assert.equal(result.modeHint, 'auto');
});

test('prepareSource imports readable web article text into transcripts directory', async () => {
  const workspace = makeTempWorkspace();
  const article = await startArticleServer();
  try {
    const result = await prepareSource({ source: article.url, workspaceDir: workspace });

    assert.equal(result.kind, 'web');
    assert.match(result.preparedPath, /transcripts\/readable-article\.txt$/);
    assert.equal(result.title, 'Readable Article');
    assert.equal(result.modeHint, 'untimed');
    const saved = fs.readFileSync(result.preparedPath, 'utf8');
    assert.match(saved, /Readable Article/);
    assert.match(saved, /First useful paragraph\./);
    assert.doesNotMatch(saved, /window\.noise/);
  } finally {
    await article.close();
  }
});

test('prepareSource returns a structured unsupported result for YouTube in this slice', async () => {
  const workspace = makeTempWorkspace();
  const result = await prepareSource({ source: 'https://youtu.be/abc123', workspaceDir: workspace });

  assert.equal(result.kind, 'youtube');
  assert.equal(result.supported, false);
  assert.match(result.reason, /YouTube transcript import is not built into this slice/);
  assert.match(result.recoveryHint, /provide a transcript file/);
});
```

- [ ] **Step 2: Run the source tests and verify they fail**

Run:

```bash
node --test test/source.test.js
```

Expected: FAIL with an import error for `../src/core/source.js`.

- [ ] **Step 3: Implement source preparation**

Create `src/core/source.js` with this content:

```js
import fs from 'node:fs';
import path from 'node:path';

export function slugifySourceTitle(value) {
  const slug = String(value ?? '')
    .replace(/\.[^/.]+$/, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return slug || 'source';
}

export function classifySource(source) {
  const text = String(source ?? '');
  if (/^https?:\/\/(www\.)?(youtube\.com|youtu\.be)\//i.test(text)) return { kind: 'youtube', source: text };
  if (/^https?:\/\//i.test(text)) return { kind: 'web', source: text };
  return { kind: 'file', source: text };
}

function decodeHtmlEntities(text) {
  return String(text)
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

function extractTitle(html, fallback) {
  const h1 = html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i)?.[1];
  const title = h1 ?? html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] ?? fallback;
  return htmlToText(title).split('\n').map((line) => line.trim()).filter(Boolean)[0] ?? fallback;
}

export function htmlToText(html) {
  const withoutNoise = String(html)
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<nav[\s\S]*?<\/nav>/gi, ' ')
    .replace(/<header[\s\S]*?<\/header>/gi, ' ')
    .replace(/<footer[\s\S]*?<\/footer>/gi, ' ');
  const article = withoutNoise.match(/<article[^>]*>([\s\S]*?)<\/article>/i)?.[1] ?? withoutNoise;
  return decodeHtmlEntities(article)
    .replace(/<\/(h1|h2|h3|p|li|blockquote)>/gi, '\n')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n\s+/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

async function prepareWebSource({ source, workspaceDir, title }) {
  const response = await fetch(source, { headers: { 'user-agent': 'mindgraph-source-import/1.0' } });
  if (!response.ok) throw new Error(`Failed to fetch source: HTTP ${response.status} ${response.statusText}`);
  const html = await response.text();
  const resolvedTitle = title || extractTitle(html, new URL(source).hostname);
  const text = htmlToText(html);
  if (!text) throw new Error(`Fetched source did not contain readable text: ${source}`);
  const transcriptsDir = path.join(workspaceDir, 'transcripts');
  fs.mkdirSync(transcriptsDir, { recursive: true });
  const preparedPath = path.join(transcriptsDir, `${slugifySourceTitle(resolvedTitle)}.txt`);
  fs.writeFileSync(preparedPath, `${text}\n`, 'utf8');
  return {
    kind: 'web',
    supported: true,
    source,
    preparedPath,
    title: resolvedTitle,
    modeHint: 'untimed',
  };
}

export async function prepareSource({ source, workspaceDir = process.cwd(), title } = {}) {
  if (!source) throw new Error('Missing source.');
  const classification = classifySource(source);

  if (classification.kind === 'youtube') {
    return {
      kind: 'youtube',
      supported: false,
      source,
      title: title ?? source,
      reason: 'YouTube transcript import is not built into this slice.',
      recoveryHint: 'Use yt-dlp or YouTube UI to save a transcript, then provide a transcript file to mindgraph.',
    };
  }

  if (classification.kind === 'web') {
    return prepareWebSource({ source, workspaceDir, title });
  }

  const preparedPath = path.resolve(workspaceDir, source);
  if (!fs.existsSync(preparedPath)) throw new Error(`Source file not found: ${preparedPath}`);
  return {
    kind: 'file',
    supported: true,
    source,
    preparedPath,
    title: title || path.basename(preparedPath).replace(/\.[^/.]+$/, ''),
    modeHint: 'auto',
  };
}
```

- [ ] **Step 4: Run the source tests and verify they pass**

Run:

```bash
node --test test/source.test.js
```

Expected: PASS for 5 tests.

- [ ] **Step 5: Commit source preparation**

Run:

```bash
git add src/core/source.js test/source.test.js
git commit -m "feat(source): prepare local and web sources"
```

---

### Task 2: Add shared journey operations

**Files:**
- Create: `src/core/journey.js`
- Test: `test/journey.test.js`

- [ ] **Step 1: Write failing journey tests**

Create `test/journey.test.js` with this content:

```js
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
```

- [ ] **Step 2: Run journey tests and verify they fail**

Run:

```bash
node --test test/journey.test.js
```

Expected: FAIL with an import error for `../src/core/journey.js`.

- [ ] **Step 3: Implement journey operations**

Create `src/core/journey.js` with this content:

```js
import fs from 'node:fs';
import path from 'node:path';
import { buildTimelineFromTranscript } from './build.js';
import { applyDigestPlan, evaluateDigest } from './digest.js';
import { summarizeDocument, validateDocument } from './schema.js';
import { prepareSource } from './source.js';

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function writeJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

function ensureValidDocument(doc, documentPath) {
  const validation = validateDocument(doc);
  if (!validation.ok) {
    const error = new Error(`Invalid mindgraph document: ${documentPath}`);
    error.validation = validation;
    throw error;
  }
  return validation;
}

function toErrorResult(error) {
  return {
    ok: false,
    error: {
      message: error.message,
      validation: error.validation,
    },
  };
}

export async function prepareSourceOperation(input) {
  try {
    const source = await prepareSource(input);
    return { ok: source.supported !== false, source, error: source.supported === false ? { message: source.reason, recoveryHint: source.recoveryHint } : undefined };
  } catch (error) {
    return toErrorResult(error);
  }
}

export async function buildStarterDigestOperation({
  source,
  outputPath,
  workspaceDir = process.cwd(),
  title,
  mode,
  defaultSpeaker,
  wordsPerMinute,
  mesoSize,
} = {}) {
  try {
    if (!outputPath) throw new Error('Missing outputPath.');
    const prepared = await prepareSource({ source, workspaceDir, title });
    if (prepared.supported === false) {
      return { ok: false, source: prepared, error: { message: prepared.reason, recoveryHint: prepared.recoveryHint } };
    }
    const rawText = fs.readFileSync(prepared.preparedPath, 'utf8');
    const doc = buildTimelineFromTranscript({
      transcriptPath: prepared.preparedPath,
      rawText,
      outputPath,
      title: title ?? prepared.title,
      mode: mode ?? prepared.modeHint ?? 'auto',
      defaultSpeaker,
      wordsPerMinute,
      mesoSize,
    });
    doc.meta.journey = {
      kind: 'agent-operated-starter',
      source: prepared,
      createdAt: new Date().toISOString(),
      next: 'create-digest-plan',
    };
    ensureValidDocument(doc, outputPath);
    writeJson(outputPath, doc);
    return {
      ok: true,
      source: prepared,
      documentPath: outputPath,
      summary: summarizeDocument(doc),
      next: {
        agentAction: 'create-digest-plan',
        guidance: 'Read meso frames, create a DigestPlan with concepts, relations, activations, macro frames, then call digest apply and digest evaluate.',
      },
    };
  } catch (error) {
    return toErrorResult(error);
  }
}

export async function inspectDocumentOperation({ documentPath } = {}) {
  try {
    const doc = readJson(documentPath);
    const validation = ensureValidDocument(doc, documentPath);
    return { ok: true, documentPath, validation, summary: summarizeDocument(doc) };
  } catch (error) {
    return toErrorResult(error);
  }
}

export async function applyDigestPlanOperation({ documentPath, planPath, plan } = {}) {
  try {
    const doc = readJson(documentPath);
    const digestPlan = plan ?? readJson(planPath);
    const summary = applyDigestPlan(doc, digestPlan);
    ensureValidDocument(doc, documentPath);
    writeJson(documentPath, doc);
    return { ok: true, documentPath, summary };
  } catch (error) {
    return toErrorResult(error);
  }
}

export async function evaluateDigestOperation({ documentPath } = {}) {
  try {
    const doc = readJson(documentPath);
    ensureValidDocument(doc, documentPath);
    return { ok: true, documentPath, report: evaluateDigest(doc) };
  } catch (error) {
    return toErrorResult(error);
  }
}
```

- [ ] **Step 4: Run journey tests and verify they pass**

Run:

```bash
node --test test/journey.test.js
```

Expected: PASS for 3 tests.

- [ ] **Step 5: Run existing digest tests**

Run:

```bash
node --test test/digest.test.js
```

Expected: PASS.

- [ ] **Step 6: Commit journey operations**

Run:

```bash
git add src/core/journey.js test/journey.test.js
git commit -m "feat(journey): add shared digest operations"
```

---

### Task 3: Add high-level CLI journey commands

**Files:**
- Modify: `src/cli/index.js`
- Modify: `package.json`
- Test: `package.json` scripts and smoke command

- [ ] **Step 1: Add package test scripts first**

Modify the `scripts` object in `package.json` by adding these entries after `test:digest`:

```json
"test:source": "node --test test/source.test.js",
"test:journey": "node --test test/journey.test.js",
```

Run:

```bash
npm run test:source && npm run test:journey
```

Expected: PASS for both scripts.

- [ ] **Step 2: Import journey operations in the CLI**

In `src/cli/index.js`, add this import below the existing digest import:

```js
import { buildStarterDigestOperation, prepareSourceOperation } from '../core/journey.js';
```

- [ ] **Step 3: Update CLI help text**

In `printHelp()`, add these usage lines after `mindgraph inspect <input-file>`:

```text
  mindgraph source import <source> [--workspace <dir>] [--title <title>] [--json]
  mindgraph digest <source> [-o <output-file>] [--workspace <dir>] [--title <title>] [--mode auto|timed-lines|captions|untimed] [--speaker <name>] [--wpm <number>] [--meso-size <n>] [--json]
```

Add these command descriptions near the top of the Commands list:

```text
  source import          Prepare a local file or readable web article for mindgraph ingestion
  digest                 High-level source→starter-document operation for agent-operated digestion
```

- [ ] **Step 4: Add a helper for JSON or text result printing**

In `src/cli/index.js`, after `validateOrExit`, add:

```js
function exitWithOperationResult(result, { json = false, successText } = {}) {
  if (json) {
    console.log(JSON.stringify(result, null, 2));
  } else if (result.ok) {
    if (successText) console.log(successText(result));
  } else {
    console.error(result.error?.message ?? 'Operation failed.');
    if (result.error?.recoveryHint) console.error(result.error.recoveryHint);
  }
  process.exit(result.ok ? 0 : 1);
}
```

- [ ] **Step 5: Add `source import` command**

In `src/cli/index.js`, place this block before the existing `if (command === 'build' && subcommand === 'timeline')` block:

```js
if (command === 'source' && subcommand === 'import') {
  const [source, ...flagArgs] = rest;
  if (!source) {
    console.error('Missing source.');
    process.exit(1);
  }
  const flags = parseFlags(flagArgs);
  const result = await prepareSourceOperation({
    source,
    workspaceDir: requireFlag(flags, '--workspace') ?? process.cwd(),
    title: requireFlag(flags, '--title'),
  });
  exitWithOperationResult(result, {
    json: Boolean(flags['--json']),
    successText: (value) => {
      if (value.source.supported === false) return `${value.source.reason}\n${value.source.recoveryHint}`;
      return `Prepared ${value.source.kind} source at ${value.source.preparedPath}`;
    },
  });
}
```

- [ ] **Step 6: Add high-level `digest <source>` command**

In `src/cli/index.js`, place this block after `source import` and before low-level `digest apply`:

```js
if (command === 'digest' && subcommand && subcommand !== 'apply' && subcommand !== 'evaluate') {
  const source = subcommand;
  const flagArgs = rest;
  const flags = parseFlags(flagArgs);
  const explicitOutput = requireFlag(flags, '-o', '--output');
  const title = requireFlag(flags, '--title');
  const resolved = resolveOutputPath({
    explicit: explicitOutput,
    transcriptFile: source,
    title,
    cwd: requireFlag(flags, '--workspace') ?? process.cwd(),
  });
  if (!resolved) {
    console.error('Missing output file. Pass -o <output-file>, or run from a workspace containing ./graphs/.');
    process.exit(1);
  }
  if (!resolved.explicit && fs.existsSync(resolved.path)) {
    console.error(`Output already exists: ${resolved.path}`);
    console.error('Pass -o <output-file> explicitly to overwrite, or choose a different name.');
    process.exit(1);
  }

  const result = await buildStarterDigestOperation({
    source,
    outputPath: resolved.path,
    workspaceDir: requireFlag(flags, '--workspace') ?? process.cwd(),
    title,
    mode: requireFlag(flags, '--mode'),
    defaultSpeaker: requireFlag(flags, '--speaker'),
    wordsPerMinute: requireFlag(flags, '--wpm') ? Number(requireFlag(flags, '--wpm')) : undefined,
    mesoSize: requireFlag(flags, '--meso-size') ? Number(requireFlag(flags, '--meso-size')) : undefined,
  });
  exitWithOperationResult(result, {
    json: Boolean(flags['--json']),
    successText: (value) => [
      `Built starter digest at ${value.documentPath}`,
      `Source: ${value.source.kind} (${value.source.preparedPath})`,
      `Frames: ${value.summary.frameCounts.micro} micro, ${value.summary.frameCounts.meso} meso`,
      'Next: create a DigestPlan, then run mindgraph digest apply <document> --plan <plan-file>',
    ].join('\n'),
  });
}
```

- [ ] **Step 7: Verify CLI syntax**

Run:

```bash
node --check src/cli/index.js
```

Expected: PASS with no output.

- [ ] **Step 8: Manually verify high-level CLI commands**

Run:

```bash
TMPDIR=$(mktemp -d)
mkdir -p "$TMPDIR/graphs"
printf 'Wisdom addresses the meaning crisis.\n\nPractice cultivates wisdom.\n' > "$TMPDIR/source.txt"
node src/cli/index.js source import "$TMPDIR/source.txt" --workspace "$TMPDIR" --json
node src/cli/index.js digest "$TMPDIR/source.txt" --workspace "$TMPDIR" --title "Wisdom CLI" --mode untimed --meso-size 1 --json
node src/cli/index.js validate "$TMPDIR/graphs/wisdom-cli.mindgraph.json"
```

Expected: source import prints JSON with `"ok": true`; digest prints JSON with `"agentAction": "create-digest-plan"`; validate prints `OK:`.

- [ ] **Step 9: Commit CLI journey commands**

Run:

```bash
git add src/cli/index.js package.json
git commit -m "feat(cli): add journey digest commands"
```

---

### Task 4: Add minimal MCP server

**Files:**
- Create: `src/mcp/server.js`
- Modify: `src/cli/index.js`
- Modify: `package.json`
- Test: `test/mcp.test.js`

- [ ] **Step 1: Write failing MCP tests**

Create `test/mcp.test.js` with this content:

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';

function makeWorkspace() {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'mindgraph-mcp-'));
  fs.mkdirSync(path.join(workspace, 'graphs'), { recursive: true });
  fs.writeFileSync(path.join(workspace, 'source.txt'), 'Wisdom addresses meaning.\n\nPractice stabilizes wisdom.', 'utf8');
  return workspace;
}

function startServer(workspace) {
  const child = spawn(process.execPath, ['src/mcp/server.js', '--workspace', workspace], {
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  const responses = [];
  let buffer = '';
  child.stdout.on('data', (chunk) => {
    buffer += chunk.toString('utf8');
    const lines = buffer.split('\n');
    buffer = lines.pop();
    for (const line of lines) {
      if (line.trim()) responses.push(JSON.parse(line));
    }
  });
  return {
    child,
    responses,
    send: (message) => child.stdin.write(`${JSON.stringify(message)}\n`),
    stop: () => child.kill('SIGTERM'),
  };
}

async function waitForResponse(server, id) {
  const started = Date.now();
  while (Date.now() - started < 2000) {
    const response = server.responses.find((item) => item.id === id);
    if (response) return response;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error(`Timed out waiting for response ${id}`);
}

test('MCP server initializes, lists tools, and builds a starter digest', async () => {
  const workspace = makeWorkspace();
  const server = startServer(workspace);
  try {
    server.send({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'test', version: '0' } } });
    const initialized = await waitForResponse(server, 1);
    assert.equal(initialized.result.serverInfo.name, 'mindgraph');

    server.send({ jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} });
    const listed = await waitForResponse(server, 2);
    const toolNames = listed.result.tools.map((tool) => tool.name);
    assert.ok(toolNames.includes('mindgraph_build_starter_digest'));
    assert.ok(toolNames.includes('mindgraph_evaluate_digest'));

    server.send({
      jsonrpc: '2.0',
      id: 3,
      method: 'tools/call',
      params: {
        name: 'mindgraph_build_starter_digest',
        arguments: { source: path.join(workspace, 'source.txt'), outputPath: path.join(workspace, 'graphs', 'mcp.mindgraph.json'), title: 'MCP Source', mode: 'untimed', mesoSize: 1 },
      },
    });
    const built = await waitForResponse(server, 3);
    const parsed = JSON.parse(built.result.content[0].text);
    assert.equal(parsed.ok, true);
    assert.equal(fs.existsSync(path.join(workspace, 'graphs', 'mcp.mindgraph.json')), true);
  } finally {
    server.stop();
  }
});
```

- [ ] **Step 2: Run MCP tests and verify they fail**

Run:

```bash
node --test test/mcp.test.js
```

Expected: FAIL because `src/mcp/server.js` does not exist.

- [ ] **Step 3: Implement the MCP server**

Create `src/mcp/server.js` with this content:

```js
#!/usr/bin/env node

import readline from 'node:readline';
import path from 'node:path';
import { spawn } from 'node:child_process';
import {
  applyDigestPlanOperation,
  buildStarterDigestOperation,
  evaluateDigestOperation,
  inspectDocumentOperation,
  prepareSourceOperation,
} from '../core/journey.js';

function parseFlags(args) {
  const flags = {};
  for (let i = 0; i < args.length; i += 1) {
    const token = args[i];
    if (!token.startsWith('-')) continue;
    const next = args[i + 1];
    if (!next || next.startsWith('-')) flags[token] = true;
    else {
      flags[token] = next;
      i += 1;
    }
  }
  return flags;
}

const flags = parseFlags(process.argv.slice(2));
const workspaceDir = path.resolve(String(flags['--workspace'] ?? process.cwd()));

function textResult(value) {
  return { content: [{ type: 'text', text: JSON.stringify(value, null, 2) }] };
}

const tools = [
  {
    name: 'mindgraph_prepare_source',
    description: 'Prepare a local file or readable web article for mindgraph ingestion.',
    inputSchema: { type: 'object', properties: { source: { type: 'string' }, title: { type: 'string' } }, required: ['source'] },
  },
  {
    name: 'mindgraph_build_starter_digest',
    description: 'Build a starter mindgraph document from a prepared or raw source for external-agent digestion.',
    inputSchema: { type: 'object', properties: { source: { type: 'string' }, outputPath: { type: 'string' }, title: { type: 'string' }, mode: { type: 'string' }, defaultSpeaker: { type: 'string' }, wordsPerMinute: { type: 'number' }, mesoSize: { type: 'number' } }, required: ['source', 'outputPath'] },
  },
  {
    name: 'mindgraph_apply_digest_plan',
    description: 'Apply a structured DigestPlan to a mindgraph document.',
    inputSchema: { type: 'object', properties: { documentPath: { type: 'string' }, planPath: { type: 'string' }, plan: { type: 'object' } }, required: ['documentPath'] },
  },
  {
    name: 'mindgraph_evaluate_digest',
    description: 'Evaluate digest quality signals for a mindgraph document.',
    inputSchema: { type: 'object', properties: { documentPath: { type: 'string' } }, required: ['documentPath'] },
  },
  {
    name: 'mindgraph_inspect_document',
    description: 'Inspect and validate a mindgraph document.',
    inputSchema: { type: 'object', properties: { documentPath: { type: 'string' } }, required: ['documentPath'] },
  },
  {
    name: 'mindgraph_open_viewer',
    description: 'Open the local mindgraph viewer for a document.',
    inputSchema: { type: 'object', properties: { documentPath: { type: 'string' }, port: { type: 'number' }, host: { type: 'string' } }, required: ['documentPath'] },
  },
];

function resolveWorkspacePath(value) {
  if (!value) return value;
  return path.isAbsolute(value) ? value : path.resolve(workspaceDir, value);
}

async function callTool(name, args = {}) {
  if (name === 'mindgraph_prepare_source') {
    return textResult(await prepareSourceOperation({ ...args, workspaceDir }));
  }
  if (name === 'mindgraph_build_starter_digest') {
    return textResult(await buildStarterDigestOperation({ ...args, workspaceDir, outputPath: resolveWorkspacePath(args.outputPath) }));
  }
  if (name === 'mindgraph_apply_digest_plan') {
    return textResult(await applyDigestPlanOperation({ ...args, documentPath: resolveWorkspacePath(args.documentPath), planPath: resolveWorkspacePath(args.planPath) }));
  }
  if (name === 'mindgraph_evaluate_digest') {
    return textResult(await evaluateDigestOperation({ documentPath: resolveWorkspacePath(args.documentPath) }));
  }
  if (name === 'mindgraph_inspect_document') {
    return textResult(await inspectDocumentOperation({ documentPath: resolveWorkspacePath(args.documentPath) }));
  }
  if (name === 'mindgraph_open_viewer') {
    const cliPath = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..', 'cli', 'index.js');
    const child = spawn(process.execPath, [cliPath, 'view', resolveWorkspacePath(args.documentPath), '--port', String(args.port ?? 4173), '--host', String(args.host ?? '127.0.0.1')], { detached: true, stdio: 'ignore' });
    child.unref();
    return textResult({ ok: true, url: `http://${args.host ?? '127.0.0.1'}:${args.port ?? 4173}` });
  }
  throw new Error(`Unknown tool: ${name}`);
}

function send(message) {
  process.stdout.write(`${JSON.stringify(message)}\n`);
}

async function handle(message) {
  try {
    if (message.method === 'initialize') {
      send({ jsonrpc: '2.0', id: message.id, result: { protocolVersion: '2024-11-05', capabilities: { tools: {} }, serverInfo: { name: 'mindgraph', version: '0.1.0' } } });
      return;
    }
    if (message.method === 'tools/list') {
      send({ jsonrpc: '2.0', id: message.id, result: { tools } });
      return;
    }
    if (message.method === 'tools/call') {
      const result = await callTool(message.params?.name, message.params?.arguments ?? {});
      send({ jsonrpc: '2.0', id: message.id, result });
      return;
    }
    if (message.id != null) send({ jsonrpc: '2.0', id: message.id, error: { code: -32601, message: `Method not found: ${message.method}` } });
  } catch (error) {
    send({ jsonrpc: '2.0', id: message.id, error: { code: -32000, message: error.message } });
  }
}

const rl = readline.createInterface({ input: process.stdin, terminal: false });
rl.on('line', (line) => {
  if (!line.trim()) return;
  handle(JSON.parse(line));
});
```

- [ ] **Step 4: Add CLI and package MCP entry points**

In `src/cli/index.js`, add this command block before the final `else` branch:

```js
if (command === 'mcp') {
  const __filename = fileURLToPath(import.meta.url);
  const __dirname = path.dirname(__filename);
  const serverScript = path.resolve(__dirname, '..', 'mcp', 'server.js');
  const child = spawn(process.execPath, [serverScript, ...args.slice(1)], { stdio: 'inherit' });
  child.on('exit', (code) => process.exit(code ?? 0));
}
```

Then adjust the final `if (command === 'view') { ... } else { ... }` chain so the `mcp` block is part of the same chain and the unknown-command branch still only runs when no command matched.

In `package.json`, change `bin` to:

```json
"bin": {
  "mindgraph": "./src/cli/index.js",
  "mindgraph-mcp": "./src/mcp/server.js"
}
```

Add this script after `test:journey`:

```json
"test:mcp": "node --test test/mcp.test.js",
```

- [ ] **Step 5: Run MCP tests and syntax checks**

Run:

```bash
node --check src/mcp/server.js
node --check src/cli/index.js
npm run test:mcp
```

Expected: syntax checks pass; MCP test passes.

- [ ] **Step 6: Commit MCP server**

Run:

```bash
git add src/mcp/server.js src/cli/index.js package.json test/mcp.test.js
git commit -m "feat(mcp): expose mindgraph journey tools"
```

---

### Task 5: Document the new product journey

**Files:**
- Modify: `README.md`
- Modify: `skills/mindgraph/SKILL.md`

- [ ] **Step 1: Update README quick start**

In `README.md`, add this section after `## External usage model`:

```md
## Product journey commands

For agent-operated digestion, prefer the high-level journey command:

```bash
mindgraph digest ./transcripts/episode-01.txt -o ./graphs/episode-01.mindgraph.json --title "Episode 01"
```

For readable web articles:

```bash
mindgraph digest https://example.com/article -o ./graphs/article.mindgraph.json --mode untimed
```

This creates a starter `.mindgraph.json` with transcript segments, micro frames, meso frames, validation, and an agent-facing next step. The LLM agent then creates a structured `DigestPlan`, applies it, evaluates quality, and opens the viewer:

```bash
mindgraph digest apply ./graphs/episode-01.mindgraph.json --plan ./plans/episode-01.digest-plan.json
mindgraph digest evaluate ./graphs/episode-01.mindgraph.json --json
mindgraph view ./graphs/episode-01.mindgraph.json
```

YouTube URLs are detected, but this slice does not fetch YouTube transcripts directly. Save a transcript with a tool such as `yt-dlp`, then pass the transcript file to `mindgraph digest`.
```

- [ ] **Step 2: Add MCP README section**

In `README.md`, add this section after the product journey commands section:

```md
## MCP usage

mindgraph also ships a minimal MCP server for Claude Desktop and other MCP-capable apps:

```bash
mindgraph mcp --workspace /path/to/content-workspace
# or
mindgraph-mcp --workspace /path/to/content-workspace
```

Initial tools:

- `mindgraph_prepare_source`
- `mindgraph_build_starter_digest`
- `mindgraph_apply_digest_plan`
- `mindgraph_evaluate_digest`
- `mindgraph_inspect_document`
- `mindgraph_open_viewer`

The MCP server is an adapter over the same journey operations as the CLI. It does not require a model API key; the connected agent performs semantic digestion and supplies a `DigestPlan`.
```

- [ ] **Step 3: Update the mindgraph skill workflow**

In `skills/mindgraph/SKILL.md`, replace the first command in “Building the timeline” with:

```bash
mindgraph digest <source-file-or-readable-article-url> [-o <output-file>] \
  [--title "Display Title"] \
  [--mode auto|timed-lines|captions|untimed] \
  [--speaker "Speaker Name"] \
  [--wpm 150] \
  [--meso-size 12]
```

Then add this paragraph after the command:

```md
Prefer `mindgraph digest` over `mindgraph build timeline` for new work. It is the cohesive journey command: it prepares local files or readable article URLs, builds the starter timeline, validates the output, and returns the next agent action. Use `mindgraph build timeline` only when you specifically need the lower-level primitive.
```

- [ ] **Step 4: Run documentation-adjacent verification**

Run:

```bash
node src/cli/index.js --help | grep -q 'mindgraph digest <source>'
node src/cli/index.js --help | grep -q 'mindgraph source import <source>'
node src/cli/index.js --help | grep -q 'mindgraph mcp'
```

Expected: all commands exit 0.

- [ ] **Step 5: Commit docs**

Run:

```bash
git add README.md skills/mindgraph/SKILL.md
git commit -m "docs: describe journey CLI and MCP usage"
```

---

### Task 6: Full verification and release-readiness checks

**Files:**
- Modify only if verification reveals a concrete failure in files changed by Tasks 1-5.

- [ ] **Step 1: Run focused tests**

Run:

```bash
npm run test:source
npm run test:journey
npm run test:mcp
npm run test:digest
```

Expected: all pass.

- [ ] **Step 2: Run smoke test**

Run:

```bash
npm run test:smoke
```

Expected: command completes successfully and prints a valid inspected Awakening sample summary.

- [ ] **Step 3: Run UI syntax check**

Run:

```bash
npm run ui:check
```

Expected: all syntax checks pass.

- [ ] **Step 4: Manually verify end-to-end journey command**

Run:

```bash
TMPDIR=$(mktemp -d)
mkdir -p "$TMPDIR/graphs"
printf 'Attention becomes wisdom.\n\nWisdom responds to a crisis of meaning.\n' > "$TMPDIR/source.txt"
node src/cli/index.js digest "$TMPDIR/source.txt" --workspace "$TMPDIR" --title "Journey Manual" --mode untimed --meso-size 1
node src/cli/index.js inspect "$TMPDIR/graphs/journey-manual.mindgraph.json"
```

Expected: digest prints `Built starter digest`; inspect prints title `Journey Manual` and nonzero micro/meso frame counts.

- [ ] **Step 5: Check working tree**

Run:

```bash
git status --short
```

Expected: no uncommitted source changes except intentional temporary files outside the repo.

- [ ] **Step 6: Final commit if verification required fixes**

If Step 1-4 required fixes, commit them:

```bash
git add <fixed-files>
git commit -m "fix: stabilize journey interface verification"
```

If no fixes were required, do not create an empty commit.

---

## Self-review notes

- Spec coverage: this plan covers the first implementation slice of shared journey operations, CLI adapter, MCP adapter, source import for local/web sources, `DigestPlan` apply/evaluate reuse, and documentation. Provider auto-digest and hosted web are explicitly scoped into later work.
- Placeholder scan: no placeholder markers are intentionally left in the plan; every task names files, commands, and expected outcomes.
- Type consistency: `prepareSourceOperation`, `buildStarterDigestOperation`, `applyDigestPlanOperation`, `evaluateDigestOperation`, and `inspectDocumentOperation` are introduced in Task 2 and reused unchanged by CLI and MCP tasks.
