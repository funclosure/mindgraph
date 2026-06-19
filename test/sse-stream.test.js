import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseSseBuffer } from '../ui/sse-stream.js';

test('parseSseBuffer yields complete events and keeps the partial remainder', () => {
  const buf =
    'event: progress\ndata: {"message":"hi"}\n\n' +
    ': keep-alive\n\n' +
    'event: answer\ndata: {"text":"par';
  const { events, rest } = parseSseBuffer(buf);
  assert.equal(events.length, 1, 'only the first complete frame (the comment frame carries no data)');
  assert.equal(events[0].type, 'progress');
  assert.deepEqual(events[0].data, { message: 'hi' });
  assert.equal(rest, 'event: answer\ndata: {"text":"par');
});

test('parseSseBuffer parses an event with no data line as null data', () => {
  const { events } = parseSseBuffer('event: done\n\n');
  assert.equal(events[0].type, 'done');
  assert.equal(events[0].data, null);
});

test('parseSseBuffer leaves non-JSON data as a string', () => {
  const { events } = parseSseBuffer('event: note\ndata: plain text\n\n');
  assert.equal(events[0].data, 'plain text');
});
