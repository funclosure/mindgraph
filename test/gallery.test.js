import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { loadGallery, resolveGallerySlug } from '../src/cli/gallery.js';
import { validateSourceFirstDocument } from '../src/core/authoring/schema.js';

test('the shipped gallery lists at least three curated graphs', () => {
  const entries = loadGallery();
  assert.ok(entries.length >= 3, `expected >=3 gallery entries, got ${entries.length}`);
  for (const entry of entries) {
    assert.ok(entry.slug, 'entry has a slug');
    assert.ok(entry.title, `entry ${entry.slug} has a title`);
    assert.ok(entry.blurb, `entry ${entry.slug} has a blurb`);
    assert.ok(fs.existsSync(entry.path), `entry ${entry.slug} resolves to an existing file: ${entry.path}`);
  }
});

test('every gallery graph is a valid, non-empty source-first document', () => {
  for (const entry of loadGallery()) {
    const doc = JSON.parse(fs.readFileSync(entry.path, 'utf8'));
    const result = validateSourceFirstDocument(doc);
    assert.ok(result.ok, `${entry.slug} should validate: ${result.errors.join('; ')}`);
    assert.ok((doc.concepts?.atomic?.length ?? 0) > 0, `${entry.slug} has concepts (not a skeleton)`);
  }
});

test('resolveGallerySlug finds a shipped slug and rejects unknown ones', () => {
  const first = loadGallery()[0].slug;
  assert.equal(resolveGallerySlug(first), loadGallery()[0].path);
  assert.equal(resolveGallerySlug('definitely-not-a-real-slug'), null);
});
