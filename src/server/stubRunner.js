// No-API runners for MINDGRAPH_STUB_DEEPEN. stubAnswerRunner mirrors answerRunner
// (emits an `answer`, writes nothing); stubCrystallizeRunner mirrors
// crystallizeRunner (weaves a discussion @source).
export async function stubAnswerRunner({ conceptIds, contexts, messages, emit }) {
  const last = messages?.[messages.length - 1]?.text ?? '';
  const labels = (contexts ?? []).map((c) => c.context?.concept?.label ?? c.conceptId);
  const snippet = contexts?.[0]?.context?.blocks?.[0]?.text?.slice(0, 160) ?? '(no source preloaded)';
  emit({ type: 'progress', message: `stub: answering about ${labels.join(', ') || (conceptIds ?? []).join(', ')}` });
  emit({
    type: 'answer',
    text: `(stub) You asked: "${last}". Selected: **${labels.join(', ')}**. First is grounded in: ${snippet}`,
  });
}

export async function stubCrystallizeRunner({ slug, conceptId, messages, store, emit }) {
  emit({ type: 'progress', message: `stub: crystallising ${conceptId}` });
  const entry = store.get(slug);
  const md = entry?.md;
  if (typeof md !== 'string') { emit({ type: 'progress', message: 'stub: no markdown' }); return; }

  const angle = (messages?.find((m) => m.role === 'you')?.text || 'discussion').slice(0, 24);
  const suffix = Date.now().toString(36);
  const sourceId = `disc-${conceptId}-${suffix}`;
  const conceptIdNew = `stub-driver-${suffix}`;
  const driverPhrase = 'stub driver';
  const block = `We discussed "${conceptId}" (${angle}). The ${driverPhrase} we surfaced compounds its effect over time.`;

  const addition = `

@source ${sourceId}
type: discussion
title: Deepen: ${conceptId} (${angle})

@block ${sourceId}-d1 source=${sourceId} kind=paragraph
${block}

@concept ${conceptIdNew}
label: Stub driver
aliases: ${driverPhrase}
first_seen: ${sourceId}-d1

@step ${sourceId}-s1 section=${sourceId}-sec blocks=${sourceId}-d1
summary: The discussion derives the ${driverPhrase} as a driver of ${conceptId}.
focus:
  - ${conceptIdNew} 0.85
  - ${conceptId} 0.3 latent
relations:
  - ${conceptIdNew} -> ${conceptId} accelerates 0.75

@section ${sourceId}-sec
title: Deepen: ${conceptId} (${angle})
summary: A stub discussion woven into the graph.
steps: ${sourceId}-s1
`;
  store.put(slug, { md: md + addition });
  emit({ type: 'progress', message: `stub wove a discussion source for ${conceptId}` });
}
