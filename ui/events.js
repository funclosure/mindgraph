// ---------------------------------------------------------------------------
// Events — bindEvents, playback controls, toolbar + canvas interactions
// ---------------------------------------------------------------------------

import { screenToWorld, zoomAround, applyDpr } from './camera.js';
import { hitTestAt } from './hit-test.js';
import { startDrift, stopDrift, isDriftActive } from './drift.js';

function resizeCanvasNow(state) {
  // Synchronously match the canvas's pixel buffer to its CSS box.
  // Used after layout shifts (e.g. prose collapse) so the canvas
  // doesn't blink stretched pixels for a frame before ResizeObserver
  // catches up.
  const canvas = document.getElementById('stage');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  state.viewport = applyDpr(canvas, ctx);
}

function scrollProseToChapter(macroIndex) {
  const container = document.getElementById('prose');
  if (!container) return;
  const headings = container.querySelectorAll('.prose-chapter');
  const heading = headings[macroIndex];
  if (!heading) return;
  const containerRect = container.getBoundingClientRect();
  const headingRect = heading.getBoundingClientRect();
  const offset = headingRect.top - (containerRect.top + 24);
  // Use instant scroll (avoids race with the scroll-binding's render path —
  // see v2 Task 11 finalization commit). The scroll-binding picks up the new
  // position and updates the playhead naturally.
  container.scrollTop += offset;
}

function scrollProseToConcept(conceptId) {
  if (!conceptId) return;
  const container = document.getElementById('prose');
  if (!container) return;
  const span = container.querySelector(`.concept[data-concept-id="${cssEscape(conceptId)}"]`);
  if (!span) return;
  const containerRect = container.getBoundingClientRect();
  const spanRect = span.getBoundingClientRect();
  const offset = (spanRect.top + spanRect.height / 2) - (containerRect.top + containerRect.height / 2);
  container.scrollBy({ top: offset, left: 0, behavior: 'smooth' });
}

function cssEscape(s) {
  // Defensive escape for selectors. Modern browsers have CSS.escape; fall back.
  if (typeof CSS !== 'undefined' && typeof CSS.escape === 'function') return CSS.escape(s);
  return String(s).replace(/[^a-zA-Z0-9_-]/g, (ch) => `\\${ch.charCodeAt(0).toString(16)} `);
}

function computePixelsPerSecond(container, vm) {
  // Pixels-per-second so the prose advances at speech rate. For timed
  // sources we use the document duration. For untimed sources the
  // producer's wordsPerMinute (default 150) yields synthetic spans whose
  // total still equals durationSeconds — same formula works.
  const totalSec = Math.max(1, vm.documentMeta.durationSeconds);
  const totalPx = Math.max(1, container.scrollHeight - container.clientHeight);
  return totalPx / totalSec;
}

// bindEvents is called every render because innerHTML replaces DOM nodes and
// fresh elements need listeners. The camera/canvas block guards against double-
// binding with a dataset flag.
//
// render     — full re-render (state → DOM + canvas)
// scheduleDraw — rAF-gated canvas-only redraw (for hot drag path)
export function bindEvents(state, render, scheduleDraw) {
  document.querySelectorAll('[data-action="toggle-view-popover"]').forEach((btn) => {
    btn.addEventListener('click', () => {
      state.viewPopoverOpen = !state.viewPopoverOpen;
      render();
    });
  });

  // Prose-handle is a static element in index.html — guard against accumulating
  // listeners across re-renders with a dataset flag (same pattern as canvas).
  const proseHandle = document.getElementById('prose-handle');
  if (proseHandle && !proseHandle.dataset.boundToggle) {
    proseHandle.dataset.boundToggle = '1';
    proseHandle.addEventListener('click', () => {
      state.prosCollapsed = !state.prosCollapsed;
      const app = document.querySelector('.app');
      if (app) app.dataset.proseCollapsed = String(state.prosCollapsed);
      render();
    });
  }

  // Prose collapse button — rendered inside the prose panel (fresh each render).
  document.querySelectorAll('[data-action="toggle-prose"]:not(#prose-handle)').forEach((btn) => {
    btn.addEventListener('click', () => {
      state.prosCollapsed = !state.prosCollapsed;
      const app = document.querySelector('.app');
      if (app) app.dataset.proseCollapsed = String(state.prosCollapsed);
      // Resize canvas synchronously before paint so the new layout's
      // first frame already has the right pixel buffer (no stretch blink).
      // Reading getBoundingClientRect inside applyDpr forces layout, which
      // is what we want here — we need the post-toggle box dimensions.
      resizeCanvasNow(state);
      render();
    });
  });

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

  document.querySelectorAll('[data-action="toggle-drift"]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const container = document.getElementById('prose');
      if (!container) return;
      if (isDriftActive()) {
        stopDrift();
        render();
        return;
      }
      const pps = computePixelsPerSecond(container, state.viewModel);
      startDrift({
        container,
        pixelsPerSecond: pps,
        onCancel: () => render(),
      });
      render();
    });
  });

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
