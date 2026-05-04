// ---------------------------------------------------------------------------
// Inspector panel renderers
// ---------------------------------------------------------------------------

import {
  buildConceptInspectorVM,
  buildFrameInspectorVM,
} from '../../src/view-model/buildMindgraphViewModel.js';
import { escapeHtml, formatTime, frameLabel, numberOrDash } from '../util.js';

export function renderInspector(vm, state) {
  if (state.selectedConceptId) return renderConceptInspector(vm, state.selectedConceptId);
  if (state.selectedFrameRef) return renderFrameInspector(vm, state.selectedFrameRef, state);

  const activeFrames = vm.selectors.getActiveFramesAtTime(state.playheadTime);
  const activeFrame = activeFrames[state.activeLevel];
  const activeConcepts = vm.selectors.getActiveConceptActivationsAtTime(state.playheadTime, state.activeLevel).slice(0, 8);

  return `
    ${renderInspectorChrome('Details')}
    <div class="inspector-scroll">
      <section class="section">
        <h3>Current frame</h3>
        ${activeFrame ? renderFrameChip(activeFrame, true) : '<div class="empty-state">No active frame at this playhead.</div>'}
      </section>
      <section class="section">
        <h3>Active concepts</h3>
        <div class="list">
          ${activeConcepts.map((activation) => `
            <div class="list-item"><button type="button" data-action="select-concept" data-concept-id="${activation.id}">${escapeHtml(activation.label)} <span class="muted">· ${activation.weight.toFixed(2)}</span></button></div>
          `).join('') || '<div class="empty-state">No concept activations in this frame.</div>'}
        </div>
      </section>
      <section class="section">
        <h3>How to use this shell</h3>
        <div class="muted">Click a concept in the graph or a frame in the timeline. The right panel will switch into a real concept or frame inspector instead of this live overview.</div>
      </section>
    </div>
  `;
}

export function renderConceptInspector(vm, conceptId) {
  const inspector = buildConceptInspectorVM(vm, conceptId, { strongestFrameLimit: 6, excerptLimit: 5 });
  if (!inspector) return '<div class="error-state">Missing concept inspector.</div>';

  const concept = inspector.concept;
  const stats = concept.stats ?? {};
  const parentClusters = inspector.parentClusters.length
    ? inspector.parentClusters.map((cluster) => `<span class="chip">${escapeHtml(cluster.label)}</span>`).join('')
    : '<span class="muted">No parent cluster</span>';

  return `
    ${renderInspectorChrome('Details', concept.label, concept.id)}
    <div class="inspector-scroll">
      <section class="section">
        <h3>Grounding</h3>
        <div class="chip-row">${parentClusters}</div>
      </section>
      <section class="section">
        <h3>Stats</h3>
        <div class="stat-grid">
          ${renderStat('Recurrence', stats.recurrenceCount ?? '—')}
          ${renderStat('Peak activation', numberOrDash(stats.peakActivation, 2))}
          ${renderStat('Total activation', numberOrDash(stats.totalActivation, 2))}
          ${renderStat('Persistence', stats.persistence != null ? `${Math.round(stats.persistence)}s` : '—')}
        </div>
      </section>
      <section class="section">
        <h3>Related concepts</h3>
        <div class="list">
          ${inspector.relatedConcepts.map((related) => `
            <div class="list-item"><button type="button" data-action="select-concept" data-concept-id="${related.id}">${escapeHtml(related.label)}</button></div>
          `).join('') || '<div class="empty-state">No one-hop neighbors.</div>'}
        </div>
      </section>
      <section class="section">
        <h3>Strongest frames</h3>
        <div class="list">
          ${inspector.strongestFrames.map((frame) => renderFrameChip(frame)).join('') || '<div class="empty-state">No frames found.</div>'}
        </div>
      </section>
      <section class="section">
        <h3>Transcript grounding</h3>
        <div class="transcript-list">
          ${inspector.transcriptExcerpts.map((segment) => renderTranscriptItem(segment)).join('') || '<div class="empty-state">No transcript excerpts available.</div>'}
        </div>
      </section>
    </div>
  `;
}

