#!/usr/bin/env node

import readline from 'node:readline';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import {
  applyDigestPlanOperation,
  buildStarterDigestOperation,
  evaluateDigestOperation,
  inspectDocumentOperation,
  prepareSourceOperation,
} from '../core/journey.js';

function parseFlags(args) {
  const flags = {};
  for (let i = 0; i < args.length; i += 1) {
    const token = args[i];
    if (!token.startsWith('-')) continue;
    const next = args[i + 1];
    if (!next || next.startsWith('-')) flags[token] = true;
    else {
      flags[token] = next;
      i += 1;
    }
  }
  return flags;
}

const flags = parseFlags(process.argv.slice(2));
const workspaceDir = path.resolve(String(flags['--workspace'] ?? process.cwd()));

function textResult(value) {
  return { content: [{ type: 'text', text: JSON.stringify(value, null, 2) }] };
}

const tools = [
  {
    name: 'mindgraph_prepare_source',
    description: 'Prepare a local file or readable web article for mindgraph ingestion.',
    inputSchema: { type: 'object', properties: { source: { type: 'string' }, title: { type: 'string' } }, required: ['source'] },
  },
  {
    name: 'mindgraph_build_starter_digest',
    description: 'Build a starter mindgraph document from a prepared or raw source for external-agent digestion.',
    inputSchema: { type: 'object', properties: { source: { type: 'string' }, outputPath: { type: 'string' }, title: { type: 'string' }, mode: { type: 'string' }, defaultSpeaker: { type: 'string' }, wordsPerMinute: { type: 'number' }, mesoSize: { type: 'number' } }, required: ['source', 'outputPath'] },
  },
  {
    name: 'mindgraph_apply_digest_plan',
    description: 'Apply a structured DigestPlan to a mindgraph document.',
    inputSchema: { type: 'object', properties: { documentPath: { type: 'string' }, planPath: { type: 'string' }, plan: { type: 'object' } }, required: ['documentPath'] },
  },
  {
    name: 'mindgraph_evaluate_digest',
    description: 'Evaluate digest quality signals for a mindgraph document.',
    inputSchema: { type: 'object', properties: { documentPath: { type: 'string' } }, required: ['documentPath'] },
  },
  {
    name: 'mindgraph_inspect_document',
    description: 'Inspect and validate a mindgraph document.',
    inputSchema: { type: 'object', properties: { documentPath: { type: 'string' } }, required: ['documentPath'] },
  },
  {
    name: 'mindgraph_open_viewer',
    description: 'Open the local mindgraph viewer for a document.',
    inputSchema: { type: 'object', properties: { documentPath: { type: 'string' }, port: { type: 'number' }, host: { type: 'string' } }, required: ['documentPath'] },
  },
];

function resolveWorkspacePath(value) {
  if (!value) return value;
  return path.isAbsolute(value) ? value : path.resolve(workspaceDir, value);
}

async function callTool(name, args = {}) {
  if (name === 'mindgraph_prepare_source') {
    return textResult(await prepareSourceOperation({ ...args, workspaceDir }));
  }
  if (name === 'mindgraph_build_starter_digest') {
    return textResult(await buildStarterDigestOperation({ ...args, workspaceDir, outputPath: resolveWorkspacePath(args.outputPath) }));
  }
  if (name === 'mindgraph_apply_digest_plan') {
    return textResult(await applyDigestPlanOperation({ ...args, documentPath: resolveWorkspacePath(args.documentPath), planPath: resolveWorkspacePath(args.planPath) }));
  }
  if (name === 'mindgraph_evaluate_digest') {
    return textResult(await evaluateDigestOperation({ documentPath: resolveWorkspacePath(args.documentPath) }));
  }
  if (name === 'mindgraph_inspect_document') {
    return textResult(await inspectDocumentOperation({ documentPath: resolveWorkspacePath(args.documentPath) }));
  }
  if (name === 'mindgraph_open_viewer') {
    const __filename = fileURLToPath(import.meta.url);
    const __dirname = path.dirname(__filename);
    const cliPath = path.resolve(__dirname, '..', 'cli', 'index.js');
    const child = spawn(process.execPath, [cliPath, 'view', resolveWorkspacePath(args.documentPath), '--port', String(args.port ?? 4173), '--host', String(args.host ?? '127.0.0.1')], { detached: true, stdio: 'ignore' });
    child.unref();
    return textResult({ ok: true, url: `http://${args.host ?? '127.0.0.1'}:${args.port ?? 4173}` });
  }
  throw new Error(`Unknown tool: ${name}`);
}

function send(message) {
  process.stdout.write(`${JSON.stringify(message)}\n`);
}

async function handle(message) {
  try {
    if (message.method === 'initialize') {
      send({ jsonrpc: '2.0', id: message.id, result: { protocolVersion: '2024-11-05', capabilities: { tools: {} }, serverInfo: { name: 'mindgraph', version: '0.1.0' } } });
      return;
    }
    if (message.method === 'tools/list') {
      send({ jsonrpc: '2.0', id: message.id, result: { tools } });
      return;
    }
    if (message.method === 'tools/call') {
      const result = await callTool(message.params?.name, message.params?.arguments ?? {});
      send({ jsonrpc: '2.0', id: message.id, result });
      return;
    }
    if (message.id != null) send({ jsonrpc: '2.0', id: message.id, error: { code: -32601, message: `Method not found: ${message.method}` } });
  } catch (error) {
    send({ jsonrpc: '2.0', id: message.id, error: { code: -32000, message: error.message } });
  }
}

const rl = readline.createInterface({ input: process.stdin, terminal: false });
rl.on('line', (line) => {
  if (!line.trim()) return;
  handle(JSON.parse(line));
});
