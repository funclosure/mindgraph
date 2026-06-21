#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import { spawn, exec } from 'node:child_process';
import http from 'node:http';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { createEmptyDocument, summarizeDocument, validateDocument } from '../core/schema.js';
import { createDocumentFromTranscript } from '../core/transcript.js';
import { applyDigestPlan, evaluateDigest } from '../core/digest.js';
import { buildStarterDigestOperation, prepareSourceOperation } from '../core/journey.js';
import { buildTimelineFromTranscript } from '../core/build.js';
import { backfillFrameActivations, getConcept, getFrame, listConcepts, listFrames, mergeFrames, parseJsonValue, recomputeConceptStats, setFrameActivations, upsertConcept, upsertRelation } from '../core/document.js';
import { compileAuthoringMarkdown } from '../core/authoring/compile.js';
import { createAuthoringDraftFromText } from '../core/authoring/draft.js';
import { formatSourceFirstValidationErrors } from '../core/authoring/schema.js';
import { evaluateSourceFirstReading } from '../view-model/evaluateSourceFirstReading.js';
import { registry } from '../operations/index.js';

const pkg = createRequire(import.meta.url)('../../package.json');

// Turn any throw that escapes a command block (e.g. a missing/malformed input
// file) into one structured line instead of a raw Node stack trace.
process.on('uncaughtException', (error) => {
  console.error(`mindgraph: ${error?.message ?? String(error)}`);
  process.exit(1);
});

