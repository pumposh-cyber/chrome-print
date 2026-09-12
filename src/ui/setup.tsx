import { useCallback, useEffect, useState } from 'react';
import type { Diagnostics } from '../background/diagnostics';
import { send, type AuthState } from '../shared/messages';
import type { Settings } from '../shared/types';

const CONSOLE = 'https://console.cloud.google.com';

/** Deep-link into the right console page, scoped to the project when we know it. */
function consoleUrl(path: string, projectNumber: string | null): string {
  return `${CONSOLE}${path}${projectNumber ? `?project=${projectNumber}` : ''}`;
}

function projectNumberOf(clientId: string | null): string | null {
  if (!clientId) return null;
  const match = /^(\d+)-/.exec(clientId);
  return match ? (match[1] as string) : null;
}

function CopyField({ label, value }: { label: string; value: string }) {
  const [copied, setCopied] = useState(false);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // Clipboard can be blocked; the value stays selectable on screen.
    }
  };

  return (
    <div className="copy-field">
      <span className="copy-label">{label}</span>
      <code>{value}</code>
      <button onClick={() => void copy()}>{copied ? 'Copied' : 'Copy'}</button>
    </div>
  );
}

const STATUS_GLYPH: Record<string, string> = { ok: '✓', warn: '!', fail: '✕', pending: '…' };

function CheckRow({ check }: { check: Diagnostics['checks'][number] }) {
  return (
    <li className={`check check-${check.status}`}>
      <span className="check-icon" aria-hidden="true">
        {STATUS_GLYPH[check.status] ?? '·'}
      </span>
      <span className="check-body">
        <strong>{check.label}</strong>
        <span>{check.detail}</span>
        {check.fixUrl ? (
          <a href={check.fixUrl} target="_blank" rel="noreferrer">
            {check.fixLabel ?? 'Fix this'} ↗
          </a>
        ) : null}
      </span>
    </li>
  );
}

interface SetupProps {
  settings: Settings;
  update: (patch: Partial<Settings>) => Promise<void>;
  auth: AuthState | null;
  busy: boolean;
  authError: string | null;
  signIn: (broadScope?: boolean) => Promise<void>;
  signOut: () => Promise<void>;
}

export function SetupSection({
  settings,
  update,
  auth,
  busy,
  authError,
  signIn,
  signOut,
}: SetupProps) {
  const [diagnostics, setDiagnostics] = useState<Diagnostics | null>(null);
  const [checking, setChecking] = useState(false);
  const [clientId, setClientId] = useState(settings.oauthClientId ?? '');
  const [saved, setSaved] = useState(false);

  const check = useCallback(async () => {
    setChecking(true);
    const response = await send({ type: 'run-diagnostics' });
    if (response.ok) setDiagnostics(response.data);
    setChecking(false);
  }, []);

  useEffect(() => {
    void check();
  }, [check, auth?.signedIn]);

  const saveClientId = async () => {
    await update({ oauthClientId: clientId.trim() || null });
    setSaved(true);
    setTimeout(() => setSaved(false), 1500);
    await check();
  };

  const projectNumber = projectNumberOf(settings.oauthClientId ?? null);
  const failures = diagnostics?.checks.filter((c) => c.status === 'fail') ?? [];
  const ready = diagnostics !== null && failures.length === 0;

  return (
    <section className="card">
      <div className="setup-head">
        <h2>Setup</h2>
        {diagnostics ? (
          <span className={ready ? 'pill' : 'pill warn'}>
            {ready ? 'Ready' : `${failures.length} to fix`}
          </span>
        ) : null}
      </div>

      {ready ? (
        <p className="note" style={{ marginTop: 0 }}>
          Everything checks out. PDFs will save to Drive when you print.
        </p>
      ) : (
        <ol className="steps">
          <li>
            <strong>Create an OAuth client</strong> of type <em>Web application</em>, and add the
            Redirect URI below to its <em>Authorized redirect URIs</em>. In the same project, enable
            the Drive API and add your Google account as a test user on the consent screen.
            <div className="step-links">
              <a href={consoleUrl('/apis/credentials', projectNumber)} target="_blank" rel="noreferrer">
                Credentials ↗
              </a>
              <a
                href={consoleUrl('/apis/library/drive.googleapis.com', projectNumber)}
                target="_blank"
                rel="noreferrer"
              >
                Enable Drive API ↗
              </a>
              <a
                href={consoleUrl('/apis/credentials/consent', projectNumber)}
                target="_blank"
                rel="noreferrer"
              >
                Consent screen ↗
              </a>
            </div>
          </li>
          <li>
            <strong>Paste the client ID</strong> it gives you into the box below. No file editing,
            no rebuild, no extension reload.
          </li>
          <li>
            <strong>Connect</strong>, and approve the permission request.
          </li>
        </ol>
      )}

      {diagnostics ? (
        <>
          <CopyField label="Extension ID" value={diagnostics.extensionId} />
          <CopyField label="Redirect URI" value={diagnostics.redirectUri} />
          <p className="note">
            The Redirect URI is what a <em>Web application</em> client needs. The Extension ID is
            only for the <em>Chrome Extension</em> client type, which has to be compiled into the
            manifest instead of pasted here. Both are fixed for every install of this extension.
          </p>
        </>
      ) : null}

      <label className="field" style={{ marginTop: 14 }}>
        Google client ID
        <input
          type="text"
          value={clientId}
          spellCheck={false}
          placeholder="1234567890-abc123.apps.googleusercontent.com"
          onChange={(event) => setClientId(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') void saveClientId();
          }}
        />
      </label>
      <div className="setup-actions">
        <button onClick={() => void saveClientId()}>{saved ? 'Saved' : 'Save client ID'}</button>
        {auth?.signedIn ? (
          <button onClick={() => void signOut()} disabled={busy}>
            Disconnect
          </button>
        ) : (
          <button
            className="primary"
            disabled={busy || !auth?.hasClientId}
            onClick={() => void signIn()}
          >
            {busy ? 'Connecting…' : 'Connect Google Drive'}
          </button>
        )}
        <button onClick={() => void check()} disabled={checking}>
          {checking ? 'Checking…' : 'Re-check'}
        </button>
      </div>

      {settings.oauthClientId ? (
        <p className="note">
          Leave this empty to fall back to the client ID shipped with the extension.
        </p>
      ) : null}
      {authError ? <p className="error">{authError}</p> : null}

      {diagnostics ? (
        <ul className="checks">
          {diagnostics.checks.map((item) => (
            <CheckRow key={item.id} check={item} />
          ))}
        </ul>
      ) : null}
    </section>
  );
}
