import { DEFAULT_SETTINGS, type Settings } from './types';

const KEY = 'settings';

/** Merge stored values over the defaults so new options appear after an update. */
function hydrate(stored: unknown): Settings {
  const raw = (stored ?? {}) as Partial<Settings>;
  return {
    ...DEFAULT_SETTINGS,
    ...raw,
    margins: { ...DEFAULT_SETTINGS.margins, ...(raw.margins ?? {}) },
    siteRules: Array.isArray(raw.siteRules) ? raw.siteRules : [],
  };
}

export async function getSettings(): Promise<Settings> {
  const { [KEY]: stored } = await chrome.storage.sync.get(KEY);
  return hydrate(stored);
}

export async function saveSettings(patch: Partial<Settings>): Promise<Settings> {
  const next = hydrate({ ...(await getSettings()), ...patch });
  await chrome.storage.sync.set({ [KEY]: next });
  return next;
}

export function onSettingsChanged(listener: (settings: Settings) => void): void {
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'sync' && changes[KEY]) listener(hydrate(changes[KEY].newValue));
  });
}
