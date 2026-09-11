import { PAPER_SIZES, type Bytes, type Settings } from '../shared/types';

const PROTOCOL_VERSION = '1.3';

/** Read the PDF back in chunks rather than one huge base64 blob. */
const STREAM_CHUNK_BYTES = 512 * 1024;

export class PdfError extends Error {
  constructor(
    message: string,
    readonly code: 'debugger-unavailable' | 'debugger-in-use' | 'restricted-url',
  ) {
    super(message);
    this.name = 'PdfError';
  }
}

interface PrintToPdfResult {
  data: string;
  stream?: string;
}

interface IoReadResult {
  data: string;
  base64Encoded?: boolean;
  eof: boolean;
}

/**
 * Render a tab to PDF using the same engine Chrome's own "Save as PDF"
 * destination uses (DevTools Protocol Page.printToPDF), so the output honours
 * the site's @media print rules, page breaks, and web fonts.
 */
export async function renderTabToPdf(tabId: number, settings: Settings): Promise<Bytes> {
  const target: chrome.debugger.Debuggee = { tabId };

  try {
    await chrome.debugger.attach(target, PROTOCOL_VERSION);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (/already attached|another debugger/i.test(message)) {
      throw new PdfError(
        'Another debugger (usually DevTools) is attached to this tab. Close DevTools and try again.',
        'debugger-in-use',
      );
    }
    if (/cannot access|chrome:\/\/|extension/i.test(message)) {
      throw new PdfError('Chrome does not allow printing this page from an extension.', 'restricted-url');
    }
    throw new PdfError(`Could not start the PDF renderer: ${message}`, 'debugger-unavailable');
  }

  try {
    const result = await printToPdf(target, settings);

    if (!result) throw new PdfError('The PDF renderer returned nothing.', 'debugger-unavailable');

    if (result.stream) return await readStream(target, result.stream);
    if (result.data) return base64ToBytes(result.data);
    throw new PdfError('The PDF renderer produced an empty document.', 'debugger-unavailable');
  } finally {
    // Detaching removes the "being debugged" banner; never let it block the result.
    await chrome.debugger.detach(target).catch(() => undefined);
  }
}

/**
 * Chrome rejects a command outright when it carries a parameter that build does
 * not know, so the optional extras are retried away rather than assumed.
 */
async function printToPdf(
  target: chrome.debugger.Debuggee,
  settings: Settings,
): Promise<PrintToPdfResult | undefined> {
  const params = buildPrintParams(settings);
  try {
    return (await chrome.debugger.sendCommand(target, 'Page.printToPDF', params)) as
      | PrintToPdfResult
      | undefined;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (!/invalid parameters|unknown|not supported/i.test(message)) throw error;

    const { generateTaggedPDF: _tagged, ...core } = params;
    return (await chrome.debugger.sendCommand(target, 'Page.printToPDF', core)) as
      | PrintToPdfResult
      | undefined;
  }
}

export function buildPrintParams(settings: Settings): Record<string, unknown> {
  const paper = PAPER_SIZES[settings.paperSize] ?? PAPER_SIZES.letter;
  return {
    landscape: settings.landscape,
    printBackground: settings.printBackground,
    scale: clamp(settings.scale, 0.1, 2),
    paperWidth: paper.width,
    paperHeight: paper.height,
    marginTop: Math.max(0, settings.margins.top),
    marginBottom: Math.max(0, settings.margins.bottom),
    marginLeft: Math.max(0, settings.margins.left),
    marginRight: Math.max(0, settings.margins.right),
    preferCSSPageSize: settings.preferCSSPageSize,
    displayHeaderFooter: settings.headerFooter,
    headerTemplate: settings.headerFooter ? HEADER_TEMPLATE : '',
    footerTemplate: settings.headerFooter ? FOOTER_TEMPLATE : '',
    transferMode: 'ReturnAsStream',
    // Emits a tagged (accessible) PDF where the page structure allows it.
    generateTaggedPDF: true,
  };
}

/**
 * Chrome renders header/footer templates with a default font-size of zero, so
 * every element has to set its own size or it comes out invisible.
 */
const HEADER_TEMPLATE = `
<div style="font-size:9px;width:100%;padding:0 12px;color:#555;font-family:system-ui,sans-serif;
            display:flex;justify-content:space-between;">
  <span class="title" style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:70%"></span>
  <span class="date"></span>
</div>`;

const FOOTER_TEMPLATE = `
<div style="font-size:9px;width:100%;padding:0 12px;color:#555;font-family:system-ui,sans-serif;
            display:flex;justify-content:space-between;">
  <span class="url" style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:70%"></span>
  <span><span class="pageNumber"></span> / <span class="totalPages"></span></span>
</div>`;

async function readStream(target: chrome.debugger.Debuggee, handle: string): Promise<Bytes> {
  const chunks: Uint8Array[] = [];
  let total = 0;

  try {
    for (;;) {
      const chunk = (await chrome.debugger.sendCommand(target, 'IO.read', {
        handle,
        size: STREAM_CHUNK_BYTES,
      })) as IoReadResult | undefined;
      if (!chunk) break;

      if (chunk.data) {
        const bytes = chunk.base64Encoded === false
          ? new TextEncoder().encode(chunk.data)
          : base64ToBytes(chunk.data);
        chunks.push(bytes);
        total += bytes.length;
      }
      if (chunk.eof) break;
    }
  } finally {
    await chrome.debugger.sendCommand(target, 'IO.close', { handle }).catch(() => undefined);
  }

  const out = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.length;
  }
  return out;
}

export function base64ToBytes(base64: string): Bytes {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, value));
}
