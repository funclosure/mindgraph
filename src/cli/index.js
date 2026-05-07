#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import { spawn, exec } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createEmptyDocument, summarizeDocument, validateDocument } from '../core/schema.js';
import { createDocumentFromTranscript } from '../core/transcript.js';
import { buildTimelineFromTranscript } from '../core/build.js';
import { getConcept, getFrame, listConcepts, listFrames, mergeFrames, parseJsonValue, recomputeConceptStats, setFrameActivations, upsertConcept, upsertRelation } from '../core/document.js';

function printHelp() {
  console.log(`mindgraph v0.1.0

Usage:
  mindgraph --help
  mindgraph init <output-file>
  mindgraph validate <input-file>
  mindgraph inspect <input-file>
  mindgraph ingest transcript <transcript-file> -o <output-file> [--title <title>] [--mode auto|timed-lines|captions|untimed] [--speaker <name>] [--wpm <number>]
  mindgraph build timeline <transcript-file> -o <output-file> [--title <title>] [--mode auto|timed-lines|captions|untimed] [--speaker <name>] [--wpm <number>] [--meso-size <n>]
  mindgraph concept upsert <document-file> --id <id> --label <label> [--level atomic|clustered]
  mindgraph concept list <document-file> [--level atomic|clustered]
  mindgraph concept show <document-file> --id <id> [--level atomic|clustered]
  mindgraph relation upsert <document-file> --id <id> --from <concept-id> --to <concept-id> --type <type>
  mindgraph frame list <document-file> [--level micro|meso|macro] [--offset <n>] [--limit <n>]
  mindgraph frame show <document-file> --level micro|meso|macro --index <n>
  mindgraph frame set-activations <document-file> --level micro|meso|macro --index <n> [--foreground-json <json>] [--background-json <json>] [--relations-json <json>] [--summary <text>]
  mindgraph frame merge <document-file> --from micro|meso --to meso|macro --start-index <n> --end-index <n> [--summary <text>] [--title <text>]
  mindgraph stats recompute <document-file>
  mindgraph view [<document-file>] [--port <n>] [--host <h>]

Commands:
  init                   Create an empty starter mindgraph document
  validate               Validate a mindgraph JSON document
  inspect                Print a concise summary of a document
  ingest transcript      Parse a transcript into a starter document
  build timeline         Run a staged transcript→timeline pipeline shell
  concept upsert         Create or update a concept deterministically
  concept list/show      Inspect concepts without opening raw JSON
  relation upsert        Create or update a relation deterministically
  frame list/show        Inspect frames without opening raw JSON
  frame set-activations  Write weighted concept/relation activations to a frame
  frame merge            Merge lower-level frames into a higher-level frame
  stats recompute        Recompute concept recurrence and activation stats
  view                   Open the reading UI for a document in the browser

Transcript formats currently supported:
  [00:01:23] Speaker: text
  00:01:23 Speaker: text
  00:01:23 - text
  [00:01:23] caption line
next caption line
  untimed paragraph blocks (with inferred timing)
`);
}

function readJson(filePath) {
  const raw = fs.readFileSync(filePath, 'utf8');
  return JSON.parse(raw);
}

function writeJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(value, null, 2) + '\n', 'utf8');
}

function formatRange(range) {
  if (!range) return 'n/a';
  return `${range.start}s → ${range.end}s`;
}

function parseFlags(args) {
  const flags = {};
  for (let i = 0; i < args.length; i += 1) {
    const token = args[i];
    if (!token.startsWith('-')) continue;
    const next = args[i + 1];
    if (!next || next.startsWith('-')) {
      flags[token] = true;
    } else {
      flags[token] = next;
      i += 1;
    }
  }
  return flags;
}

function requireFlag(flags, ...names) {
  for (const name of names) {
    if (flags[name] != null) return flags[name];
  }
  return null;
}

function validateOrExit(doc, filePath) {
  const result = validateDocument(doc);
  if (!result.ok) {
    console.error(`Document became invalid: ${filePath}`);
    for (const error of result.errors) console.error(`- ${error}`);
    process.exit(1);
  }
}

