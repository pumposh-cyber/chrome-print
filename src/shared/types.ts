/**
 * A byte buffer backed by a plain ArrayBuffer. Blob and fetch reject the
 * SharedArrayBuffer-compatible default that a bare Uint8Array widens to.
 */
export type Bytes = Uint8Array<ArrayBuffer>;

/** Paper sizes in inches, matching what the Chrome print pipeline expects. */
export const PAPER_SIZES = {
  letter: { label: 'Letter (8.5 x 11 in)', width: 8.5, height: 11 },
  legal: { label: 'Legal (8.5 x 14 in)', width: 8.5, height: 14 },
  tabloid: { label: 'Tabloid (11 x 17 in)', width: 11, height: 17 },
  a3: { label: 'A3 (297 x 420 mm)', width: 11.69, height: 16.54 },
  a4: { label: 'A4 (210 x 297 mm)', width: 8.27, height: 11.69 },
  a5: { label: 'A5 (148 x 210 mm)', width: 5.83, height: 8.27 },
} as const;

export type PaperSize = keyof typeof PAPER_SIZES;

/** What should happen when a print is intercepted on a given site. */
export type PrintAction =
  /** Save to Drive with no confirmation. */
  | 'auto'
  /** Show an in-page prompt offering Drive or the system dialog. */
  | 'ask'
  /** Do not intercept at all; let Chrome's own print dialog open. */
  | 'native';

export interface SiteRule {
  /** Host pattern. Supports a leading "*." wildcard, e.g. "*.example.com". */
  pattern: string;
  action: PrintAction;
}

export interface Settings {
  /** Master switch. When false the extension never intercepts anything. */
  enabled: boolean;
  /** Intercept Ctrl+P / Cmd+P keypresses. */
  interceptShortcut: boolean;
  /** Intercept programmatic window.print() calls made by the page. */
  interceptWindowPrint: boolean;
  /** Default action for sites with no specific rule. */
  defaultAction: PrintAction;
  siteRules: SiteRule[];

  /**
  * A Google OAuth client ID entered by the user. When set it overrides the one
  * compiled into the manifest, so someone can point the extension at their own
  * Google project without editing files or rebuilding.
  */
  oauthClientId: string | null;

  /** Drive folder that PDFs are written into. Null means "ask on first save". */
  folderId: string | null;
  folderName: string | null;

  /** Template for the saved file name. See renderFilename() for tokens. */
  filenameTemplate: string;

  paperSize: PaperSize;
  landscape: boolean;
  /** Print CSS backgrounds and images. */
  printBackground: boolean;
  /** 0.1 - 2.0 */
  scale: number;
  /** Margins in inches. */
  margins: { top: number; right: number; bottom: number; left: number };
  /** Honour @page size declared by the site's CSS instead of paperSize. */
  preferCSSPageSize: boolean;
  /** Draw the page title and URL into the page header/footer. */
  headerFooter: boolean;

  /** Show the in-page progress/result toast. */
  showToast: boolean;
  /** Fire a desktop notification once the upload finishes. */
  notifyOnSuccess: boolean;
  /** Also drop a copy in the local Downloads folder. */
  alsoDownloadLocally: boolean;
  /** Open the uploaded file in a new tab. */
  openAfterSave: boolean;
}

export const DEFAULT_SETTINGS: Settings = {
  enabled: true,
  interceptShortcut: true,
  interceptWindowPrint: true,
  defaultAction: 'auto',
  siteRules: [],
  oauthClientId: null,
  folderId: null,
  folderName: null,
  filenameTemplate: '{title} - {date}',
  paperSize: 'letter',
  landscape: false,
  printBackground: true,
  scale: 1,
  margins: { top: 0.4, right: 0.4, bottom: 0.4, left: 0.4 },
  preferCSSPageSize: false,
  headerFooter: false,
  showToast: true,
  notifyOnSuccess: true,
  alsoDownloadLocally: false,
  openAfterSave: false,
};

/** One row in the "recently saved" list shown in the popup. */
export interface HistoryEntry {
  fileId: string;
  name: string;
  webViewLink: string;
  url: string;
  savedAt: number;
  bytes: number;
}

export interface DriveFolder {
  id: string;
  name: string;
}
