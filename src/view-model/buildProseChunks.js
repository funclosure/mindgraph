// Pure helper — no DOM. Returns an array of { kind: 'chapter' | 'paragraph', ... }.

/**
 * @typedef {Object} ChapterChunk
 * @property {'chapter'} kind
 * @property {string} title          - From macro frame title
 * @property {Object} macroFrameRef  - { level: 'macro', index: number }
 * @property {Object} timeSpan       - { start: number, end: number }
 *
 * @typedef {Object} ParagraphChunk
 * @property {'paragraph'} kind
 * @property {string} text                              - Joined paragraph prose
 * @property {string} [speaker]                         - Speaker name if known
 * @property {string[]} segmentIds                      - Source transcript segment ids
 * @property {Object} timeSpan                          - { start, end } union of segments
 * @property {Array<{start: number, end: number, conceptId: string}>} conceptMentions
 */

const PARAGRAPH_WORD_TARGET = 150;

export function buildProseChunks(vm) {
  const macro = vm.frames?.macro ?? [];
  const segments = vm.transcript?.segments ?? [];
  const chunks = [];
  if (!segments.length) return chunks;

  // Sort macro by start time so chapters are in narrative order.
  const macroSorted = [...macro].sort((a, b) => a.span.start - b.span.start);
  let macroCursor = 0;

  let para = newParagraph();

  for (let i = 0; i < segments.length; i += 1) {
    const seg = segments[i];

    // Emit chapter heading for any macro chunk whose start ≤ seg.start.
    while (macroCursor < macroSorted.length && macroSorted[macroCursor].span.start <= seg.start) {
      // Flush the in-progress paragraph before the chapter heading.
      if (para.segmentIds.length) {
        chunks.push(finalizeParagraph(para, vm));
        para = newParagraph();
      }
      const macroFrame = macroSorted[macroCursor];
      chunks.push({
        kind: 'chapter',
        title: macroFrame.title || `Chapter ${macroCursor + 1}`,
        macroFrameRef: macroFrame.ref,
        timeSpan: { start: macroFrame.span.start, end: macroFrame.span.end },
      });
      macroCursor += 1;
    }

    // Paragraph break on speaker change.
    if (
      para.segmentIds.length &&
      seg.speaker &&
      para.speaker &&
      seg.speaker !== para.speaker
    ) {
      chunks.push(finalizeParagraph(para, vm));
      para = newParagraph();
    }

    // Append this segment to the current paragraph.
    if (!para.speaker && seg.speaker) para.speaker = seg.speaker;
    if (!para.segmentIds.length) para.timeSpan.start = seg.start;
    para.timeSpan.end = seg.end;
    para.segmentIds.push(seg.id);
    para.text = (para.text ? para.text + ' ' : '') + (seg.text || '').trim();

    // Length-based break: if running paragraph has accumulated ~150 words AND
    // the segment ends with a sentence terminator, close the paragraph.
    if (countWords(para.text) >= PARAGRAPH_WORD_TARGET && /[.!?]\s*$/.test(para.text)) {
      chunks.push(finalizeParagraph(para, vm));
      para = newParagraph();
    }
  }

  if (para.segmentIds.length) chunks.push(finalizeParagraph(para, vm));

  return chunks;
}

function newParagraph() {
  return {
    kind: 'paragraph',
    text: '',
    speaker: undefined,
    segmentIds: [],
    timeSpan: { start: 0, end: 0 },
    conceptMentions: [],
  };
}

function finalizeParagraph(para, vm) {
  para.conceptMentions = computeMentions(para.text, para.segmentIds, vm);
  return para;
}

function countWords(text) {
  return (text.match(/\S+/g) ?? []).length;
}

// Find concept mentions inside the paragraph text. We use the document's
// existing conceptToTranscriptSegmentIds index: for each concept that
// references at least one of this paragraph's source segments, scan the
// paragraph text for occurrences of the concept label and any aliases.
function computeMentions(text, segmentIds, vm) {
  const segmentIdSet = new Set(segmentIds);
  const candidateIds = new Set();
  for (const [conceptId, refIds] of Object.entries(vm.indexes?.conceptToTranscriptSegmentIds ?? {})) {
    if (refIds.some((id) => segmentIdSet.has(id))) candidateIds.add(conceptId);
  }
  const mentions = [];
  for (const conceptId of candidateIds) {
    const concept = vm.concepts.byId?.[conceptId];
    if (!concept) continue;
    const phrases = [concept.label, ...(concept.aliases ?? [])].filter(Boolean);
    for (const phrase of phrases) {
      const re = new RegExp(`\\b${escapeRegExp(phrase)}\\b`, 'gi');
      let match;
      while ((match = re.exec(text)) !== null) {
        mentions.push({
          start: match.index,
          end: match.index + match[0].length,
          conceptId,
        });
      }
    }
  }
  // Sort by start, then prefer earlier-ending (longer specificity).
  mentions.sort((a, b) => a.start - b.start || a.end - b.end);
  // Deduplicate overlaps: keep the first; drop any that overlap with it.
  const deduped = [];
  let lastEnd = -1;
  for (const m of mentions) {
    if (m.start >= lastEnd) {
      deduped.push(m);
      lastEnd = m.end;
    }
  }
  return deduped;
}

function escapeRegExp(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