const args = process.argv.slice(2);
const [command, subcommand, ...rest] = args;

if (!command || command === '--help' || command === '-h') {
  printHelp();
  process.exit(0);
}

if (command === 'init') {
  const outputFile = subcommand;
  if (!outputFile) {
    console.error('Missing output file path.');
    process.exit(1);
  }

  const doc = createEmptyDocument({
    meta: {
      createdBy: 'mindgraph init',
    },
  });

  writeJson(outputFile, doc);
  console.log(`Created starter document at ${outputFile}`);
  process.exit(0);
}

if (command === 'validate') {
  const inputFile = subcommand;
  if (!inputFile) {
    console.error('Missing input file path.');
    process.exit(1);
  }

  const doc = readJson(inputFile);
  const result = validateDocument(doc);
  if (result.ok) {
    console.log(`OK: ${inputFile} is a valid mindgraph document.`);
    process.exit(0);
  }

  console.error(`INVALID: ${inputFile}`);
  for (const error of result.errors) console.error(`- ${error}`);
  process.exit(1);
}

if (command === 'inspect') {
  const inputFile = subcommand;
  if (!inputFile) {
    console.error('Missing input file path.');
    process.exit(1);
  }

  const doc = readJson(inputFile);
  const result = validateDocument(doc);
  if (!result.ok) {
    console.error('Document is invalid; inspect aborted.');
    for (const error of result.errors) console.error(`- ${error}`);
    process.exit(1);
  }

  const summary = summarizeDocument(doc);
  console.log(`Title: ${summary.title}`);
  console.log(`Speakers: ${summary.speakers.join(', ') || 'n/a'}`);
  console.log(`Segments: ${summary.segmentCount}`);
  console.log(`Concepts (atomic): ${summary.conceptCounts.atomic}`);
  console.log(`Concepts (clustered): ${summary.conceptCounts.clustered}`);
  console.log(`Relations: ${summary.relationCount}`);
  console.log(`Frames (micro): ${summary.frameCounts.micro}`);
  console.log(`Frames (meso): ${summary.frameCounts.meso}`);
  console.log(`Frames (macro): ${summary.frameCounts.macro}`);
  console.log(`Range: ${formatRange(summary.timeRange)}`);
  process.exit(0);
}

if (command === 'build' && subcommand === 'timeline') {
  const [transcriptFile, ...flagArgs] = rest;
  if (!transcriptFile) {
    console.error('Missing transcript file path.');
    process.exit(1);
  }

  const flags = parseFlags(flagArgs);
  const outputFile = requireFlag(flags, '-o', '--output');
  const title = requireFlag(flags, '--title');
  const mode = requireFlag(flags, '--mode') ?? 'auto';
  const defaultSpeaker = requireFlag(flags, '--speaker');
  const wordsPerMinute = requireFlag(flags, '--wpm');
  const mesoSize = requireFlag(flags, '--meso-size');

  if (!outputFile) {
    console.error('Missing output file. Use -o <output-file>.');
    process.exit(1);
  }

  const rawText = fs.readFileSync(transcriptFile, 'utf8');
  const doc = buildTimelineFromTranscript({
    transcriptPath: transcriptFile,
    rawText,
    outputPath: outputFile,
    title,
    mode,
    defaultSpeaker,
    wordsPerMinute: wordsPerMinute ? Number(wordsPerMinute) : undefined,
    mesoSize: mesoSize ? Number(mesoSize) : undefined,
  });

  validateOrExit(doc, outputFile);
  writeJson(outputFile, doc);
  console.log(`Built staged timeline at ${outputFile}`);
  console.log(`Format: ${doc.meta.transcriptFormat}`);
  console.log(`Frames (micro): ${doc.frames.micro.length}`);
  console.log(`Frames (meso): ${doc.frames.meso.length}`);
  console.log('Next:');
  for (const cmd of doc.meta.build?.suggestedNextCommands ?? []) console.log(`  ${cmd}`);
  process.exit(0);
}

