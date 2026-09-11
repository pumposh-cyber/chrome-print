import type { HistoryEntry } from '../shared/types';

const KEY = 'history';
const MAX_ENTRIES = 25;

export async function getHistory(): Promise<HistoryEntry[]> {
  const { [KEY]: stored } = await chrome.storage.local.get(KEY);
  return Array.isArray(stored) ? (stored as HistoryEntry[]) : [];
}

export async function addHistoryEntry(entry: HistoryEntry): Promise<void> {
  const entries = [entry, ...(await getHistory())].slice(0, MAX_ENTRIES);
  await chrome.storage.local.set({ [KEY]: entries });
}

export async function clearHistory(): Promise<void> {
  await chrome.storage.local.remove(KEY);
}
