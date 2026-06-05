import fs from 'node:fs';
import path from 'node:path';

export function slugifySourceTitle(value) {
  const slug = String(value ?? '')
    .replace(/\.[^/.]+$/, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return slug || 'source';
}

export function classifySource(source) {
  const text = String(source ?? '');
  if (/^https?:\/\/(www\.)?(youtube\.com|youtu\.be)\//i.test(text)) return { kind: 'youtube', source: text };
  if (/^https?:\/\//i.test(text)) return { kind: 'web', source: text };
  return { kind: 'file', source: text };
}

function decodeHtmlEntities(text) {
  return String(text)
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

function extractTitle(html, fallback) {
  const h1 = html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i)?.[1];
  const title = h1 ?? html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] ?? fallback;
  return htmlToText(title).split('\n').map((line) => line.trim()).filter(Boolean)[0] ?? fallback;
}

export function htmlToText(html) {
  const withoutNoise = String(html)
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<nav[\s\S]*?<\/nav>/gi, ' ')
    .replace(/<header[\s\S]*?<\/header>/gi, ' ')
    .replace(/<footer[\s\S]*?<\/footer>/gi, ' ');
  const article = withoutNoise.match(/<article[^>]*>([\s\S]*?)<\/article>/i)?.[1] ?? withoutNoise;
  return decodeHtmlEntities(article)
    .replace(/<\/(h1|h2|h3|p|li|blockquote)>/gi, '\n')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n\s+/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

async function prepareWebSource({ source, workspaceDir, title }) {
  const response = await fetch(source, { headers: { 'user-agent': 'mindgraph-source-import/1.0' } });
  if (!response.ok) throw new Error(`Failed to fetch source: HTTP ${response.status} ${response.statusText}`);
  const html = await response.text();
  const resolvedTitle = title || extractTitle(html, new URL(source).hostname);
  const text = htmlToText(html);
  if (!text) throw new Error(`Fetched source did not contain readable text: ${source}`);
  const transcriptsDir = path.join(workspaceDir, 'transcripts');
  fs.mkdirSync(transcriptsDir, { recursive: true });
  const preparedPath = path.join(transcriptsDir, `${slugifySourceTitle(resolvedTitle)}.txt`);
  fs.writeFileSync(preparedPath, `${text}\n`, 'utf8');
  return {
    kind: 'web',
    supported: true,
    source,
    preparedPath,
    title: resolvedTitle,
    modeHint: 'untimed',
  };
}

export async function prepareSource({ source, workspaceDir = process.cwd(), title } = {}) {
  if (!source) throw new Error('Missing source.');
  const classification = classifySource(source);

  if (classification.kind === 'youtube') {
    return {
      kind: 'youtube',
      supported: false,
      source,
      title: title ?? source,
      reason: 'YouTube transcript import is not built into this slice.',
      recoveryHint: 'Use yt-dlp or YouTube UI to save a transcript, then provide a transcript file to mindgraph.',
    };
  }

  if (classification.kind === 'web') {
    return prepareWebSource({ source, workspaceDir, title });
  }

  const preparedPath = path.resolve(workspaceDir, source);
  if (!fs.existsSync(preparedPath)) throw new Error(`Source file not found: ${preparedPath}`);
  return {
    kind: 'file',
    supported: true,
    source,
    preparedPath,
    title: title || path.basename(preparedPath).replace(/\.[^/.]+$/, ''),
    modeHint: 'auto',
  };
}
