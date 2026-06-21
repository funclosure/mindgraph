// ---------------------------------------------------------------------------
// Events — bindEvents, toolbar + canvas interactions
// ---------------------------------------------------------------------------

import { screenToWorld, zoomAround, applyDpr } from './camera.js';
import { hitTestAt } from './hit-test.js';

// Maintain the selection set. Plain click selects one; additive (Shift/⌘-click)
// toggles a node in/out. `selectedConceptId` stays the "primary" (last acted) for
// camera framing and single-node code paths.
function setSelection(state, conceptId, additive) {
  const set = new Set(state.selectedConceptIds ?? []);
  if (!conceptId) {
    set.clear();
  } else if (additive) {
    if (set.has(conceptId)) set.delete(conceptId);
    else set.add(conceptId);
  } else {
    set.clear();
    set.add(conceptId);
  }
  state.selectedConceptIds = [...set];
  state.selectedConceptId = set.has(conceptId) ? conceptId : (state.selectedConceptIds.at(-1) ?? undefined);
}

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
  // Prose-handle is a static element in index.html — guard against accumulating
  // listeners across re-renders with a dataset flag (same pattern as canvas).

  // Source / Ask panel toggles in the top nav. Each shows/hides its panel; the
  // prose region width follows how many are open, so resize the canvas
  // synchronously before paint to avoid a stretch blink.
  document.querySelectorAll('[data-action="toggle-source"]').forEach((btn) => {
    btn.addEventListener('click', () => {
      state.sourceOpen = !state.sourceOpen;
      const app = document.querySelector('.app');
      if (app) app.dataset.sourceOpen = String(state.sourceOpen);
      resizeCanvasNow(state);
      render();
    });
  });

  document.querySelectorAll('[data-action="toggle-ask"]').forEach((btn) => {
    btn.addEventListener('click', () => {
      state.askOpen = !state.askOpen;
      const app = document.querySelector('.app');
      if (app) app.dataset.askOpen = String(state.askOpen);
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
  document.querySelectorAll('[data-action="toggle-digest"]').forEach((panel) => {
    panel.addEventListener('click', (event) => {
      if (event.target.closest('button')) return;
      state.digestExpanded = !state.digestExpanded;
      render();
    });
    panel.addEventListener('keydown', (event) => {
      if (event.key !== 'Enter' && event.key !== ' ') return;
      if (event.target.closest('button')) return;
      event.preventDefault();
      state.digestExpanded = !state.digestExpanded;
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
    btn.addEventListener('click', (event) => {
      const conceptId = btn.dataset.conceptId;
      const concept = state.viewModel.concepts.byId?.[conceptId];
      const firstSeen = concept?.firstSeenAt;
      const isProseSpan = btn.classList.contains('concept');
      const additive = event.shiftKey || event.metaKey;
      // Auto-advance the playhead only when the click did NOT come from a prose
      // mention. Prose-span clicks should never teleport — the user clicked a
      // word in their current view.
      if (!isProseSpan && typeof firstSeen === 'number' && firstSeen > state.playheadTime) {
        state.playheadTime = firstSeen;
      }
      setSelection(state, conceptId, additive);
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
      const additive = e.shiftKey || e.metaKey;
      if (hit) {
        setSelection(state, hit.id, additive);
        state.selectedFrameRef = undefined;
        state.cameraMode = 'selection';
        if (state.sim) state.sim.reheat(0.05);     // v3 tuning: very subtle selection nudge
        scrollProseToConcept(state.selectedConceptId);
      } else if (!additive) {
        // Clicking empty space clears the selection — unless a modifier is held
        // (so Shift/⌘-clicking the background doesn't wipe a multi-selection).
        setSelection(state, null, false);
        state.selectedFrameRef = undefined;
        if (state.cameraMode === 'selection') state.cameraMode = 'auto';
      }
      render();
    });
  }
}
