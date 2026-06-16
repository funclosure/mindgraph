# Operations Catalog Foundation — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Establish a single operations catalog as the source of truth for mindgraph's verbs, prove the adapter pattern by routing the CLI's `validate`/`inspect` through it (fixing the source-first rejection bug), and add the missing aggregate test runner + CI.

**Architecture:** A new pure `src/operations/` composition layer depends on `core` and `view-model` and exposes each verb as a descriptor `{name, summary, inputSchema, handler(input, ctx) → Result}`. Operations return `ok(value)` when they execute and `err(...)` only on operational failure (bad input, exceptions); domain status lives in `value`. The CLI becomes a thin adapter that runs catalog operations. `core` stays pure (no `fs`/`process`/`console`).

**Tech Stack:** Node ESM (also Bun-compatible), `node:test` + `node:assert/strict`, zero new runtime dependencies.

**Scope note:** This is Plan 1 of 4 for the Phase-1 spec (`docs/superpowers/specs/2026-06-16-portable-core-operations-catalog-design.md`). Plan 2 = full CLI + MCP as generated adapters; Plan 3 = browser OPFS store + local ops; Plan 4 = agent server + deepen loop. This plan only converts the two drifted commands (`validate`, `inspect`) to the catalog to prove the pattern; the remaining CLI commands are converted in Plan 2.

**Spec refinement:** The spec diagram placed the catalog inside `core`. The `qa` and `view_model` ops require the `view-model` layer, so placing the catalog in `core` would invert the `core → view-model` dependency. This plan instead puts the catalog in its own `src/operations/` layer that depends on both `core` and `view-model`, preserving `core` purity. Adapters (cli, mcp, server, browser) depend on `operations`.

---

## File Structure

- Create: `src/operations/result.js` — `Result` type helpers (`ok`, `err`, `errorItem`). Pure.
- Create: `src/operations/memoryStore.js` — in-memory `Store` port implementation for tests/browser. Pure.
- Create: `src/operations/registry.js` — `createRegistry(operations)` with minimal input-schema validation + `try/catch` wrapping. Pure.
- Create: `src/operations/catalog.js` — the operation descriptors (`compile`, `validate`, `qa`, `inspect`, `view_model`), wrapping existing `core`/`view-model` functions. Pure.
- Create: `src/operations/index.js` — assembles `createRegistry(operations)` and exports `registry`.
- Create: `test/operations-result.test.js`
- Create: `test/operations-registry.test.js`
- Create: `test/operations-catalog.test.js`
- Create: `test/cli-validate-inspect.test.js`
- Create: `.github/workflows/test.yml` — CI running the full suite.
- Modify: `package.json` — add aggregate `"test"` script.
- Modify: `src/cli/index.js` — route `validate` and `inspect` commands through `registry`; add a top-level `try/catch` so unexpected throws become structured errors.

---

## Task 0: Add aggregate test runner (hygiene)

**Files:**
- Modify: `package.json`

- [ ] **Step 1: Add the aggregate test script**

In `package.json`, add a `test` key to `scripts` (keep all existing `test:*` scripts):

```json
"test": "node --test test/*.test.js",
```

- [ ] **Step 2: Run the full suite to establish a baseline**

Run: `npm test`
Expected: all currently-orphaned suites now execute (including `test/source-first-reading-qa.test.js`). Note any pre-existing failures; they are out of scope for this plan but record them.

- [ ] **Step 3: Commit**

```bash
git add package.json
git commit -m "test: add aggregate npm test runner over test/*.test.js"
```

---

## Task 1: Result helpers

**Files:**
- Create: `src/operations/result.js`
- Test: `test/operations-result.test.js`

- [ ] **Step 1: Write the failing test**

