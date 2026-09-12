import {
  type PrintTrigger,
  type RequestMessage,
  type Response,
  type TabMessage,
} from '../shared/messages';
import { renderFilename } from '../shared/filename';
import { isRestrictedUrl, resolveAction } from '../shared/matcher';
import { getSettings, saveSettings } from '../shared/settings';
import type { Bytes, Settings } from '../shared/types';
import {
  BASE_SCOPES,
  BROWSE_SCOPES,
  createFolder,
  getAuthState,
  getFolder,
  listFolders,
  signIn,
  signOut,
  uploadPdf,
} from './drive';
import { runDiagnostics } from './diagnostics';
import { AuthError } from './auth';
import { addHistoryEntry, clearHistory, getHistory } from './history';
import { PdfError, renderTabToPdf } from './pdf';

const DEFAULT_FOLDER_NAME = 'Printed Pages';
const CONTEXT_MENU_ID = 'print-to-drive-save';

/** Tabs with a save already running, so a double Ctrl+P does not double-upload. */
const inFlight = new Set<number>();

// --------------------------------------------------------------------------
// Lifecycle
// --------------------------------------------------------------------------

chrome.runtime.onInstalled.addListener((details) => {
  chrome.contextMenus.create(
    {
      id: CONTEXT_MENU_ID,
      title: 'Save this page to Drive as PDF',
      contexts: ['page', 'selection', 'link', 'image'],
    },
    () => void chrome.runtime.lastError,
  );

  if (details.reason === 'install') {
    chrome.runtime.openOptionsPage().catch(() => undefined);
  }
});

chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (info.menuItemId === CONTEXT_MENU_ID && tab?.id !== undefined) {
    void handlePrint(tab, 'action');
  }
});

chrome.commands.onCommand.addListener((command, tab) => {
  if (command === 'save-to-drive' && tab?.id !== undefined) {
    void handlePrint(tab, 'command');
  }
});

chrome.notifications.onClicked.addListener((notificationId) => {
  const link = notificationLinks.get(notificationId);
  if (link) {
    void chrome.tabs.create({ url: link });
    chrome.notifications.clear(notificationId);
  }
});

const notificationLinks = new Map<string, string>();

// --------------------------------------------------------------------------
// Message routing
// --------------------------------------------------------------------------

chrome.runtime.onMessage.addListener((message: RequestMessage, sender, sendResponse) => {
  handleMessage(message, sender)
    .then((data) => sendResponse({ ok: true, data } satisfies Response<unknown>))
    .catch((error: unknown) => sendResponse(toErrorResponse(error)));
  // Keep the message channel open for the async work above.
  return true;
});

async function handleMessage(
  message: RequestMessage,
  sender: chrome.runtime.MessageSender,
): Promise<unknown> {
  switch (message.type) {
    case 'print-requested': {
      const tab = sender.tab;
      if (!tab?.id) throw new Error('This page cannot be printed to Drive.');
      // Do not await: the content script needs its reply before the upload ends.
      void handlePrint(tab, message.trigger);
      return { started: true };
    }
    case 'print-active-tab': {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (!tab?.id) throw new Error('No active tab.');
      void handlePrint(tab, message.trigger);
      return { started: true };
    }
    case 'get-settings':
      return getSettings();
    case 'save-settings': {
      const settings = await saveSettings(message.patch);
      await broadcastSettings(settings);
      return settings;
    }
    case 'sign-in':
      await signIn(message.broadScope === true);
      return getAuthState();
    case 'sign-out':
      await signOut();
      return null;
    case 'get-auth-state':
      return getAuthState();
    case 'list-folders': {
      const { canBrowseDrive } = await getAuthState();
      return listFolders(message.parentId, canBrowseDrive ? BROWSE_SCOPES : BASE_SCOPES);
    }
    case 'create-folder':
      return createFolder(message.name, message.parentId);
    case 'open-options':
      await chrome.runtime.openOptionsPage();
      return null;
    case 'run-diagnostics':
      return runDiagnostics();
    case 'get-history':
      return getHistory();
    case 'clear-history':
      await clearHistory();
      return null;
    default: {
      const exhaustive: never = message;
      throw new Error(`Unknown message: ${JSON.stringify(exhaustive)}`);
    }
  }
}

function toErrorResponse(error: unknown): Response<never> {
  if (error instanceof PdfError) return { ok: false, error: error.message, code: error.code };
  if (error instanceof AuthError) return { ok: false, error: error.message };
  return { ok: false, error: error instanceof Error ? error.message : String(error) };
}

// --------------------------------------------------------------------------
// The main flow
// --------------------------------------------------------------------------

