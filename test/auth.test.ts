import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  AuthError,
  BASE_SCOPES,
  manifestClientId,
  parseImplicitResponse,
  resolveBackend,
  supportsChromeIdentity,
  withTimeout,
} from '../src/background/auth';

const REDIRECT = 'https://abc.chromiumapp.org/';

/** Minimal stand-in for the parts of the chrome API these functions read. */
function stubChrome(options: { clientId?: string; getAuthToken?: boolean } = {}) {
  (globalThis as Record<string, unknown>).chrome = {
    runtime: {
      getManifest: () => (options.clientId ? { oauth2: { client_id: options.clientId } } : {}),
    },
    identity: options.getAuthToken === false ? {} : { getAuthToken: () => undefined },
  };
}

afterEach(() => {
  delete (globalThis as Record<string, unknown>).chrome;
  vi.useRealTimers();
});

describe('manifestClientId', () => {
  it('returns a configured client ID', () => {
    stubChrome({ clientId: '123-abc.apps.googleusercontent.com' });
    expect(manifestClientId()).toBe('123-abc.apps.googleusercontent.com');
  });

  it('treats the unconfigured placeholder as absent', () => {
    stubChrome({ clientId: 'REPLACE_WITH_YOUR_CLIENT_ID.apps.googleusercontent.com' });
    expect(manifestClientId()).toBeNull();
  });

  it('handles a manifest with no oauth2 block', () => {
    stubChrome();
    expect(manifestClientId()).toBeNull();
  });
});

describe('resolveBackend', () => {
  it('prefers a client ID the user entered, over the manifest', () => {
    stubChrome({ clientId: '111-manifest.apps.googleusercontent.com' });
    const resolved = resolveBackend({ customClientId: '222-custom.apps.googleusercontent.com' });
    expect(resolved.backend).toBe('web-auth-flow');
    expect(resolved.clientId).toBe('222-custom.apps.googleusercontent.com');
  });

  it('uses chrome.identity when only the manifest has one', () => {
    stubChrome({ clientId: '111-manifest.apps.googleusercontent.com' });
    expect(resolveBackend({ customClientId: null }).backend).toBe('chrome-identity');
  });

  it('falls back to the redirect flow where getAuthToken is missing', () => {
    stubChrome({ clientId: '111-manifest.apps.googleusercontent.com', getAuthToken: false });
    expect(supportsChromeIdentity()).toBe(false);
    expect(resolveBackend({ customClientId: null }).backend).toBe('web-auth-flow');
  });

  it('reports no client ID when nothing is configured', () => {
    stubChrome();
    const resolved = resolveBackend({ customClientId: null });
    expect(resolved.clientId).toBeNull();
  });
});

describe('parseImplicitResponse', () => {
  it('reads the token out of the URL fragment', () => {
    const token = parseImplicitResponse(
      `${REDIRECT}#access_token=ya29.test&expires_in=3600&token_type=Bearer`,
      BASE_SCOPES,
    );
    expect(token.token).toBe('ya29.test');
    expect(token.expiresAt).toBeGreaterThan(Date.now());
    expect(token.scopes).toEqual(BASE_SCOPES);
  });

  it('records the scopes Google actually granted, not the ones asked for', () => {
    const token = parseImplicitResponse(
      `${REDIRECT}#access_token=t&expires_in=3600&scope=${encodeURIComponent('a b')}`,
      BASE_SCOPES,
    );
    expect(token.scopes).toEqual(['a', 'b']);
  });

  it('maps a silent-auth rejection to consent-required', () => {
    expect(() => parseImplicitResponse(`${REDIRECT}#error=interaction_required`, [])).toThrowError(
      expect.objectContaining({ code: 'consent-required' }),
    );
  });

  it('explains an access_denied in terms of the test-user list', () => {
    try {
      parseImplicitResponse(`${REDIRECT}#error=access_denied`, []);
      expect.unreachable('should have thrown');
    } catch (error) {
      expect(error).toBeInstanceOf(AuthError);
      expect((error as AuthError).code).toBe('denied');
      expect((error as AuthError).message).toMatch(/test user/i);
    }
  });

  it('also finds an error reported in the query string', () => {
    expect(() => parseImplicitResponse(`${REDIRECT}?error=access_denied`, [])).toThrowError(
      AuthError,
    );
  });

  it('rejects a response with no token at all', () => {
    expect(() => parseImplicitResponse(`${REDIRECT}#token_type=Bearer`, [])).toThrowError(
      expect.objectContaining({ code: 'not-signed-in' }),
    );
  });
});

describe('withTimeout', () => {
  it('passes a value through when it arrives in time', async () => {
    await expect(withTimeout(Promise.resolve('done'), 1000)).resolves.toBe('done');
  });

  it('rejects rather than hanging forever', async () => {
    vi.useFakeTimers();
    const pending = withTimeout(new Promise(() => undefined), 500);
    const assertion = expect(pending).rejects.toThrowError(
      expect.objectContaining({ code: 'timed-out' }),
    );
    await vi.advanceTimersByTimeAsync(600);
    await assertion;
  });

  it('propagates the original failure', async () => {
    await expect(withTimeout(Promise.reject(new Error('boom')), 1000)).rejects.toThrow('boom');
  });
});