function printHelp() {
  console.log(`mindgraph v${pkg.version}

Usage:
  mindgraph --help
  mindgraph init <output-file>
  mindgraph validate <input-file>
  mindgraph inspect <input-file>
  mindgraph authoring validate <input-file.md> [--json]
  mindgraph authoring compile <input-file.md> -o <output-file.json> [--json]
  mindgraph authoring draft <input-file.txt> -o <output-file.md> [--title <title>] [--source-id <id>] [--compile <output-file.json>] [--json]
  mindgraph authoring qa <input-file.md> [--json]
  mindgraph source import <source> [--workspace <dir>] [--title <title>] [--json]
  mindgraph digest <source> [-o <output-file>] [--workspace <dir>] [--title <title>] [--mode auto|timed-lines|captions|untimed] [--speaker <name>] [--wpm <number>] [--meso-size <n>] [--json]
  mindgraph mcp [--workspace <dir>]
  mindgraph ingest transcript <transcript-file> [-o <output-file>] [--title <title>] [--mode auto|timed-lines|captions|untimed] [--speaker <name>] [--wpm <number>]
  mindgraph build timeline <transcript-file> [-o <output-file>] [--title <title>] [--mode auto|timed-lines|captions|untimed] [--speaker <name>] [--wpm <number>] [--meso-size <n>]
  mindgraph concept upsert <document-file> --id <id> --label <label> [--level atomic|clustered]
  mindgraph concept list <document-file> [--level atomic|clustered]
  mindgraph concept show <document-file> --id <id> [--level atomic|clustered]
  mindgraph relation upsert <document-file> --id <id> --from <concept-id> --to <concept-id> --type <type> [--provenance source|inferred]
  mindgraph frame list <document-file> [--level micro|meso|macro] [--offset <n>] [--limit <n>]
  mindgraph frame show <document-file> --level micro|meso|macro --index <n>
  mindgraph frame set-activations <document-file> --level micro|meso|macro --index <n> [--foreground-json <json>] [--background-json <json>] [--relations-json <json>] [--summary <text>]
  mindgraph frame merge <document-file> --from micro|meso --to meso|macro --start-index <n> --end-index <n> [--summary <text>] [--title <text>]
  mindgraph frame backfill-activations <document-file> --from meso|macro --to micro|meso
  mindgraph stats recompute <document-file>
  mindgraph digest apply <document-file> --plan <plan-file>
  mindgraph digest evaluate <document-file> [--json]
  mindgraph view [<document-file>] [--port <n>] [--host <h>]
  mindgraph open [<graph>] [--port <n>] [--host <h>] [--stub]

When -o is omitted from ingest/build, mindgraph defaults to ./graphs/<slug>.mindgraph.json
if a ./graphs/ directory exists in the current working directory.

Commands:
  init                   Create an empty starter mindgraph document
  validate               Validate a mindgraph JSON document
  inspect                Print a concise summary of a document
  authoring validate     Validate a source-first mindgraph Markdown authoring document
  authoring compile      Compile mindgraph Markdown authoring to source-first runtime JSON
  authoring draft        Draft editable source-first Markdown from a plain article/text file
  authoring qa           Check whether active digest concepts bind to source phrasing
  source import          Prepare a local file or readable web article for mindgraph ingestion
  digest                 High-level source→starter-document operation for agent-operated digestion
  mcp                    Start the mindgraph MCP server over stdio
  ingest transcript      Parse a transcript into a starter document
  build timeline         Run a staged transcript→timeline pipeline shell
  concept upsert         Create or update a concept deterministically
  concept list/show      Inspect concepts without opening raw JSON
  relation upsert        Create or update a relation deterministically (use --provenance inferred for common-knowledge connections the speaker assumed)
  frame list/show        Inspect frames without opening raw JSON
  frame set-activations  Write weighted concept/relation activations to a frame
  frame merge            Merge lower-level frames into a higher-level frame
  frame backfill-activations  Broadcast a coarser level's activations onto a finer level's frames
  stats recompute        Recompute concept recurrence and activation stats
  digest apply           Apply a batch digest plan: concepts, relations, activations, macro frames, ignored spans
  digest evaluate        Report digest quality signals: empty frames, unused concepts, inactive relations, top activations
  view                   Open the read-only reading UI for a document in the browser
  open / ask             Launch the live UI (with the Ask agent) and open the browser; defaults to the newest graphs/*.mindgraph.md

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

function exitWithOperationResult(result, { json = false, successText } = {}) {
  if (json) {
    console.log(JSON.stringify(result, null, 2));
  } else if (result.ok) {
    if (successText) console.log(successText(result));
  } else {
    console.error(result.error?.message ?? 'Operation failed.');
    if (result.error?.recoveryHint) console.error(result.error.recoveryHint);
  }
  process.exit(result.ok ? 0 : 1);
}

function formatWarnings(warnings = []) {
  if (!warnings.length) return '';
  return ['Warnings:', ...warnings.map((warning) => `  - ${warning.code}: ${warning.message}`)].join('\n');
}

function slugify(text) {
  return String(text)
    .replace(/\.[^/.]+$/, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

// Resolve where the produced .mindgraph.json should land.
//
// - Explicit -o always wins.
// - Otherwise, if ./graphs/ exists in cwd we default to ./graphs/<slug>.mindgraph.json,
//   where the slug comes from --title or the source filename.
// - Otherwise we return null and the caller errors with a hint.
//
// Returns { path, explicit } or null.
function resolveOutputPath({ explicit, transcriptFile, title, cwd }) {
  if (explicit) return { path: explicit, explicit: true };
  const slugSource = title || path.basename(transcriptFile || '');
  const slug = slugify(slugSource);
  if (!slug) return null;
  const graphsDir = path.join(cwd, 'graphs');
  let stat;
  try {
    stat = fs.statSync(graphsDir);
  } catch {
    return null;
  }
  if (!stat.isDirectory()) return null;
  return { path: path.join(graphsDir, `${slug}.mindgraph.json`), explicit: false };
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

  const document = readJson(inputFile);
  const result = registry.run('validate', { document });
  if (!result.ok) {
    for (const error of result.errors) console.error(`- ${error.message}`);
    process.exit(1);
  }
  if (result.value.valid) {
    console.log(`OK: ${inputFile} is a valid ${result.value.kind ?? 'mindgraph'} document.`);
    process.exit(0);
  }

  console.error(`INVALID: ${inputFile}`);
  for (const message of result.value.errors) console.error(`- ${message}`);
  process.exit(1);
}

if (command === 'inspect') {
  const inputFile = subcommand;
  if (!inputFile) {
    console.error('Missing input file path.');
    process.exit(1);
  }

  const document = readJson(inputFile);
  const result = registry.run('inspect', { document });
  if (!result.ok) {
    console.error('Document is invalid; inspect aborted.');
    for (const error of result.errors) console.error(`- ${error.message}`);
    process.exit(1);
  }

  const summary = result.value;
  if (summary.kind === 'mindgraph.source-first') {
    console.log(`Title: ${summary.title}`);
    console.log(`Kind: ${summary.kind}`);
    console.log(`Sources: ${summary.counts.sources}`);
    console.log(`Source blocks: ${summary.counts.sourceBlocks}`);
    console.log(`Reader steps: ${summary.counts.readerSteps}`);
    console.log(`Sections: ${summary.counts.sections}`);
    console.log(`Concepts (atomic): ${summary.counts.conceptsAtomic}`);
    console.log(`Concepts (clustered): ${summary.counts.conceptsClustered}`);
    console.log(`Relations: ${summary.counts.relations}`);
    process.exit(0);
  }

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

if (command === 'authoring' && subcommand === 'validate') {
  const [inputFile, ...flagArgs] = rest;
  if (!inputFile) {
    console.error('Missing input file path.');
    process.exit(1);
  }
  const flags = parseFlags(flagArgs);
  const markdown = fs.readFileSync(inputFile, 'utf8');
  const result = compileAuthoringMarkdown(markdown, { filePath: inputFile });
  if (flags['--json']) {
    console.log(JSON.stringify({ ok: result.validation.ok, validation: result.validation }, null, 2));
  } else if (result.validation.ok) {
    console.log(`OK: ${inputFile} is a valid mindgraph authoring document.`);
  } else {
    console.error(`INVALID: ${inputFile}`);
    console.error(formatSourceFirstValidationErrors(result.validation));
  }
  process.exit(result.validation.ok ? 0 : 1);
}

if (command === 'authoring' && subcommand === 'compile') {
  const [inputFile, ...flagArgs] = rest;
  if (!inputFile) {
    console.error('Missing input file path.');
    process.exit(1);
  }
  const flags = parseFlags(flagArgs);
  const outputFile = requireFlag(flags, '-o', '--output');
  if (!outputFile) {
    console.error('Missing -o <output-file.json>.');
    process.exit(1);
  }
  const markdown = fs.readFileSync(inputFile, 'utf8');
  const result = compileAuthoringMarkdown(markdown, { filePath: inputFile });
  if (!result.validation.ok) {
    if (flags['--json']) console.log(JSON.stringify({ ok: false, validation: result.validation }, null, 2));
    else {
      console.error(`INVALID: ${inputFile}`);
      console.error(formatSourceFirstValidationErrors(result.validation));
    }
    process.exit(1);
  }
  writeJson(outputFile, result.document);
  if (flags['--json']) console.log(JSON.stringify({ ok: true, inputFile, outputFile, validation: result.validation }, null, 2));
  else console.log(`Compiled ${inputFile} to ${outputFile}`);
  process.exit(0);
}

if (command === 'authoring' && subcommand === 'qa') {
  const [inputFile, ...flagArgs] = rest;
  if (!inputFile) {
    console.error('Missing input file path.');
    process.exit(1);
  }
  const flags = parseFlags(flagArgs);
  const markdown = fs.readFileSync(inputFile, 'utf8');
  const result = compileAuthoringMarkdown(markdown, { filePath: inputFile });
  if (!result.validation.ok) {
    if (flags['--json']) console.log(JSON.stringify({ ok: false, validation: result.validation }, null, 2));
    else {
      console.error(`INVALID: ${inputFile}`);
      console.error(formatSourceFirstValidationErrors(result.validation));
    }
    process.exit(1);
  }

  const report = evaluateSourceFirstReading(result.document);
  if (flags['--json']) {
    console.log(JSON.stringify({ ok: report.ok, inputFile, report }, null, 2));
  } else {
    console.log(`Source-first reading QA: ${report.ok ? 'OK' : 'NEEDS REPAIR'}`);
    console.log(`Focus binding: ${report.boundFocusActivations}/${report.totalFocusActivations} (${Math.round(report.focusBindingRate * 100)}%)`);
    if (report.unboundFocus.length) {
      console.log('Unbound active concepts:');
      for (const gap of report.unboundFocus) {
        console.log(`- ${gap.stepId} ${gap.label} (${gap.conceptId}) in ${gap.sectionTitle}`);
      }
    }
  }
  process.exit(report.ok ? 0 : 1);
}

if (command === 'authoring' && subcommand === 'draft') {
  const [inputFile, ...flagArgs] = rest;
  if (!inputFile) {
    console.error('Missing input file path.');
    process.exit(1);
  }
  const flags = parseFlags(flagArgs);
  const outputFile = requireFlag(flags, '-o', '--output');
  if (!outputFile) {
    console.error('Missing -o <output-file.md>.');
    process.exit(1);
  }

  const compileOutputFile = requireFlag(flags, '--compile');
  // Default the runtime pointer to the compiled JSON sibling of the -o markdown
  // path (e.g. foo.mindgraph.md -> foo.mindgraph.json), not a slug of the title.
  // An explicit --compile target wins.
  const runtimeBase = path.basename(outputFile);
  const runtime = compileOutputFile
    ? path.basename(compileOutputFile)
    : /\.md$/i.test(runtimeBase)
      ? runtimeBase.replace(/\.md$/i, '.json')
      : `${runtimeBase}.mindgraph.json`;
  const text = fs.readFileSync(inputFile, 'utf8');
  let draft;
  try {
    draft = createAuthoringDraftFromText(text, {
      title: requireFlag(flags, '--title'),
      sourceId: requireFlag(flags, '--source-id'),
      sourcePath: inputFile,
      runtime,
    });
  } catch (error) {
    if (flags['--json']) console.log(JSON.stringify({ ok: false, error: { message: error.message } }, null, 2));
    else console.error(error.message);
    process.exit(1);
  }

  if (!draft.validation.ok) {
    if (flags['--json']) console.log(JSON.stringify({ ok: false, validation: draft.validation }, null, 2));
    else {
      console.error(`INVALID DRAFT: ${inputFile}`);
      console.error(formatSourceFirstValidationErrors(draft.validation));
    }
    process.exit(1);
  }

  fs.mkdirSync(path.dirname(outputFile), { recursive: true });
  fs.writeFileSync(outputFile, draft.markdown, 'utf8');
  if (compileOutputFile) writeJson(compileOutputFile, draft.document);

  if (flags['--json']) {
    console.log(JSON.stringify({
      ok: true,
      inputFile,
      outputFile,
      ...(compileOutputFile ? { compiledFile: compileOutputFile } : {}),
      validation: draft.validation,
    }, null, 2));
  } else {
    console.log(`Drafted ${inputFile} to ${outputFile}`);
    if (compileOutputFile) console.log(`Compiled ${outputFile} to ${compileOutputFile}`);
  }
  process.exit(0);
}

if (command === 'source' && subcommand === 'import') {
  const [source, ...flagArgs] = rest;
  if (!source) {
    console.error('Missing source.');
    process.exit(1);
  }
  const flags = parseFlags(flagArgs);
  const result = await prepareSourceOperation({
    source,
    workspaceDir: requireFlag(flags, '--workspace') ?? process.cwd(),
    title: requireFlag(flags, '--title'),
  });
  exitWithOperationResult(result, {
    json: Boolean(flags['--json']),
    successText: (value) => {
      if (value.source.supported === false) return `${value.source.reason}\n${value.source.recoveryHint}`;
      return `Prepared ${value.source.kind} source at ${value.source.preparedPath}`;
    },
  });
}

if (command === 'digest' && subcommand && subcommand !== 'apply' && subcommand !== 'evaluate') {
  const source = subcommand;
  const flagArgs = rest;
  const flags = parseFlags(flagArgs);
  const explicitOutput = requireFlag(flags, '-o', '--output');
  const title = requireFlag(flags, '--title');
  const workspaceDir = requireFlag(flags, '--workspace') ?? process.cwd();
  const resolved = resolveOutputPath({
    explicit: explicitOutput,
    transcriptFile: source,
    title,
    cwd: workspaceDir,
  });
  if (!resolved) {
    console.error('Missing output file. Pass -o <output-file>, or run from a workspace containing ./graphs/.');
    process.exit(1);
  }
  if (!resolved.explicit && fs.existsSync(resolved.path)) {
    console.error(`Output already exists: ${resolved.path}`);
    console.error('Pass -o <output-file> explicitly to overwrite, or choose a different name.');
    process.exit(1);
  }

  const result = await buildStarterDigestOperation({
    source,
    outputPath: resolved.path,
    workspaceDir,
    title,
    mode: requireFlag(flags, '--mode'),
    defaultSpeaker: requireFlag(flags, '--speaker'),
    wordsPerMinute: requireFlag(flags, '--wpm') ? Number(requireFlag(flags, '--wpm')) : undefined,
    mesoSize: requireFlag(flags, '--meso-size') ? Number(requireFlag(flags, '--meso-size')) : undefined,
  });
  exitWithOperationResult(result, {
    json: Boolean(flags['--json']),
    successText: (value) => [
      `Built starter digest at ${value.documentPath}`,
      `Source: ${value.source.kind} (${value.source.preparedPath})`,
      `Frames: ${value.summary.frameCounts.micro} micro, ${value.summary.frameCounts.meso} meso`,
      formatWarnings(value.readiness?.ux?.warnings),
      'Next: create a DigestPlan, then run mindgraph digest apply <document> --plan <plan-file>',
    ].filter(Boolean).join('\n'),
  });
}

if (command === 'build' && subcommand === 'timeline') {
  const [transcriptFile, ...flagArgs] = rest;
  if (!transcriptFile) {
    console.error('Missing transcript file path.');
    process.exit(1);
  }

  const flags = parseFlags(flagArgs);
  const explicitOutput = requireFlag(flags, '-o', '--output');
  const title = requireFlag(flags, '--title');
  const mode = requireFlag(flags, '--mode') ?? 'auto';
  const defaultSpeaker = requireFlag(flags, '--speaker');
  const wordsPerMinute = requireFlag(flags, '--wpm');
  const mesoSize = requireFlag(flags, '--meso-size');

  const resolved = resolveOutputPath({
    explicit: explicitOutput,
    transcriptFile,
    title,
    cwd: process.cwd(),
  });
  if (!resolved) {
    console.error('Missing output file. Pass -o <output-file>, or run from a workspace containing ./graphs/.');
    process.exit(1);
  }
  const outputFile = resolved.path;
  if (!resolved.explicit && fs.existsSync(outputFile)) {
    console.error(`Output already exists: ${outputFile}`);
    console.error('Pass -o <output-file> explicitly to overwrite, or choose a different name.');
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
  const explicitOutput = requireFlag(flags, '-o', '--output');
  const title = requireFlag(flags, '--title');
  const mode = requireFlag(flags, '--mode') ?? 'auto';
  const defaultSpeaker = requireFlag(flags, '--speaker');
  const wordsPerMinute = requireFlag(flags, '--wpm');

  const resolved = resolveOutputPath({
    explicit: explicitOutput,
    transcriptFile,
    title,
    cwd: process.cwd(),
  });
  if (!resolved) {
    console.error('Missing output file. Pass -o <output-file>, or run from a workspace containing ./graphs/.');
    process.exit(1);
  }
  const outputFile = resolved.path;
  if (!resolved.explicit && fs.existsSync(outputFile)) {
    console.error(`Output already exists: ${outputFile}`);
    console.error('Pass -o <output-file> explicitly to overwrite, or choose a different name.');
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
  const provenance = requireFlag(flags, '--provenance');

  const doc = readJson(documentFile);
  upsertRelation(doc, {
    id,
    from,
    to,
    type,
    label,
    description,
    meta: metaJson ? parseJsonValue(metaJson, 'meta JSON') : undefined,
    provenance,
  });
  validateOrExit(doc, documentFile);
  writeJson(documentFile, doc);
  console.log(`Upserted relation '${id}'${provenance === 'inferred' ? ' (inferred)' : ''}.`);
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

if (command === 'frame' && subcommand === 'backfill-activations') {
  const [documentFile, ...flagArgs] = rest;
  if (!documentFile) {
    console.error('Missing document file path.');
    process.exit(1);
  }

  const flags = parseFlags(flagArgs);
  const fromLevel = requireFlag(flags, '--from') ?? 'meso';
  const toLevel = requireFlag(flags, '--to') ?? 'micro';

  const doc = readJson(documentFile);
  const result = backfillFrameActivations(doc, { fromLevel, toLevel });
  validateOrExit(doc, documentFile);
  writeJson(documentFile, doc);
  console.log(`Backfilled activations from ${fromLevel} to ${toLevel}: updated ${result.updated} of ${result.total} ${toLevel} frames.`);
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

if (command === 'digest' && subcommand === 'apply') {
  const [documentFile, ...flagArgs] = rest;
  if (!documentFile) {
    console.error('Missing document file path.');
    process.exit(1);
  }
  const flags = parseFlags(flagArgs);
  const planFile = requireFlag(flags, '--plan');
  if (!planFile) {
    console.error('Missing --plan <plan-file>.');
    process.exit(1);
  }

  const doc = readJson(documentFile);
  const plan = readJson(planFile);
  const summary = applyDigestPlan(doc, plan);
  validateOrExit(doc, documentFile);
  writeJson(documentFile, doc);
  console.log(`Applied digest plan to ${documentFile}.`);
  console.log(JSON.stringify(summary, null, 2));
  process.exit(0);
}

function printDigestEvaluation(report) {
  console.log('Digest evaluation');
  console.log(`  Concepts: ${report.counts.atomicConcepts} atomic, ${report.counts.clusteredConcepts} clustered`);
  console.log(`  Relations: ${report.counts.relations}`);
  console.log(`  Frames: ${report.counts.microFrames} micro, ${report.counts.mesoFrames} meso, ${report.counts.macroFrames} macro`);
  console.log(`  UX readiness: ${report.ux?.status ?? 'unknown'}`);
  for (const warning of report.ux?.warnings ?? []) console.log(`    - ${warning.code}: ${warning.message}`);
  console.log(`  Ignored spans: ${report.ignoredSpans.length}`);
  console.log(`  Ignored meso frames: ${report.ignoredMesoFrameIndexes.length ? report.ignoredMesoFrameIndexes.join(', ') : 'none'}`);
  console.log(`  Empty non-ignored meso frames: ${report.emptyMesoFrameIndexes.length ? report.emptyMesoFrameIndexes.join(', ') : 'none'}`);
  console.log(`  Unused concepts: ${report.unusedConceptIds.length ? report.unusedConceptIds.join(', ') : 'none'}`);
  console.log(`  Inactive relations: ${report.inactiveRelationIds.length ? report.inactiveRelationIds.join(', ') : 'none'}`);
  console.log('  Grounding:');
  console.log(`    Source concepts without grounding: ${report.grounding.sourceConceptsWithoutGrounding.length ? report.grounding.sourceConceptsWithoutGrounding.join(', ') : 'none'}`);
  console.log(`    Source relations without grounding: ${report.grounding.sourceRelationsWithoutGrounding.length ? report.grounding.sourceRelationsWithoutGrounding.join(', ') : 'none'}`);
  console.log(`    Inferred relations: ${report.grounding.inferredRelationIds.length ? `${report.grounding.inferredRelationIds.length} (${Math.round(report.grounding.inferredRelationRatio * 100)}%) ${report.grounding.inferredRelationIds.join(', ')}` : 'none'}`);
  console.log(`    Inferred without rationale: ${report.grounding.inferredRelationsWithoutRationale.length ? report.grounding.inferredRelationsWithoutRationale.join(', ') : 'none'}`);
  console.log(`    Inferred without validation status: ${report.grounding.inferredRelationsWithoutValidationStatus.length ? report.grounding.inferredRelationsWithoutValidationStatus.join(', ') : 'none'}`);
  console.log(`    Inferred needing validation: ${report.grounding.inferredRelationsNeedingValidation.length ? report.grounding.inferredRelationsNeedingValidation.join(', ') : 'none'}`);
  console.log(`    Web-validated inferred missing sources: ${report.grounding.webValidatedInferredRelationsMissingSources.length ? report.grounding.webValidatedInferredRelationsMissingSources.join(', ') : 'none'}`);
  console.log(`    Inferred active in frames: ${report.grounding.inferredRelationsActiveInFrames.length ? report.grounding.inferredRelationsActiveInFrames.join(', ') : 'none'}`);
  console.log('  Top concepts:');
  for (const concept of report.topConcepts.slice(0, 10)) {
    console.log(`    ${concept.id} (${concept.recurrenceCount}×, total=${concept.totalActivation}, peak=${concept.peakActivation})`);
  }
}

if (command === 'digest' && subcommand === 'evaluate') {
  const [documentFile, ...flagArgs] = rest;
  if (!documentFile) {
    console.error('Missing document file path.');
    process.exit(1);
  }
  const flags = parseFlags(flagArgs);
  const doc = readJson(documentFile);
  const report = evaluateDigest(doc);
  if (flags['--json']) console.log(JSON.stringify(report, null, 2));
  else printDigestEvaluation(report);
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
} else if (command === 'open' || command === 'ask') {
  // Launch the live UI (with the Ask agent) and open the browser. Defaults to the
  // most recently edited graphs/*.mindgraph.md; pass a name fragment or a path to
  // pick a specific graph. `--stub` uses the no-API stub runners.
  let target;
  let flagArgs;
  if (subcommand && !subcommand.startsWith('-')) { target = subcommand; flagArgs = rest; }
  else { flagArgs = subcommand !== undefined ? [subcommand, ...rest] : rest; }
  const flags = parseFlags(flagArgs);
  const stub = flagArgs.includes('--stub');
  const port = String(flags['--port'] ?? '4173');
  const host = String(flags['--host'] ?? '127.0.0.1');
  const url = `http://${host}:${port}`;

  const __filename = fileURLToPath(import.meta.url);
  const __dirname = path.dirname(__filename);
  const serverScript = path.resolve(__dirname, '..', 'server', 'index.js');
  const graphsDir = path.resolve(process.cwd(), 'graphs');

  const listGraphs = () => {
    try {
      return fs.readdirSync(graphsDir)
        .filter((f) => f.endsWith('.mindgraph.md'))
        .map((f) => path.join(graphsDir, f));
    } catch {
      return [];
    }
  };

  let docPath;
  if (target) {
    if (fs.existsSync(target)) {
      docPath = path.resolve(target);
    } else {
      const match = listGraphs().find((f) => path.basename(f).includes(target));
      if (!match) { console.error(`No graph matching "${target}" in graphs/.`); process.exit(1); }
      docPath = match;
    }
  } else {
    const graphs = listGraphs().sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs);
    if (!graphs.length) { console.error('No graphs/*.mindgraph.md found. Pass a file: mindgraph open <path>'); process.exit(1); }
    docPath = graphs[0];
  }

  const openBrowser = (delay) => setTimeout(() => {
    const cmd =
      process.platform === 'darwin' ? `open ${JSON.stringify(url)}` :
      process.platform === 'win32' ? `start "" ${JSON.stringify(url)}` :
      `xdg-open ${JSON.stringify(url)}`;
    exec(cmd, (err) => {
      if (err) console.error(`(Could not auto-open browser; visit ${url} manually.)`);
    });
  }, delay);

  // Ask an already-running server which document it's serving. Returns null if
  // nothing answers on the port (so we know it's free to bind).
  const probeHealth = (baseUrl) => new Promise((resolve) => {
    const req = http.get(`${baseUrl}/health`, { timeout: 700 }, (res) => {
      if (res.statusCode !== 200) { res.resume(); resolve(null); return; }
      let body = '';
      res.on('data', (c) => { body += c; });
      res.on('end', () => { try { resolve(JSON.parse(body)); } catch { resolve(null); } });
    });
    req.on('error', () => resolve(null));
    req.on('timeout', () => { req.destroy(); resolve(null); });
  });

  const existing = await probeHealth(url);
  if (existing?.ok && existing.doc && path.resolve(existing.doc) === docPath) {
    // Same graph already live on this port — reuse it instead of crashing on
    // EADDRINUSE. Just point the browser at it.
    console.log(`mindgraph: reusing the server already running at ${url} (serving ${existing.slug}).`);
    openBrowser(0);
  } else if (existing?.ok) {
    // A different graph holds the port; don't silently open the wrong one.
    console.error(`mindgraph: ${url} is already serving a different graph ("${existing.slug}").`);
    console.error(`  Stop it with \`lsof -ti tcp:${port} | xargs kill\`, or open this one elsewhere: mindgraph open${target ? ` ${target}` : ''} --port <n>.`);
    process.exit(1);
  } else {
    console.log(`mindgraph: ${path.relative(process.cwd(), docPath)}  →  ${url}${stub ? '  (stub — no API)' : ''}`);
    console.log('  (Ctrl-C to stop)');

    const env = { ...process.env };
    if (stub) env.MINDGRAPH_STUB_DEEPEN = '1';
    const child = spawn(process.execPath, [serverScript, '--doc', docPath, '--port', port, '--host', host], { stdio: 'inherit', env });

    openBrowser(800);

    for (const sig of ['SIGINT', 'SIGTERM']) {
      process.on(sig, () => { child.kill(sig); });
    }
    child.on('exit', (code) => process.exit(code ?? 0));
  }
} else if (command === 'mcp') {
  const __filename = fileURLToPath(import.meta.url);
  const __dirname = path.dirname(__filename);
  const serverScript = path.resolve(__dirname, '..', 'mcp', 'server.js');
  const child = spawn(process.execPath, [serverScript, ...args.slice(1)], { stdio: 'inherit' });
  child.on('exit', (code) => process.exit(code ?? 0));
} else {
  console.error(`Unknown command: ${args.join(' ')}`);
  printHelp();
  process.exit(1);
}
