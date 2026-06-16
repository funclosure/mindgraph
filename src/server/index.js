#!/usr/bin/env node

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { createFsStore } from '../adapters/fsStore.js';
import { deepenHandler } from './deepenHandler.js';
import { stubRunner } from './stubRunner.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, '../..');

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
const docPath = docPathFlag
  || path.join(projectRoot, 'examples/out/episode-1-built.mindgraph.json');
const activeSlug = slugFromDocPath(docPath);
const fsStore = createFsStore({ baseDir: path.dirname(docPath) });

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.txt': 'text/plain; charset=utf-8',
};

function slugFromDocPath(filePath) {
  const name = path.basename(filePath);
  for (const suffix of ['.mindgraph.md', '.mindgraph.json', '.md', '.json']) {
    if (name.endsWith(suffix)) return name.slice(0, -suffix.length);
  }
  return path.parse(name).name;
}

function serveConfiguredMarkdown(res) {
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
}

function serveConfiguredJson(res) {
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
}

function serveStatic(pathname, res) {
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
}

async function selectRunner(emit) {
  if (process.env.MINDGRAPH_STUB_DEEPEN) return stubRunner;

  try {
    const mod = await import('./agentRunner.js');
    return mod.agentRunner;
  } catch {
    emit({
      type: 'error',
      message: 'Real deepen runner unavailable. Set MINDGRAPH_STUB_DEEPEN=1 for a no-API stub, or add src/server/agentRunner.js (Unit 4).',
    });
    return null;
  }
}

async function handleDeepen(req, res, url) {
  const slug = url.searchParams.get('slug') || activeSlug;
  const concept = url.searchParams.get('concept');
  if (!concept) {
    res.writeHead(400, { 'content-type': 'text/plain; charset=utf-8' });
    res.end('Missing required query parameter: concept');
    return;
  }

  let closed = false;
  const keepAlive = setInterval(() => {
    if (!closed) res.write(': ping\n\n');
  }, 20_000);

  const finish = () => {
    closed = true;
    clearInterval(keepAlive);
  };
  req.on('close', finish);

  res.writeHead(200, {
    'content-type': 'text/event-stream',
    'cache-control': 'no-store',
    connection: 'keep-alive',
  });
  res.flushHeaders?.();

  const emit = (event) => {
    if (!closed) res.write(`event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`);
  };

  const runner = await selectRunner(emit);
  if (!runner) {
    finish();
    res.end();
    return;
  }

  await deepenHandler({ slug, conceptId: concept, store: fsStore, runner, emit });
  finish();
  res.end();
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url || '/', `http://${req.headers.host || `${host}:${port}`}`);
  const pathname = url.pathname === '/' ? '/ui/index.html' : decodeURIComponent(url.pathname);

  if (req.method === 'GET' && pathname === '/deepen') {
    handleDeepen(req, res, url);
    return;
  }

  if (pathname === '/doc.md') {
    serveConfiguredMarkdown(res);
    return;
  }

  if (pathname === '/doc.json') {
    serveConfiguredJson(res);
    return;
  }

  serveStatic(pathname, res);
});

server.listen(port, host, () => {
  console.log(`mindgraph agent server available at http://${host}:${port}`);
  console.log(`document: ${docPath}`);
  console.log(`active slug: ${activeSlug}`);
});
