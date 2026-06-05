import { createEmptyDocument } from './schema.js';
import { createDocumentFromTranscript } from './transcript.js';
import { mergeFrames } from './document.js';

export function buildTimelineFromTranscript({
  transcriptPath,
  rawText,
  outputPath,
  title,
  mode = 'auto',
  defaultSpeaker,
  wordsPerMinute,
  mesoSize = 12,
}) {
  const doc = createEmptyDocument(createDocumentFromTranscript({
    transcriptPath,
    rawText,
    title,
    mode,
    defaultSpeaker,
    wordsPerMinute,
  }));

  if (Number.isInteger(mesoSize) && mesoSize >= 1) {
    for (let startIndex = 0; startIndex < doc.frames.micro.length; startIndex += mesoSize) {
      const endIndex = Math.min(startIndex + mesoSize - 1, doc.frames.micro.length - 1);
      mergeFrames(doc, {
        fromLevel: 'micro',
        toLevel: 'meso',
        startIndex,
        endIndex,
        title: `Meso Window ${doc.frames.meso.length + 1}`,
      });
    }
  }

  doc.meta.build = {
    mode: 'staged',
    outputPath,
    createdAt: new Date().toISOString(),
    stages: [
      {
        name: 'ingest',
        status: 'completed',
        notes: 'Transcript parsed into transcript.segments and frames.micro.',
      },
      {
        name: 'coarse-coalesce',
        status: doc.frames.meso.length > 0 ? 'completed' : 'skipped',
        notes: doc.frames.meso.length > 0
          ? `Generated ${doc.frames.meso.length} coarse meso windows from micro frames.`
          : 'No automatic meso windows generated.',
      },
      {
        name: 'concept-annotation',
        status: 'pending',
        notes: 'Use concept upsert, frame set-activations, and relation upsert to add semantic structure.',
      },
      {
        name: 'macro-structure',
        status: 'pending',
        notes: 'Merge meso windows into macro phases once semantic themes are clearer.',
      },
    ],
    suggestedNextCommands: [
      `mindgraph frame list ${outputPath} --level micro --offset 0 --limit 10`,
      `mindgraph frame list ${outputPath} --level meso --offset 0 --limit 10`,
      `mindgraph concept upsert ${outputPath} --id <concept-id> --label \"<Label>\"`,
      `mindgraph frame set-activations ${outputPath} --level micro --index <n> --foreground-json '[{"id":"<concept-id>","weight":0.9,"mode":"explicit"}]'`,
      `mindgraph stats recompute ${outputPath}`,
    ],
  };

  return doc;
}
