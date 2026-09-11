import { StrictMode, useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { send } from '../shared/messages';
import type { HistoryEntry } from '../shared/types';
import { useAuth, useSettings } from './hooks';
import './styles.css';

function relativeTime(timestamp: number): string {
  const seconds = Math.round((Date.now() - timestamp) / 1000);
  if (seconds < 60) return 'just now';
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} h ago`;
  return new Date(timestamp).toLocaleDateString();
}

function Popup() {
  const { settings, update } = useSettings();
  const { auth } = useAuth();
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const [status, setStatus] = useState<string | null>(null);

  useEffect(() => {
    void send({ type: 'get-history' }).then((response) => {
      if (response.ok) setHistory(response.data);
    });
  }, []);

  const saveNow = async () => {
    setStatus('Saving…');
    const response = await send({ type: 'print-active-tab', trigger: 'action' });
    if (!response.ok) {
      setStatus(response.error);
      return;
    }
    // The upload continues in the service worker; the page card reports the result.
    window.close();
  };

  if (!settings) {
    return (
      <main className="popup">
        <p>Loading…</p>
      </main>
    );
  }

  return (
    <main className="popup">
      <div className="card">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <h1>Print to Drive</h1>
          <span className={settings.enabled ? 'pill' : 'pill off'}>
            {settings.enabled ? 'On' : 'Off'}
          </span>
        </div>
        <label className="switch" style={{ marginTop: 10 }}>
          <input
            type="checkbox"
            checked={settings.enabled}
            onChange={(event) => void update({ enabled: event.target.checked })}
          />
          Intercept printing on every site
        </label>
      </div>

      <div className="card">
        <button
          className="primary"
          style={{ width: '100%' }}
          onClick={() => void saveNow()}
          disabled={!auth?.signedIn}
        >
          Save this page to Drive
        </button>
        <p className="note">
          {auth?.signedIn
            ? `Destination: ${settings.folderName ?? 'Printed Pages (created on first save)'}`
            : 'Connect a Google account in settings first.'}
        </p>
        {status ? <p className="error">{status}</p> : null}
      </div>

      {history.length > 0 ? (
        <div className="card">
          <h2>Recent</h2>
          <ul className="history">
            {history.slice(0, 6).map((entry) => (
              <li key={entry.fileId}>
                <a href={entry.webViewLink} target="_blank" rel="noreferrer">
                  {entry.name}
                </a>
                <time dateTime={new Date(entry.savedAt).toISOString()}>
                  {relativeTime(entry.savedAt)}
                </time>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      <button className="link" onClick={() => void chrome.runtime.openOptionsPage()}>
        Settings
      </button>
    </main>
  );
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Popup />
  </StrictMode>,
);
