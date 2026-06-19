// Pure: turn an anchored conversation into the crystallize agent's task prompt.
// The agent will weave the durable concepts the conversation surfaced into a new
// discussion @source (the discussion-as-source protocol lives in the system prompt).
export function buildCrystallizeTask({ conceptId, mdPath, messages }) {
  const transcript = (messages ?? [])
    .map((m) => `${m.role === 'agent' ? 'You (assistant)' : 'Reader'}: ${m.text}`)
    .join('\n');

  return `The reader has been talking with you about the concept "${conceptId}" in ${mdPath}, grounded in its source. Below is the conversation. Crystallise it: weave the durable concepts it surfaced into a NEW discussion @source, following your PROTOCOL exactly.

First read ${mdPath} to learn the existing concept ids and the authoring format already in use.

Conversation:
${transcript}

Capture what is durable and reusable from this conversation (not every aside). Each derived concept must bind verbatim to a discussion block, the anchor "${conceptId}" rides along as latent, and cross-source relations link the new concepts to "${conceptId}" and other relevant existing concepts. Make a surgical Edit appending the new source; do not output the whole document. When done, stop.`;
}
