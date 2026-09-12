import { getSettings } from '../shared/settings';
import {
  BASE_SCOPES,
  getAccessToken,
  getRedirectUri,
  manifestClientId,
  resolveBackend,
  supportsChromeIdentity,
} from './auth';
import { authConfig, getFolder, listFolders } from './drive';

export type CheckStatus = 'ok' | 'warn' | 'fail' | 'pending';

export interface DiagnosticCheck {
  id: string;
  label: string;
  status: CheckStatus;
  detail: string;
  /** A console page that fixes this specific problem, when one exists. */
  fixUrl?: string;
  fixLabel?: string;
}

export interface Diagnostics {
  extensionId: string;
  redirectUri: string;
  backend: string;
  backendReason: string;
  checks: DiagnosticCheck[];
}

/** A Google client ID looks like "1234567890-hash.apps.googleusercontent.com". */
export const CLIENT_ID_PATTERN = /^\d+-[A-Za-z0-9_-]+\.apps\.googleusercontent\.com$/;

/** Pull the project number out of a client ID; it prefixes every one of them. */
export function projectNumberFromClientId(clientId: string): string | null {
  const match = /^(\d+)-/.exec(clientId);
  return match ? (match[1] as string) : null;
}

/**
 * Google's "API not enabled" error embeds a link that turns the API on for the
 * exact project involved. Surfacing it turns a dead end into one click.
 */
export function activationUrlFromError(message: string): string | null {
  const match = /https:\/\/console\.(?:developers|cloud)\.google\.com\/[^\s"')]+/.exec(message);
  return match ? match[0] : null;
}

export async function runDiagnostics(): Promise<Diagnostics> {
  const settings = await getSettings();
  const config = await authConfig();
  const resolved = resolveBackend(config);

  const checks: DiagnosticCheck[] = [];
  const clientId = resolved.clientId;

  // 1. Is there a client ID at all, and does it look like one?
  if (!clientId) {
    checks.push({
      id: 'client-id',
      label: 'Google client ID',
      status: 'fail',
      detail:
        'Not configured. Create an OAuth client in the Google Cloud Console and paste its ID above.',
      fixUrl: 'https://console.cloud.google.com/apis/credentials',
      fixLabel: 'Open Credentials',
    });
  } else if (!CLIENT_ID_PATTERN.test(clientId)) {
    checks.push({
      id: 'client-id',
      label: 'Google client ID',
      status: 'warn',
      detail: `"${clientId}" does not look like a client ID. Expected digits, a dash, then .apps.googleusercontent.com`,
    });
  } else {
    const source = settings.oauthClientId ? 'from this page' : 'from the manifest';
    checks.push({
      id: 'client-id',
      label: 'Google client ID',
      status: 'ok',
      detail: `Configured ${source} (project ${projectNumberFromClientId(clientId) ?? 'unknown'}).`,
    });
  }

  // 2. Can we get a token without prompting?
  let token: string | null = null;
  if (clientId) {
    token = await getAccessToken({ config, scopes: BASE_SCOPES, interactive: false }).catch(
      () => null,
    );
    checks.push({
      id: 'signed-in',
      label: 'Signed in to Google',
      status: token ? 'ok' : 'fail',
      detail: token
        ? 'A valid access token is cached.'
        : 'Not connected yet. Use Connect Google Drive above.',
    });
  }

  // 3. Does the Drive API actually answer? This is where a project with the
  //    API switched off, or an account missing from the test-user list, shows up.
  if (token) {
    try {
      await listFolders();
      checks.push({
        id: 'drive-api',
        label: 'Google Drive API',
        status: 'ok',
        detail: 'Reachable, and the extension can list the folders it owns.',
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const activation = activationUrlFromError(message);
      checks.push({
        id: 'drive-api',
        label: 'Google Drive API',
        status: 'fail',
        detail: message,
        ...(activation ? { fixUrl: activation, fixLabel: 'Enable the API' } : {}),
      });
    }
  }

  // 4. Is the saved destination folder still there?
  if (token && settings.folderId) {
    const folder = await getFolder(settings.folderId).catch(() => null);
    checks.push({
      id: 'folder',
      label: 'Destination folder',
      status: folder ? 'ok' : 'warn',
      detail: folder
        ? `Saving to "${folder.name}".`
        : 'The saved folder is gone. A new "Printed Pages" folder will be created on the next save.',
    });
  } else if (token) {
    checks.push({
      id: 'folder',
      label: 'Destination folder',
      status: 'ok',
      detail: 'None chosen; a "Printed Pages" folder will be created on the first save.',
    });
  }

  // 5. Browser capability, which decides the auth backend.
  checks.push({
    id: 'backend',
    label: 'Sign-in method',
    status: 'ok',
    detail: supportsChromeIdentity()
      ? `${resolved.backend} — ${resolved.reason}`
      : `${resolved.backend} — this browser has no chrome.identity.getAuthToken.`,
  });

  return {
    extensionId: chrome.runtime.id,
    redirectUri: getRedirectUri(),
    backend: resolved.backend,
    backendReason: resolved.reason,
    checks,
  };
}

/** True when the manifest ships a usable client ID, so setup needs no console work. */
export function hasBundledClientId(): boolean {
  return manifestClientId() !== null;
}
