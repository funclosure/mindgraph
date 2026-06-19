import path from 'node:path';
import { readSkill, loadSdk } from './agentSdk.js';
import { buildCrystallizeTask } from './crystallizeTask.js';

// Crystallize the conversation into a new discussion @source. Edits the .md in
// place; the handler compiles + QAs afterward. No question tool — the chat already
// happened.
export async function crystallizeRunner({ slug, conceptId, messages, emit }) {
  const { query } = await loadSdk();
  const mdDir = process.env.MINDGRAPH_MD_DIR || 'graphs';
  const mdPath = path.join(mdDir, `${slug}.mindgraph.md`);

  const systemPrompt = `${readSkill()}

---
You are the mindgraph "crystallize" agent. The reader has had a conversation about one concept and now wants to add what it surfaced to the graph. This is a scoped edit, NOT a re-digest.

PROTOCOL — author a NEW discussion @source woven into the same .mindgraph.md:
1. Optionally use WebSearch/WebFetch ONLY if the conversation relied on facts beyond the source; attribute them in the prose, never as the original source.
2. Add a NEW @source of "type: discussion" (no path), id "disc-<conceptId>-<short-suffix>", titled Deepen: <concept> (<angle>) — do NOT wrap the title in quotes.
3. Write @block(s) of clean, readable prose that SYNTHESISE the conversation (not raw turns) — enough text to ground the new concepts.
4. Derive 1-3 @concepts from the discussion. Each derived concept's label or an alias MUST appear verbatim in its discussion block (reading QA binds on this).
5. Add a @section + @step(s); the step's focus foregrounds the derived concepts (non-latent) AND includes the anchor "${conceptId}" as "latent" so cross-source relations validate.
6. Add cross-source @relations (inline in the step's relations:) from the derived concepts to "${conceptId}" and other clearly-related existing concepts, with real typed edges, grounded in the discussion blocks.
7. Edit ONLY ${mdPath}. Do not run compile/validate/qa, do not edit any other file, do not output the whole document. When done, stop.`;

  const task = buildCrystallizeTask({ conceptId, mdPath, messages });

  emit({ type: 'progress', message: `crystallising the conversation about "${conceptId}"` });

  const allowedTools = ['Read', 'Edit', 'Grep', 'Glob', 'WebSearch', 'WebFetch'];
  const conversation = query({
    prompt: task,
    options: {
      systemPrompt,
      model: process.env.MINDGRAPH_MODEL || 'claude-sonnet-4-6',
      allowedTools,
      canUseTool: async (toolName, input) => {
        if (allowedTools.includes(toolName)) return { behavior: 'allow', updatedInput: input };
        return { behavior: 'deny', message: `Tool ${toolName} is not permitted for crystallize.` };
      },
    },
  });

  for await (const message of conversation) {
    const content = message?.message?.content;
    if (!Array.isArray(content)) continue;
    for (const block of content) {
      if (block?.type === 'tool_use' && block.name) {
        const file = block.input?.file_path ? ` ${path.basename(block.input.file_path)}` : '';
        emit({ type: 'progress', message: `Claude: ${block.name}${file}` });
      } else if (block?.type === 'text' && block.text?.trim()) {
        emit({ type: 'progress', message: block.text.trim().slice(0, 140) });
      }
    }
  }

  emit({ type: 'progress', message: 'Claude finished editing' });
}