if (command === 'ingest' && subcommand === 'transcript') {
  const [transcriptFile, ...flagArgs] = rest;
  if (!transcriptFile) {
    console.error('Missing transcript file path.');
    process.exit(1);
  }

  const flags = parseFlags(flagArgs);
  const outputFile = requireFlag(flags, '-o', '--output');
  const title = requireFlag(flags, '--title');
  const mode = requireFlag(flags, '--mode') ?? 'auto';
  const defaultSpeaker = requireFlag(flags, '--speaker');
  const wordsPerMinute = requireFlag(flags, '--wpm');

  if (!outputFile) {
    console.error('Missing output file. Use -o <output-file>.');
    process.exit(1);
  }

  const rawText = fs.readFileSync(transcriptFile, 'utf8');
  const doc = createEmptyDocument(createDocumentFromTranscript({
    transcriptPath: transcriptFile,
    rawText,
    title,
    mode,
    defaultSpeaker,
    wordsPerMinute: wordsPerMinute ? Number(wordsPerMinute) : undefined,
  }));

  writeJson(outputFile, doc);
  console.log(`Ingested transcript into ${outputFile}`);
  console.log(`Format: ${doc.meta.transcriptFormat}`);
  console.log(`Segments: ${doc.transcript.segments.length}`);
  console.log(`Frames (micro): ${doc.frames.micro.length}`);
  process.exit(0);
}

if (command === 'concept' && subcommand === 'upsert') {
  const [documentFile, ...flagArgs] = rest;
  if (!documentFile) {
    console.error('Missing document file path.');
    process.exit(1);
  }

  const flags = parseFlags(flagArgs);
  const id = requireFlag(flags, '--id');
  const label = requireFlag(flags, '--label');
  const level = requireFlag(flags, '--level') ?? 'atomic';
  const description = requireFlag(flags, '--description');
  const aliasesJson = requireFlag(flags, '--aliases-json');
  const speakersJson = requireFlag(flags, '--speakers-json');
  const statsJson = requireFlag(flags, '--stats-json');
  const parentIdsJson = requireFlag(flags, '--parent-ids-json');
  const firstSeenAtRaw = requireFlag(flags, '--first-seen-at');

  const doc = readJson(documentFile);
  upsertConcept(doc, {
    level,
    id,
    label,
    description,
    aliases: aliasesJson ? parseJsonValue(aliasesJson, 'aliases JSON') : undefined,
    speakers: speakersJson ? parseJsonValue(speakersJson, 'speakers JSON') : undefined,
    stats: statsJson ? parseJsonValue(statsJson, 'stats JSON') : undefined,
    parentIds: parentIdsJson ? parseJsonValue(parentIdsJson, 'parentIds JSON') : undefined,
    firstSeenAt: firstSeenAtRaw != null ? Number(firstSeenAtRaw) : undefined,
  });
  validateOrExit(doc, documentFile);
  writeJson(documentFile, doc);
  console.log(`Upserted concept '${id}' in ${level} concepts.`);
  process.exit(0);
}

if (command === 'concept' && subcommand === 'list') {
  const [documentFile, ...flagArgs] = rest;
  if (!documentFile) {
    console.error('Missing document file path.');
    process.exit(1);
  }
  const flags = parseFlags(flagArgs);
  const level = requireFlag(flags, '--level') ?? 'atomic';
  const doc = readJson(documentFile);
  for (const concept of listConcepts(doc, { level })) {
    const stats = concept.stats ? ` recurs=${concept.stats.recurrenceCount} total=${concept.stats.totalActivation} peak=${concept.stats.peakActivation}` : '';
    console.log(`${concept.id}\t${concept.label}\tfirstSeen=${concept.firstSeenAt ?? 'n/a'}${stats}`);
  }
  process.exit(0);
}

