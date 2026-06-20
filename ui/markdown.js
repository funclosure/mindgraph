import { escapeHtml } from './util.js';

// Minimal, safe Markdown -> HTML for chat answers. We escape the raw text FIRST
// (so the model can never inject HTML), then apply a small, well-known subset:
// headings, bullet/numbered lists, inline code, bold, italics, and links
// (http/https only). Block citations like [b012] are left as plain text.
export function renderMarkdown(text) {
  const escaped = escapeHtml(text ?? '');
  const blocks = escaped.split(/\n{2,}/).filter((b) => b.trim() !== '');
  return blocks.map((block) => {
    const lines = block.split('\n');
    const nonEmpty = lines.filter((l) => l.trim() !== '');

    // A standalone heading line ("## Title", 1–6 #). Rendered small for chat.
    const heading = nonEmpty.length === 1 && nonEmpty[0].match(/^\s*#{1,6}\s+(.*)$/);
    if (heading) return `<div class="md-h">${inline(heading[1])}</div>`;

    if (nonEmpty.length > 0 && nonEmpty.every((l) => /^\s*[-*]\s+/.test(l))) {
      const items = nonEmpty.map((l) => `<li>${inline(l.replace(/^\s*[-*]\s+/, ''))}</li>`).join('');
      return `<ul class="md-list">${items}</ul>`;
    }

    if (nonEmpty.length > 0 && nonEmpty.every((l) => /^\s*\d+\.\s+/.test(l))) {
      const items = nonEmpty.map((l) => `<li>${inline(l.replace(/^\s*\d+\.\s+/, ''))}</li>`).join('');
      return `<ol class="md-list">${items}</ol>`;
    }

    return `<p>${inline(lines.join('<br>'))}</p>`;
  }).join('');
}

function inline(s) {
  return s
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/__([^_]+)__/g, '<strong>$1</strong>')
    .replace(/\*([^*\n]+)\*/g, '<em>$1</em>')
    // links: [text](http...) — text already escaped; restrict to http(s) so no
    // javascript: URLs can slip through.
    .replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>');
}