async function handlePrint(tab: chrome.tabs.Tab, trigger: PrintTrigger): Promise<void> {
  const tabId = tab.id;
  if (tabId === undefined) return;

  const settings = await getSettings();
  const url = tab.url ?? '';

  if (!settings.enabled) return void fallBackToNativePrint(tabId);

  if (isRestrictedUrl(url)) {
    await notifyTab(tabId, {
      type: 'status',
      state: 'error',
      label: 'Chrome does not allow extensions to print this page.',
    });
    return;
  }

  // An explicit click or shortcut is already a decision, so it skips "ask".
  const userInitiated = trigger === 'action' || trigger === 'command';
  const action = resolveAction(url, settings.siteRules, settings.defaultAction);

  if (!userInitiated) {
    if (action === 'native') return void fallBackToNativePrint(tabId);
    if (action === 'ask') return void notifyTab(tabId, { type: 'confirm-print' });
  }

  if (inFlight.has(tabId)) return;
  inFlight.add(tabId);

  // The status card is optional; the rest of the flow is unaffected by it.
  const status = (message: TabMessage) =>
    settings.showToast ? notifyTab(tabId, message) : Promise.resolve();

  try {
    await status({ type: 'status', state: 'working', label: 'Rendering PDF…' });
    const bytes = await renderTabToPdf(tabId, settings);

    await status({ type: 'status', state: 'working', label: 'Uploading to Drive…' });
    const folder = await ensureFolder(settings);
    const name = renderFilename(settings.filenameTemplate, { title: tab.title ?? '', url });
    const file = await uploadPdf(bytes, name, folder.id, url);

    await addHistoryEntry({
      fileId: file.id,
      name: file.name,
      webViewLink: file.webViewLink,
      url,
      savedAt: Date.now(),
      bytes: bytes.byteLength,
    });

    if (settings.alsoDownloadLocally) await downloadLocally(bytes, file.name);
    if (settings.openAfterSave) await chrome.tabs.create({ url: file.webViewLink, active: false });

    await status({
      type: 'status',
      state: 'success',
      label: `Saved to ${folder.name}`,
      link: file.webViewLink,
    });
    if (settings.notifyOnSuccess) showNotification(file.name, folder.name, file.webViewLink);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await status({ type: 'status', state: 'error', label: message, canRetryNative: true });
    // Errors on a background upload are easy to miss, so always surface one.
    chrome.notifications.create({
      type: 'basic',
      iconUrl: chrome.runtime.getURL('icons/icon-128.png'),
      title: 'Could not save to Drive',
      message,
    });
  } finally {
    inFlight.delete(tabId);
  }
}

/**
 * Resolve the destination folder, recreating the default one if the stored
 * folder was deleted so a save never fails just because Drive changed.
 */
async function ensureFolder(settings: Settings): Promise<{ id: string; name: string }> {
  if (settings.folderId) {
    const existing = await getFolder(settings.folderId);
    if (existing) return existing;
  }

  const created = await createFolder(settings.folderName || DEFAULT_FOLDER_NAME);
  await saveSettings({ folderId: created.id, folderName: created.name });
  return created;
}

async function downloadLocally(bytes: Bytes, filename: string): Promise<void> {
  // Service workers have no URL.createObjectURL, so the copy goes out as a data URL.
  const base64 = bytesToBase64(bytes);
  await chrome.downloads
    .download({ url: `data:application/pdf;base64,${base64}`, filename, saveAs: false })
    .catch(() => undefined);
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return btoa(binary);
}

function showNotification(fileName: string, folderName: string, link: string): void {
  chrome.notifications.create(
    {
      type: 'basic',
      iconUrl: chrome.runtime.getURL('icons/icon-128.png'),
      title: 'Saved to Google Drive',
      message: `${fileName}\nin ${folderName}`,
      buttons: [{ title: 'Open in Drive' }],
    },
    (id) => {
      if (id) notificationLinks.set(id, link);
    },
  );
}

chrome.notifications.onButtonClicked.addListener((id) => {
  const link = notificationLinks.get(id);
  if (link) {
    void chrome.tabs.create({ url: link });
    chrome.notifications.clear(id);
  }
});

// --------------------------------------------------------------------------
// Talking back to tabs
// --------------------------------------------------------------------------

async function notifyTab(tabId: number, message: TabMessage): Promise<void> {
  // A tab with no content script (or one that navigated away) is not an error.
  await chrome.tabs.sendMessage(tabId, message).catch(() => undefined);
}

/**
 * Ask the page to run the real window.print() that the page-world script
 * stashed before overriding it. Routed through the content script so the
 * extension needs no host permission on the pages it prints.
 */
async function fallBackToNativePrint(tabId: number): Promise<void> {
  await notifyTab(tabId, { type: 'native-print' });
}

async function broadcastSettings(settings: Settings): Promise<void> {
  const tabs = await chrome.tabs.query({});
  await Promise.all(
    tabs.map((tab) =>
      tab.id === undefined
        ? Promise.resolve()
        : chrome.tabs
            .sendMessage(tab.id, { type: 'settings-changed', settings } satisfies TabMessage)
            .catch(() => undefined),
    ),
  );
}
