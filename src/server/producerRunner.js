// ---------------------------------------------------------------------------
// producerRunner — the real one-command "author" agent. Given a drafted
// scaffold .mindgraph.md and the source text, it authors the full semantic
// graph in place, following the mindgraph skill's digest protocol. Modeled on
// crystallizeRunner; credential-gated (loadSdk throws if the SDK is absent).
// ---------------------------------------------------------------------------

import { readSkill, loadSdk } from './agentSdk.js';

export async function producerRunner({ mdPath, sourceText, title, onProgress = () => {} }) {
  const { query } = await loadSdk();

  const systemPrompt = `${readSkill()}

---
You are the mindgraph "author" agent. You are digesting a source into a NEW
source-first graph from a heuristic scaffold. Follow the skill's semantic digest
protocol: thesis → segments → claims → concepts → relations → connectivity →
reader steps → binding.

PROTOCOL:
1. Read the scaffold at ${mdPath}. It is structural only — replace its placeholder
   concepts/relations with real semantic structure grounded in the source.
2. Every non-latent focus concept's label or an alias MUST appear verbatim in a
   block it is bound to (reading QA binds on this).
3. Relations must have real typed edges with both endpoints present in the step
   focus, grounded in blocks (provenance: source) or marked inferred with a rationale.
4. Edit ONLY ${mdPath}. Do not run compile/validate/qa and do not edit other files.
   When the .mindgraph.md is a complete, faithful digest, stop.`;

  const task = `Author a complete source-first mindgraph in ${mdPath} for "${title ?? 'this source'}".
The source text is below. Digest it faithfully per the protocol, then stop.

<source>
${sourceText ?? ''}
</source>`;

  onProgress(`authoring the graph for "${title ?? 'source'}" (this can take a minute)`);

  const allowedTools = ['Read', 'Edit', 'Grep', 'Glob', 'WebSearch', 'WebFetch'];
  const conversation = query({
    prompt: task,
    options: {
      systemPrompt,
      model: process.env.MINDGRAPH_MODEL || 'claude-sonnet-4-6',
      allowedTools,
      canUseTool: async (toolName, input) => {
        if (allowedTools.includes(toolName)) return { behavior: 'allow', updatedInput: input };
        return { behavior: 'deny', message: `Tool ${toolName} is not permitted for author.` };
      },
    },
  });

  for await (const message of conversation) {
    if (message?.type === 'assistant') {
      for (const block of message.message?.content ?? []) {
        if (block.type === 'tool_use') onProgress(`· ${block.name}`);
      }
    }
  }
}
