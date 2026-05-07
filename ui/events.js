// ---------------------------------------------------------------------------
// Events — bindEvents, playback controls, toolbar + canvas interactions
// ---------------------------------------------------------------------------

import { screenToWorld, zoomAround, zoomAroundCenter, fitCameraToLayout } from './camera.js';
import { hitTestAt } from './hit-test.js';

function scrollProseToChapter(macroIndex) {
  const container = document.getElementById('prose-overlay');
  if (!container) return;
  const headings = container.querySelectorAll('.prose-chapter');
  const heading = headings[macroIndex];
  if (!heading) return;
  const containerRect = container.getBoundingClientRect();
  const headingRect = heading.getBoundingClientRect();
  const offset = headingRect.top - (containerRect.top + 24); // leave 24 px from top edge
  container.scrollBy({ top: offset, left: 0, behavior: 'smooth' });
}

function scrollProseToConcept(conceptId) {
  if (!conceptId) return;
  const container = document.getElementById('prose-overlay');
  if (!container) return;
  const span = container.querySelector(`.concept[data-concept-id="${cssEscape(conceptId)}"]`);
  if (!span) return;
  const containerRect = container.getBoundingClientRect();
  const spanRect = span.getBoundingClientRect();
  // Target: scroll so the span sits at the vertical center of the container.
  const offset = (spanRect.top + spanRect.height / 2) - (containerRect.top + containerRect.height / 2);
  container.scrollBy({ top: offset, left: 0, behavior: 'smooth' });
}

function cssEscape(s) {
  // Defensive escape for selectors. Modern browsers have CSS.escape; fall back.
  if (typeof CSS !== 'undefined' && typeof CSS.escape === 'function') return CSS.escape(s);
  return String(s).replace(/[^a-zA-Z0-9_-]/g, (ch) => `\\${ch.charCodeAt(0).toString(16)} `);
}

