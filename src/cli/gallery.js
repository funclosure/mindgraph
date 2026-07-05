// ---------------------------------------------------------------------------
// Gallery — the curated sample graphs that ship with the package so a newcomer
// has an instant, credential-free "wow" (read with `mindgraph view <slug>`).
//
// The manifest and its .mindgraph.json files live in examples/gallery/, resolved
// relative to THIS module (i.e. the install location), not the caller's cwd — so
// `mindgraph view meaning-crisis` works from any directory.
// ---------------------------------------------------------------------------

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const galleryDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'examples', 'gallery');

export function loadGallery() {
  const manifestPath = path.join(galleryDir, 'gallery.json');
  let manifest;
  try {
    manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  } catch {
    return [];
  }
  return manifest.map((entry) => ({
    ...entry,
    path: path.join(galleryDir, entry.file),
  }));
}

// Resolve a bare gallery slug (or its .json filename) to an absolute path, or
// null if it is not a shipped sample.
export function resolveGallerySlug(slug) {
  if (!slug) return null;
  const entry = loadGallery().find((e) => e.slug === slug || e.file === slug);
  return entry ? entry.path : null;
}
