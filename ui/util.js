// ---------------------------------------------------------------------------
// Shared utility functions
// ---------------------------------------------------------------------------

export function escapeHtml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

export function formatTime(seconds) {
  const total = Math.max(0, Math.floor(seconds || 0));
  const hh = Math.floor(total / 3600);
  const mm = Math.floor((total % 3600) / 60);
  const ss = total % 60;
  if (hh > 0) return `${hh}:${String(mm).padStart(2, '0')}:${String(ss).padStart(2, '0')}`;
  return `${mm}:${String(ss).padStart(2, '0')}`;
}

export function frameLabel(frame) {
  return `${frame.ref.level} ${frame.ref.index + 1}${frame.title ? ` · ${frame.title}` : ''}`;
}

export function numberOrDash(value, digits = 2) {
  return value == null ? '—' : Number(value).toFixed(digits);
}

export function wrapLabel(label, maxLines = 2) {
  const words = String(label).split(/\s+/).filter(Boolean);
  if (words.length <= 1) return [String(label)];
  const perLine = Math.ceil(words.length / maxLines);
  const out = [];
  for (let i = 0; i < words.length; i += perLine) {
    out.push(words.slice(i, i + perLine).join(' '));
  }
  return out.slice(0, maxLines);
}

export function hexToRgba(hex, alpha) {
  const v = hex.replace('#', '');
  const n = Number.parseInt(v, 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${alpha})`;
}
