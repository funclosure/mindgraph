// ---------------------------------------------------------------------------
// Prose panel renderer — overview headings + paragraphs + concept-mention spans
// ---------------------------------------------------------------------------

import { escapeHtml } from '../util.js';

export function renderProse(chunks, state) {
  const activeIds = new Set(state.graphRenderState?.activeNodeIds ?? []);
  const selectedIds = new Set(
    state.selectedConceptIds?.length ? state.selectedConceptIds
      : (state.selectedConceptId ? [state.selectedConceptId] : []),
  );
  const playheadTime = state.playheadTime ?? 0;
  const html = chunks.map((chunk) => renderChunk(chunk, activeIds, selectedIds, playheadTime)).join('');
  return `<article class="prose-article">${html}</article>`;
}

function renderChunk(chunk, activeIds, selectedIds, playheadTime) {
  if (chunk.kind === 'overview') {
    return `<h2 class="prose-overview" data-time-start="${chunk.timeSpan.start}">${escapeHtml(chunk.title)}</h2>`;
  }
  return renderParagraph(chunk, activeIds, selectedIds, playheadTime);
}

function renderParagraph(para, activeIds, selectedIds, playheadTime) {
  const inner = renderParagraphInner(para.text, para.conceptMentions, activeIds, selectedIds);
  const isCurrent = isTimeInSpan(playheadTime, para.timeSpan);
  const cls = ['prose-block'];
  if (isCurrent) cls.push('is-current');
  return (
    `<section class="${cls.join(' ')}" data-time-start="${para.timeSpan.start}" data-time-end="${para.timeSpan.end}">` +
      `<p class="prose-para">${inner}</p>` +
    `</section>`
  );
}

function isTimeInSpan(time, span) {
  if (!span || typeof time !== 'number') return false;
  return time >= span.start && time < span.end;
}

function renderParagraphInner(text, mentions, activeIds, selectedIds) {
  if (!mentions.length) return escapeHtml(text);
  const parts = [];
  let cursor = 0;
  for (const m of mentions) {
    if (m.start > cursor) parts.push(escapeHtml(text.slice(cursor, m.start)));
    const phrase = text.slice(m.start, m.end);
    const isActive = activeIds.has(m.conceptId);
    const isSelected = selectedIds.has(m.conceptId);
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
