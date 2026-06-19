// Parse a growing SSE text buffer into complete events. Returns the events found
// and the leftover partial frame (to be prepended to the next chunk). Pure.
export function parseSseBuffer(buffer) {
  const events = [];
  let idx;
  while ((idx = buffer.indexOf('\n\n')) !== -1) {
    const frame = buffer.slice(0, idx);
    buffer = buffer.slice(idx + 2);
    let type = 'message';
    const dataLines = [];
    for (const line of frame.split('\n')) {
      if (line.startsWith('event:')) type = line.slice(6).trim();
      else if (line.startsWith('data:')) dataLines.push(line.slice(5).replace(/^ /, ''));
      // ':' comment lines (keep-alives) are ignored
    }
    if (dataLines.length) {
      const raw = dataLines.join('\n');
      let data;
      try { data = JSON.parse(raw); } catch { data = raw; }
      events.push({ type, data });
    } else if (type !== 'message') {
      events.push({ type, data: null });
    }
  }
  return { events, rest: buffer };
}

// POST a JSON body and stream the SSE-formatted response, invoking onEvent({type,data})
// for each complete event as it arrives.
export async function streamPost(url, body, onEvent) {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok || !res.body) {
    onEvent({ type: 'error', data: { message: `request failed (${res.status})` } });
    return;
  }
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const { events, rest } = parseSseBuffer(buffer);
    buffer = rest;
    for (const e of events) onEvent(e);
  }
}
