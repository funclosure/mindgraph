import { readSkill, loadSdk } from './agentSdk.js';

// Read-only talk runner. Answers a question about the anchored node, grounded in
// its preloaded source context. Streams `answer` (assistant text) + `progress`
// (tool use). Never edits the file.
//   ctx: { concept:{id,label,aliases}, blocks:[{id,text}], neighbors:[{id,label,type,direction}] }
//   messages: [{ role:'you'|'agent', text }]  (full conversation so far)
export async function answerRunner({ conceptId, context, messages, emit }) {
  const { query } = await loadSdk();

  const blockText = (context?.blocks ?? []).map((b) => `[${b.id}] ${b.text}`).join('\n\n');
  const neighborText = (context?.neighbors ?? [])
    .map((n) => `- ${n.label} (${n.direction === 'out' ? `${conceptId} ${n.type} ${n.id}` : `${n.id} ${n.type} ${conceptId}`})`)
    .join('\n') || '(none)';
  const label = context?.concept?.label ?? conceptId;

  const systemPrompt = `${readSkill()}

---
You are the mindgraph "Ask" agent — a knowledgeable reading companion. The reader is reading a digested source and has tapped one concept to chat about it. Assume they have ALREADY READ the source up to and including this node; do NOT re-explain what they just read or dump a comprehensive summary.

STYLE — lightweight back-and-forth, this is a chat, not an essay:
- Default to 1–3 short sentences. Answer the actual question, then stop. Leave room for a follow-up.
- Talk like a sharp friend who read the same piece: direct, plain, no preamble ("This concept refers to…"), no headings, no bullet-point dumps.
- Only go long and comprehensive when the reader EXPLICITLY asks for more — "go deeper", "more detail", "explain fully", "give me the comprehensive version". Otherwise stay brief.
- Cite a block id (e.g. b012) only when pointing at a specific passage; don't pepper every sentence with citations.
- You may use light Markdown (**bold**, *italics*, \`code\`, links, short bullet lists) — it is rendered.

Ground your answer in the SOURCE CONTEXT below. If the question goes beyond the source, you MAY use WebSearch/WebFetch — but say so and attribute it; never present outside facts as if the source stated them. Do NOT edit any file. Do NOT author concepts or relations — this is conversation, not graph editing.

ANCHOR CONCEPT: ${label} (id: ${conceptId})

SOURCE CONTEXT (blocks that foreground this concept):
${blockText || '(no preloaded blocks — use Read/Grep on the source if needed)'}

GRAPH NEIGHBORS:
${neighborText}`;

  // Replay the conversation as the prompt; the latest reader message is last.
  const prompt = (messages ?? [])
    .map((m) => `${m.role === 'agent' ? 'Assistant' : 'Reader'}: ${m.text}`)
    .join('\n') || `Reader: Tell me about "${label}".`;

  const allowedTools = ['Read', 'Grep', 'WebSearch', 'WebFetch'];
  const conversation = query({
    prompt,
    options: {
      systemPrompt,
      model: process.env.MINDGRAPH_MODEL || 'claude-sonnet-4-6',
      allowedTools,
      canUseTool: async (toolName, input) => {
        if (allowedTools.includes(toolName)) return { behavior: 'allow', updatedInput: input };
        return { behavior: 'deny', message: `Tool ${toolName} is not permitted in Ask.` };
      },
    },
  });

  for await (const message of conversation) {
    const content = message?.message?.content;
    if (!Array.isArray(content)) continue;
    for (const block of content) {
      if (block?.type === 'text' && block.text?.trim()) {
        emit({ type: 'answer', text: block.text });
      } else if (block?.type === 'tool_use' && block.name) {
        emit({ type: 'progress', message: `Claude: ${block.name}` });
      }
    }
  }
}
