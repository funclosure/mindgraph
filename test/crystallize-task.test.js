import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildCrystallizeTask } from '../src/server/crystallizeTask.js';

test('buildCrystallizeTask embeds the concept, transcript, and target file', () => {
  const task = buildCrystallizeTask({
    conceptId: 'powerful-ai',
    mdPath: 'graphs/x.mindgraph.md',
    messages: [
      { role: 'you', text: 'what is this about?' },
      { role: 'agent', text: 'It is about imminent powerful AI.' },
      { role: 'you', text: 'add the recursive loop idea' },
    ],
  });
  assert.match(task, /powerful-ai/);
  assert.match(task, /graphs\/x\.mindgraph\.md/);
  assert.match(task, /what is this about\?/);
  assert.match(task, /It is about imminent powerful AI\./);
  assert.match(task, /add the recursive loop idea/);
  // It must instruct authoring a discussion source from the conversation.
  assert.match(task, /discussion/i);
});

test('buildCrystallizeTask labels speakers readably', () => {
  const task = buildCrystallizeTask({
    conceptId: 'c',
    mdPath: 'm.md',
    messages: [{ role: 'you', text: 'hi' }, { role: 'agent', text: 'hello' }],
  });
  assert.match(task, /Reader: hi/);
  assert.match(task, /You \(assistant\): hello/);
});