if (command === 'concept' && subcommand === 'show') {
  const [documentFile, ...flagArgs] = rest;
  if (!documentFile) {
    console.error('Missing document file path.');
    process.exit(1);
  }
  const flags = parseFlags(flagArgs);
  const level = requireFlag(flags, '--level') ?? 'atomic';
  const id = requireFlag(flags, '--id');
  const doc = readJson(documentFile);
  console.log(JSON.stringify(getConcept(doc, { level, id }), null, 2));
  process.exit(0);
}

if (command === 'relation' && subcommand === 'upsert') {
  const [documentFile, ...flagArgs] = rest;
  if (!documentFile) {
    console.error('Missing document file path.');
    process.exit(1);
  }

  const flags = parseFlags(flagArgs);
  const id = requireFlag(flags, '--id');
  const from = requireFlag(flags, '--from');
  const to = requireFlag(flags, '--to');
  const type = requireFlag(flags, '--type');
  const label = requireFlag(flags, '--label');
  const description = requireFlag(flags, '--description');
  const metaJson = requireFlag(flags, '--meta-json');

  const doc = readJson(documentFile);
  upsertRelation(doc, {
    id,
    from,
    to,
    type,
    label,
    description,
    meta: metaJson ? parseJsonValue(metaJson, 'meta JSON') : undefined,
  });
  validateOrExit(doc, documentFile);
  writeJson(documentFile, doc);
  console.log(`Upserted relation '${id}'.`);
  process.exit(0);
}

if (command === 'frame' && subcommand === 'list') {
  const [documentFile, ...flagArgs] = rest;
  if (!documentFile) {
    console.error('Missing document file path.');
    process.exit(1);
  }
  const flags = parseFlags(flagArgs);
  const level = requireFlag(flags, '--level') ?? 'micro';
  const offset = Number(requireFlag(flags, '--offset') ?? 0);
  const limit = Number(requireFlag(flags, '--limit') ?? 10);
  const doc = readJson(documentFile);
  for (const frame of listFrames(doc, { level, offset, limit })) {
    const concepts = frame.foregroundConcepts.map((c) => `${c.id}:${c.weight}`).join(', ');
    console.log(`[${level}:${frame.index}] ${frame.span.start}-${frame.span.end}s${frame.title ? ` ${frame.title}` : ''}`);
    console.log(`  summary: ${frame.summary ?? ''}`);
    if (concepts) console.log(`  concepts: ${concepts}`);
  }
  process.exit(0);
}

if (command === 'frame' && subcommand === 'show') {
  const [documentFile, ...flagArgs] = rest;
  if (!documentFile) {
    console.error('Missing document file path.');
    process.exit(1);
  }
  const flags = parseFlags(flagArgs);
  const level = requireFlag(flags, '--level') ?? 'micro';
  const indexRaw = requireFlag(flags, '--index');
  if (indexRaw == null) {
    console.error('Missing --index for target frame.');
    process.exit(1);
  }
  const doc = readJson(documentFile);
  console.log(JSON.stringify(getFrame(doc, { level, index: Number(indexRaw) }), null, 2));
  process.exit(0);
}

if (command === 'frame' && subcommand === 'set-activations') {
  const [documentFile, ...flagArgs] = rest;
  if (!documentFile) {
    console.error('Missing document file path.');
    process.exit(1);
  }

  const flags = parseFlags(flagArgs);
  const level = requireFlag(flags, '--level') ?? 'micro';
  const indexRaw = requireFlag(flags, '--index');
  if (indexRaw == null) {
    console.error('Missing --index for target frame.');
    process.exit(1);
  }

  const doc = readJson(documentFile);
  setFrameActivations(doc, {
    level,
    index: Number(indexRaw),
    foregroundConcepts: requireFlag(flags, '--foreground-json') ? parseJsonValue(requireFlag(flags, '--foreground-json'), 'foreground JSON') : undefined,
    backgroundConcepts: requireFlag(flags, '--background-json') ? parseJsonValue(requireFlag(flags, '--background-json'), 'background JSON') : undefined,
    activeRelations: requireFlag(flags, '--relations-json') ? parseJsonValue(requireFlag(flags, '--relations-json'), 'relations JSON') : undefined,
    summary: requireFlag(flags, '--summary') ?? undefined,
  });
  validateOrExit(doc, documentFile);
  writeJson(documentFile, doc);
  console.log(`Updated activations for ${level}[${indexRaw}].`);
  process.exit(0);
}

