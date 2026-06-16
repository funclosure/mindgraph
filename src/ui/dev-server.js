#!/usr/bin/env node

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, '../..');

// CLI args: --doc <path>, --port <n>, --host <h>. All optional.
const cliArgs = process.argv.slice(2);
let docPathFlag;
for (let i = 0; i < cliArgs.length; i += 1) {
  const next = cliArgs[i + 1];
  if (cliArgs[i] === '--doc' && next) { docPathFlag = path.resolve(next); i += 1; }
  else if (cliArgs[i] === '--port' && next) { process.env.PORT = next; i += 1; }
  else if (cliArgs[i] === '--host' && next) { process.env.HOST = next; i += 1; }
}

const host = process.env.HOST || '127.0.0.1';
const port = Number(process.env.PORT || 4173);

// The document the UI fetches at /doc.json. Either the --doc flag's target,
// or the canonical sample inside the repo. The UI calls fetch('/doc.json')
// regardless of source.
const docPath = docPathFlag
  || path.join(projectRoot, 'examples/out/episode-1-built.mindgraph.json');

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.txt': 'text/plain; charset=utf-8',
};

const server = http.createServer((req, res) => {
  const url = new URL(req.url || '/', `http://${req.headers.host || `${host}:${port}`}`);
  const pathname = url.pathname === '/' ? '/ui/index.html' : decodeURIComponent(url.pathname);

  // /doc.md — serve source-first authoring markdown when --doc points at a
  // .md file, so the browser can compile it via the shared core. 404 for
  // precompiled (.json) documents; the UI then falls back to /doc.json.
  if (pathname === '/doc.md') {
    if (!docPath.endsWith('.md')) {
      res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
      res.end('No markdown document configured');
      return;
    }
    fs.stat(docPath, (statError, stats) => {
      if (statError || !stats.isFile()) {
        res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
        res.end(`Document not found: ${docPath}`);
        return;
      }
      res.writeHead(200, {
        'content-type': 'text/plain; charset=utf-8',
        'cache-control': 'no-store',
      });
      fs.createReadStream(docPath).pipe(res);
    });
    return;
  }

  // /doc.json — serve the configured document when it is a precompiled JSON.
  if (pathname === '/doc.json') {
    if (docPath.endsWith('.md')) {
      res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
      res.end('Document is source-first markdown; served at /doc.md');
      return;
    }
    fs.stat(docPath, (statError, stats) => {
      if (statError || !stats.isFile()) {
        res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
        res.end(`Document not found: ${docPath}`);
        return;
      }
      res.writeHead(200, {
        'content-type': 'application/json; charset=utf-8',
        'cache-control': 'no-store',
      });
      fs.createReadStream(docPath).pipe(res);
    });
    return;
  }

  // Everything else: static files inside the project root.
  const resolvedPath = path.resolve(projectRoot, `.${pathname}`);
  if (!resolvedPath.startsWith(projectRoot)) {
    res.writeHead(403, { 'content-type': 'text/plain; charset=utf-8' });
    res.end('Forbidden');
    return;
  }

  fs.stat(resolvedPath, (statError, stats) => {
    if (statError || !stats.isFile()) {
      res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
      res.end('Not found');
      return;
    }

    const ext = path.extname(resolvedPath);
    res.writeHead(200, {
      'content-type': MIME_TYPES[ext] || 'application/octet-stream',
      'cache-control': 'no-store',
    });
    fs.createReadStream(resolvedPath).pipe(res);
  });
});

server.listen(port, host, () => {
  console.log(`mindgraph UI shell available at http://${host}:${port}`);
  console.log(`document: ${docPath}`);
});
