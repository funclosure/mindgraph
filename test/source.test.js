import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { classifySource, prepareSource, slugifySourceTitle } from '../src/core/source.js';

function makeTempWorkspace() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'mindgraph-source-'));
}

function startArticleServer() {
  const server = http.createServer((req, res) => {
    res.setHeader('content-type', 'text/html; charset=utf-8');
    res.end(`<!doctype html>
      <html><head><title>Readable Article</title><script>window.noise = true;</script></head>
      <body><nav>Navigation</nav><article><h1>Readable Article</h1><p>First useful paragraph.</p><p>Second useful paragraph.</p></article></body></html>`);
  });
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      resolve({
        url: `http://127.0.0.1:${address.port}/article`,
        close: () => new Promise((done) => server.close(done)),
      });
    });
  });
}

test('classifySource detects local files, web articles, and YouTube URLs', () => {
  assert.equal(classifySource('./notes.txt').kind, 'file');
  assert.equal(classifySource('https://example.com/post').kind, 'web');
  assert.equal(classifySource('https://youtu.be/abc123').kind, 'youtube');
  assert.equal(classifySource('https://www.youtube.com/watch?v=abc123').kind, 'youtube');
});

test('slugifySourceTitle creates stable filesystem slugs', () => {
  assert.equal(slugifySourceTitle('Meaning, Crisis & Wisdom!'), 'meaning-crisis-wisdom');
  assert.equal(slugifySourceTitle('   '), 'source');
});

test('prepareSource passes through local file sources', async () => {
  const workspace = makeTempWorkspace();
  const sourcePath = path.join(workspace, 'input transcript.txt');
  fs.writeFileSync(sourcePath, 'A local transcript paragraph.', 'utf8');

  const result = await prepareSource({ source: sourcePath, workspaceDir: workspace, title: 'Local Title' });

  assert.equal(result.kind, 'file');
  assert.equal(result.preparedPath, sourcePath);
  assert.equal(result.title, 'Local Title');
  assert.equal(result.modeHint, 'auto');
});

test('prepareSource imports readable web article text into transcripts directory', async () => {
  const workspace = makeTempWorkspace();
  const article = await startArticleServer();
  try {
    const result = await prepareSource({ source: article.url, workspaceDir: workspace });

    assert.equal(result.kind, 'web');
    assert.match(result.preparedPath, /transcripts\/readable-article\.txt$/);
    assert.equal(result.title, 'Readable Article');
    assert.equal(result.modeHint, 'untimed');
    const saved = fs.readFileSync(result.preparedPath, 'utf8');
    assert.match(saved, /Readable Article/);
    assert.match(saved, /First useful paragraph\./);
    assert.doesNotMatch(saved, /window\.noise/);
  } finally {
    await article.close();
  }
});

test('prepareSource returns a structured unsupported result for YouTube in this slice', async () => {
  const workspace = makeTempWorkspace();
  const result = await prepareSource({ source: 'https://youtu.be/abc123', workspaceDir: workspace });

  assert.equal(result.kind, 'youtube');
  assert.equal(result.supported, false);
  assert.match(result.reason, /YouTube transcript import is not built into this slice/);
  assert.match(result.recoveryHint, /provide a transcript file/);
});

test('extractArticleBlocks preserves headings, paragraphs, list items, and blockquotes', async () => {
  const { extractArticleBlocks } = await import('../src/core/source.js');
  const blocks = extractArticleBlocks(`<!doctype html>
    <html><body><article>
      <h1>Main Title</h1>
      <p>First paragraph with <strong>inline</strong> text.</p>
      <h2>Second Section</h2>
      <ul><li>First item</li><li>Second item</li></ul>
      <blockquote>Quoted idea.</blockquote>
    </article></body></html>`);

  assert.deepEqual(blocks, [
    'Main Title',
    'First paragraph with inline text.',
    'Second Section',
    'First item',
    'Second item',
    'Quoted idea.',
  ]);
});

test('prepareSource writes readable web article blocks separated by blank lines', async () => {
  const workspace = makeTempWorkspace();
  const server = http.createServer((req, res) => {
    res.setHeader('content-type', 'text/html; charset=utf-8');
    res.end(`<!doctype html><html><body><article>
      <h1>Structured Article</h1>
      <p>Paragraph one.</p>
      <p>Paragraph two.</p>
      <p>Paragraph three.</p>
    </article></body></html>`);
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  try {
    const result = await prepareSource({ source: `http://127.0.0.1:${address.port}/structured`, workspaceDir: workspace });
    const saved = fs.readFileSync(result.preparedPath, 'utf8');
    assert.match(saved, /Structured Article\n\nParagraph one\.\n\nParagraph two\.\n\nParagraph three\./);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});
