import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';

function makeWorkspace() {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'mindgraph-mcp-'));
  fs.mkdirSync(path.join(workspace, 'graphs'), { recursive: true });
  fs.writeFileSync(path.join(workspace, 'source.txt'), 'Wisdom addresses meaning.\n\nPractice stabilizes wisdom.', 'utf8');
  return workspace;
}

function startServer(workspace) {
  const child = spawn(process.execPath, ['src/mcp/server.js', '--workspace', workspace], {
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  const responses = [];
  let buffer = '';
  child.stdout.on('data', (chunk) => {
    buffer += chunk.toString('utf8');
    const lines = buffer.split('\n');
    buffer = lines.pop();
    for (const line of lines) {
      if (line.trim()) responses.push(JSON.parse(line));
    }
  });
  return {
    child,
    responses,
    send: (message) => child.stdin.write(`${JSON.stringify(message)}\n`),
    stop: () => child.kill('SIGTERM'),
  };
}

async function waitForResponse(server, id) {
  const started = Date.now();
  while (Date.now() - started < 2000) {
    const response = server.responses.find((item) => item.id === id);
    if (response) return response;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error(`Timed out waiting for response ${id}`);
}

test('MCP server initializes, lists tools, and builds a starter digest', async () => {
  const workspace = makeWorkspace();
  const server = startServer(workspace);
  try {
    server.send({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'test', version: '0' } } });
    const initialized = await waitForResponse(server, 1);
    assert.equal(initialized.result.serverInfo.name, 'mindgraph');

    server.send({ jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} });
    const listed = await waitForResponse(server, 2);
    const toolNames = listed.result.tools.map((tool) => tool.name);
    assert.ok(toolNames.includes('mindgraph_build_starter_digest'));
    assert.ok(toolNames.includes('mindgraph_evaluate_digest'));

    server.send({
      jsonrpc: '2.0',
      id: 3,
      method: 'tools/call',
      params: {
        name: 'mindgraph_build_starter_digest',
        arguments: { source: path.join(workspace, 'source.txt'), outputPath: path.join(workspace, 'graphs', 'mcp.mindgraph.json'), title: 'MCP Source', mode: 'untimed', mesoSize: 1 },
      },
    });
    const built = await waitForResponse(server, 3);
    const parsed = JSON.parse(built.result.content[0].text);
    assert.equal(parsed.ok, true);
    assert.equal(fs.existsSync(path.join(workspace, 'graphs', 'mcp.mindgraph.json')), true);
  } finally {
    server.stop();
  }
});
