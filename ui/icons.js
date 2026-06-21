// ---------------------------------------------------------------------------
// Icons — small inline SVG set, Lucide-style (MIT-licensed paths).
// ---------------------------------------------------------------------------
//
// Each export is a function returning an SVG string. They use currentColor
// for stroke so they tint with surrounding text colour. Default size 18 px,
// stroke-width 1.5. Pass { size, className } to override.
//
// Source paths from https://lucide.dev (MIT). Reproduced inline so the
// project keeps its zero-dependency policy.

function svg({ size = 18, className = '' }, body) {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" class="${className}" aria-hidden="true">${body}</svg>`;
}

export function settingsIcon(opts = {}) {
  return svg(opts, `
    <path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z"/>
    <circle cx="12" cy="12" r="3"/>
  `);
}

export function sourceIcon(opts = {}) {
  // Lucide "file-text" (MIT).
  return svg(opts, `
    <path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z"/>
    <path d="M14 2v4a2 2 0 0 0 2 2h4"/>
    <path d="M10 9H8"/><path d="M16 13H8"/><path d="M16 17H8"/>
  `);
}

export function chatIcon(opts = {}) {
  // Lucide "message-circle" (MIT).
  return svg(opts, `
    <path d="M7.9 20A9 9 0 1 0 4 16.1L2 22Z"/>
  `);
}

export function panelRightCloseIcon(opts = {}) {
  return svg(opts, `
    <rect width="18" height="18" x="3" y="3" rx="2"/>
    <path d="M15 3v18"/>
    <path d="m8 9 3 3-3 3"/>
  `);
}

export function panelRightOpenIcon(opts = {}) {
  return svg(opts, `
    <rect width="18" height="18" x="3" y="3" rx="2"/>
    <path d="M15 3v18"/>
    <path d="m10 15-3-3 3-3"/>
  `);
}
