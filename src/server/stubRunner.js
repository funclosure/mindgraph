// No-API deepen runner. Demonstrates the full conversational mechanic: ask one
// scripted clarifying question, then weave a discussion @source into the .md
// (compiled discussion block + a derived concept grounded in it + a cross-source
// relation to the anchor + a section/step), matching the shape the real agent
// must produce. Used when MINDGRAPH_STUB_DEEPEN is set.
export async function stubRunner({ slug, conceptId, prompt, store, emit, askQuestions }) {
  emit({ type: 'progress', message: `stub: preparing ${conceptId}` });

  const entry = store.get(slug);
  const md = entry?.md;
  if (typeof md !== 'string') {
    emit({ type: 'progress', message: 'stub: no markdown' });
    return;
  }

  // Ask one structured question so the UI round-trip is exercised end to end.
  let angle = 'a key driver';
  if (typeof askQuestions === 'function') {
    emit({ type: 'progress', message: 'stub: asking a clarifying question' });
    const answers = await askQuestions([
      {
        header: 'Angle',
        question: `Which aspect of "${conceptId}" should we deepen?`,
        options: [
          { label: 'Timeline', description: 'When and how fast it arrives' },
          { label: 'Mechanism', description: 'What drives or enables it' },
          { label: 'Risks', description: 'What could go wrong' },
        ],
        multiSelect: false,
      },
    ]);
    const picked = answers?.[0]?.values?.[0];
    if (picked) angle = picked;
  }

  const suffix = Date.now().toString(36);
  const sourceId = `disc-${conceptId}-${suffix}`;
  const conceptIdNew = `stub-driver-${suffix}`;
  // Keep the derived concept's label verbatim in the block so reading QA binds it.
  const driverPhrase = 'stub driver';
  const block = `We deepened "${conceptId}" along the ${angle} angle. The ${driverPhrase} we surfaced compounds its effect over time.`;

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
summary: The deepen discussion derives the ${driverPhrase} as a driver of ${conceptId}.
focus:
  - ${conceptIdNew} 0.85
  - ${conceptId} 0.3 latent
relations:
  - ${conceptIdNew} -> ${conceptId} accelerates 0.75

@section ${sourceId}-sec
title: Deepen: ${conceptId} (${angle})
summary: A stub deepen discussion woven into the graph.
steps: ${sourceId}-s1
`;

  store.put(slug, { md: md + addition });
  emit({ type: 'progress', message: `stub wove a discussion source for ${conceptId}` });
}
