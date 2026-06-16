const DIRECTIVE_COLLECTIONS = {
  source: 'sources',
  block: 'blocks',
  step: 'steps',
  section: 'sections',
  concept: 'concepts',
  cluster: 'clusters',
  relation: 'relations',
  intake: 'intakes',
  revision: 'revisions',
};

const DIRECTIVE_FIELDS = {
  source: new Set(['type', 'title', 'path']),
  block: new Set(),
  step: new Set(['section', 'blocks', 'summary', 'focus', 'relations']),
  section: new Set(['title', 'summary', 'steps']),
  concept: new Set(['label', 'aliases', 'cluster', 'first_seen']),
  cluster: new Set(['label', 'children']),
  relation: new Set(['from', 'to', 'type', 'provenance', 'grounded_in', 'rationale']),
  intake: new Set(),
  revision: new Set(),
};

const SECTION_HEADING_RE = /^#\s+(Sources|Source Blocks|Reader Steps|Sections|Concepts|Relations|Intake|Revisions)\s*$/;

function parseScalar(value) {
  const trimmed = String(value ?? '').trim();
  if (/^-?\d+(\.\d+)?$/.test(trimmed)) return Number(trimmed);
  if (trimmed === 'true') return true;
  if (trimmed === 'false') return false;
  return trimmed;
}

function parseCsv(value) {
  return String(value ?? '')
    .split(',')
    .map((part) => part.trim())
    .filter(Boolean);
}

function parseFrontmatter(markdown) {
  if (!markdown.startsWith('---')) {
    throw new Error('Missing frontmatter.');
  }
  if (markdown[3] !== '\n' && markdown[3] !== '\r') {
    throw new Error('Missing frontmatter.');
  }

  const bodyStart = markdown[3] === '\r' ? 5 : 4;
  const end = markdown.indexOf('\n---', bodyStart);
  if (end === -1) throw new Error('Unclosed frontmatter.');

  const raw = markdown.slice(4, end).trim();
  const meta = {};
  for (const line of raw.split(/\r?\n/)) {
    if (!line.trim()) continue;
    const match = line.match(/^([A-Za-z0-9_-]+):\s*(.*)$/);
    if (!match) throw new Error(`Invalid frontmatter line: ${line}`);
    meta[match[1]] = parseScalar(match[2]);
  }

  return {
    meta,
    body: markdown.slice(end + 5).replace(/^\r?\n/, ''),
  };
}

function parseDirectiveHeader(line) {
  const match = line.match(/^@([A-Za-z0-9_-]+)(?:\s+([A-Za-z0-9_.:-]+))?(.*)$/);
  if (!match) return null;
  const [, type, id, rest] = match;
  const collection = DIRECTIVE_COLLECTIONS[type];
  if (!collection) throw new Error(`Unknown directive '@${type}'.`);

  const attrs = {};
  for (const token of rest.trim().split(/\s+/).filter(Boolean)) {
    const attr = token.match(/^([A-Za-z0-9_-]+)=(.+)$/);
    if (!attr) throw new Error(`Invalid directive attribute '${token}' on @${type}.`);
    attrs[attr[1]] = attr[2];
  }

  return { type, collection, id, attrs, fields: {}, bodyLines: [] };
}

function parseFocusItem(value) {
  const match = value.trim().match(/^(\S+)\s+(-?\d+(?:\.\d+)?)\s*(\S+)?$/);
  if (!match) {
    throw new Error(`Invalid focus item '${value}'. Expected: <id> <weight> [mode].`);
  }

  const [, id, weightText, mode] = match;
  const weight = Number(weightText);
  if (!Number.isFinite(weight)) {
    throw new Error(`Invalid focus item '${value}'. Weight must be a finite number.`);
  }

  return {
    id,
    weight,
    ...(mode ? { mode } : {}),
  };
}

function parseRelationItem(value) {
  const match = value.trim().match(/^(\S+)\s+->\s+(\S+)\s+(\S+)\s+(-?\d+(?:\.\d+)?)$/);
  if (!match) throw new Error(`Invalid relation activation item: ${value}`);
  return {
    from: match[1],
    to: match[2],
    type: match[3],
    weight: Number(match[4]),
  };
}

function parseList(lines, startIndex, itemParser) {
  const values = [];
  let i = startIndex;
  while (i < lines.length) {
    const line = lines[i];
    const match = line.match(/^\s+-\s+(.+)$/);
    if (!match) break;
    values.push(itemParser(match[1]));
    i += 1;
  }
  return { values, nextIndex: i };
}

function parseDirectiveFields(entry) {
  const fields = {};
  const bodyLines = [];
  const lines = entry.bodyLines;
  const allowedFields = DIRECTIVE_FIELDS[entry.type] ?? new Set();

  for (let i = 0; i < lines.length;) {
    const line = lines[i];
    const field = line.match(/^([A-Za-z0-9_-]+):\s*(.*)$/);

    if (!field || !allowedFields.has(field[1])) {
      bodyLines.push(line);
      i += 1;
      continue;
    }

    const [, key, rawValue] = field;
    if (rawValue === '' && (key === 'focus' || key === 'relations')) {
      const parsed = parseList(lines, i + 1, key === 'focus' ? parseFocusItem : parseRelationItem);
      fields[key] = parsed.values;
      i = parsed.nextIndex;
      continue;
    }

    if (key === 'steps' || key === 'children' || key === 'cluster' || key === 'aliases' || key === 'grounded_in') {
      fields[key] = parseCsv(rawValue);
    } else {
      fields[key] = parseScalar(rawValue);
    }

    i += 1;
  }

  return {
    fields,
    body: bodyLines.join('\n').trim(),
  };
}

export function parseAuthoringMarkdown(markdown, { filePath } = {}) {
  const { meta, body } = parseFrontmatter(markdown);

  const model = {
    filePath,
    meta,
    sources: [],
    blocks: [],
    steps: [],
    sections: [],
    concepts: [],
    clusters: [],
    relations: [],
    intakes: [],
    revisions: [],
  };

  let current = null;
  for (const line of body.split(/\r?\n/)) {
    if (SECTION_HEADING_RE.test(line)) {
      if (current) {
        const parsed = parseDirectiveFields(current);
        model[current.collection].push({ id: current.id, attrs: current.attrs, fields: parsed.fields, body: parsed.body });
        current = null;
      }
      continue;
    }
    if (!current && line.startsWith('#')) continue;
    if (line.startsWith('@')) {
      if (current) {
        const parsed = parseDirectiveFields(current);
        model[current.collection].push({ id: current.id, attrs: current.attrs, fields: parsed.fields, body: parsed.body });
      }
      current = parseDirectiveHeader(line);
      continue;
    }

    if (current) current.bodyLines.push(line);
  }

  if (current) {
    const parsed = parseDirectiveFields(current);
    model[current.collection].push({ id: current.id, attrs: current.attrs, fields: parsed.fields, body: parsed.body });
  }

  return model;
}
