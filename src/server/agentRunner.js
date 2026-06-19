import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';

const SKILL_PATH = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../skills/mindgraph/SKILL.md',
);

function readSkill() {
  try { return readFileSync(SKILL_PATH, 'utf8'); }
  catch { return 'You digest source material into a navigable source-first concept graph.'; }
}

// Human answers can take a while; the SDK closes slow MCP tool calls at 60s by
// default. Give the reader room to think.
process.env.CLAUDE_CODE_STREAM_CLOSE_TIMEOUT ||= '600000';

export async function agentRunner({ slug, conceptId, prompt, emit, askQuestions }) {
  let query, tool, createSdkMcpServer;
  try {
    ({ query, tool, createSdkMcpServer } = await import('@anthropic-ai/claude-agent-sdk'));
  } catch {
    throw new Error('Agent SDK not installed. Run: npm install @anthropic-ai/claude-agent-sdk');
  }

  const mdDir = process.env.MINDGRAPH_MD_DIR || 'graphs';
  const mdPath = path.join(mdDir, `${slug}.mindgraph.md`);

  // The clarification tool. Its handler emits a question event (via askQuestions)
  // and blocks until the client posts an answer through the question channel.
  const askTool = tool(
    'ask_user_questions',
    'Ask the reader 1-2 structured clarifying questions when their intent is ambiguous. ONLY call this when you genuinely cannot tell which aspect of the concept to deepen. If the steer is already clear, skip it and proceed.',
    {
      questions: z.array(z.object({
        header: z.string().describe('Short chip label, max ~12 chars'),
        question: z.string(),
        options: z.array(z.object({ label: z.string(), description: z.string() })).min(2).max(4),
        multiSelect: z.boolean().optional(),
      })).min(1).max(2),
    },
    async (args) => {
      const answers = await askQuestions(args.questions);
      const text = (answers ?? [])
        .map((a) => `${a.header}: ${(a.values ?? []).join(', ') || '(no preference)'}`)
        .join('\n');
      return { content: [{ type: 'text', text: text || '(the reader skipped the questions)' }] };
    },
  );

  const questionServer = createSdkMcpServer({
    name: 'deepen-questions',
    version: '1.0.0',
    tools: [askTool],
  });

  const ASK_TOOL = 'mcp__deepen-questions__ask_user_questions';
  const allowedTools = ['Read', 'Edit', 'Grep', 'Glob', 'WebSearch', 'WebFetch', ASK_TOOL];

  const systemPrompt = `${readSkill()}

---
You are operating as the mindgraph "deepen" agent. A reader anchored on one concept wants to explore it further. This is a scoped, conversational edit — NOT a full re-digest.

PROTOCOL — the outcome of a deepen is a new discussion @source woven into the same .mindgraph.md:
1. If the reader's intent is ambiguous, call ask_user_questions ONCE with 1-2 crisp questions (2-4 options each). If their steer is already clear, skip it.
2. Optionally use WebSearch/WebFetch ONLY when the reader's ask goes beyond the existing source material. When you use the web, say so in the discussion prose and attribute it; never present web facts as if the original essay stated them.
3. Author a NEW @source of "type: discussion" (a discussion needs no path), id "disc-<conceptId>-<short-suffix>", titled Deepen: <concept> (<angle>) — do NOT wrap the title in quotes.
4. Under it, write @block(s) of clean, readable prose that SYNTHESISE the exchange (not raw chat turns) — enough text to ground the new concepts.
5. Derive 1-3 @concepts FROM that discussion. Each derived concept's label or an alias MUST appear verbatim in its discussion block (reading QA binds on this).
6. Add a @section + @step(s) for the discussion source. In the step's focus, foreground the derived concepts (non-latent) AND include the anchor concept "${conceptId}" as "latent" (low weight) so cross-source relations validate without needing the anchor's label in the discussion text.
7. Add cross-source @relations (inline in the step's relations:) from the derived concepts to "${conceptId}" and any other clearly-related essay concepts. Use real typed edges (accelerates, enables, constrains, reframes, threatens, mitigates, depends_on, contrasts_with, supports), grounded in the discussion blocks.
8. Edit ONLY ${mdPath}. Do not run compile/validate/qa, do not edit any other file, do not output the whole document — make a surgical Edit appending the new source. When done, stop.`;

  const task = `Deepen the concept "${conceptId}" in ${mdPath} by weaving in a new discussion @source, following your PROTOCOL exactly.
First read ${mdPath} to learn the existing concept ids, the anchor's region, and the authoring format already in use.${prompt ? `\n\nThe reader's steer: "${prompt}". Let it guide whether you need to ask a question and which angle you deepen.` : '\n\nThe reader gave no steer — decide whether a clarifying question is warranted.'}`;

  emit({ type: 'progress', message: `asking Claude to deepen "${conceptId}"` });

  const conversation = query({
    prompt: task,
    options: {
      systemPrompt,
      model: process.env.MINDGRAPH_MODEL || 'claude-sonnet-4-6',
      mcpServers: { 'deepen-questions': questionServer },
      allowedTools,
      canUseTool: async (toolName, input) => {
        if (allowedTools.includes(toolName)) return { behavior: 'allow', updatedInput: input };
        return { behavior: 'deny', message: `Tool ${toolName} is not permitted for deepen.` };
      },
    },
  });

  for await (const message of conversation) {
    const content = message?.message?.content;
    if (!Array.isArray(content)) continue;
    for (const block of content) {
      if (block?.type === 'tool_use' && block.name) {
        if (block.name === ASK_TOOL) continue; // the question UI speaks for this one
        const file = block.input?.file_path ? ` ${path.basename(block.input.file_path)}` : '';
        emit({ type: 'progress', message: `Claude: ${block.name}${file}` });
      } else if (block?.type === 'text' && block.text?.trim()) {
        emit({ type: 'progress', message: block.text.trim().slice(0, 140) });
      }
    }
  }

  emit({ type: 'progress', message: 'Claude finished editing' });
}
