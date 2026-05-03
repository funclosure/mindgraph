#!/usr/bin/env node

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, '../..');
const host = process.env.HOST || '127.0.0.1';
const port = Number(process.env.PORT || 4173);

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
});