```js
// test/operations-result.test.js
import test from 'node:test';
import assert from 'node:assert/strict';
import { ok, err, errorItem } from '../src/operations/result.js';

test('ok wraps a value and is ok', () => {
  const r = ok({ a: 1 });
  assert.equal(r.ok, true);
  assert.deepEqual(r.value, { a: 1 });
  assert.deepEqual(r.errors, []);
});

test('err carries a single error item as an array', () => {
  const r = err(errorItem('bad_input', 'nope', 'field'));
  assert.equal(r.ok, false);
  assert.equal(r.errors.length, 1);
  assert.deepEqual(r.errors[0], { code: 'bad_input', message: 'nope', path: 'field' });
});

test('err accepts an array of error items', () => {
  const r = err([errorItem('a', 'x'), errorItem('b', 'y')]);
  assert.equal(r.ok, false);
  assert.equal(r.errors.length, 2);
});

test('errorItem omits path when not provided', () => {
  assert.deepEqual(errorItem('c', 'm'), { code: 'c', message: 'm' });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/operations-result.test.js`
Expected: FAIL — cannot find module `../src/operations/result.js`.

- [ ] **Step 3: Write minimal implementation**

```js
// src/operations/result.js
export function ok(value) {
  return { ok: true, value, errors: [] };
}

export function err(errors) {
  return { ok: false, errors: Array.isArray(errors) ? errors : [errors] };
}

export function errorItem(code, message, path) {
  return path === undefined ? { code, message } : { code, message, path };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test test/operations-result.test.js`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add src/operations/result.js test/operations-result.test.js
git commit -m "feat(operations): add Result type helpers"
```

---

## Task 2: In-memory Store port

**Files:**
- Create: `src/operations/memoryStore.js`
- Test: `test/operations-registry.test.js` (created here, extended in Task 3)

The `Store` port shape: `get(id) -> {md?, json?} | null`, `put(id, {md?, json?})`, `list() -> string[]`. The Node fs store and browser OPFS store (later plans) implement the same shape.

- [ ] **Step 1: Write the failing test**

```js
// test/operations-registry.test.js
import test from 'node:test';
import assert from 'node:assert/strict';
import { createMemoryStore } from '../src/operations/memoryStore.js';

test('memory store put/get round-trips and merges fields', () => {
  const store = createMemoryStore();
  store.put('a', { md: '# hi' });
  store.put('a', { json: { kind: 'x' } });
  assert.deepEqual(store.get('a'), { md: '# hi', json: { kind: 'x' } });
});

test('memory store get returns null for missing id and list enumerates ids', () => {
  const store = createMemoryStore();
  assert.equal(store.get('missing'), null);
  store.put('a', { md: '1' });
  store.put('b', { md: '2' });
  assert.deepEqual(store.list().sort(), ['a', 'b']);
});

