/**
 * Token acquisition, with two interchangeable backends.
 *
 * `chrome-identity` uses chrome.identity.getAuthToken, which reads the client
 * ID from the manifest and manages refresh itself. It is the proven path, but
 * it is Chrome-only and cannot use a client ID supplied at runtime.
 *
 * `web-auth-flow` drives the OAuth redirect by hand through
 * chrome.identity.launchWebAuthFlow. That accepts a client ID from settings,
 * so nobody has to edit and rebuild the manifest, and it works on Chromium
 * browsers that do not implement getAuthToken.
 */

export const DRIVE_FILE_SCOPE = 'https://www.googleapis.com/auth/drive.file';
export const EMAIL_SCOPE = 'https://www.googleapis.com/auth/userinfo.email';
export const DRIVE_READONLY_SCOPE = 'https://www.googleapis.com/auth/drive.readonly';

export const BASE_SCOPES = [DRIVE_FILE_SCOPE, EMAIL_SCOPE];
export const BROWSE_SCOPES = [...BASE_SCOPES, DRIVE_READONLY_SCOPE];

const AUTH_ENDPOINT = 'https://accounts.google.com/o/oauth2/v2/auth';
const REVOKE_ENDPOINT = 'https://oauth2.googleapis.com/revoke';

/** An interactive sign-in that has not finished by now is never going to. */
const INTERACTIVE_TIMEOUT_MS = 120_000;
const SILENT_TIMEOUT_MS = 20_000;

/** Refresh a little early so a request never goes out with a just-expired token. */
const EXPIRY_SKEW_MS = 60_000;

export type AuthBackend = 'chrome-identity' | 'web-auth-flow';

export type AuthErrorCode =
  | 'no-client-id'
  | 'not-signed-in'
  | 'consent-required'
  | 'timed-out'
  | 'denied'
  | 'unsupported';

export class AuthError extends Error {
  constructor(
    message: string,
    readonly code: AuthErrorCode,
  ) {
    super(message);
    this.name = 'AuthError';
  }
}

export interface AuthConfig {
  /** Client ID entered in the options page. Overrides the manifest's. */
  customClientId: string | null;
}

export interface ResolvedBackend {
  backend: AuthBackend;
  clientId: string | null;
  /** Why this backend was chosen, surfaced in the setup panel. */
  reason: string;
}

/** The ID compiled into the manifest, ignoring the unconfigured placeholder. */
export function manifestClientId(): string | null {
  const raw = chrome.runtime.getManifest().oauth2?.client_id ?? '';
  return raw && !raw.startsWith('REPLACE_WITH_') ? raw : null;
}

export function getRedirectUri(): string {
  return chrome.identity.getRedirectURL();
}

export function supportsChromeIdentity(): boolean {
  return typeof chrome.identity?.getAuthToken === 'function';
}

/**
 * Decide how to authenticate. A client ID the user typed always wins, because
 * choosing it is an explicit request to use their own Google project.
 */
export function resolveBackend(config: AuthConfig): ResolvedBackend {
  if (config.customClientId) {
    return {
      backend: 'web-auth-flow',
      clientId: config.customClientId,
      reason: 'Using the client ID from this options page.',
    };
  }
  const bundled = manifestClientId();
  if (bundled && supportsChromeIdentity()) {
    return {
      backend: 'chrome-identity',
      clientId: bundled,
      reason: "Using the client ID shipped in the extension's manifest.",
    };
  }
  if (bundled) {
    return {
      backend: 'web-auth-flow',
      clientId: bundled,
      reason: 'This browser has no getAuthToken, so the redirect flow is used.',
    };
  }
  return {
    backend: 'web-auth-flow',
    clientId: null,
    reason: 'No client ID configured yet.',
  };
}

// ---------------------------------------------------------------------------
// Token cache
// ---------------------------------------------------------------------------

interface CachedToken {
  token: string;
  expiresAt: number;
  scopes: string[];
}

const CACHE_KEY = 'oauth-token';

/** In-memory fallback for builds where storage.session is unavailable. */
let memoryCache: CachedToken | null = null;

async function readCache(): Promise<CachedToken | null> {
  try {
    const { [CACHE_KEY]: cached } = await chrome.storage.session.get(CACHE_KEY);
    return (cached as CachedToken | undefined) ?? null;
  } catch {
    return memoryCache;
  }
}

async function writeCache(value: CachedToken | null): Promise<void> {
  memoryCache = value;
  try {
    if (value) await chrome.storage.session.set({ [CACHE_KEY]: value });
    else await chrome.storage.session.remove(CACHE_KEY);
  } catch {
    // storage.session is best-effort; the in-memory copy above still stands.
  }
}