// bindEvents is called every render because innerHTML replaces DOM nodes and
// fresh elements need listeners. The camera/canvas block guards against double-
// binding with a dataset flag.
//
// render     — full re-render (state → DOM + canvas)
// scheduleDraw — rAF-gated canvas-only redraw (for hot drag path)
export function bindEvents(state, render, scheduleDraw) {
  const range = document.querySelector('[data-action="scrub-playhead"]');
  if (range) {
    range.addEventListener('input', (e) => {
      state.playheadTime = Number(e.target.value);
      render();
    });
  }
  document.querySelector('[data-action="toggle-play"]')?.addEventListener('click', () => togglePlayback(state, render));
  document.querySelector('[data-action="step-back"]')?.addEventListener('click', () => stepFrame(state, render, -1));
  document.querySelector('[data-action="step-forward"]')?.addEventListener('click', () => stepFrame(state, render, 1));
  document.querySelectorAll('[data-action="set-level"]').forEach((btn) => {
    btn.addEventListener('click', () => {
      state.activeLevel = btn.dataset.level;
      render();
    });
  });
  document.querySelectorAll('[data-action="select-frame"]').forEach((btn) => {
    btn.addEventListener('click', () => {
      state.selectedFrameRef = { level: btn.dataset.level, index: Number(btn.dataset.index) };
      state.selectedConceptId = undefined;
      state.cameraMode = 'selection';
      const frame = state.viewModel.selectors.getFrame(state.selectedFrameRef);
      if (frame) state.playheadTime = frame.span.start;
      render();
    });
  });
  document.querySelectorAll('[data-action="select-concept"]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const conceptId = btn.dataset.conceptId;
      const concept = state.viewModel.concepts.byId?.[conceptId];
      const firstSeen = concept?.firstSeenAt;
      const isProseSpan = btn.classList.contains('concept');
      // Auto-advance the playhead only when the click did NOT come from a prose
      // mention. Prose-span clicks should never teleport — the user clicked a
      // word in their current view.
      if (!isProseSpan && typeof firstSeen === 'number' && firstSeen > state.playheadTime) {
        state.playheadTime = firstSeen;
      }
      state.selectedConceptId = conceptId;
      state.selectedFrameRef = undefined;
      state.cameraMode = 'selection';
      render();
    });
  });

  document.querySelectorAll('[data-action="jump-chapter"]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const idx = Number(btn.dataset.macroIndex);
      const frame = state.viewModel.frames.macro?.[idx];
      if (!frame) return;
      state.playheadTime = frame.span.start;
      state.selectedFrameRef = { level: 'macro', index: idx };
      state.selectedConceptId = undefined;
      state.cameraMode = 'selection';
      // Smooth-scroll the prose to the chapter heading. The scroll-binding
      // will then re-confirm the playhead from the centered paragraph.
      scrollProseToChapter(idx);
      render();
    });
  });

  // Toolbar camera buttons — static DOM, bind once only.
  const toolbar = document.querySelector('.graph-toolbar');
  if (toolbar && !toolbar.dataset.boundCameraEvents) {
    toolbar.dataset.boundCameraEvents = '1';
    document.querySelector('[data-action="zoom-in"]')?.addEventListener('click', () => {
      zoomAroundCenter(state.camera, state.viewport, 1.2);
      render();
    });
    document.querySelector('[data-action="zoom-out"]')?.addEventListener('click', () => {
      zoomAroundCenter(state.camera, state.viewport, 1 / 1.2);
      render();
    });
    document.querySelector('[data-action="fit"]')?.addEventListener('click', () => {
      // Fit is a one-shot manual override — let the user inspect the whole layout.
      state.cameraMode = 'manual';
      fitCameraToLayout(state.camera, state.layout, state.viewport);
      render();
    });
    document.querySelector('[data-action="reset-camera"]')?.addEventListener('click', () => {
      state.selectedConceptId = undefined;
      state.selectedFrameRef = undefined;
      state.cameraMode = 'auto';
      render();
    });
  }

  // Canvas wheel + drag — bind once only.
  const canvasEl = document.getElementById('stage');
  if (canvasEl && !canvasEl.dataset.boundCameraEvents) {
    canvasEl.dataset.boundCameraEvents = '1';

    canvasEl.addEventListener('wheel', (e) => {
      e.preventDefault();
      const rect = canvasEl.getBoundingClientRect();
      const point = { x: e.clientX - rect.left, y: e.clientY - rect.top };
      const factor = Math.exp(-e.deltaY * 0.0015);
      state.cameraMode = 'manual';
      zoomAround(state.camera, point, factor);
      render();
    }, { passive: false });

    let dragging = false;
    let lastX = 0;
    let lastY = 0;
    let downStartX = 0;
    let downStartY = 0;
    let dragSwitched = false;
    canvasEl.addEventListener('pointerdown', (e) => {
      dragging = true;
      lastX = e.clientX;
      lastY = e.clientY;
      downStartX = e.clientX;
      downStartY = e.clientY;
      dragSwitched = false;
      canvasEl.setPointerCapture(e.pointerId);
      canvasEl.style.cursor = 'grabbing';
    });
    canvasEl.addEventListener('pointermove', (e) => {
      if (!dragging) return;
      if (!dragSwitched) {
        const moved = Math.hypot(e.clientX - downStartX, e.clientY - downStartY);
        if (moved > 4) {
          state.cameraMode = 'manual';
          dragSwitched = true;
        }
      }
      state.camera.pan.x += e.clientX - lastX;
      state.camera.pan.y += e.clientY - lastY;
      lastX = e.clientX;
      lastY = e.clientY;
      scheduleDraw();
    });
    canvasEl.addEventListener('pointerup', (e) => {
      if (!dragging) return;
      dragging = false;
      try { canvasEl.releasePointerCapture(e.pointerId); } catch (_) {}
      canvasEl.style.cursor = 'grab';
      render();
    });
    canvasEl.style.cursor = 'grab';

    let downAt = null;
    canvasEl.addEventListener('pointerdown', (e) => {
      downAt = { x: e.clientX, y: e.clientY };
    });
    canvasEl.addEventListener('click', (e) => {
      // Suppress click if the pointer moved more than a few px (= drag, not click).
      if (downAt && Math.hypot(e.clientX - downAt.x, e.clientY - downAt.y) > 4) {
        downAt = null;
        return;
      }
      downAt = null;
      const rect = canvasEl.getBoundingClientRect();
      const screen = { x: e.clientX - rect.left, y: e.clientY - rect.top };
      const world = screenToWorld(state.camera, screen);
      const hit = hitTestAt(state, world);
      // hit.kind is 'concept' | 'cluster' | null. Cluster IDs are also
      // concept IDs in the view-model (clusters are themselves concepts),
      // so both kinds resolve through the same selection slot.
      if (hit) {
        state.selectedConceptId = hit.id;
        state.selectedFrameRef = undefined;
        state.cameraMode = 'selection';
        // Smooth-scroll the prose to the first occurrence of this concept's
        // mention so the user sees it in context. The scroll-to-playhead
        // binding will pick up the new position and update graph state.
        scrollProseToConcept(state.selectedConceptId);
      } else {
        state.selectedConceptId = undefined;
        state.selectedFrameRef = undefined;
        if (state.cameraMode === 'selection') state.cameraMode = 'auto';
      }
      render();
    });
  }
}

export function togglePlayback(state, render) {
  if (state.isPlaying) stopPlayback(state, render);
  else startPlayback(state, render);
}

export function startPlayback(state, render) {
  if (state.cameraMode === 'manual') state.cameraMode = 'auto';
  if (state.isPlaying) return;
  const duration = state.viewModel.documentMeta.durationSeconds;
  if (state.playheadTime >= duration) state.playheadTime = 0;
  state.isPlaying = true;
  let lastT = performance.now();
  const tick = (now) => {
    if (!state.isPlaying) return;
    const dt = Math.min(0.5, (now - lastT) / 1000);
    lastT = now;
    state.playheadTime = Math.min(state.playheadTime + dt, duration);
    if (state.playheadTime >= duration) state.isPlaying = false;
    render();
    if (state.isPlaying) requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
  render();
}

export function stopPlayback(state, render) {
  if (!state.isPlaying) return;
  state.isPlaying = false;
  render();
}

export function stepFrame(state, render, direction) {
  const frames = state.viewModel.frames[state.activeLevel];
  if (!frames || !frames.length) return;
  const current = state.viewModel.selectors.getActiveFrameAtTime(state.activeLevel, state.playheadTime);
  const currentIndex = current ? current.ref.index : 0;
  const nextIndex = Math.max(0, Math.min(frames.length - 1, currentIndex + direction));
  const next = frames[nextIndex];
  if (!next) return;
  state.playheadTime = next.span.start;
  render();
}
