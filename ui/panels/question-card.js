import { escapeHtml } from '../util.js';

// Render one ask_user_questions set into the deepen thread.
export function renderQuestionCards(questions, turnId) {
  const cards = questions.map((q, qi) => {
    const opts = (q.options ?? []).map((opt) => {
      const inputType = q.multiSelect ? 'checkbox' : 'radio';
      return (
        `<label class="qc-option">` +
          `<input type="${inputType}" name="qc-${escapeHtml(turnId)}-${qi}" value="${escapeHtml(opt.label)}" />` +
          `<span class="qc-option-label">${escapeHtml(opt.label)}</span>` +
          `<span class="qc-option-desc">${escapeHtml(opt.description ?? '')}</span>` +
        `</label>`
      );
    }).join('');
    return (
      `<div class="qc-card" data-qindex="${qi}" data-multi="${q.multiSelect ? '1' : '0'}">` +
        `<div class="qc-header">${escapeHtml(q.header ?? '')}</div>` +
        `<div class="qc-question">${escapeHtml(q.question ?? '')}</div>` +
        `<div class="qc-options">${opts}</div>` +
        `<input class="qc-other" type="text" placeholder="Other… (optional)" />` +
      `</div>`
    );
  }).join('');
  return (
    `<div class="qc-set" data-turn-id="${escapeHtml(turnId)}">` +
      cards +
      `<button class="qc-submit" data-action="qc-submit">Answer</button>` +
    `</div>`
  );
}

export function collectAnswers(setEl, questions) {
  return questions.map((q, qi) => {
    const card = setEl.querySelector(`.qc-card[data-qindex="${qi}"]`);
    const values = [];
    card?.querySelectorAll('input[type="radio"]:checked, input[type="checkbox"]:checked')
      .forEach((input) => values.push(input.value));
    const other = card?.querySelector('.qc-other')?.value?.trim();
    if (other) values.push(other);
    return { header: q.header ?? `q${qi}`, values };
  });
}
