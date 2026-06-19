import { test } from 'node:test';
import assert from 'node:assert/strict';
import { renderMarkdown } from '../ui/markdown.js';

test('renders bold, italics, and inline code', () => {
  const html = renderMarkdown('Powerful **AI** is *near* per `b001`.');
  assert.match(html, /<strong>AI<\/strong>/);
  assert.match(html, /<em>near<\/em>/);
  assert.match(html, /<code>b001<\/code>/);
});

test('escapes HTML before applying markdown (no injection)', () => {
  const html = renderMarkdown('<script>alert(1)</script> **safe**');
  assert.doesNotMatch(html, /<script>/);
  assert.match(html, /&lt;script&gt;/);
  assert.match(html, /<strong>safe<\/strong>/);
});

test('renders bullet lists and paragraphs', () => {
  const html = renderMarkdown('Intro line.\n\n- one\n- two');
  assert.match(html, /<p>Intro line\.<\/p>/);
  assert.match(html, /<ul class="md-list"><li>one<\/li><li>two<\/li><\/ul>/);
});

test('renders only http(s) links, leaves bare [b012] citations alone', () => {
  const html = renderMarkdown('See [docs](https://example.com) and block [b012].');
  assert.match(html, /<a href="https:\/\/example\.com" target="_blank" rel="noopener noreferrer">docs<\/a>/);
  assert.match(html, /\[b012\]/);
});

test('does not turn a javascript: link into an anchor', () => {
  const html = renderMarkdown('[x](javascript:alert(1))');
  assert.doesNotMatch(html, /<a /);
});

test('newlines within a paragraph become <br>', () => {
  const html = renderMarkdown('line one\nline two');
  assert.match(html, /line one<br>line two/);
});
