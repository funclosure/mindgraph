#!/usr/bin/env node

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { createFsStore } from '../adapters/fsStore.js';
import { askHandler } from './askHandler.js';
import { crystallizeHandler } from './crystallizeHandler.js';
import { answerRunner } from './answerRunner.js';
import { crystallizeRunner } from './crystallizeRunner.js';
import { stubAnswerRunner, stubCrystallizeRunner } from './stubRunner.js';
import { undoHandler } from "./undoHandler.js";

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
const graphsDir = path.dirname(docPath);
const fsStore = createFsStore({ baseDir: graphsDir });
const useStub = Boolean(process.env.MINDGRAPH_STUB_DEEPEN);
// The crystallize runner reads this to locate the .md it must edit, keeping it
// aligned with the fsStore base dir.
process.env.MINDGRAPH_MD_DIR = graphsDir;

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

function readJsonBody(req) {
  return new Promise((resolve) => {
    let body = '';
    req.on('data', (chunk) => { body += chunk; if (body.length > 4_000_000) req.destroy(); });
    req.on('end', () => { try { resolve(JSON.parse(body || '{}')); } catch { resolve(null); } });
    req.on('error', () => resolve(null));
  });
}

function openSseResponse(req, res) {
  let closed = false;
  const keepAlive = setInterval(() => { if (!closed) res.write(': ping\n\n'); }, 20_000);
  const finish = () => { closed = true; clearInterval(keepAlive); };
  req.on('close', finish);
  res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-store', connection: 'keep-alive' });
  res.flushHeaders?.();
  const emit = (event) => { if (!closed) res.write(`event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`); };
  return { emit, finish };
}

async function handleAsk(req, res) {
  const payload = await readJsonBody(req);
  const conceptIds = payload?.concepts ?? (payload?.concept ? [payload.concept] : []);
  if (!conceptIds.length) {
    res.writeHead(400, { 'content-type': 'text/plain; charset=utf-8' });
    res.end('Missing required field: concept(s)');
    return;
  }
  const { emit, finish } = openSseResponse(req, res);
  await askHandler({
    slug: payload.slug || activeSlug,
    conceptIds,
    messages: payload.messages ?? [],
    store: fsStore,
    runner: useStub ? stubAnswerRunner : answerRunner,
    emit,
  });
  finish();
  res.end();
}

async function handleCrystallize(req, res) {
  const payload = await readJsonBody(req);
  if (!payload?.concept) {
    res.writeHead(400, { 'content-type': 'text/plain; charset=utf-8' });
    res.end('Missing required field: concept');
    return;
  }
  const { emit, finish } = openSseResponse(req, res);
  await crystallizeHandler({
    slug: payload.slug || activeSlug,
    conceptId: payload.concept,
    messages: payload.messages ?? [],
    store: fsStore,
    runner: useStub ? stubCrystallizeRunner : crystallizeRunner,
    emit,
  });
  finish();
  res.end();
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url || '/', `http://${req.headers.host || `${host}:${port}`}`);
  const pathname = url.pathname === '/' ? '/ui/index.html' : decodeURIComponent(url.pathname);

  if (req.method === 'GET' && pathname === '/health') {
    // Lets `mindgraph open` detect an already-running server and decide whether
    // to reuse it (same document) or warn (a different graph is being served).
    res.writeHead(200, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
    res.end(JSON.stringify({ ok: true, slug: activeSlug, doc: docPath }));
    return;
  }

  if (req.method === "GET" && pathname === "/undo") {
    const slug = url.searchParams.get("slug") || activeSlug;
    const result = undoHandler({ slug, store: fsStore });
    res.writeHead(result.ok ? 200 : 409, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
    res.end(JSON.stringify(result));
    return;
  }

  if (req.method === 'POST' && pathname === '/ask') {
    handleAsk(req, res);
    return;
  }

  if (req.method === 'POST' && pathname === '/crystallize') {
    handleCrystallize(req, res);
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

server.on('error', (err) => {
  // Don't let an occupied port crash with an unhandled 'error' stack trace.
  // `mindgraph open` probes /health first and usually reuses an existing server;
  // this clean message covers the cases it can't (e.g. a non-mindgraph process).
  if (err.code === 'EADDRINUSE') {
    console.error(`mindgraph: port ${port} on ${host} is already in use.`);
    console.error(`  Reuse the running server, free the port with \`lsof -ti tcp:${port} | xargs kill\`, or pass --port <n>.`);
    process.exit(1);
  }
  throw err;
});

server.listen(port, host, () => {
  console.log(`mindgraph agent server available at http://${host}:${port}`);
  console.log(`document: ${docPath}`);
  console.log(`active slug: ${activeSlug}`);
});
