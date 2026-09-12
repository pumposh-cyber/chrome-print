import type { AuthState } from '../shared/messages';
import type { Bytes, DriveFolder } from '../shared/types';

const FILES_API = 'https://www.googleapis.com/drive/v3/files';
const UPLOAD_API = 'https://www.googleapis.com/upload/drive/v3/files';
const USERINFO_API = 'https://www.googleapis.com/oauth2/v3/userinfo';
const FOLDER_MIME = 'application/vnd.google-apps.folder';

/**
 * drive.file only grants access to files and folders this extension created or
 * the user explicitly opened with it. It is a non-sensitive scope, so a
 * self-installed build works without going through OAuth verification.
 */
export const BASE_SCOPES = [
  'https://www.googleapis.com/auth/drive.file',
  'https://www.googleapis.com/auth/userinfo.email',
];

/**
 * Optional, and deliberately opt-in: listing folders the extension did not
 * create needs a restricted scope, which Google only grants an unverified app
 * for accounts listed as test users on its OAuth consent screen.
 */
export const BROWSE_SCOPES = [...BASE_SCOPES, 'https://www.googleapis.com/auth/drive.readonly'];

export class DriveError extends Error {
  constructor(
    message: string,
    readonly status?: number,
  ) {
    super(message);
    this.name = 'DriveError';
  }
}

/** Cached only for the lifetime of the service worker; Chrome owns the real cache. */
let cachedToken: string | null = null;

export async function getToken(interactive: boolean, scopes?: string[]): Promise<string> {
  const result = await chrome.identity.getAuthToken({ interactive, ...(scopes ? { scopes } : {}) });
  // Chrome returns a bare string on older builds and an object on newer ones.
  const token = typeof result === 'string' ? result : result?.token;
  if (!token) throw new DriveError('Google did not return an access token.');
  cachedToken = token;
  return token;
}

export async function signOut(): Promise<void> {
  const token = cachedToken ?? (await tryGetToken(false));
  if (token) {
    // Revoking as well as clearing means the next sign-in re-shows the consent
    // screen, which is what a user expects from "disconnect".
    await fetch(`https://accounts.google.com/o/oauth2/revoke?token=${token}`).catch(() => undefined);
    await chrome.identity.removeCachedAuthToken({ token }).catch(() => undefined);
  }
  await chrome.identity.clearAllCachedAuthTokens?.().catch(() => undefined);
  cachedToken = null;
}

async function tryGetToken(interactive: boolean, scopes?: string[]): Promise<string | null> {
  try {
    return await getToken(interactive, scopes);
  } catch {
    return null;
  }
}

export async function getAuthState(): Promise<AuthState> {
  const token = await tryGetToken(false);
  if (!token) return { signedIn: false, email: null, canBrowseDrive: false };

  const [email, canBrowseDrive] = await Promise.all([
    fetchEmail(token),
    tryGetToken(false, BROWSE_SCOPES).then((t) => t !== null),
  ]);
  return { signedIn: true, email, canBrowseDrive };
}

async function fetchEmail(token: string): Promise<string | null> {
  try {
    const response = await fetch(USERINFO_API, { headers: { Authorization: `Bearer ${token}` } });
    if (!response.ok) return null;
    const body = (await response.json()) as { email?: string };
    return body.email ?? null;
  } catch {
    return null;
  }
}

/**
 * Call the Drive API with a valid token, refreshing once if Google rejects the
 * cached one (tokens expire after an hour and Chrome caches them eagerly).
 */
async function authedFetch(
  url: string,
  init: RequestInit,
  scopes?: string[],
): Promise<globalThis.Response> {
  let token = await getToken(false, scopes);
  let response = await fetch(url, withAuth(init, token));

  if (response.status === 401) {
    await chrome.identity.removeCachedAuthToken({ token }).catch(() => undefined);
    cachedToken = null;
    token = await getToken(false, scopes);
    response = await fetch(url, withAuth(init, token));
  }
  return response;
}

function withAuth(init: RequestInit, token: string): RequestInit {
  const headers = new Headers(init.headers);
  headers.set('Authorization', `Bearer ${token}`);
  return { ...init, headers };
}

async function readError(response: globalThis.Response, fallback: string): Promise<DriveError> {
  let detail = '';
  try {
    const body = (await response.json()) as { error?: { message?: string } };
    detail = body.error?.message ?? '';
  } catch {
    detail = await response.text().catch(() => '');
  }
  return new DriveError(detail ? `${fallback}: ${detail}` : `${fallback} (HTTP ${response.status})`, response.status);
}

