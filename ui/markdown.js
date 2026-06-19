import { escapeHtml } from './util.js';

// Minimal, safe Markdown -> HTML for chat answers. We escape the raw text FIRST
// (so the model can never inject HTML), then apply a small, well-known subset:
// inline code, bold, italics, links (http/https only), bullet lists, and
// paragraph/line breaks. Block citations like [b012] are left as plain text.
export function renderMarkdown(text) {
  const escaped = escapeHtml(text ?? '');
  const blocks = escaped.split(/\n{2,}/).filter((b) => b.trim() !== '');
  return blocks.map((block) => {
    const lines = block.split('\n');
    const nonEmpty = lines.filter((l) => l.trim() !== '');
    const isList = nonEmpty.length > 0 && nonEmpty.every((l) => /^\s*[-*]\s+/.test(l));
    if (isList) {
      const items = nonEmpty
        .map((l) => `<li>${inline(l.replace(/^\s*[-*]\s+/, ''))}</li>`)
        .join('');
      return `<ul class="md-list">${items}</ul>`;
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
