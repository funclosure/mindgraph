import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createQuestionChannel } from '../src/server/questionChannel.js';

// The HTTP wiring is thin; the contract worth pinning is that a runner can ask
// and the answer route's payload resolves it. We assert that against the same
// channel the server uses, simulating the emit/ask/answer sequence.
test('runner ask() resolves when an answer payload arrives for the turn', async () => {
  const channel = createQuestionChannel();
  const events = [];
  const emit = (e) => events.push(e);
  const turnId = 'turn-x';

  const askQuestions = (questions) => {
    emit({ type: 'question', turnId, questions });
    return channel.ask(turnId);
  };

  const runnerPromise = (async () => {
    const answers = await askQuestions([{ header: 'Angle', question: 'Which angle?', options: [], multiSelect: false }]);
    return answers;
  })();

  // Simulate POST /deepen/answer body handling.
  const body = JSON.stringify({ turnId, answers: [{ header: 'Angle', values: ['Timeline'] }] });
  const delivered = channel.answer(JSON.parse(body).turnId, JSON.parse(body).answers);

  assert.equal(delivered, true);
  assert.deepEqual(await runnerPromise, [{ header: 'Angle', values: ['Timeline'] }]);
  assert.equal(events[0].type, 'question');
  assert.equal(events[0].turnId, 'turn-x');
});
