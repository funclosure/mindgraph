import fs from 'node:fs';
import path from 'node:path';

function pathsFor(baseDir, slug) {
  return {
    md: path.join(baseDir, `${slug}.mindgraph.md`),
    json: path.join(baseDir, `${slug}.mindgraph.json`),
  };
}

export function createFsStore({ baseDir = 'graphs' } = {}) {
  return {
    get(slug) {
      const files = pathsFor(baseDir, slug);
      const entry = {};

      if (fs.existsSync(files.md)) entry.md = fs.readFileSync(files.md, 'utf8');
      if (fs.existsSync(files.json)) entry.json = JSON.parse(fs.readFileSync(files.json, 'utf8'));

      return Object.keys(entry).length ? entry : null;
    },

    put(slug, entry) {
      fs.mkdirSync(baseDir, { recursive: true });
      const files = pathsFor(baseDir, slug);

      if (Object.hasOwn(entry, 'md')) fs.writeFileSync(files.md, entry.md, 'utf8');
      if (Object.hasOwn(entry, 'json')) {
        fs.writeFileSync(files.json, JSON.stringify(entry.json, null, 2), 'utf8');
      }

      return this.get(slug);
    },

    list() {
      if (!fs.existsSync(baseDir)) return [];

      const slugs = new Set();
      for (const name of fs.readdirSync(baseDir)) {
        const mdSuffix = '.mindgraph.md';
        const jsonSuffix = '.mindgraph.json';
        if (name.endsWith(mdSuffix)) slugs.add(name.slice(0, -mdSuffix.length));
        if (name.endsWith(jsonSuffix)) slugs.add(name.slice(0, -jsonSuffix.length));
      }

      return [...slugs].sort();
    },
  };
}
