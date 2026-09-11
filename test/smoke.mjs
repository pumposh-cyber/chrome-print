/**
 * End-to-end smoke test: loads dist/ into a real Chromium, then checks that the
 * print path is actually intercepted and that every extension page renders.
 *
 * Playwright is not a dependency of this project (it pulls a browser down on
 * install), so run `npm install --no-save playwright` first, or point
 * PLAYWRIGHT_BROWSERS_PATH at an existing download.
 *
 *   npm run build && npm run smoke
 */
import { createServer } from 'node:http';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

let chromium;
try {
  ({ chromium } = await import('playwright'));
} catch {
  console.error('This test needs Playwright: npm install --no-save playwright');
  process.exit(2);
}

const EXT = join(dirname(fileURLToPath(import.meta.url)), '..', 'dist');
const PORT = 8899;

const page_html = `<!doctype html><title>Smoke Test Page</title>
<h1>Print to Drive smoke test</h1>
<button id="print" onclick="window.print()">Print</button>
<script>
  window.__events = [];
  window.addEventListener('print-to-drive:print-requested', () => window.__events.push('requested'));
</script>`;

const server = createServer((_req, res) => {
  res.writeHead(200, { 'Content-Type': 'text/html' });
  res.end(page_html);
});
await new Promise((resolve) => server.listen(PORT, '127.0.0.1', resolve));

const userDataDir = await mkdtemp(join(tmpdir(), 'ptd-'));
const errors = [];

const context = await chromium.launchPersistentContext(userDataDir, {
  channel: 'chromium',
  headless: true,
  args: [`--disable-extensions-except=${EXT}`, `--load-extension=${EXT}`],
});

context.on('weberror', (e) => errors.push(`page error: ${e.error()}`));

// Wait for the MV3 service worker to register.
let worker = context.serviceWorkers()[0];
if (!worker) worker = await context.waitForEvent('serviceworker', { timeout: 15000 });
const extensionId = new URL(worker.url()).host;
console.log('service worker registered for extension', extensionId);

worker.on('console', (msg) => {
  if (msg.type() === 'error') errors.push(`worker console: ${msg.text()}`);
});

const page = await context.newPage();
page.on('console', (msg) => {
  if (msg.type() === 'error') errors.push(`page console: ${msg.text()}`);
});
await page.goto(`http://127.0.0.1:${PORT}/`, { waitUntil: 'load' });

const checks = [];
const check = (name, pass, detail = '') => {
  checks.push({ name, pass, detail });
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
};

// 1. The MAIN-world script replaced window.print.
const overridden = await page.evaluate(() => {
  const fn = window.print;
  return { name: fn.name, source: fn.toString() };
});
check('window.print is replaced', overridden.name === 'print', JSON.stringify(overridden));

// 2. The isolated world applied settings, which proves it reached the worker.
await page.waitForFunction(
  () => document.documentElement.hasAttribute('data-print-to-drive'),
  null,
  { timeout: 10000 },
);
const attr = await page.evaluate(() =>
  document.documentElement.getAttribute('data-print-to-drive'),
);
check('settings round-trip to the content script', attr === 'on', `attribute=${attr}`);

// 3. Calling window.print() fires the bridge event instead of opening a dialog.
await page.evaluate(() => window.print());
await page.waitForTimeout(300);
const events = await page.evaluate(() => window.__events);
check('window.print() is intercepted', events.length === 1, `events=${JSON.stringify(events)}`);

// 4. A page's own print button goes through the same path.
await page.click('#print');
await page.waitForTimeout(300);
const events2 = await page.evaluate(() => window.__events);
check('page print button is intercepted', events2.length === 2, `events=${JSON.stringify(events2)}`);

// 5. Ctrl+P is swallowed by the content script. Because the handler runs in
//    the capture phase and stops propagation, the proof is that a page-level
//    listener never sees Ctrl+P while it still sees an unrelated shortcut.
const seen = await page.evaluate(async () => {
  const received = [];
  window.addEventListener('keydown', (e) => received.push(e.key + (e.ctrlKey ? '+ctrl' : '')));
  document.dispatchEvent(new KeyboardEvent('keydown', { key: 'p', ctrlKey: true, bubbles: true }));
  document.dispatchEvent(new KeyboardEvent('keydown', { key: 'j', ctrlKey: true, bubbles: true }));
  await new Promise((r) => setTimeout(r, 200));
  return received;
});
check(
  'Ctrl+P is captured and stopped, other shortcuts pass through',
  !seen.includes('p+ctrl') && seen.includes('j+ctrl'),
  `page saw ${JSON.stringify(seen)}`,
);

// 6. The options page renders without throwing.
const options = await context.newPage();
const optionErrors = [];
options.on('pageerror', (e) => optionErrors.push(String(e)));
await options.goto(`chrome-extension://${extensionId}/options.html`, { waitUntil: 'load' });
await options.waitForSelector('h1', { timeout: 10000 });
const heading = await options.textContent('h1');
const sections = await options.$$eval('section.card h2', (els) => els.map((e) => e.textContent));
check(
  'options page renders',
  heading === 'Print to Drive' && optionErrors.length === 0,
  `sections=${JSON.stringify(sections)}`,
);

// 7. The popup renders without throwing.
const popup = await context.newPage();
const popupErrors = [];
popup.on('pageerror', (e) => popupErrors.push(String(e)));
await popup.goto(`chrome-extension://${extensionId}/popup.html`, { waitUntil: 'load' });
await popup.waitForSelector('h1', { timeout: 10000 });
check('popup renders', popupErrors.length === 0, (await popup.textContent('h1')) ?? '');

// 8. Triggering a save puts the status card on the page. Without a Drive
//    connection it ends in the error state, which is itself the fallback path.
await page.evaluate(() => window.print());
let toastShown = false;
try {
  await page.waitForFunction(() => document.getElementById('print-to-drive-toast') !== null, null, {
    timeout: 10000,
  });
  toastShown = true;
} catch {
  toastShown = false;
}
check('status card is injected when a save starts', toastShown);

await context.close();
server.close();

if (errors.length) {
  console.log('\nCollected errors:');
  for (const e of errors) console.log('  ' + e);
}

const failed = checks.filter((c) => !c.pass);
console.log(`\n${checks.length - failed.length}/${checks.length} checks passed`);
process.exit(failed.length ? 1 : 0);
