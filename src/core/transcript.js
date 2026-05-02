export function parseTimestamp(value) {
  const trimmed = value.trim();
  const parts = trimmed.split(':').map(Number);
  if (parts.some(Number.isNaN)) return null;

  if (parts.length === 3) {
    const [hh, mm, ss] = parts;
    return hh * 3600 + mm * 60 + ss;
  }

  if (parts.length === 2) {
    const [mm, ss] = parts;
    return mm * 60 + ss;
  }

  return null;
}

export function slugify(value) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'untitled';
}

export function deriveTitleFromPath(filePath) {
  const name = filePath.split('/').pop() ?? 'untitled';
  return name.replace(/\.[^.]+$/, '').replace(/[-_]+/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

function normalizeWhitespace(value) {
  return value.replace(/\s+/g, ' ').trim();
}

function estimateDurationSeconds(text, wordsPerMinute = 150, minSeconds = 4) {
  const words = normalizeWhitespace(text).split(' ').filter(Boolean).length;
  if (words === 0) return minSeconds;
  return Math.max(minSeconds, Math.ceil((words / wordsPerMinute) * 60));
}

function finalizeSegments(segments) {
  return segments
    .filter((segment) => normalizeWhitespace(segment.text).length > 0)
    .map((segment, index, all) => ({
      id: `seg-${index + 1}`,
      start: segment.start,
      end: segment.end ?? all[index + 1]?.start ?? segment.start + 30,
      speaker: segment.speaker ?? undefined,
      text: normalizeWhitespace(segment.text),
    }));
}

function parseTimestampedSpeakerLines(lines) {
  const segments = [];
  const speakers = new Set();
  const patterns = [
    /^\s*\[?(\d{1,2}:\d{2}(?::\d{2})?)\]?\s+([^:]+):\s+(.*)\s*$/,
    /^\s*(\d{1,2}:\d{2}(?::\d{2})?)\s*([^:]+):\s+(.*)\s*$/,
    /^\s*(\d{1,2}:\d{2}(?::\d{2})?)\s*-\s+(.*)\s*$/,
  ];

  for (const line of lines) {
    if (!line.trim()) continue;

    let match = line.match(patterns[0]) || line.match(patterns[1]);
    if (match) {
      const start = parseTimestamp(match[1]);
      if (start == null) continue;
      const speaker = match[2].trim();
      const text = match[3].trim();
      segments.push({ start, speaker, text });
      speakers.add(speaker);
      continue;
    }

    match = line.match(patterns[2]);
    if (match) {
      const start = parseTimestamp(match[1]);
      if (start == null) continue;
      const text = match[2].trim();
      segments.push({ start, speaker: null, text });
    }
  }

  return {
    format: 'timestamped-lines',
    speakers: Array.from(speakers),
    segments: finalizeSegments(segments),
  };
}

function parseCaptionTranscript(lines, defaultSpeaker) {
  const timestampOnly = /^\s*\[(\d{1,2}:\d{2}(?::\d{2})?)\]\s*(.*)\s*$/;
  const segments = [];
  let current = null;

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) continue;

    const match = line.match(timestampOnly);
    if (match) {
      const start = parseTimestamp(match[1]);
      if (start == null) continue;

      if (current) segments.push(current);
      current = {
        start,
        speaker: defaultSpeaker ?? null,
        text: match[2] ? match[2].trim() : '',
      };
      continue;
    }

    if (current) {
      current.text = current.text ? `${current.text} ${line}` : line;
    }
  }

  if (current) segments.push(current);

  return {
    format: 'caption-blocks',
    speakers: defaultSpeaker ? [defaultSpeaker] : [],
    segments: finalizeSegments(segments),
  };
}

function splitUntimedBlocks(rawText) {
  return rawText
    .split(/\n\s*\n/g)
    .map((block) => normalizeWhitespace(block))
    .filter(Boolean);
}

function parseUntimedTranscript(rawText, { defaultSpeaker, wordsPerMinute = 150 } = {}) {
  const blocks = splitUntimedBlocks(rawText);
  let cursor = 0;

  const segments = blocks.map((text) => {
    const duration = estimateDurationSeconds(text, wordsPerMinute);
    const segment = {
      start: cursor,
      end: cursor + duration,
      speaker: defaultSpeaker ?? null,
      text,
    };
    cursor += duration;
    return segment;
  });

  return {
    format: 'untimed-inferred',
    speakers: defaultSpeaker ? [defaultSpeaker] : [],
    segments: finalizeSegments(segments),
  };
}

export function parseTranscript(rawText, options = {}) {
  const lines = rawText.split(/\r?\n/);
  const mode = options.mode ?? 'auto';

  if (mode === 'timed-lines') return parseTimestampedSpeakerLines(lines);
  if (mode === 'captions') return parseCaptionTranscript(lines, options.defaultSpeaker);
  if (mode === 'untimed') return parseUntimedTranscript(rawText, options);

  const captionHits = lines.filter((line) => /^\s*\[\d{1,2}:\d{2}(?::\d{2})?\]/.test(line)).length;
  const speakerHits = lines.filter((line) => /^\s*\[?(\d{1,2}:\d{2}(?::\d{2})?)\]?\s+[^:]+:\s+/.test(line)).length;

  if (speakerHits > 0) return parseTimestampedSpeakerLines(lines);
  if (captionHits > 0) return parseCaptionTranscript(lines, options.defaultSpeaker);
  return parseUntimedTranscript(rawText, options);
}

export function createDocumentFromTranscript({ transcriptPath, rawText, title, mode = 'auto', defaultSpeaker, wordsPerMinute }) {
  const parsed = parseTranscript(rawText, { mode, defaultSpeaker, wordsPerMinute });
  const resolvedTitle = title || deriveTitleFromPath(transcriptPath);

  return {
    transcript: {
      title: resolvedTitle,
      source: transcriptPath,
      speakers: parsed.speakers,
      segments: parsed.segments,
    },
    concepts: {
      atomic: [],
      clustered: [],
    },
    relations: [],
    frames: {
      micro: parsed.segments.map((segment) => ({
        t: segment.start,
        span: { start: segment.start, end: segment.end },
        speakers: segment.speaker ? [segment.speaker] : [],
        foregroundConcepts: [],
        backgroundConcepts: [],
        activeRelations: [],
        summary: segment.text,
        sourceSegmentIds: [segment.id],
      })),
      meso: [],
      macro: [],
    },
    meta: {
      createdBy: 'mindgraph ingest transcript',
      transcriptFormat: parsed.format,
      wordsPerMinute: parsed.format === 'untimed-inferred' ? (wordsPerMinute ?? 150) : undefined,
      levels: ['micro', 'meso', 'macro'],
    },
  };
}
