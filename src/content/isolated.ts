import {
  INTERCEPT_ATTRIBUTE,
  PAGE_EVENT_NATIVE_PRINT,
  PAGE_EVENT_PRINT_REQUESTED,
  send,
  type PrintTrigger,
  type TabMessage,
} from '../shared/messages';
import { resolveAction } from '../shared/matcher';
import { DEFAULT_SETTINGS, type Settings } from '../shared/types';
import { hideToast, showToast } from './toast';

/**
 * Runs in the extension's isolated world. It relays print requests from the
 * page world to the service worker, owns the Ctrl+P shortcut, and renders the
 * status card.
 */

const isTopFrame = window.top === window;
let settings: Settings = DEFAULT_SETTINGS;

void loadSettings();

async function loadSettings(): Promise<void> {
  const response = await send({ type: 'get-settings' });
  if (response.ok) applySettings(response.data);
}

function applySettings(next: Settings): void {
  settings = next;
  const intercepting = next.enabled && next.interceptWindowPrint;
  // The page world reads this attribute before deciding to defer to us.
  document.documentElement.setAttribute(INTERCEPT_ATTRIBUTE, intercepting ? 'on' : 'off');
}

// --------------------------------------------------------------------------
// Triggers
// --------------------------------------------------------------------------

window.addEventListener(PAGE_EVENT_PRINT_REQUESTED, () => {
  void requestPrint('window.print');
});

window.addEventListener(
  'keydown',
  (event) => {
    if (!settings.enabled || !settings.interceptShortcut) return;
    if (event.defaultPrevented || event.altKey || event.shiftKey) return;
    if (!(event.ctrlKey || event.metaKey)) return;
    if (event.key.toLowerCase() !== 'p') return;
    // A site opted out keeps Chrome's own dialog on its native shortcut.
    if (resolveAction(location.href, settings.siteRules, settings.defaultAction) === 'native') return;

    event.preventDefault();
    event.stopPropagation();
    void requestPrint('shortcut');
  },
  // Capture phase, so the browser's built-in handling never gets the event first.
  true,
);

async function requestPrint(trigger: PrintTrigger): Promise<void> {
  const response = await send({ type: 'print-requested', trigger });
  if (!response.ok && isTopFrame) {
    showError(response.error);
  }
}

function nativePrint(): void {
  window.dispatchEvent(new CustomEvent(PAGE_EVENT_NATIVE_PRINT));
}

// --------------------------------------------------------------------------
// Status updates pushed from the service worker
// --------------------------------------------------------------------------

chrome.runtime.onMessage.addListener((message: TabMessage) => {
  if (message.type === 'settings-changed') {
    applySettings(message.settings);
    return;
  }
  // Only the top frame draws UI, otherwise every iframe would stack a card.
  if (!isTopFrame) return;

  switch (message.type) {
    case 'native-print':
      nativePrint();
      break;
    case 'confirm-print':
      showToast('ask', 'Save this page to Google Drive?', {
        detail: settings.folderName ? `It will go to "${settings.folderName}".` : undefined,
        actions: [
          { label: 'Save to Drive', primary: true, onClick: () => void requestPrint('action') },
          { label: 'System dialog', onClick: nativePrint },
        ],
      });
      break;
    case 'status':
      if (message.state === 'working') {
        showToast('working', message.label);
      } else if (message.state === 'success') {
        showToast('success', message.label, { link: message.link, dismissAfter: 8000 });
      } else {
        showError(message.label);
      }
      break;
  }
});

function showError(detail: string): void {
  showToast('error', 'Could not save to Drive', {
    detail,
    actions: [
      { label: 'Use system dialog', onClick: nativePrint },
      { label: 'Settings', onClick: openOptions },
    ],
    dismissAfter: 20000,
  });
}

function openOptions(): void {
  // A content script may not navigate to a non-web-accessible extension page,
  // so the service worker opens the options tab on our behalf.
  void send({ type: 'open-options' });
}

window.addEventListener('pagehide', hideToast);
