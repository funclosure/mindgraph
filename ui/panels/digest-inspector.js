// ---------------------------------------------------------------------------
// Digest inspector — generated understanding, separate from source prose.
// ---------------------------------------------------------------------------

import { escapeHtml } from '../util.js';

export function renderDigestInspector(vm, state) {
  const digest = activeDigest(vm, state);
  if (!digest?.step) return '';
  const digestKey = digest.step.key ?? `${digest.step.ref?.level ?? 'step'}:${digest.step.ref?.index ?? 0}`;
  const expanded = Boolean(state.digestExpanded);

  const concepts = digest.step.foregroundConcepts
    .slice(0, 6)
    .map((concept) => {
      const active = state.graphRenderState?.activeNodeIds?.includes(concept.id) ? ' is-active' : '';
      const selected = state.selectedConceptId === concept.id ? ' is-selected' : '';
      return (
        `<button type="button" class="digest-chip${active}${selected}" data-action="select-concept" data-concept-id="${escapeHtml(concept.id)}">` +
          `${escapeHtml(concept.label)}` +
        `</button>`
      );
    })
    .join('');

  const relations = digest.step.activeRelations
    .slice(0, 4)
    .map((activation) => renderRelation(activation, vm))
    .join('');
  const meta = renderMeta(digest.step);

  return (
    `<aside class="digest-panel" aria-label="Active digest" role="button" tabindex="0" data-action="toggle-digest" data-expanded="${expanded ? 'true' : 'false'}" data-digest-key="${escapeHtml(digestKey)}">` +
      `<div class="digest-head">` +
        `<div class="digest-kicker">digest</div>` +
        meta +
      `</div>` +
      `<h2>${escapeHtml(digest.section?.title ?? digest.step.title ?? 'Current focus')}</h2>` +
      `<p>${escapeHtml(digest.step.summary ?? '')}</p>` +
      (expanded && concepts ? `<div class="digest-chips">${concepts}</div>` : '') +
      (expanded && relations ? `<div class="digest-relations">${relations}</div>` : '') +
    `</aside>`
  );
}

function activeDigest(vm, state) {
  const playheadTime = state.playheadTime ?? 0;
  if (vm.sourceFlow) {
    if (state.activeLevel === 'overview') {
      const overview = latestStarted(vm.sourceFlow.overview, playheadTime);
      return {
        step: overview,
        section: overview,
      };
    }
    return {
      step: latestStarted(vm.sourceFlow.readerSteps, playheadTime),
      section: latestStarted(vm.sourceFlow.sections, playheadTime),
    };
  }
  return {
    step: vm.selectors.getActiveFrameAtTime('micro', playheadTime),
    section: vm.selectors.getActiveFrameAtTime('macro', playheadTime),
  };
}

function latestStarted(frames, playheadTime) {
  let active;
  for (const frame of frames ?? []) {
    if ((frame.span?.start ?? 0) <= playheadTime) active = frame;
    else break;
  }
  return active;
}

function renderRelation(activation, vm) {
  const relation = activation.relation;
  if (!relation) return '';
  const from = vm.concepts.byId?.[relation.from]?.label ?? relation.from;
  const to = vm.concepts.byId?.[relation.to]?.label ?? relation.to;
  return (
    `<div class="digest-relation">` +
      `<span>${escapeHtml(from)}</span>` +
      `<b>${escapeHtml(formatRelationType(relation.type))}</b>` +
      `<span>${escapeHtml(to)}</span>` +
    `</div>`
  );
}

function renderMeta(step) {
  const blockCount = step.sourceSegmentIds?.length ?? 0;
  const conceptCount = step.foregroundConcepts?.length ?? 0;
  const relationCount = step.activeRelations?.length ?? 0;
  const label = `${blockCount} source ${plural(blockCount, 'block')} · ${conceptCount} ${plural(conceptCount, 'concept')} · ${relationCount} ${plural(relationCount, 'relation')}`;
  return `<div class="digest-meta">${escapeHtml(label)}</div>`;
}

function plural(count, singular) {
  return count === 1 ? singular : `${singular}s`;
}

function formatRelationType(type) {
  return String(type ?? 'relates')
    .replaceAll('_', ' ')
    .replaceAll('-', ' ');
}
