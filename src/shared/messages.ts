import type { Diagnostics } from '../background/diagnostics';
import type { DriveFolder, HistoryEntry, Settings } from './types';

export * from './events';

export type PrintTrigger = 'shortcut' | 'window.print' | 'action' | 'command';

/** Messages sent from a content script or UI page to the service worker. */
export type RequestMessage =
  | { type: 'print-requested'; trigger: PrintTrigger }
  | { type: 'print-active-tab'; trigger: PrintTrigger }
  | { type: 'get-settings' }
  | { type: 'save-settings'; patch: Partial<Settings> }
  | { type: 'sign-in'; broadScope?: boolean }
  | { type: 'sign-out' }
  | { type: 'get-auth-state' }
  | { type: 'list-folders'; parentId?: string }
  | { type: 'create-folder'; name: string; parentId?: string }
  | { type: 'open-options' }
  | { type: 'run-diagnostics' }
  | { type: 'get-history' }
  | { type: 'clear-history' };

export interface AuthState {
  signedIn: boolean;
  email: string | null;
  /** True when the user granted the wider scope that can browse existing folders. */
  canBrowseDrive: boolean;
  /** Which sign-in mechanism is in use: 'chrome-identity' or 'web-auth-flow'. */
  backend: string;
  /** False when no client ID is configured anywhere, so sign-in cannot start. */
  hasClientId: boolean;
}

export interface SaveResult {
  fileId: string;
  name: string;
  webViewLink: string;
  bytes: number;
}

/** Discriminated result wrapper so callers never have to read chrome.runtime.lastError. */
export type Response<T> = { ok: true; data: T } | { ok: false; error: string; code?: ErrorCode };

export type ErrorCode =
  | 'not-signed-in'
  | 'no-folder'
  | 'restricted-url'
  | 'debugger-unavailable'
  | 'debugger-in-use'
  | 'upload-failed'
  | 'cancelled';

export interface ResponseMap {
  'print-requested': { started: boolean };
  'print-active-tab': { started: boolean };
  'get-settings': Settings;
  'save-settings': Settings;
  'sign-in': AuthState;
  'sign-out': null;
  'get-auth-state': AuthState;
  'list-folders': DriveFolder[];
  'create-folder': DriveFolder;
  'open-options': null;
  'run-diagnostics': Diagnostics;
  'get-history': HistoryEntry[];
  'clear-history': null;
}

/** Pushed from the service worker down to a tab's content script. */
export type TabMessage =
  | { type: 'status'; state: 'working'; label: string }
  | { type: 'status'; state: 'success'; label: string; link?: string }
  | { type: 'status'; state: 'error'; label: string; canRetryNative?: boolean }
  | { type: 'confirm-print' }
  | { type: 'native-print' }
  | { type: 'settings-changed'; settings: Settings };

/**
 * Promise wrapper around chrome.runtime.sendMessage that preserves the response
 * type for a given request and turns transport failures into a typed error.
 */
export async function send<K extends RequestMessage['type']>(
  message: Extract<RequestMessage, { type: K }>,
): Promise<Response<ResponseMap[K]>> {
  try {
    return (await chrome.runtime.sendMessage(message)) as Response<ResponseMap[K]>;
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}