export function renderFrameInspector(vm, frameRef, state) {
  const inspector = buildFrameInspectorVM(vm, frameRef);
  if (!inspector) return '<div class="error-state">Missing frame inspector.</div>';

  return `
    ${renderInspectorChrome('Details', `${inspector.frame.ref.level} ${inspector.frame.ref.index + 1}`, `${formatTime(inspector.frame.span.start)} → ${formatTime(inspector.frame.span.end)}`)}
    <div class="inspector-scroll">
      <section class="section">
        <h3>Summary</h3>
        <div class="muted">${escapeHtml(inspector.frame.summary || inspector.frame.title || 'No summary yet — this shell still shows the structural payload cleanly.')}</div>
      </section>
      <section class="section">
        <h3>Active concepts</h3>
        <div class="list">
          ${[...inspector.foregroundConcepts, ...inspector.backgroundConcepts].map((activation) => `
            <div class="list-item"><button type="button" data-action="select-concept" data-concept-id="${activation.id}">${escapeHtml(activation.label)} <span class="muted">· ${activation.weight.toFixed(2)}</span></button></div>
          `).join('') || '<div class="empty-state">No concept activations.</div>'}
        </div>
      </section>
      <section class="section">
        <h3>Active relations</h3>
        <div class="list">
          ${inspector.activeRelations.map((relationActivation) => {
            const relation = relationActivation.relation;
            const label = relation ? `${relation.from} → ${relation.to} · ${relation.type}` : relationActivation.id;
            return `<div class="list-item">${escapeHtml(label)} <span class="muted">· ${relationActivation.weight.toFixed(2)}</span></div>`;
          }).join('') || '<div class="empty-state">No relation activations.</div>'}
        </div>
      </section>
      <section class="section">
        <h3>Provenance</h3>
        <div class="breadcrumbs">
          ${inspector.parentFrame ? `<span class="breadcrumb">parent · <button type="button" class="link-button" data-action="select-frame" data-level="${inspector.parentFrame.ref.level}" data-index="${inspector.parentFrame.ref.index}">${escapeHtml(frameLabel(inspector.parentFrame))}</button></span>` : ''}
          ${inspector.childFrames.map((frame) => `<span class="breadcrumb">child · <button type="button" class="link-button" data-action="select-frame" data-level="${frame.ref.level}" data-index="${frame.ref.index}">${escapeHtml(frameLabel(frame))}</button></span>`).join('') || '<span class="muted">No linked child frames</span>'}
        </div>
      </section>
      <section class="section">
        <h3>Transcript grounding</h3>
        <div class="transcript-list">
          ${inspector.transcriptSegments.map((segment) => renderTranscriptItem(segment)).join('') || '<div class="empty-state">No transcript segments attached.</div>'}
        </div>
      </section>
    </div>
  `;
}

function renderInspectorChrome(activeTab, title = 'Inspector', subtitle = 'Live semantic window') {
  return `
    <div class="inspector-title-block">
      <h2>${escapeHtml(title)}</h2>
      <div class="muted">${escapeHtml(subtitle)}</div>
    </div>
  `;
}

function renderFrameChip(frame, isLive = false) {
  return `
    <div class="frame-chip">
      <button type="button" data-action="select-frame" data-level="${frame.ref.level}" data-index="${frame.ref.index}">
        <strong>${escapeHtml(frameLabel(frame))}</strong>
        <div class="muted">${formatTime(frame.span.start)} → ${formatTime(frame.span.end)}${isLive ? ' · live now' : ''}</div>
      </button>
    </div>
  `;
}

function renderTranscriptItem(segment) {
  return `
    <div class="transcript-item">
      <div class="muted">${formatTime(segment.start)} → ${formatTime(segment.end)}${segment.speaker ? ` · ${escapeHtml(segment.speaker)}` : ''}</div>
      <div>${escapeHtml(segment.text)}</div>
    </div>
  `;
}

function renderStat(label, value) {
  return `
    <div class="stat-card">
      <div class="label">${escapeHtml(label)}</div>
      <div class="value">${escapeHtml(String(value))}</div>
    </div>
  `;
}
