#!/usr/bin/env node
// Convenience launcher for the Ask UI (consumer side). Picks the most recently
// edited graphs/*.mindgraph.md (or a name you pass), starts the server, and
// opens the browser.
//
//   npm run ask                      # newest graph in graphs/
//   npm run ask -- adolescence       # newest graph whose filename contains "adolescence"
//   npm run ask -- path/to/x.md      # an explicit file
//   npm run ask -- --stub            # no-API stub runners (demo without credentials)

import { spawn } from 'node:child_process';
import net from 'node:net';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const graphsDir = path.join(root, 'graphs');
const HOST = '127.0.0.1';
const PORT = 4173;
const url = `http://${HOST}:${PORT}`;

const args = process.argv.slice(2);
const stub = args.includes('--stub');
const pick = args.find((a) => !a.startsWith('--'));

function listGraphs() {
  try {
    return fs.readdirSync(graphsDir)
      .filter((f) => f.endsWith('.mindgraph.md'))
      .map((f) => path.join(graphsDir, f));
  } catch {
    return [];
  }
}

function resolveDoc() {
  if (pick) {
    if (fs.existsSync(pick)) return path.resolve(pick);
    const match = listGraphs().find((f) => path.basename(f).includes(pick));
    if (match) return match;
    console.error(`No graph matching "${pick}" in graphs/.`);
    process.exit(1);
  }
  const graphs = listGraphs().sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs);
  return graphs[0] ?? null;
}

const doc = resolveDoc();
if (!doc) {
  console.error('No graphs/*.mindgraph.md found. Pass a file: npm run ask -- <path>');
  process.exit(1);
}

console.log('');
console.log('  mindgraph Ask');
console.log(`  graph: ${path.relative(root, doc)}`);
console.log(`  url:   ${url}${stub ? '   (stub — no API)' : ''}`);
console.log('  (Ctrl-C to stop)\n');

const env = { ...process.env };
if (stub) env.MINDGRAPH_STUB_DEEPEN = '1';

const server = spawn(process.execPath, [path.join(root, 'src/server/index.js'), '--doc', doc], {
  stdio: 'inherit',
  env,
});

// Open the browser once the server is accepting connections.
function openWhenReady(attempt = 0) {
  const sock = net.connect(PORT, HOST);
  sock.on('connect', () => {
    sock.destroy();
    const opener = process.platform === 'darwin' ? 'open'
      : process.platform === 'win32' ? 'start' : 'xdg-open';
    spawn(opener, [url], { stdio: 'ignore', detached: true }).unref();
  });
  sock.on('error', () => {
    sock.destroy();
    if (attempt < 50) setTimeout(() => openWhenReady(attempt + 1), 200);
  });
}
openWhenReady();

const shutdown = () => { server.kill('SIGINT'); };
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
server.on('exit', (code) => process.exit(code ?? 0));
