import { useCallback, useEffect, useState } from 'react';
import { send, type AuthState } from '../shared/messages';
import type { Settings } from '../shared/types';

interface SettingsApi {
  settings: Settings | null;
  update: (patch: Partial<Settings>) => Promise<void>;
  error: string | null;
}

/** Loads settings once, then writes patches through the service worker. */
export function useSettings(): SettingsApi {
  const [settings, setSettings] = useState<Settings | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void send({ type: 'get-settings' }).then((response) => {
      if (response.ok) setSettings(response.data);
      else setError(response.error);
    });
  }, []);

  const update = useCallback(async (patch: Partial<Settings>) => {
    // Apply locally first so controls never feel laggy, then persist.
    setSettings((current) => (current ? { ...current, ...patch } : current));
    const response = await send({ type: 'save-settings', patch });
    if (response.ok) setSettings(response.data);
    else setError(response.error);
  }, []);

  return { settings, update, error };
}

interface AuthApi {
  auth: AuthState | null;
  busy: boolean;
  error: string | null;
  signIn: (broadScope?: boolean) => Promise<void>;
  signOut: () => Promise<void>;
  refresh: () => Promise<void>;
}

export function useAuth(): AuthApi {
  const [auth, setAuth] = useState<AuthState | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    const response = await send({ type: 'get-auth-state' });
    if (response.ok) setAuth(response.data);
    else setAuth({ signedIn: false, email: null, canBrowseDrive: false });
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const signIn = useCallback(async (broadScope?: boolean) => {
    setBusy(true);
    setError(null);
    const response = await send({ type: 'sign-in', broadScope });
    if (response.ok) setAuth(response.data);
    else setError(response.error);
    setBusy(false);
  }, []);

  const signOut = useCallback(async () => {
    setBusy(true);
    await send({ type: 'sign-out' });
    setAuth({ signedIn: false, email: null, canBrowseDrive: false });
    setBusy(false);
  }, []);

  return { auth, busy, error, signIn, signOut, refresh };
}