export async function listFolders(parentId?: string, scopes?: string[]): Promise<DriveFolder[]> {
  const clauses = [`mimeType = '${FOLDER_MIME}'`, 'trashed = false'];
  if (parentId) clauses.push(`'${parentId}' in parents`);

  const params = new URLSearchParams({
    q: clauses.join(' and '),
    fields: 'files(id,name)',
    orderBy: 'name',
    pageSize: '200',
    spaces: 'drive',
    supportsAllDrives: 'true',
    includeItemsFromAllDrives: 'true',
  });

  const response = await authedFetch(`${FILES_API}?${params}`, { method: 'GET' }, scopes);
  if (!response.ok) throw await readError(response, 'Could not list Drive folders');

  const body = (await response.json()) as { files?: DriveFolder[] };
  return body.files ?? [];
}

export async function createFolder(name: string, parentId?: string): Promise<DriveFolder> {
  const params = new URLSearchParams({ fields: 'id,name', supportsAllDrives: 'true' });
  const response = await authedFetch(`${FILES_API}?${params}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name,
      mimeType: FOLDER_MIME,
      ...(parentId ? { parents: [parentId] } : {}),
    }),
  });
  if (!response.ok) throw await readError(response, 'Could not create the Drive folder');
  return (await response.json()) as DriveFolder;
}

/** Returns null when the folder was deleted or is no longer visible to us. */
export async function getFolder(id: string): Promise<DriveFolder | null> {
  const params = new URLSearchParams({ fields: 'id,name,trashed', supportsAllDrives: 'true' });
  const response = await authedFetch(`${FILES_API}/${encodeURIComponent(id)}?${params}`, {
    method: 'GET',
  });
  if (response.status === 404 || response.status === 403) return null;
  if (!response.ok) throw await readError(response, 'Could not read the Drive folder');

  const folder = (await response.json()) as DriveFolder & { trashed?: boolean };
  return folder.trashed ? null : { id: folder.id, name: folder.name };
}

export interface UploadedFile {
  id: string;
  name: string;
  webViewLink: string;
}

/** Anything larger goes through a resumable upload so a dropped connection is recoverable. */
const RESUMABLE_THRESHOLD_BYTES = 5 * 1024 * 1024;

export async function uploadPdf(
  bytes: Bytes,
  name: string,
  folderId: string,
  sourceUrl: string,
): Promise<UploadedFile> {
  const metadata = {
    name,
    mimeType: 'application/pdf',
    parents: [folderId],
    description: `Printed from ${sourceUrl}`,
    // Surfaced in Drive's details pane, handy when tracing where a PDF came from.
    properties: { printToDriveSource: sourceUrl.slice(0, 120) },
  };

  return bytes.byteLength > RESUMABLE_THRESHOLD_BYTES
    ? uploadResumable(bytes, metadata)
    : uploadMultipart(bytes, metadata);
}

async function uploadMultipart(
  bytes: Bytes,
  metadata: Record<string, unknown>,
): Promise<UploadedFile> {
  const boundary = `ptd-${crypto.randomUUID()}`;
  const body = new Blob([
    `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n`,
    JSON.stringify(metadata),
    `\r\n--${boundary}\r\nContent-Type: application/pdf\r\n\r\n`,
    bytes,
    `\r\n--${boundary}--\r\n`,
  ]);

  const params = new URLSearchParams({
    uploadType: 'multipart',
    fields: 'id,name,webViewLink',
    supportsAllDrives: 'true',
  });

  const response = await authedFetch(`${UPLOAD_API}?${params}`, {
    method: 'POST',
    headers: { 'Content-Type': `multipart/related; boundary=${boundary}` },
    body,
  });
  if (!response.ok) throw await readError(response, 'Drive rejected the upload');
  return (await response.json()) as UploadedFile;
}

async function uploadResumable(
  bytes: Bytes,
  metadata: Record<string, unknown>,
): Promise<UploadedFile> {
  const params = new URLSearchParams({
    uploadType: 'resumable',
    fields: 'id,name,webViewLink',
    supportsAllDrives: 'true',
  });

  const start = await authedFetch(`${UPLOAD_API}?${params}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json; charset=UTF-8',
      'X-Upload-Content-Type': 'application/pdf',
      'X-Upload-Content-Length': String(bytes.byteLength),
    },
    body: JSON.stringify(metadata),
  });
  if (!start.ok) throw await readError(start, 'Drive refused to start the upload');

  const location = start.headers.get('Location');
  if (!location) throw new DriveError('Drive did not return an upload URL.');

  // The session URL carries its own credentials, so this PUT is deliberately unauthed.
  const response = await fetch(location, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/pdf' },
    body: new Blob([bytes]),
  });
  if (!response.ok) throw await readError(response, 'Drive rejected the upload');
  return (await response.json()) as UploadedFile;
}
