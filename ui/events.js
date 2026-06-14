// ---------------------------------------------------------------------------
// Events — bindEvents, toolbar + canvas interactions
// ---------------------------------------------------------------------------

import { screenToWorld, zoomAround, applyDpr } from './camera.js';
import { hitTestAt } from './hit-test.js';

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

function scrollProseToTime(time) {
  const container = document.getElementById('prose');
  if (!container) return;
  const blocks = [...container.querySelectorAll('.prose-block[data-time-start]')];
  const target = blocks.find((block) => Number(block.dataset.timeStart) >= time) ?? blocks.at(-1);
  if (!target) return;
  const containerRect = container.getBoundingClientRect();
  const targetRect = target.getBoundingClientRect();
  const offset = targetRect.top - (containerRect.top + 24);
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

  document.querySelectorAll('[data-action="jump-source-section"]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const idx = Number(btn.dataset.sectionIndex);
      const sectionLevel = state.viewModel.sourceFlow ? 'section' : 'macro';
      const frame = state.viewModel.sourceFlow?.sections?.[idx] ?? state.viewModel.frames?.macro?.[idx];
      if (!frame) return;
      state.playheadTime = frame.span.start;
      state.selectedFrameRef = { level: sectionLevel, index: idx };
      state.selectedConceptId = undefined;
      state.cameraMode = 'selection';
      // Smooth-scroll the prose to the first source paragraph in the section. The scroll-binding
      // will then re-confirm the playhead from the centered paragraph.
      scrollProseToTime(frame.span.start);
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

    // Pan-vs-drag state. dragging.kind === 'pan' means panning the camera;
    // dragging.kind === 'dot' means dragging a pinned concept.
    let dragging = null;
    let lastX = 0;
    let lastY = 0;
    let downStartX = 0;
    let downStartY = 0;
    let dragSwitched = false;
    // Click-suppression bookkeeping. Shared by both pointerdown listeners
    // below: the first sets it for the drag/pan fork, the click handler
    // reads it to suppress click-after-drag, and pointercancel resets it
    // so a canceled gesture can't leave a stale value behind.
    let downAt = null;
    canvasEl.addEventListener('pointerdown', (e) => {
      // Capture gesture start position for ALL paths (dot and pan both need it).
      downStartX = e.clientX;
      downStartY = e.clientY;

      const rect = canvasEl.getBoundingClientRect();
      const screen = { x: e.clientX - rect.left, y: e.clientY - rect.top };
      const world = screenToWorld(state.camera, screen);
      const hit = hitTestAt(state, world);

      if (hit && hit.kind === 'concept' && state.sim) {
        // Dot drag — pin the concept under the cursor.
        dragging = { kind: 'dot', id: hit.id };
        state.sim.pin(hit.id, world);
        state.sim.alpha = 1.0;
        canvasEl.setPointerCapture(e.pointerId);
        canvasEl.style.cursor = 'grabbing';
        scheduleDraw();
        return;
      }

      // Else: pan path (unchanged behavior).
      dragging = { kind: 'pan' };
      lastX = e.clientX;
      lastY = e.clientY;
      dragSwitched = false;
      canvasEl.setPointerCapture(e.pointerId);
      canvasEl.style.cursor = 'grabbing';
    });
    canvasEl.addEventListener('pointermove', (e) => {
      if (!dragging) return;

      if (dragging.kind === 'dot') {
        const rect = canvasEl.getBoundingClientRect();
        const screen = { x: e.clientX - rect.left, y: e.clientY - rect.top };
        const world = screenToWorld(state.camera, screen);
        state.sim.pin(dragging.id, world);
        state.sim.alpha = 1.0;
        scheduleDraw();
        return;
      }

      // Pan path (unchanged).
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
      try { canvasEl.releasePointerCapture(e.pointerId); } catch (_) {}
      canvasEl.style.cursor = 'grab';

      if (dragging.kind === 'dot' && state.sim) {
        state.sim.unpin(dragging.id);
        const moved = Math.hypot(e.clientX - downStartX, e.clientY - downStartY) > 4;
        if (moved) state.sim.reheat(0.32);
        dragging = null;
        scheduleDraw();          // wakes the rAF loop if it was idle
        return;
      }

      dragging = null;
      render();
    });
    canvasEl.addEventListener('pointercancel', (e) => {
      // pointercancel fires on iOS scroll interruption, browser-level capture
      // loss, etc. Treat as a clean release so we don't leave the dot pinned.
      if (!dragging) return;
      try { canvasEl.releasePointerCapture(e.pointerId); } catch (_) {}
      canvasEl.style.cursor = 'grab';
      if (dragging.kind === 'dot' && state.sim) {
        state.sim.unpin(dragging.id);
        const moved = Math.hypot(e.clientX - downStartX, e.clientY - downStartY) > 4;
        if (moved) state.sim.reheat(0.32);
      }
      dragging = null;
      downAt = null;  // canceled gesture: don't let a stale downAt fire later
      scheduleDraw();
    });
    canvasEl.style.cursor = 'grab';

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
      if (hit) {
        state.selectedConceptId = hit.id;
        state.selectedFrameRef = undefined;
        state.cameraMode = 'selection';
        if (state.sim) state.sim.reheat(0.05);     // v3 tuning: very subtle selection nudge
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
