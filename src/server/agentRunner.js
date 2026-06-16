import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// The real deepen runner: drive the Claude Agent SDK to expand a concept's
// region of a source-first authoring file. The agent edits the .md in place
// (Read/Edit tools); the deepen handler reads and compiles it afterward, so
// this runner's only job is to make the edit happen and stream progress.
//
// This is the ONLY module that imports @anthropic-ai/claude-agent-sdk. It
// requires Claude credentials at runtime (ANTHROPIC_API_KEY or an active Claude
// subscription session). Without them the SDK call fails and the error is
// surfaced to the client by the deepen handler.

const SKILL_PATH = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../skills/mindgraph/SKILL.md',
);

function readSkill() {
  try {
    return readFileSync(SKILL_PATH, 'utf8');
  } catch {
    return 'You digest source material into a navigable source-first concept graph.';
  }
}

export async function agentRunner({ slug, conceptId, emit }) {
  let query;
  try {
    ({ query } = await import('@anthropic-ai/claude-agent-sdk'));
  } catch {
    throw new Error('Agent SDK not installed. Run: npm install @anthropic-ai/claude-agent-sdk');
  }

  const mdDir = process.env.MINDGRAPH_MD_DIR || 'graphs';
  const mdPath = path.join(mdDir, `${slug}.mindgraph.md`);

  const systemPrompt = `${readSkill()}

---
You are operating as the mindgraph "deepen" agent: a scoped, single-region edit, not a full re-digest.`;

  const task = `Deepen the concept "${conceptId}" in the source-first authoring file ${mdPath}.

1. Read ${mdPath} and the @source file it references.
2. Add 2-4 durable, source-grounded concepts and/or typed relations (and the reader-step focus entries needed to surface them) that expand "${conceptId}"'s region.
3. Obey the rules in your skill: no orphan concepts (bridge new nodes to the existing graph), and the focus/QA rules (every non-latent active concept's label or alias must appear verbatim in its step's blocks; every active relation's endpoints must both be in that step's focus list).
4. Edit ONLY ${mdPath}. Do not run any compile/validate/qa commands, do not create or edit any other file, and do not output the whole document — make a surgical edit with the Edit tool.

When the edit is complete, stop.`;

  emit({ type: 'progress', message: `asking Claude to deepen "${conceptId}"` });

  const conversation = query({
    prompt: task,
    options: {
      systemPrompt,
      model: process.env.MINDGRAPH_MODEL || 'claude-sonnet-4-6',
      permissionMode: 'bypassPermissions',
      allowDangerouslySkipPermissions: true,
      allowedTools: ['Read', 'Edit', 'Grep', 'Glob'],
    },
  });

  // Drain the agent's turn. The file edit is the side effect we depend on; we
  // parse messages defensively only to stream human-readable progress.
  for await (const message of conversation) {
    const content = message?.message?.content;
    if (!Array.isArray(content)) continue;
    for (const block of content) {
      if (block?.type === 'tool_use' && block.name) {
        const file = block.input?.file_path ? ` ${path.basename(block.input.file_path)}` : '';
        emit({ type: 'progress', message: `Claude: ${block.name}${file}` });
      } else if (block?.type === 'text' && block.text?.trim()) {
        emit({ type: 'progress', message: block.text.trim().slice(0, 100) });
      }
    }
  }

  emit({ type: 'progress', message: 'Claude finished editing' });
}
