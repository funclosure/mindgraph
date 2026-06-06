import { DEFAULT_ANIMATION_CONFIG } from './animator.js';
import { DEFAULT_LAYOUT_CONFIG } from './layout.js';

const LAYOUT_KNOBS = [
  { key: 'baseLinkDistance', label: 'Base link distance', min: 20, max: 180, step: 1 },
  { key: 'hubRingBonus', label: 'Hub ring bonus', min: 0, max: 50, step: 1 },
  { key: 'unrelatedMinDistance', label: 'Unrelated min distance', min: 40, max: 180, step: 1 },
  { key: 'unrelatedSeparationStrength', label: 'Unrelated separation', min: 0, max: 0.2, step: 0.005 },
  { key: 'centerGravity', label: 'Center gravity', min: 0, max: 0.05, step: 0.001 },
  { key: 'centerComfortRadius', label: 'Center comfort radius', min: 20, max: 500, step: 5 },
  { key: 'componentCohesionStrength', label: 'Component cohesion', min: 0, max: 0.12, step: 0.005 },
  { key: 'componentCohesionComfortRadius', label: 'Component comfort radius', min: 40, max: 350, step: 5 },
  { key: 'componentCohesionMaxComponentSize', label: 'Component max size', min: 1, max: 20, step: 1 },
  { key: 'baseLinkStrength', label: 'Base link strength', min: 0.005, max: 0.16, step: 0.005 },
  { key: 'linkStrengthMax', label: 'Link strength max', min: 0.02, max: 0.4, step: 0.01 },
  { key: 'alphaHalfLifeFrames', label: 'Physics half-life frames', min: 20, max: 400, step: 5 },
  { key: 'bloomNeighborDistance', label: 'Spawn neighbor distance', min: 20, max: 240, step: 5 },
  { key: 'bloomHubDistanceBonus', label: 'Spawn hub bonus', min: 0, max: 80, step: 2 },
  { key: 'bloomJitter', label: 'Spawn jitter', min: 0, max: 80, step: 2 },
];

const ANIMATION_KNOBS = [
  { key: 'bloomDurationMs', label: 'Bloom duration ms', min: 200, max: 2500, step: 50 },
  { key: 'fadeDurationMs', label: 'Fade duration ms', min: 100, max: 1200, step: 20 },
  { key: 'cameraTimeConstantS', label: 'Camera time constant s', min: 0.05, max: 1.5, step: 0.05 },
  { key: 'highlightTimeConstantS', label: 'Highlight time constant s', min: 0.05, max: 1.2, step: 0.05 },
  { key: 'bloomReheatStrength', label: 'Spawn force reheat', min: 0, max: 0.1, step: 0.001 },
];

function numberFromInput(input) {
  const step = Number(input.step || 1);
  const value = Number(input.value);
  return Number.isInteger(step) ? Math.round(value) : value;
}

function formatKnobValue(value, step) {
  const numericStep = Number(step || 1);
  if (Number.isInteger(numericStep)) return String(Math.round(value));
  const decimals = Math.min(6, Math.max(0, String(numericStep).split('.')[1]?.length ?? 0));
  return Number(value).toFixed(decimals).replace(/0+$/, '').replace(/\.$/, '');
}

