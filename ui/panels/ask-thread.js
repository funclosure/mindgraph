import { escapeHtml } from '../util.js';
import { renderMarkdown } from '../markdown.js';

// Render the Ask tab. `vm`:
//   { hasSelection, auto, conceptLabels:[…], busy, entries:[{role,text}], canUndo, canCrystallize, thinking:{seconds}|null }
// `auto` means the focus came from the section the reader is on, not an explicit
// pick — so the header says so and Ask still has something to talk about.
export function renderAskThread(vm) {
  if (!vm.hasSelection) {
    return `<div class="ask-empty">Scroll the source to talk about the section you're reading — or select a concept (Shift- or ⌘-click to add more) to focus on it.</div>`;
  }
  const labels = vm.conceptLabels ?? [];
  const headLabel = labels.length <= 1
    ? escapeHtml(labels[0] ?? '')
    : labels.length === 2
      ? `${escapeHtml(labels[0])} &amp; ${escapeHtml(labels[1])}`
      : `${escapeHtml(labels[0])} + ${labels.length - 1} more`;
  const lead = vm.auto ? 'This section' : 'Ask';
  const placeholder = vm.auto
    ? 'Ask about this section…'
    : labels.length > 1 ? 'Ask about these…' : `Ask about ${escapeHtml(labels[0] ?? '')}…`;

  const entries = vm.entries
    .map((e) => {
      // Agent answers render as (safe) Markdown, with source-block citations made clickable.
      if (e.role === 'agent') return `<div class="ask-entry ask-agent md">${renderMarkdown(e.text, vm.validBlockIds)}</div>`;
      return `<div class="ask-entry ask-${e.role}">${escapeHtml(e.text)}</div>`;
    })
    .join('');
  // Tappable starter questions while the conversation is empty.
  const starters = vm.entries.length === 0 ? renderStarters(labels) : '';
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
    `<button class="ask-head" data-action="ask-focus" title="${vm.auto ? 'The section you\'re reading' : 'Zoom to the selection'}">${lead}: <strong>${headLabel}</strong></button>` +
    `<div class="ask-thread">${entries}${thinking}${starters}</div>` +
    `<div class="ask-input">` +
      `<input id="ask-prompt" type="text" placeholder="${placeholder}" ${vm.busy ? 'disabled' : ''} />` +
      `<button data-action="ask-send" ${vm.busy ? 'disabled' : ''}>${vm.busy ? '…' : 'Send'}</button>` +
      add + undo +
    `</div>`
  );
}

// Suggested first questions, adapting to single- vs multi-selection.
function renderStarters(labels) {
  const prompts = labels.length > 1
    ? ['How do these relate?', 'Compare them', 'Why do they matter together?']
    : ['What is this about?', 'Why does it matter?', 'How does it connect to its neighbors?'];
  return (
    `<div class="ask-starters">` +
    prompts.map((p) => `<button class="ask-starter" data-action="ask-starter" data-prompt="${escapeHtml(p)}">${escapeHtml(p)}</button>`).join('') +
    `</div>`
  );
}
