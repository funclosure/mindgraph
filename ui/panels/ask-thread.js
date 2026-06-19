import { escapeHtml } from '../util.js';

// Render the Ask tab. `vm`:
//   { conceptId, conceptLabel, busy, entries:[{role,text}], canUndo, canCrystallize, thinking:{seconds}|null }
export function renderAskThread(vm) {
  if (!vm.conceptId) {
    return `<div class="ask-empty">Select a concept to talk about it in the context of the source.</div>`;
  }
  const entries = vm.entries
    .map((e) => `<div class="ask-entry ask-${e.role}">${escapeHtml(e.text)}</div>`)
    .join('');
  // The heartbeat is a single pinned line at the end of the thread while the
  // agent is working; it is not part of the entry log.
  const thinking = vm.thinking
    ? `<div class="ask-entry ask-heartbeat">Thinking… (${vm.thinking.seconds}s)</div>`
    : '';
  const add = vm.canCrystallize
    ? `<button class="ask-add" data-action="ask-add" ${vm.busy ? 'disabled' : ''}>Add to graph</button>`
    : '';
  const undo = vm.canUndo
    ? `<button class="ask-undo" data-action="ask-undo">Undo</button>`
    : '';
  return (
    `<div class="ask-head">Ask: <strong>${escapeHtml(vm.conceptLabel)}</strong></div>` +
    `<div class="ask-thread">${entries}${thinking}</div>` +
    `<div class="ask-input">` +
      `<input id="ask-prompt" type="text" placeholder="Ask about ${escapeHtml(vm.conceptLabel)}…" ${vm.busy ? 'disabled' : ''} />` +
      `<button data-action="ask-send" ${vm.busy ? 'disabled' : ''}>${vm.busy ? '…' : 'Send'}</button>` +
      add + undo +
    `</div>`
  );
}