export function createLayoutDebugPanel({ sim, animator, onChange } = {}) {
  if (!sim || typeof sim.updateConfig !== 'function') return null;
  const root = document.createElement('aside');
  root.style.cssText = [
    'position:fixed',
    'right:12px',
    'bottom:12px',
    'z-index:50',
    'width:320px',
    'max-height:calc(100vh - 24px)',
    'overflow:auto',
    'padding:12px',
    'border:1px solid rgba(212,190,145,0.3)',
    'border-radius:12px',
    'background:rgba(18,16,13,0.92)',
    'color:#f5efe3',
    'font:12px ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
    'box-shadow:0 10px 30px rgba(0,0,0,0.45)',
    'backdrop-filter:blur(8px)',
  ].join(';');

  const title = document.createElement('div');
  title.textContent = 'Tuning knobs';
  title.style.cssText = 'font-weight:700;font-size:13px;margin-bottom:4px';
  root.append(title);

  const meta = document.createElement('div');
  meta.style.cssText = 'color:rgba(245,239,227,0.65);margin-bottom:10px;line-height:1.35';
  root.append(meta);

  const inputs = new Map();
  const currentLayoutConfig = () => sim.layoutMeta?.config ?? DEFAULT_LAYOUT_CONFIG;
  const currentAnimationConfig = () => animator?.config ?? DEFAULT_ANIMATION_CONFIG;

  function updateMeta() {
    const layoutMeta = sim.layoutMeta ?? {};
    meta.textContent = `fragmented=${Boolean(layoutMeta.fragmented)} · components=${layoutMeta.componentCount ?? 'n/a'} · density=${Number(layoutMeta.relationDensity ?? 0).toFixed(2)}`;
  }

  function appendSection(label) {
    const heading = document.createElement('div');
    heading.textContent = label;
    heading.style.cssText = 'margin:12px 0 6px;color:#d7bd7b;font-weight:700;text-transform:uppercase;letter-spacing:0.08em;font-size:10px';
    root.append(heading);
  }

  function appendKnob(knob, valueSource, onInput) {
    const row = document.createElement('label');
    row.style.cssText = 'display:grid;grid-template-columns:1fr 64px;gap:8px;align-items:center;margin:8px 0';
    const label = document.createElement('span');
    label.textContent = knob.label;
    label.style.cssText = 'color:rgba(245,239,227,0.82)';
    const value = document.createElement('output');
    value.style.cssText = 'text-align:right;color:#d7bd7b;font-variant-numeric:tabular-nums';
    const slider = document.createElement('input');
    slider.type = 'range';
    slider.min = String(knob.min);
    slider.max = String(knob.max);
    slider.step = String(knob.step);
    slider.value = String(valueSource()[knob.key]);
    slider.style.cssText = 'grid-column:1 / -1;width:100%';
    value.value = formatKnobValue(Number(slider.value), slider.step);
    slider.addEventListener('input', () => {
      const next = numberFromInput(slider);
      value.value = formatKnobValue(next, slider.step);
      onInput(knob.key, next);
    });
    row.append(label, value, slider);
    root.append(row);
    inputs.set(knob.key, { slider, value });
  }

  appendSection('Layout');
  for (const knob of LAYOUT_KNOBS) {
    appendKnob(knob, currentLayoutConfig, (key, next) => {
      sim.updateConfig({ [key]: next });
      updateMeta();
      onChange?.();
    });
  }

  appendSection('Animation');
  for (const knob of ANIMATION_KNOBS) {
    appendKnob(knob, currentAnimationConfig, (key, next) => {
      animator?.updateConfig?.({ [key]: next });
      onChange?.();
    });
  }

  const buttons = document.createElement('div');
  buttons.style.cssText = 'display:flex;gap:8px;margin-top:10px';

  const reset = document.createElement('button');
  reset.type = 'button';
  reset.textContent = 'Reset';
  reset.style.cssText = buttonStyle();
  reset.addEventListener('click', () => {
    sim.updateConfig(DEFAULT_LAYOUT_CONFIG);
    animator?.updateConfig?.(DEFAULT_ANIMATION_CONFIG);
    for (const knob of LAYOUT_KNOBS) {
      const input = inputs.get(knob.key);
      const next = DEFAULT_LAYOUT_CONFIG[knob.key];
      input.slider.value = String(next);
      input.value.value = formatKnobValue(next, input.slider.step);
    }
    for (const knob of ANIMATION_KNOBS) {
      const input = inputs.get(knob.key);
      const next = DEFAULT_ANIMATION_CONFIG[knob.key];
      input.slider.value = String(next);
      input.value.value = formatKnobValue(next, input.slider.step);
    }
    updateMeta();
    onChange?.();
  });

  const copy = document.createElement('button');
  copy.type = 'button';
  copy.textContent = 'Copy JSON';
  copy.style.cssText = buttonStyle();
  copy.addEventListener('click', async () => {
    const json = JSON.stringify({ layout: currentLayoutConfig(), animation: currentAnimationConfig() }, null, 2);
    try {
      await navigator.clipboard.writeText(json);
      copy.textContent = 'Copied';
      setTimeout(() => { copy.textContent = 'Copy JSON'; }, 900);
    } catch {
      console.info('tuning config', json);
      copy.textContent = 'Logged';
      setTimeout(() => { copy.textContent = 'Copy JSON'; }, 900);
    }
  });

  buttons.append(reset, copy);
  root.append(buttons);
  updateMeta();
  document.body.append(root);
  return root;
}

function buttonStyle() {
  return [
    'appearance:none',
    'border:1px solid rgba(212,190,145,0.35)',
    'border-radius:8px',
    'background:rgba(212,190,145,0.12)',
    'color:#f5efe3',
    'padding:6px 8px',
    'cursor:pointer',
    'font:inherit',
  ].join(';');
}
