import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createQuestionChannel } from '../src/server/questionChannel.js';

test('answer() resolves the pending ask() with the posted answers', async () => {
  const channel = createQuestionChannel();
  const pending = channel.ask('turn-1');
  assert.equal(channel.pendingCount(), 1);

  const delivered = channel.answer('turn-1', [{ header: 'Angle', values: ['Timeline'] }]);
  assert.equal(delivered, true);

  const answers = await pending;
  assert.deepEqual(answers, [{ header: 'Angle', values: ['Timeline'] }]);
  assert.equal(channel.pendingCount(), 0);
});

test('answer() for an unknown turn returns false and resolves nothing', () => {
  const channel = createQuestionChannel();
  assert.equal(channel.answer('nope', []), false);
});

test('cancel() rejects the pending ask()', async () => {
  const channel = createQuestionChannel();
  const pending = channel.ask('turn-2');
  channel.cancel('turn-2', 'deepen cancelled');
  await assert.rejects(pending, /deepen cancelled/);
  assert.equal(channel.pendingCount(), 0);
});

test('a second ask() for the same turn cancels the first', async () => {
  const channel = createQuestionChannel();
  const first = channel.ask('turn-3');
  const second = channel.ask('turn-3');
  await assert.rejects(first, /superseded/);
  channel.answer('turn-3', [{ header: 'h', values: ['v'] }]);
  assert.deepEqual(await second, [{ header: 'h', values: ['v'] }]);
});
