// ---------------------------------------------------------------------------
// Prose panel renderer — chapters + paragraphs + concept-mention spans
// ---------------------------------------------------------------------------

import { escapeHtml } from '../util.js';

// Render the full prose panel HTML.
//
// chunks  — output of buildProseChunks(vm)
// state   — { selectedConceptId, graphRenderState: { activeNodeIds } }
export function renderProse(chunks, state) {
  const activeIds = new Set(state.graphRenderState?.activeNodeIds ?? []);
  const selectedId = state.selectedConceptId;
  const html = chunks.map((chunk) => renderChunk(chunk, activeIds, selectedId)).join('');
  return `
    <header class="prose-header">
      <button type="button" class="prose-collapse" data-action="toggle-prose" title="Hide reading panel">✕</button>
    </header>
    <article class="prose-article">${html}</article>
  `;
}

function renderChunk(chunk, activeIds, selectedId) {
  if (chunk.kind === 'chapter') {
    return `<h2 class="prose-chapter" data-time-start="${chunk.timeSpan.start}">${escapeHtml(chunk.title)}</h2>`;
  }
  return renderParagraph(chunk, activeIds, selectedId);
}

function renderParagraph(para, activeIds, selectedId) {
  const inner = renderParagraphInner(para.text, para.conceptMentions, activeIds, selectedId);
  return `<p class="prose-para" data-time-start="${para.timeSpan.start}" data-time-end="${para.timeSpan.end}">${inner}</p>`;
}

// Build the paragraph's inner HTML by interleaving plain-text and mention spans.
function renderParagraphInner(text, mentions, activeIds, selectedId) {
  if (!mentions.length) return escapeHtml(text);
  const parts = [];
  let cursor = 0;
  for (const m of mentions) {
    if (m.start > cursor) parts.push(escapeHtml(text.slice(cursor, m.start)));
    const phrase = text.slice(m.start, m.end);
    const isActive = activeIds.has(m.conceptId);
    const isSelected = selectedId === m.conceptId;
    const cls = ['concept'];
    if (isActive) cls.push('concept--active');
    if (isSelected) cls.push('concept--selected');
    parts.push(
      `<span class="${cls.join(' ')}" data-concept-id="${escapeHtml(m.conceptId)}" data-action="select-concept">${escapeHtml(phrase)}</span>`,
    );
    cursor = m.end;
  }
  if (cursor < text.length) parts.push(escapeHtml(text.slice(cursor)));
  return parts.join('');
}