function cacheSatisfies(cached: CachedToken | null, scopes: string[]): boolean {
  if (!cached) return false;
  if (cached.expiresAt - EXPIRY_SKEW_MS <= Date.now()) return false;
  return scopes.every((scope) => cached.scopes.includes(scope));
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export interface TokenRequest {
  config: AuthConfig;
  scopes: string[];
  interactive: boolean;
}

export async function getAccessToken({ config, scopes, interactive }: TokenRequest): Promise<string> {
  const cached = await readCache();
  if (cacheSatisfies(cached, scopes)) return (cached as CachedToken).token;

  const resolved = resolveBackend(config);
  if (!resolved.clientId) {
    throw new AuthError(
      'No Google client ID is configured. Add one in the extension options.',
      'no-client-id',
    );
  }

  const token =
    resolved.backend === 'chrome-identity'
      ? await chromeIdentityToken(scopes, interactive)
      : await webAuthFlowToken(resolved.clientId, scopes, interactive);

  await writeCache(token);
  return token.token;
}

export async function clearTokens(config: AuthConfig): Promise<void> {
  const cached = await readCache();
  await writeCache(null);

  if (cached?.token) {
    // Revoking makes the next sign-in re-show the consent screen, which is what
    // a user expects from "disconnect".
    await fetch(`${REVOKE_ENDPOINT}?token=${encodeURIComponent(cached.token)}`, {
      method: 'POST',
    }).catch(() => undefined);
  }

  if (resolveBackend(config).backend === 'chrome-identity' && supportsChromeIdentity()) {
    if (cached?.token) {
      await chrome.identity.removeCachedAuthToken({ token: cached.token }).catch(() => undefined);
    }
    await chrome.identity.clearAllCachedAuthTokens?.().catch(() => undefined);
  }
}

/** Drop a token the Drive API rejected, so the next call fetches a fresh one. */
export async function invalidateToken(token: string, config: AuthConfig): Promise<void> {
  await writeCache(null);
  if (resolveBackend(config).backend === 'chrome-identity' && supportsChromeIdentity()) {
    await chrome.identity.removeCachedAuthToken({ token }).catch(() => undefined);
  }
}

// ---------------------------------------------------------------------------
// Backends
// ---------------------------------------------------------------------------

async function chromeIdentityToken(scopes: string[], interactive: boolean): Promise<CachedToken> {
  const result = await withTimeout(
    chrome.identity.getAuthToken({ interactive, scopes }),
    interactive ? INTERACTIVE_TIMEOUT_MS : SILENT_TIMEOUT_MS,
  );

  // Chrome returns a bare string on older builds and an object on newer ones.
  const token = typeof result === 'string' ? result : result?.token;
  if (!token) throw new AuthError('Google did not return an access token.', 'not-signed-in');

  return {
    token,
    // getAuthToken hides the real lifetime; Google's tokens last an hour.
    expiresAt: Date.now() + 3_600_000,
    scopes,
  };
}

async function webAuthFlowToken(
  clientId: string,
  scopes: string[],
  interactive: boolean,
): Promise<CachedToken> {
  const params = new URLSearchParams({
    client_id: clientId,
    response_type: 'token',
    redirect_uri: getRedirectUri(),
    scope: scopes.join(' '),
    // Without this a silent attempt would pop a window, defeating the point.
    ...(interactive ? {} : { prompt: 'none' }),
  });

  let responseUrl: string | undefined;
  try {
    responseUrl = await withTimeout(
      chrome.identity.launchWebAuthFlow({ url: `${AUTH_ENDPOINT}?${params}`, interactive }),
      interactive ? INTERACTIVE_TIMEOUT_MS : SILENT_TIMEOUT_MS,
    );
  } catch (error) {
    if (error instanceof AuthError) throw error;
    const message = error instanceof Error ? error.message : String(error);
    if (/did not approve|canceled|cancelled|closed/i.test(message)) {
      throw new AuthError('Sign-in was cancelled.', 'denied');
    }
    throw new AuthError(
      interactive ? `Sign-in failed: ${message}` : 'Not signed in.',
      interactive ? 'denied' : 'not-signed-in',
    );
  }

  if (!responseUrl) throw new AuthError('Not signed in.', 'not-signed-in');
  return parseImplicitResponse(responseUrl, scopes);
}

export function parseImplicitResponse(responseUrl: string, scopes: string[]): CachedToken {
  const url = new URL(responseUrl);
  // The implicit flow returns its payload in the fragment, not the query.
  const fragment = new URLSearchParams(url.hash.replace(/^#/, ''));
  const query = new URLSearchParams(url.search);

  const error = fragment.get('error') ?? query.get('error');
  if (error) {
    if (error === 'interaction_required' || error === 'login_required' || error === 'consent_required') {
      throw new AuthError('Google needs you to sign in again.', 'consent-required');
    }
    if (error === 'access_denied') {
      throw new AuthError(
        'Google denied access. Check that your account is a test user on the consent screen.',
        'denied',
      );
    }
    throw new AuthError(`Google returned "${error}".`, 'denied');
  }

  const token = fragment.get('access_token');
  if (!token) throw new AuthError('Google did not return an access token.', 'not-signed-in');

  const expiresIn = Number(fragment.get('expires_in') ?? '3600');
  const granted = fragment.get('scope');

  return {
    token,
    expiresAt: Date.now() + (Number.isFinite(expiresIn) ? expiresIn : 3600) * 1000,
    // Google may grant fewer scopes than asked; record what it actually gave.
    scopes: granted ? granted.split(' ') : scopes,
  };
}

/**
 * Reject rather than hang forever. The underlying auth window may still be
 * open, but the UI gets an answer it can show instead of spinning.
 */
export function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new AuthError('Google did not respond in time.', 'timed-out')),
      ms,
    );
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error: unknown) => {
        clearTimeout(timer);
        reject(error instanceof Error ? error : new Error(String(error)));
      },
    );
  });
}