if (command === 'frame' && subcommand === 'merge') {
  const [documentFile, ...flagArgs] = rest;
  if (!documentFile) {
    console.error('Missing document file path.');
    process.exit(1);
  }

  const flags = parseFlags(flagArgs);
  const fromLevel = requireFlag(flags, '--from') ?? 'micro';
  const toLevel = requireFlag(flags, '--to') ?? 'meso';
  const startIndexRaw = requireFlag(flags, '--start-index');
  const endIndexRaw = requireFlag(flags, '--end-index');
  if (startIndexRaw == null || endIndexRaw == null) {
    console.error('Missing --start-index or --end-index for frame merge.');
    process.exit(1);
  }

  const doc = readJson(documentFile);
  const mergedFrame = mergeFrames(doc, {
    fromLevel,
    toLevel,
    startIndex: Number(startIndexRaw),
    endIndex: Number(endIndexRaw),
    summary: requireFlag(flags, '--summary') ?? undefined,
    title: requireFlag(flags, '--title') ?? undefined,
  });
  validateOrExit(doc, documentFile);
  writeJson(documentFile, doc);
  console.log(`Merged ${fromLevel}[${startIndexRaw}..${endIndexRaw}] into ${toLevel} frame '${mergedFrame.id}'.`);
  process.exit(0);
}

if (command === 'stats' && subcommand === 'recompute') {
  const [documentFile] = rest;
  if (!documentFile) {
    console.error('Missing document file path.');
    process.exit(1);
  }

  const doc = readJson(documentFile);
  recomputeConceptStats(doc);
  validateOrExit(doc, documentFile);
  writeJson(documentFile, doc);
  console.log(`Recomputed concept stats in ${documentFile}.`);
  process.exit(0);
}

if (command === 'view') {
  // Positional arg: optional document file. Anything else is parsed as flags.
  let target;
  let flagArgs;
  if (subcommand && !subcommand.startsWith('-')) {
    target = subcommand;
    flagArgs = rest;
  } else {
    flagArgs = subcommand !== undefined ? [subcommand, ...rest] : rest;
  }
  const flags = parseFlags(flagArgs);
  const port = String(flags['--port'] ?? '4173');
  const host = String(flags['--host'] ?? '127.0.0.1');
  const url = `http://${host}:${port}`;

  const __filename = fileURLToPath(import.meta.url);
  const __dirname = path.dirname(__filename);
  const serverScript = path.resolve(__dirname, '..', 'ui', 'dev-server.js');

  const serverArgs = [serverScript, '--port', port, '--host', host];
  if (target) {
    const docPath = path.resolve(target);
    if (!fs.existsSync(docPath)) {
      console.error(`Document not found: ${docPath}`);
      process.exit(1);
    }
    serverArgs.push('--doc', docPath);
  }

  const child = spawn(process.execPath, serverArgs, { stdio: 'inherit' });

  // Open the browser shortly after the server binds.
  setTimeout(() => {
    const cmd =
      process.platform === 'darwin' ? `open ${JSON.stringify(url)}` :
      process.platform === 'win32' ? `start "" ${JSON.stringify(url)}` :
      `xdg-open ${JSON.stringify(url)}`;
    exec(cmd, (err) => {
      if (err) console.error(`(Could not auto-open browser; visit ${url} manually.)`);
    });
  }, 600);

  // Forward exit signals so Ctrl+C cleanly stops the dev server.
  for (const sig of ['SIGINT', 'SIGTERM']) {
    process.on(sig, () => { child.kill(sig); });
  }
  child.on('exit', (code) => process.exit(code ?? 0));
} else {
  console.error(`Unknown command: ${args.join(' ')}`);
  printHelp();
  process.exit(1);
}
