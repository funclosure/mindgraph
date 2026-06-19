import { escapeHtml } from '../util.js';

// Render the Deepen tab. `vm` model:
//   { conceptId, conceptLabel, busy, entries:[{role,text}], canUndo, thinking:{seconds}|null }
export function renderDeepenThread(vm) {
  if (!vm.conceptId) {
    return `<div class="deepen-empty">Select a concept in the graph to deepen it.</div>`;
  }
  const entries = vm.entries
    .map((e) => {
      if (e.role === 'question') return `<div class="deepen-entry deepen-question">${e.html}</div>`;
      return `<div class="deepen-entry deepen-${e.role}">${escapeHtml(e.text)}</div>`;
    })
    .join('');
  // The heartbeat is a single pinned line at the end of the thread while the
  // agent is working; it is not part of the entry log.
  const thinking = vm.thinking
    ? `<div class="deepen-entry deepen-heartbeat">Thinking… (${vm.thinking.seconds}s)</div>`
    : '';
  const undo = vm.canUndo
    ? `<button class="deepen-undo" data-action="deepen-undo">Undo</button>`
    : '';
  return (
    `<div class="deepen-head">Deepening: <strong>${escapeHtml(vm.conceptLabel)}</strong></div>` +
    `<div class="deepen-thread">${entries}${thinking}</div>` +
    `<div class="deepen-input">` +
      `<input id="deepen-prompt" type="text" placeholder="What about ${escapeHtml(vm.conceptLabel)} to go deeper on? (optional)" ${vm.busy ? 'disabled' : ''} />` +
      `<button data-action="deepen-run" ${vm.busy ? 'disabled' : ''}>${vm.busy ? 'Deepening…' : 'Deepen'}</button>` +
      undo +
    `</div>`
  );
}
