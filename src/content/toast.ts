/**
 * A small status card injected into the page. It lives in a shadow root with
 * `all: initial` so no site stylesheet can reach in and restyle it.
 */

const HOST_ID = 'print-to-drive-toast';

const STYLES = `
:host { all: initial; }
.card {
  position: fixed;
  inset-block-end: 20px;
  inset-inline-end: 20px;
  z-index: 2147483647;
  display: flex;
  gap: 12px;
  align-items: flex-start;
  max-width: 340px;
  padding: 14px 16px;
  border-radius: 12px;
  background: #ffffff;
  color: #1f1f1f;
  box-shadow: 0 6px 24px rgba(0, 0, 0, 0.18), 0 0 0 1px rgba(0, 0, 0, 0.06);
  font: 13px/1.45 system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
  animation: slide-in 160ms ease-out;
}
@keyframes slide-in {
  from { opacity: 0; transform: translateY(8px); }
  to { opacity: 1; transform: none; }
}
.icon { flex: none; width: 18px; height: 18px; margin-top: 1px; }
.spinner {
  border: 2px solid rgba(26, 115, 232, 0.25);
  border-top-color: #1a73e8;
  border-radius: 50%;
  animation: spin 700ms linear infinite;
  box-sizing: border-box;
}
@keyframes spin { to { transform: rotate(360deg); } }
.check, .cross, .ask {
  border-radius: 50%;
  display: grid;
  place-items: center;
  color: #fff;
  font-size: 12px;
  font-weight: 700;
}
.check { background: #1e8e3e; }
.cross { background: #d93025; }
.ask { background: #1a73e8; }
.body { flex: 1; min-width: 0; }
.title { font-weight: 600; margin-bottom: 2px; }
.detail { color: #5f6368; word-break: break-word; }
.actions { display: flex; gap: 8px; margin-top: 10px; flex-wrap: wrap; }
button, a.button {
  font: inherit;
  font-weight: 600;
  padding: 6px 12px;
  border-radius: 8px;
  border: 1px solid #dadce0;
  background: #fff;
  color: #1a73e8;
  cursor: pointer;
  text-decoration: none;
}
button.primary { background: #1a73e8; border-color: #1a73e8; color: #fff; }
button:hover, a.button:hover { background: #f1f3f4; }
button.primary:hover { background: #1b66c9; }
.close {
  flex: none; border: 0; background: transparent; color: #5f6368;
  font-size: 16px; line-height: 1; padding: 2px 4px; cursor: pointer;
}
@media (prefers-color-scheme: dark) {
  .card { background: #202124; color: #e8eaed; box-shadow: 0 6px 24px rgba(0,0,0,.5), 0 0 0 1px rgba(255,255,255,.08); }
  .detail, .close { color: #9aa0a6; }
  button, a.button { background: #292a2d; border-color: #5f6368; color: #8ab4f8; }
  button:hover, a.button:hover { background: #35363a; }
  button.primary { background: #8ab4f8; border-color: #8ab4f8; color: #202124; }
}
/* The PDF is rendered while this card is on screen, so keep it out of print. */
@media print { .card { display: none !important; } }
@media (prefers-reduced-motion: reduce) {
  .card { animation: none; }
  .spinner { animation-duration: 2s; }
}
`;

export type ToastState = 'working' | 'success' | 'error' | 'ask';

export interface ToastAction {
  label: string;
  primary?: boolean;
  onClick: () => void;
}

export interface ToastOptions {
  detail?: string;
  link?: string;
  actions?: ToastAction[];
  /** Auto-dismiss delay in ms. Omit to leave the card up until replaced. */
  dismissAfter?: number;
}

let root: ShadowRoot | null = null;
let dismissTimer: number | undefined;

function ensureRoot(): ShadowRoot {
  if (root?.host.isConnected) return root;

  document.getElementById(HOST_ID)?.remove();
  const host = document.createElement('div');
  host.id = HOST_ID;
  // Keep the host itself out of the page's layout and of printed output.
  host.style.setProperty('all', 'initial', 'important');
  (document.body ?? document.documentElement).append(host);

  root = host.attachShadow({ mode: 'closed' });
  const style = document.createElement('style');
  style.textContent = STYLES;
  root.append(style);
  return root;
}

export function showToast(state: ToastState, title: string, options: ToastOptions = {}): void {
  const shadow = ensureRoot();
  shadow.querySelector('.card')?.remove();
  window.clearTimeout(dismissTimer);

  const card = document.createElement('div');
  card.className = 'card';
  card.setAttribute('role', state === 'error' ? 'alert' : 'status');

  const ICONS = {
    working: { className: 'spinner', glyph: '' },
    success: { className: 'check', glyph: '✓' },
    error: { className: 'cross', glyph: '!' },
    ask: { className: 'ask', glyph: '?' },
  } as const;

  const icon = document.createElement('div');
  icon.className = `icon ${ICONS[state].className}`;
  icon.textContent = ICONS[state].glyph;

  const body = document.createElement('div');
  body.className = 'body';

  const titleEl = document.createElement('div');
  titleEl.className = 'title';
  titleEl.textContent = title;
  body.append(titleEl);

  if (options.detail) {
    const detail = document.createElement('div');
    detail.className = 'detail';
    detail.textContent = options.detail;
    body.append(detail);
  }

  const actions = document.createElement('div');
  actions.className = 'actions';

  if (options.link) {
    const link = document.createElement('a');
    link.className = 'button';
    link.textContent = 'Open in Drive';
    link.href = options.link;
    link.target = '_blank';
    link.rel = 'noreferrer noopener';
    actions.append(link);
  }

  for (const action of options.actions ?? []) {
    const button = document.createElement('button');
    button.textContent = action.label;
    if (action.primary) button.classList.add('primary');
    button.addEventListener('click', () => {
      hideToast();
      action.onClick();
    });
    actions.append(button);
  }

  if (actions.childElementCount > 0) body.append(actions);

  const close = document.createElement('button');
  close.className = 'close';
  close.type = 'button';
  close.textContent = '×';
  close.setAttribute('aria-label', 'Dismiss');
  close.addEventListener('click', hideToast);

  card.append(icon, body, close);
  shadow.append(card);

  if (options.dismissAfter) {
    dismissTimer = window.setTimeout(hideToast, options.dismissAfter);
  }
}

export function hideToast(): void {
  window.clearTimeout(dismissTimer);
  root?.querySelector('.card')?.remove();
}
