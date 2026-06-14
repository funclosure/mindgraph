// Pure helper — no DOM. Returns an array of { kind: 'overview' | 'paragraph', ... }.

/**
 * @typedef {Object} OverviewChunk
 * @property {'overview'} kind
 * @property {string} title          - From overview frame title
 * @property {Object} overviewFrameRef - { level: 'overview' | 'macro', index: number }
 * @property {Object} timeSpan       - { start: number, end: number }
 *
 * @typedef {Object} ParagraphChunk
 * @property {'paragraph'} kind
 * @property {string} text                              - Joined paragraph prose
 * @property {string} [speaker]                         - Speaker name if known
 * @property {string[]} segmentIds                      - Source transcript segment ids
 * @property {Object} timeSpan                          - { start, end } union of segments
 * @property {Array<{start: number, end: number, conceptId: string}>} conceptMentions
 * @property {Object} [focus]                           - Current reader-step focus for this paragraph
 */

const PARAGRAPH_WORD_TARGET = 150;
const PARAGRAPH_WORD_HARD_CEILING = 220;

export function buildProseChunks(vm) {
  const overview = vm.sourceFlow?.overview ?? vm.frames?.macro ?? [];
  const segments = vm.transcript?.segments ?? [];
  const chunks = [];
  if (!segments.length) return chunks;

  // Sort overview frames by start time so headings are in narrative order.
  const overviewSorted = [...overview].sort((a, b) => a.span.start - b.span.start);
  let overviewCursor = 0;

  let para = newParagraph();

  for (let i = 0; i < segments.length; i += 1) {
    const seg = segments[i];

    // Emit overview heading for any overview chunk whose start ≤ seg.start.
    while (overviewCursor < overviewSorted.length && overviewSorted[overviewCursor].span.start <= seg.start) {
      // Flush the in-progress paragraph before the overview heading.
      if (para.segmentIds.length) {
        chunks.push(finalizeParagraph(para, vm));
        para = newParagraph();
      }
      const overviewFrame = overviewSorted[overviewCursor];
      chunks.push({
        kind: 'overview',
        title: overviewFrame.title || `Overview ${overviewCursor + 1}`,
        overviewFrameRef: overviewFrame.ref,
        timeSpan: { start: overviewFrame.span.start, end: overviewFrame.span.end },
      });
      overviewCursor += 1;
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

    // Length-based break: at the target (~150 words) we look for a sentence
    // terminator; without one (machine transcripts often lack punctuation),
    // we still force a break once we exceed PARAGRAPH_WORD_HARD_CEILING.
    const words = countWords(para.text);
    if (
      (words >= PARAGRAPH_WORD_TARGET && /[.!?]\s*$/.test(para.text))
      || words >= PARAGRAPH_WORD_HARD_CEILING
    ) {
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
  para.focus = computeFocus(para.timeSpan.start, vm);
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

function computeFocus(time, vm) {
  const frame = vm.selectors?.getActiveFrameAtTime?.('readerStep', time);
  if (!frame) return undefined;
  const concepts = (frame.foregroundConcepts ?? [])
    .map((activation) => {
      const concept = vm.concepts.byId?.[activation.id];
      if (!concept) return undefined;
      return {
        id: activation.id,
        label: concept.label,
        weight: activation.weight,
        ...(activation.mode ? { mode: activation.mode } : {}),
      };
    })
    .filter(Boolean)
    .sort((a, b) => b.weight - a.weight)
    .slice(0, 4);
  if (!concepts.length && !frame.summary) return undefined;
  return {
    timeLabel: formatClock(time),
    summary: frame.summary ?? '',
    concepts,
  };
}

function formatClock(seconds) {
  const total = Math.max(0, Math.floor(seconds));
  const minutes = Math.floor(total / 60);
  const secs = total % 60;
  return `${String(minutes).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
}

function escapeRegExp(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
