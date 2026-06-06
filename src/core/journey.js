import fs from 'node:fs';
import path from 'node:path';
import { buildTimelineFromTranscript } from './build.js';
import { applyDigestPlan, evaluateDigest, evaluateUxReadiness } from './digest.js';
import { summarizeDocument, validateDocument } from './schema.js';
import { prepareSource } from './source.js';

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function writeJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

function ensureValidDocument(doc, documentPath) {
  const validation = validateDocument(doc);
  if (!validation.ok) {
    const error = new Error(`Invalid mindgraph document: ${documentPath}`);
    error.validation = validation;
    throw error;
  }
  return validation;
}

function toErrorResult(error) {
  return {
    ok: false,
    error: {
      message: error.message,
      validation: error.validation,
    },
  };
}

export async function prepareSourceOperation(input) {
  try {
    const source = await prepareSource(input);
    return { ok: source.supported !== false, source, error: source.supported === false ? { message: source.reason, recoveryHint: source.recoveryHint } : undefined };
  } catch (error) {
    return toErrorResult(error);
  }
}

export async function buildStarterDigestOperation({
  source,
  outputPath,
  workspaceDir = process.cwd(),
  title,
  mode,
  defaultSpeaker,
  wordsPerMinute,
  mesoSize,
} = {}) {
  try {
    if (!outputPath) throw new Error('Missing outputPath.');
    const prepared = await prepareSource({ source, workspaceDir, title });
    if (prepared.supported === false) {
      return { ok: false, source: prepared, error: { message: prepared.reason, recoveryHint: prepared.recoveryHint } };
    }
    const rawText = fs.readFileSync(prepared.preparedPath, 'utf8');
    const doc = buildTimelineFromTranscript({
      transcriptPath: prepared.preparedPath,
      rawText,
      outputPath,
      title: title ?? prepared.title,
      mode: mode ?? prepared.modeHint ?? 'auto',
      defaultSpeaker,
      wordsPerMinute,
      mesoSize,
    });
    doc.meta.journey = {
      kind: 'agent-operated-starter',
      source: prepared,
      createdAt: new Date().toISOString(),
      next: 'create-digest-plan',
    };
    ensureValidDocument(doc, outputPath);
    const ux = evaluateUxReadiness(doc);
    writeJson(outputPath, doc);
    return {
      ok: true,
      source: prepared,
      documentPath: outputPath,
      readiness: { ux },
      summary: summarizeDocument(doc),
      next: {
        agentAction: 'create-digest-plan',
        guidance: 'Read meso frames, create a DigestPlan with concepts, relations, activations, macro frames, then call digest apply and digest evaluate.',
      },
    };
  } catch (error) {
    return toErrorResult(error);
  }
}

export async function inspectDocumentOperation({ documentPath } = {}) {
  try {
    const doc = readJson(documentPath);
    const validation = ensureValidDocument(doc, documentPath);
    return { ok: true, documentPath, validation, summary: summarizeDocument(doc) };
  } catch (error) {
    return toErrorResult(error);
  }
}

export async function applyDigestPlanOperation({ documentPath, planPath, plan } = {}) {
  try {
    const doc = readJson(documentPath);
    const digestPlan = plan ?? readJson(planPath);
    const summary = applyDigestPlan(doc, digestPlan);
    ensureValidDocument(doc, documentPath);
    writeJson(documentPath, doc);
    return { ok: true, documentPath, summary };
  } catch (error) {
    return toErrorResult(error);
  }
}

export async function evaluateDigestOperation({ documentPath } = {}) {
  try {
    const doc = readJson(documentPath);
    ensureValidDocument(doc, documentPath);
    return { ok: true, documentPath, report: evaluateDigest(doc) };
  } catch (error) {
    return toErrorResult(error);
  }
}