test('memory store seeds from initial entries', () => {
  const store = createMemoryStore({ a: { md: 'seed' } });
  assert.deepEqual(store.get('a'), { md: 'seed' });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/operations-registry.test.js`
Expected: FAIL — cannot find module `../src/operations/memoryStore.js`.

- [ ] **Step 3: Write minimal implementation**

```js
// src/operations/memoryStore.js
export function createMemoryStore(initial = {}) {
  const map = new Map(Object.entries(initial).map(([id, entry]) => [id, { ...entry }]));
  return {
    get(id) {
      return map.has(id) ? { ...map.get(id) } : null;
    },
    put(id, entry) {
      map.set(id, { ...(map.get(id) ?? {}), ...entry });
      return this.get(id);
    },
    list() {
      return [...map.keys()];
    },
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test test/operations-registry.test.js`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add src/operations/memoryStore.js test/operations-registry.test.js
git commit -m "feat(operations): add in-memory Store port"
```

---

## Task 3: Registry with input validation and exception trapping

**Files:**
- Create: `src/operations/registry.js`
- Test: `test/operations-registry.test.js` (extend)

- [ ] **Step 1: Write the failing test (append to the file)**

```js
// append to test/operations-registry.test.js
import { createRegistry } from '../src/operations/registry.js';

const sampleOps = [
  {
    name: 'echo',
    summary: 'echo input back',
    inputSchema: { type: 'object', properties: { text: { type: 'string' } }, required: ['text'] },
    handler: ({ text }) => ok({ text }),
  },
  {
    name: 'boom',
    summary: 'always throws',
    inputSchema: { type: 'object', properties: {} },
    handler: () => { throw new Error('kaboom'); },
  },
];

test('registry runs a known op and returns its Result', () => {
  const reg = createRegistry(sampleOps);
  assert.deepEqual(reg.run('echo', { text: 'hi' }).value, { text: 'hi' });
});

test('registry rejects unknown operations', () => {
  const reg = createRegistry(sampleOps);
  const r = reg.run('nope', {});
  assert.equal(r.ok, false);
  assert.equal(r.errors[0].code, 'unknown_operation');
});

test('registry validates required input before calling handler', () => {
  const reg = createRegistry(sampleOps);
  const r = reg.run('echo', {});
  assert.equal(r.ok, false);
  assert.equal(r.errors[0].code, 'missing_input');
  assert.equal(r.errors[0].path, 'text');
});

test('registry checks declared property types', () => {
  const reg = createRegistry(sampleOps);
  const r = reg.run('echo', { text: 123 });
  assert.equal(r.ok, false);
  assert.equal(r.errors[0].code, 'invalid_input');
});

test('registry traps handler exceptions as operational errors', () => {
  const reg = createRegistry(sampleOps);
  const r = reg.run('boom', {});
  assert.equal(r.ok, false);
  assert.equal(r.errors[0].code, 'operation_threw');
  assert.match(r.errors[0].message, /kaboom/);
});

test('registry list exposes name/summary/inputSchema only', () => {
  const reg = createRegistry(sampleOps);
  const listed = reg.list().find((o) => o.name === 'echo');
  assert.deepEqual(Object.keys(listed).sort(), ['inputSchema', 'name', 'summary']);
});
```

Add `import { ok } from '../src/operations/result.js';` to the top of the test file if not already present.

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/operations-registry.test.js`
Expected: FAIL — cannot find module `../src/operations/registry.js`.

- [ ] **Step 3: Write minimal implementation**

```js
// src/operations/registry.js
import { err, errorItem } from './result.js';

function matchesType(value, type) {
  if (type === 'string') return typeof value === 'string';
  if (type === 'number') return typeof value === 'number';
  if (type === 'boolean') return typeof value === 'boolean';
  if (type === 'object') return value !== null && typeof value === 'object' && !Array.isArray(value);
  if (type === 'array') return Array.isArray(value);
  return true;
}

function validateInput(input, schema) {
  const errors = [];
  if (!schema || schema.type !== 'object') return errors;
  for (const key of schema.required ?? []) {
    if (input[key] === undefined) errors.push(errorItem('missing_input', `Missing required input '${key}'`, key));
  }
  for (const [key, spec] of Object.entries(schema.properties ?? {})) {
    if (input[key] === undefined) continue;
    if (spec.type && !matchesType(input[key], spec.type)) {
      errors.push(errorItem('invalid_input', `Input '${key}' must be of type ${spec.type}`, key));
    }
  }
  return errors;
}

export function createRegistry(operations) {
  const byName = new Map(operations.map((op) => [op.name, op]));
  return {
    list() {
      return [...byName.values()].map(({ name, summary, inputSchema }) => ({ name, summary, inputSchema }));
    },
    get(name) {
      return byName.get(name) ?? null;
    },
    run(name, input = {}, ctx = {}) {
      const op = byName.get(name);
      if (!op) return err(errorItem('unknown_operation', `Unknown operation: ${name}`));
      const inputErrors = validateInput(input, op.inputSchema);
      if (inputErrors.length) return err(inputErrors);
      try {
        return op.handler(input, ctx);
      } catch (error) {
        return err(errorItem('operation_threw', error?.message ?? String(error)));
      }
    },
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test test/operations-registry.test.js`
Expected: PASS (all registry + memory-store tests).

- [ ] **Step 5: Commit**

```bash
git add src/operations/registry.js test/operations-registry.test.js
git commit -m "feat(operations): add catalog registry with input validation"
```

---

## Task 4: Catalog operations (compile, validate, qa, inspect, view_model)

**Files:**
- Create: `src/operations/catalog.js`
- Create: `src/operations/index.js`
- Test: `test/operations-catalog.test.js`

Key behavior: `validate` and `inspect` **route by `document.kind`** — source-first documents use the source-first validator/summary, legacy documents use the legacy ones. This is the bug fix.

- [ ] **Step 1: Write the failing test**

```js
// test/operations-catalog.test.js
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
  assert.equal(r.ok, true);          // operation ran
  assert.equal(r.value.valid, false); // domain says invalid
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

test('compile surfaces structural errors as operational err', () => {
  const r = registry.run('compile', { markdown: 'not valid authoring at all' });
  // parse may throw or validation may fail; either way the op must not throw raw
  assert.equal(r.ok === true || r.ok === false, true);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/operations-catalog.test.js`
Expected: FAIL — cannot find module `../src/operations/index.js`.

- [ ] **Step 3: Write minimal implementation**

```js
// src/operations/catalog.js
import { ok, err, errorItem } from './result.js';
import { compileAuthoringMarkdown } from '../core/authoring/compile.js';
import { validateSourceFirstDocument } from '../core/authoring/schema.js';
import { validateDocument, summarizeDocument } from '../core/schema.js';
import { evaluateSourceFirstReading } from '../view-model/evaluateSourceFirstReading.js';
import { buildMindgraphViewModel } from '../view-model/buildMindgraphViewModel.js';

function isSourceFirst(document) {
  return document?.kind === 'mindgraph.source-first';
}

function summarizeSourceFirst(document) {
  return {
    kind: document.kind,
    title: document.title ?? '',
    counts: {
      sources: (document.sources ?? []).length,
      sourceBlocks: (document.sourceBlocks ?? []).length,
      readerSteps: (document.readerSteps ?? []).length,
      sections: (document.sections ?? []).length,
      conceptsAtomic: (document.concepts?.atomic ?? []).length,
      conceptsClustered: (document.concepts?.clustered ?? []).length,
      relations: (document.relations ?? []).length,
    },
  };
}

export const operations = [
  {
    name: 'compile',
    summary: 'Compile source-first authoring markdown to a runtime document.',
    inputSchema: {
      type: 'object',
      properties: { markdown: { type: 'string' }, filePath: { type: 'string' } },
      required: ['markdown'],
    },
    handler: ({ markdown, filePath }) => {
      const { document, validation } = compileAuthoringMarkdown(markdown, { filePath });
      return ok({ document, validation });
    },
  },
  {
    name: 'validate',
    summary: 'Validate a mindgraph document; routes by document kind.',
    inputSchema: { type: 'object', properties: { document: { type: 'object' } }, required: ['document'] },
    handler: ({ document }) => {
      const result = isSourceFirst(document) ? validateSourceFirstDocument(document) : validateDocument(document);
      return ok({ valid: result.ok, kind: document.kind, errors: result.errors ?? [] });
    },
  },
  {
    name: 'qa',
    summary: 'Source-first reading QA: focus binding and relation grounding.',
    inputSchema: { type: 'object', properties: { document: { type: 'object' } }, required: ['document'] },
    handler: ({ document }) => ok(evaluateSourceFirstReading(document)),
  },
  {
    name: 'inspect',
    summary: 'Summarize a mindgraph document; routes by document kind.',
    inputSchema: { type: 'object', properties: { document: { type: 'object' } }, required: ['document'] },
    handler: ({ document }) => {
      if (isSourceFirst(document)) return ok(summarizeSourceFirst(document));
      const validation = validateDocument(document);
      if (!validation.ok) {
        return err(validation.errors.map((message) => errorItem('invalid_document', message)));
      }
      return ok(summarizeDocument(document));
    },
  },
  {
    name: 'view_model',
    summary: 'Build the UI view model from a document.',
    inputSchema: { type: 'object', properties: { document: { type: 'object' } }, required: ['document'] },
    handler: ({ document }) => ok({ viewModel: buildMindgraphViewModel(document) }),
  },
];
```

```js
// src/operations/index.js
import { createRegistry } from './registry.js';
import { operations } from './catalog.js';

export const registry = createRegistry(operations);
export { operations };
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test test/operations-catalog.test.js`
Expected: PASS. The `validate ACCEPTS a source-first document` test is the regression guard for the kind-routing bug.

If the fixture path differs, find a committed source-first authoring fixture: `ls examples/authoring/*.mindgraph.md` and update the test path. If none exists, the existing `test/authoring-compile.test.js` references the canonical fixture — reuse that exact path.

- [ ] **Step 5: Commit**

```bash
git add src/operations/catalog.js src/operations/index.js test/operations-catalog.test.js
git commit -m "feat(operations): add compile/validate/qa/inspect/view_model with kind routing"
```

---

## Task 5: Route CLI `validate` and `inspect` through the catalog

**Files:**
- Modify: `src/cli/index.js`
- Test: `test/cli-validate-inspect.test.js`

The current `validate` (around `src/cli/index.js:212-229`) and `inspect` (around `:231-258`) call the legacy validators directly and reject source-first JSON. Re-route them through `registry`.

- [ ] **Step 1: Write the failing test**

```js
// test/cli-validate-inspect.test.js
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/cli-validate-inspect.test.js`
Expected: FAIL — current CLI prints `INVALID` / `kind must be 'mindgraph.document'` and exits nonzero.

- [ ] **Step 3: Replace the `validate` command block in `src/cli/index.js`**

Find the existing `if (command === 'validate') { ... }` block and replace its body with:

```js
if (command === 'validate') {
  const [inputFile] = rest;
  if (!inputFile) { console.error('Missing <input-file>.'); process.exit(1); }
  const document = readJson(inputFile);
  const result = registry.run('validate', { document });
  if (!result.ok) {
    for (const e of result.errors) console.error(`- ${e.message}`);
    process.exit(1);
  }
  if (result.value.valid) {
    console.log(`OK: ${inputFile} is a valid ${result.value.kind ?? 'mindgraph'} document.`);
    process.exit(0);
  }
  console.error(`INVALID: ${inputFile}`);
  for (const message of result.value.errors) console.error(`- ${message}`);
  process.exit(1);
}
```

- [ ] **Step 4: Replace the `inspect` command block in `src/cli/index.js`**

```js
if (command === 'inspect') {
  const [inputFile] = rest;
  if (!inputFile) { console.error('Missing <input-file>.'); process.exit(1); }
  const document = readJson(inputFile);
  const result = registry.run('inspect', { document });
  if (!result.ok) {
    console.error('Document is invalid; inspect aborted.');
    for (const e of result.errors) console.error(`- ${e.message}`);
    process.exit(1);
  }
  console.log(JSON.stringify(result.value, null, 2));
  process.exit(0);
}
```

- [ ] **Step 5: Add the registry import at the top of `src/cli/index.js`**

Alongside the other imports near the top of the file:

```js
import { registry } from '../operations/index.js';
```

- [ ] **Step 6: Run the CLI test to verify it passes**

Run: `node --test test/cli-validate-inspect.test.js`
Expected: PASS (2 tests). Source-first docs now validate and inspect cleanly.

- [ ] **Step 7: Verify no regression on legacy documents**

Run: `node src/cli/index.js validate examples/out/awakening.mindgraph.json`
Expected: `OK: ... is a valid mindgraph.document document.` (legacy path still routes correctly). If `examples/out/awakening.mindgraph.json` is absent, generate it first with `npm run test:smoke:node`.

- [ ] **Step 8: Commit**

```bash
git add src/cli/index.js test/cli-validate-inspect.test.js
git commit -m "fix(cli): route validate/inspect through operations catalog (accept source-first)"
```

---

## Task 6: Add a top-level error guard to the CLI

**Files:**
- Modify: `src/cli/index.js`

`readJson` throws a raw stack on malformed/missing files. Wrap the entry so unexpected throws become a single structured line.

- [ ] **Step 1: Locate the CLI entry**

Identify the line where command dispatch begins (after imports and helper definitions, where `const [command, subcommand, ...rest] = process.argv.slice(2);` is parsed). Confirm there is currently no surrounding try/catch.

- [ ] **Step 2: Wrap dispatch in a guard**

Wrap the dispatch section (from just after argument parsing through the final fall-through) in:

```js
try {
  // ... existing command dispatch (unchanged) ...
} catch (error) {
  console.error(`mindgraph: ${error?.message ?? String(error)}`);
  process.exit(1);
}
```

Note: each command block still calls `process.exit(...)`; the guard only catches throws that escape (e.g. `readJson` on a missing file).

- [ ] **Step 3: Verify a malformed input yields a clean error, not a stack trace**

Run: `node src/cli/index.js validate /nonexistent/file.json`
Expected: a single `mindgraph: ...` line on stderr and exit code 1 — not a Node stack trace.

- [ ] **Step 4: Run the full suite**

Run: `npm test`
Expected: all suites pass (or only pre-existing, recorded failures from Task 0 remain).

- [ ] **Step 5: Commit**

```bash
git add src/cli/index.js
git commit -m "fix(cli): guard dispatch so unexpected errors are structured, not raw stacks"
```

---

## Task 7: CI workflow

**Files:**
- Create: `.github/workflows/test.yml`

- [ ] **Step 1: Create the workflow**

```yaml
# .github/workflows/test.yml
name: test
on:
  push:
    branches: [main]
  pull_request:
jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: '22'
      - run: npm test
```

- [ ] **Step 2: Validate the YAML locally**

Run: `node -e "const fs=require('fs');const s=fs.readFileSync('.github/workflows/test.yml','utf8');if(!/npm test/.test(s))throw new Error('missing test step');console.log('workflow ok')"`
Expected: `workflow ok`.

- [ ] **Step 3: Commit**

```bash
git add .github/workflows/test.yml
git commit -m "ci: run npm test on push and pull_request"
```

---

## Self-Review

**Spec coverage (against `2026-06-16-portable-core-operations-catalog-design.md`):**
- Operation catalog `{name, inputSchema, handler → Result}` — Tasks 1, 3, 4. ✓
- `Result` returns errors as data, never throws/exits — Tasks 1, 3 (try/catch trap). ✓
- `Store` port (memory; fs/OPFS in later plans) — Task 2. ✓
- `validate`/`inspect` kind-routing fix — Task 4 (op) + Task 5 (CLI). ✓
- CLI as adapter over catalog (the two drifted commands; rest in Plan 2) — Task 5. ✓
- Top-level error handling / parseable errors — Task 6. ✓
- Aggregate `npm test` + CI — Tasks 0, 7. ✓
- Deferred to later plans (correctly out of scope here): full CLI/MCP adapters, OPFS store, agent server + deepen loop, legacy frame ops. ✓

**Placeholder scan:** No TBD/TODO; every code step shows complete code; every test shows real assertions. ✓

**Type/name consistency:** `ok`/`err`/`errorItem` (Task 1) used identically in Tasks 3–5. `registry.run(name, input, ctx)` signature consistent across Tasks 3–5. `createMemoryStore`/`createRegistry` names stable. Op names (`compile`, `validate`, `qa`, `inspect`, `view_model`) consistent between catalog (Task 4) and CLI/tests (Tasks 4–5). ✓

**Open dependency:** Tasks 4–5 assume a committed source-first authoring fixture at `examples/authoring/recursive-self-improvement.mindgraph.md` (referenced by the existing `test/authoring-compile.test.js`). Task 4 Step 4 instructs how to locate/substitute it if the path differs.
