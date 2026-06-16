import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { createFsStore } from '../src/adapters/fsStore.js';

function tempBaseDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'mindgraph-fs-store-'));
}

test('fs store writes and reads markdown entries', () => {
  const store = createFsStore({ baseDir: tempBaseDir() });

  store.put('demo', { md: '# x' });

  assert.deepEqual(store.get('demo'), { md: '# x' });
});

test('fs store merges markdown and json fields across separate files', () => {
  const store = createFsStore({ baseDir: tempBaseDir() });

  store.put('demo', { md: '# x' });
  store.put('demo', { json: { kind: 'k' } });

  assert.deepEqual(store.get('demo'), { md: '# x', json: { kind: 'k' } });
});

test('fs store returns null for missing entries', () => {
  const store = createFsStore({ baseDir: tempBaseDir() });

  assert.equal(store.get('missing'), null);
});

test('fs store lists sorted unique slugs for markdown and json files', () => {
  const store = createFsStore({ baseDir: tempBaseDir() });

  store.put('demo', { md: '# x' });
  store.put('demo', { json: { kind: 'k' } });
  store.put('other', { json: { kind: 'other' } });

  assert.deepEqual(store.list(), ['demo', 'other']);
});
