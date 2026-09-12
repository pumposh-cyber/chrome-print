import { StrictMode, useCallback, useEffect, useMemo, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { renderFilename } from '../shared/filename';
import { send, type AuthState } from '../shared/messages';
import { PAPER_SIZES, type DriveFolder, type PaperSize, type PrintAction, type Settings } from '../shared/types';
import { useAuth, useSettings } from './hooks';
import { SetupSection } from './setup';
import './styles.css';

const ACTION_LABELS: Record<PrintAction, string> = {
  auto: 'Save to Drive automatically',
  ask: 'Ask me each time',
  native: "Use Chrome's print dialog",
};

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="card">
      <h2>{title}</h2>
      {children}
    </section>
  );
}

function Toggle({
  label,
  hint,
  checked,
  onChange,
  disabled,
}: {
  label: string;
  hint?: string;
  checked: boolean;
  onChange: (value: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <label className="row">
      <span className="label">
        {label}
        {hint ? <span>{hint}</span> : null}
      </span>
      <input
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={(event) => onChange(event.target.checked)}
      />
    </label>
  );
}

function FolderSection({
  settings,
  update,
  auth,
  signIn,
}: {
  settings: Settings;
  update: (patch: Partial<Settings>) => Promise<void>;
  auth: AuthState | null;
  signIn: (broadScope?: boolean) => Promise<void>;
}) {
  const [folders, setFolders] = useState<DriveFolder[]>([]);
  const [newFolder, setNewFolder] = useState('');
  const [folderError, setFolderError] = useState<string | null>(null);
  const [loadingFolders, setLoadingFolders] = useState(false);

  const loadFolders = useCallback(async () => {
    setLoadingFolders(true);
    const response = await send({ type: 'list-folders' });
    if (response.ok) setFolders(response.data);
    else setFolderError(response.error);
    setLoadingFolders(false);
  }, []);

  useEffect(() => {
    if (auth?.signedIn) void loadFolders();
  }, [auth?.signedIn, auth?.canBrowseDrive, loadFolders]);

  // The chosen folder may not come back from the listing (for example after the
  // broader scope is revoked), so keep it in the list regardless.
  const choices = useMemo(() => {
    if (!settings.folderId || folders.some((folder) => folder.id === settings.folderId)) {
      return folders;
    }
    return [{ id: settings.folderId, name: settings.folderName ?? 'Selected folder' }, ...folders];
  }, [folders, settings.folderId, settings.folderName]);

  const createFolder = async () => {
    const name = newFolder.trim();
    if (!name) return;
    setFolderError(null);
    const response = await send({ type: 'create-folder', name });
    if (!response.ok) {
      setFolderError(response.error);
      return;
    }
    setNewFolder('');
    setFolders((current) => [...current, response.data]);
    await update({ folderId: response.data.id, folderName: response.data.name });
  };

  if (!auth?.signedIn) {
    return (
      <Section title="Destination folder">
        <p className="note" style={{ marginTop: 0 }}>
          Connect a Google account in Setup above, then pick a folder here. Until you do, the first
          save creates a folder called &quot;Printed Pages&quot; in your Drive.
        </p>
      </Section>
    );
  }

  return (
    <Section title="Destination folder">
      <div className="row">
        <span className="label">
          Signed in
          <span>{auth.email ?? 'Google account'}</span>
        </span>
      </div>

      <div className="row">
        <span className="label" style={{ width: '100%' }}>
          <label className="field" htmlFor="folder">
            Save PDFs into
          </label>
          <select
            id="folder"
            value={settings.folderId ?? ''}
            onChange={(event) => {
              const folder = choices.find((f) => f.id === event.target.value);
              void update({ folderId: folder?.id ?? null, folderName: folder?.name ?? null });
            }}
          >
            <option value="">Create &quot;Printed Pages&quot; on first save</option>
            {choices.map((folder) => (
              <option key={folder.id} value={folder.id}>
                {folder.name}
              </option>
            ))}
          </select>
        </span>
      </div>

      <div className="grid">
        <label className="field">
          New folder
          <input
            type="text"
            value={newFolder}
            placeholder="e.g. Receipts"
            onChange={(event) => setNewFolder(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') void createFolder();
            }}
          />
        </label>
        <div style={{ display: 'flex', alignItems: 'flex-end', gap: 8 }}>
          <button onClick={() => void createFolder()} disabled={!newFolder.trim()}>
            Create &amp; use
          </button>
          <button onClick={() => void loadFolders()} disabled={loadingFolders}>
            {loadingFolders ? 'Refreshing…' : 'Refresh'}
          </button>
        </div>
      </div>

      {auth.canBrowseDrive ? (
        <p className="note">Every folder in your Drive is listed above.</p>
      ) : (
        <p className="note">
          Only folders this extension created are listed, because it holds the narrow{' '}
          <code>drive.file</code> permission. To pick a folder you already had, grant read access to
          your Drive:{' '}
          <button className="link" onClick={() => void signIn(true)}>
            allow browsing my Drive
          </button>
          .
        </p>
      )}
      {folderError ? <p className="error">{folderError}</p> : null}
    </Section>
  );
}

function FilenameSection({
  settings,
  update,
}: {
  settings: Settings;
  update: (patch: Partial<Settings>) => Promise<void>;
}) {
  const [template, setTemplate] = useState(settings.filenameTemplate);

  const preview = renderFilename(template, {
    title: 'Quarterly Report',
    url: 'https://example.com/reports/q3',
    now: new Date(),
  });

  return (
    <Section title="File name">
      <label className="field">
        Template
        <input
          type="text"
          value={template}
          onChange={(event) => setTemplate(event.target.value)}
          onBlur={() => void update({ filenameTemplate: template })}
        />
      </label>
      <div className="preview">{preview}</div>
      <p className="note">
        Tokens: <code>{'{title}'}</code> <code>{'{host}'}</code> <code>{'{path}'}</code>{' '}
        <code>{'{url}'}</code> <code>{'{date}'}</code> <code>{'{time}'}</code>{' '}
        <code>{'{datetime}'}</code> <code>{'{timestamp}'}</code> <code>{'{year}'}</code>{' '}
        <code>{'{month}'}</code> <code>{'{day}'}</code>
      </p>
    </Section>
  );
}

function PageSetupSection({
  settings,
  update,
}: {
  settings: Settings;
  update: (patch: Partial<Settings>) => Promise<void>;
}) {
  const setMargin = (side: keyof Settings['margins'], value: number) =>
    void update({ margins: { ...settings.margins, [side]: value } });

  return (
    <Section title="Page setup">
      <div className="grid">
        <label className="field">
          Paper size
          <select
            value={settings.paperSize}
            disabled={settings.preferCSSPageSize}
            onChange={(event) => void update({ paperSize: event.target.value as PaperSize })}
          >
            {Object.entries(PAPER_SIZES).map(([key, paper]) => (
              <option key={key} value={key}>
                {paper.label}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          Orientation
          <select
            value={settings.landscape ? 'landscape' : 'portrait'}
            onChange={(event) => void update({ landscape: event.target.value === 'landscape' })}
          >
            <option value="portrait">Portrait</option>
            <option value="landscape">Landscape</option>
          </select>
        </label>
        <label className="field">
          Scale
          <input
            type="number"
            min={0.1}
            max={2}
            step={0.05}
            value={settings.scale}
            onChange={(event) => void update({ scale: Number(event.target.value) })}
          />
        </label>
      </div>

      <div className="grid">
        {(['top', 'right', 'bottom', 'left'] as const).map((side) => (
          <label className="field" key={side}>
            {`Margin ${side} (in)`}
            <input
              type="number"
              min={0}
              step={0.1}
              value={settings.margins[side]}
              onChange={(event) => setMargin(side, Number(event.target.value))}
            />
          </label>
        ))}
      </div>

      <Toggle
        label="Print background graphics"
        hint="Keeps colours and images that Chrome drops by default."
        checked={settings.printBackground}
        onChange={(value) => void update({ printBackground: value })}
      />
      <Toggle
        label="Respect the page's own @page size"
        hint="Let a site that defines its own print layout win over the settings above."
        checked={settings.preferCSSPageSize}
        onChange={(value) => void update({ preferCSSPageSize: value })}
      />
      <Toggle
        label="Add header and footer"
        hint="Title and date on top, URL and page numbers at the bottom."
        checked={settings.headerFooter}
        onChange={(value) => void update({ headerFooter: value })}
      />
    </Section>
  );
}

function SiteRulesSection({
  settings,
  update,
}: {
  settings: Settings;
  update: (patch: Partial<Settings>) => Promise<void>;
}) {
  const [pattern, setPattern] = useState('');
  const [action, setAction] = useState<PrintAction>('native');

  const add = () => {
    const trimmed = pattern.trim().toLowerCase();
    if (!trimmed) return;
    const rules = settings.siteRules.filter((rule) => rule.pattern !== trimmed);
    void update({ siteRules: [...rules, { pattern: trimmed, action }] });
    setPattern('');
  };

  const remove = (target: string) =>
    void update({ siteRules: settings.siteRules.filter((rule) => rule.pattern !== target) });

  return (
    <Section title="Per-site rules">
      {settings.siteRules.length > 0 ? (
        <table>
          <thead>
            <tr>
              <th>Site</th>
              <th>Behaviour</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {settings.siteRules.map((rule) => (
              <tr key={rule.pattern}>
                <td>
                  <code>{rule.pattern}</code>
                </td>
                <td>
                  <select
                    value={rule.action}
                    onChange={(event) =>
                      void update({
                        siteRules: settings.siteRules.map((r) =>
                          r.pattern === rule.pattern
                            ? { ...r, action: event.target.value as PrintAction }
                            : r,
                        ),
                      })
                    }
                  >
                    {Object.entries(ACTION_LABELS).map(([value, label]) => (
                      <option key={value} value={value}>
                        {label}
                      </option>
                    ))}
                  </select>
                </td>
                <td className="actions">
                  <button className="danger link" onClick={() => remove(rule.pattern)}>
                    Remove
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        <p className="note" style={{ marginTop: 0 }}>
          No exceptions yet. Add one for sites whose own print dialog you want to keep, such as a
          banking portal.
        </p>
      )}

      <div className="grid">
        <label className="field">
          Host
          <input
            type="text"
            value={pattern}
            placeholder="example.com or *.example.com"
            onChange={(event) => setPattern(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') add();
            }}
          />
        </label>
        <label className="field">
          Behaviour
          <select value={action} onChange={(event) => setAction(event.target.value as PrintAction)}>
            {Object.entries(ACTION_LABELS).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </label>
        <div style={{ display: 'flex', alignItems: 'flex-end' }}>
          <button onClick={add} disabled={!pattern.trim()}>
            Add rule
          </button>
        </div>
      </div>
    </Section>
  );
}

function Options() {
  const { settings, update, error } = useSettings();
  const { auth, busy, error: authError, signIn, signOut } = useAuth();

  if (!settings) {
    return (
      <main className="page">
        <p>{error ?? 'Loading…'}</p>
      </main>
    );
  }

  return (
    <main className="page">
      <header>
        <h1>Print to Drive</h1>
        <p className="subtitle">
          Ctrl+P saves the page as a PDF in Google Drive instead of opening the print dialog.
        </p>
      </header>

      <SetupSection
        settings={settings}
        update={update}
        auth={auth}
        busy={busy}
        authError={authError}
        signIn={signIn}
        signOut={signOut}
      />
      <FolderSection settings={settings} update={update} auth={auth} signIn={signIn} />

      <Section title="Interception">
        <Toggle
          label="Enable Print to Drive"
          hint="Turn off to restore Chrome's normal printing everywhere."
          checked={settings.enabled}
          onChange={(value) => void update({ enabled: value })}
        />
        <Toggle
          label="Intercept Ctrl+P / ⌘P"
          checked={settings.interceptShortcut}
          disabled={!settings.enabled}
          onChange={(value) => void update({ interceptShortcut: value })}
        />
        <Toggle
          label="Intercept window.print() from pages"
          hint='Covers the "Print" buttons sites render themselves.'
          checked={settings.interceptWindowPrint}
          disabled={!settings.enabled}
          onChange={(value) => void update({ interceptWindowPrint: value })}
        />
        <div className="row">
          <span className="label">
            Default behaviour
            <span>Applies to sites with no rule below.</span>
          </span>
          <select
            value={settings.defaultAction}
            onChange={(event) => void update({ defaultAction: event.target.value as PrintAction })}
          >
            {Object.entries(ACTION_LABELS).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </div>
        <p className="note">
          Chrome's own menu → Print cannot be intercepted by any extension. Use Ctrl+P, a page's
          print button, or the toolbar icon.
        </p>
      </Section>

      <FilenameSection settings={settings} update={update} />
      <PageSetupSection settings={settings} update={update} />
      <SiteRulesSection settings={settings} update={update} />

      <Section title="After saving">
        <Toggle
          label="Show the in-page status card"
          checked={settings.showToast}
          onChange={(value) => void update({ showToast: value })}
        />
        <Toggle
          label="Show a desktop notification"
          checked={settings.notifyOnSuccess}
          onChange={(value) => void update({ notifyOnSuccess: value })}
        />
        <Toggle
          label="Open the PDF in a new tab"
          checked={settings.openAfterSave}
          onChange={(value) => void update({ openAfterSave: value })}
        />
        <Toggle
          label="Also keep a copy in Downloads"
          checked={settings.alsoDownloadLocally}
          onChange={(value) => void update({ alsoDownloadLocally: value })}
        />
      </Section>

      {error ? <p className="error">{error}</p> : null}
    </main>
  );
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Options />
  </StrictMode>,
);
