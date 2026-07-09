import { compileAuthoringMarkdown } from './compile.js';
import { parseTranscript } from '../transcript.js';

const STOP_WORDS = new Set([
  'about',
  'after',
  'again',
  'against',
  'also',
  'because',
  'before',
  'being',
  'between',
  'could',
  'every',
  'first',
  'from',
  'have',
  'into',
  'more',
  'must',
  'need',
  'other',
  'policy',
  'should',
  'such',
  'than',
  'that',
  'their',
  'there',
  'these',
  'this',
  'through',
  'under',
  'when',
  'where',
  'which',
  'while',
  'with',
  'world',
  'would',
]);

function slugify(value, fallback = 'item') {
  const slug = String(value)
    .toLowerCase()
    .replace(/['’]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return slug || fallback;
}

function idNumber(prefix, index) {
  return `${prefix}${String(index + 1).padStart(3, '0')}`;
}

function titleCaseFromSlug(slug) {
  return slug
    .split('-')
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

function normalizeNewlines(text) {
  return String(text)
    .replace(/\r\n?/g, '\n')
    .split('\n');
}

function isLikelyDateLine(line) {
  return /^(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\s+\d{4}$/i.test(line)
    || /^\d{4}[-/]\d{1,2}[-/]\d{1,2}$/.test(line);
}

function splitParagraphs(text, opts = {}) {
  const titleSlug = opts.title ? slugify(opts.title) : null;
  const rawLines = normalizeNewlines(text).map((line) => line.trim());
  const hasExplicitTitleLine = titleSlug
    ? rawLines.some((line) => slugify(stripHeadingNumber(line)) === titleSlug)
    : false;
  const paragraphs = [];
  let current = [];
  let started = !hasExplicitTitleLine;
  let justSkippedTitle = false;

  function flush() {
    const paragraph = current.join(' ').replace(/\s+/g, ' ').trim();
    if (paragraph) paragraphs.push(paragraph);
    current = [];
  }

  for (const line of rawLines) {
    if (!line) {
      flush();
      continue;
    }
    if (/^footnotes$/i.test(line)) break;

    if (!started) {
      if (slugify(stripHeadingNumber(line)) === titleSlug) {
        started = true;
        justSkippedTitle = true;
      }
      continue;
    }

    if (justSkippedTitle && isLikelyDateLine(line)) {
      justSkippedTitle = false;
      continue;
    }
    justSkippedTitle = false;

    if (/^\d+[.)]\s+\S/.test(line)) {
      flush();
      paragraphs.push(line);
      continue;
    }

    current.push(line);
  }

  flush();
  return paragraphs;
}

function transcriptBlocks(text, opts = {}) {
  const parsed = parseTranscript(text, { mode: 'auto' });
  if (parsed.format === 'untimed-inferred' || parsed.segments.length < 4) return null;

  const targetSeconds = opts.targetSeconds ?? 90;
  const blocks = [];
  let current = [];
  let currentStart = null;

  function flush() {
    if (!current.length) return;
    blocks.push(current.join(' ').replace(/\s+/g, ' ').trim());
    current = [];
    currentStart = null;
  }

  for (const segment of parsed.segments) {
    if (currentStart == null) currentStart = segment.start;
    if (current.length && segment.start - currentStart >= targetSeconds) flush();
    if (currentStart == null) currentStart = segment.start;
    current.push(segment.text);
  }
  flush();
  return blocks.length ? blocks : null;
}

function stripHeadingNumber(text) {
  return String(text).replace(/^\d+[.)]\s+/, '').trim();
}

function looksLikeHeading(paragraph) {
  if (/^\d+[.)]\s+\S/.test(paragraph)) return true;
  if (paragraph.length > 80) return false;
  if (/[.!?:;]$/.test(paragraph)) return false;
  return paragraph.split(/\s+/).length <= 8;
}

function inferTitle(paragraphs, explicitTitle) {
  if (explicitTitle) return explicitTitle;
  const firstHeading = paragraphs.find((paragraph) => looksLikeHeading(paragraph));
  return firstHeading ? stripHeadingNumber(firstHeading) : 'Untitled Mindgraph';
}

function extractSections(paragraphs, title) {
  const sections = [];
  let current = null;
  const titleSlug = slugify(title);

  function ensureSection(heading) {
    const baseId = slugify(stripHeadingNumber(heading), 'section');
    let id = baseId;
    let suffix = 2;
    while (sections.some((section) => section.id === id)) {
      id = `${baseId}-${suffix}`;
      suffix += 1;
    }
    current = { id, title: stripHeadingNumber(heading), paragraphs: [] };
    sections.push(current);
  }

  for (const paragraph of paragraphs) {
    const stripped = stripHeadingNumber(paragraph);
    if (!sections.length && slugify(stripped) === titleSlug) continue;
    if (looksLikeHeading(paragraph) && slugify(stripped) !== titleSlug) {
      ensureSection(paragraph);
      continue;
    }
    if (!current) ensureSection('Overview');
    current.paragraphs.push(paragraph);
  }

  return sections
    .map((section) => ({
      ...section,
      paragraphs: section.paragraphs.length ? section.paragraphs : [section.title],
    }))
    .filter((section) => section.paragraphs.some(Boolean));
}

function topKeywords(text, limit) {
  const counts = new Map();
  const words = String(text).toLowerCase().match(/[a-z][a-z-]{3,}/g) ?? [];
  for (const word of words) {
    const normalized = word.replace(/^-+|-+$/g, '');
    if (normalized.length < 4 || STOP_WORDS.has(normalized)) continue;
    counts.set(normalized, (counts.get(normalized) ?? 0) + 1);
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, limit)
    .map(([word]) => slugify(word));
}

function dedupeIds(ids) {
  const seen = new Set();
  const result = [];
  for (const id of ids) {
    if (seen.has(id)) continue;
    seen.add(id);
    result.push(id);
  }
  return result;
}

function summarize(text) {
  const normalized = String(text).replace(/\s+/g, ' ').trim();
  const sentence = normalized.match(/^.*?[.!?](?:\s|$)/)?.[0]?.trim();
  const summary = sentence || normalized;
  if (summary.length <= 180) return summary;
  return `${summary.slice(0, 177).trim()}...`;
}

function yamlScalar(value) {
  return String(value ?? '').replace(/\n/g, ' ').trim();
}

export function createAuthoringDraftFromText(text, opts = {}) {
  const transcriptParagraphs = transcriptBlocks(text);
  const paragraphs = transcriptParagraphs ?? splitParagraphs(text, { title: opts.title });
  if (!paragraphs.length) {
    throw new Error('Cannot draft authoring markdown from empty text.');
  }

  const title = inferTitle(paragraphs, opts.title);
  const sourceId = slugify(opts.sourceId ?? title, 'source');
  const runtime = opts.runtime ?? `${slugify(title, 'mindgraph')}.mindgraph.json`;
  const sections = extractSections(paragraphs, title);
  const centralConceptId = `${slugify(title, 'article')}-thesis`;
  const blockEntries = [];
  const stepEntries = [];
  const sectionEntries = [];
  const sectionConceptIds = [];

  sections.forEach((section, sectionIndex) => {
    const blockIds = [];
    section.paragraphs.forEach((paragraph) => {
      const id = idNumber('b', blockEntries.length);
      blockIds.push(id);
      blockEntries.push({ id, sectionId: section.id, text: paragraph, kind: transcriptParagraphs ? 'transcript' : 'paragraph' });
    });

    const stepId = idNumber('s', sectionIndex);
    const conceptId = slugify(section.title, `section-${sectionIndex + 1}`);
    sectionConceptIds.push(conceptId);
    stepEntries.push({
      id: stepId,
      sectionId: section.id,
      blockIds,
      conceptId,
      summary: summarize(section.paragraphs.join(' ')),
    });
    sectionEntries.push({
      id: section.id,
      title: section.title,
      summary: summarize(section.paragraphs.join(' ')),
      stepId,
    });
  });

  const keywordConceptIds = topKeywords(paragraphs.join(' '), 4)
    .filter((id) => id !== sourceId && id !== centralConceptId && !sectionConceptIds.includes(id));
  const atomicConceptIds = dedupeIds([centralConceptId, ...sectionConceptIds, ...keywordConceptIds]);
  const clusterId = `${slugify(title, 'article')}-ideas`;
  const firstBlockId = blockEntries[0].id;
  const sectionConceptSet = new Set(sectionConceptIds);
  const lines = [
    '---',
    'kind: mindgraph.authoring',
    'version: 1',
    `title: ${yamlScalar(title)}`,
    `runtime: ${yamlScalar(runtime)}`,
    '---',
    '',
    '# Sources',
    '',
    `@source ${sourceId}`,
    'type: article',
    `title: ${yamlScalar(title)}`,
  ];

  if (opts.sourcePath) lines.push(`path: ${yamlScalar(opts.sourcePath)}`);
  if (opts.sourceUrl) lines.push(`url: ${yamlScalar(opts.sourceUrl)}`);

  lines.push('', '# Source Blocks', '');
  for (const block of blockEntries) {
    lines.push(`@block ${block.id} source=${sourceId} kind=${block.kind}`, block.text, '');
  }

  lines.push('# Reader Steps', '');
  for (const step of stepEntries) {
    lines.push(
      `@step ${step.id} section=${step.sectionId} blocks=${step.blockIds.join(',')}`,
      `summary: ${yamlScalar(step.summary)}`,
      'focus:',
      `  - ${centralConceptId} 0.70 inferred`,
      `  - ${step.conceptId} 0.92 inferred`,
      'relations:',
      `  - ${centralConceptId} -> ${step.conceptId} includes 0.74`,
      '',
    );
  }

  lines.push('# Sections', '');
  for (const section of sectionEntries) {
    lines.push(
      `@section ${section.id}`,
      `title: ${yamlScalar(section.title)}`,
      `summary: ${yamlScalar(section.summary)}`,
      `steps: ${section.stepId}`,
      '',
    );
  }

  lines.push('# Concepts', '');
  for (const id of atomicConceptIds) {
    const label = id === centralConceptId ? title : titleCaseFromSlug(id);
    const firstSeenBlockId = sectionConceptSet.has(id)
      ? stepEntries[sectionConceptIds.indexOf(id)]?.blockIds[0] ?? firstBlockId
      : firstBlockId;
    lines.push(
      `@concept ${id}`,
      `label: ${yamlScalar(label)}`,
      `cluster: ${clusterId}`,
      `first_seen: ${firstSeenBlockId}`,
      '',
    );
  }

  lines.push(
    `@cluster ${clusterId}`,
    `label: ${yamlScalar(title)} Ideas`,
    `children: ${atomicConceptIds.join(', ')}`,
    '',
    '# Relations',
    '',
  );

  sectionConceptIds.forEach((conceptId, index) => {
    const relationId = idNumber('r', index);
    const groundedBlockId = stepEntries[index]?.blockIds[0] ?? firstBlockId;
    lines.push(
      `@relation ${relationId}`,
      `from: ${centralConceptId}`,
      `to: ${conceptId}`,
      'type: includes',
      'provenance: source',
      `grounded_in: ${groundedBlockId}`,
      '',
    );
  });

  const markdown = `${lines.join('\n').replace(/\n{3,}/g, '\n\n').trim()}\n`;
  const compiled = compileAuthoringMarkdown(markdown);
  return { markdown, validation: compiled.validation, document: compiled.document };
}
