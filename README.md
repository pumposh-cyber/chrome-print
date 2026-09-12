# Print to Drive

A Chrome extension that takes over printing. Press <kbd>Ctrl</kbd>+<kbd>P</kbd> (or click a page's
own "Print" button) and instead of the print dialog opening, the page is rendered to PDF and
uploaded straight into a Google Drive folder you choose.

Google used to offer this natively — Google Cloud Print could save to Drive, and the print dialog
carried a "Save to Google Drive" destination. Cloud Print was shut down at the end of 2020 and the
destination went with it, so this extension rebuilds the workflow from the pieces Chrome still
exposes.

- **Real print fidelity.** The PDF comes out of the same renderer as Chrome's own "Save as PDF"
  destination (`Page.printToPDF` over the DevTools protocol), so `@media print` rules, page breaks,
  and web fonts are all respected. It is not a screenshot.
- **No dialog.** `auto` mode saves without a click. `ask` mode shows a small in-page prompt.
- **Narrow permissions.** It uses the `drive.file` OAuth scope, which grants access only to files
  the extension itself creates. It cannot read the rest of your Drive.
- **Setup is guided.** The options page walks you through Google's side and tells you exactly
  what is wrong when something is.

---

## Install

**Either** download the zip from [Releases](../../releases), unzip it somewhere permanent, then at
`chrome://extensions` turn on **Developer mode** and click **Load unpacked** on that folder.

**Or** build it yourself (Node 18+):

```bash
npm install
npm run build     # writes dist/, which is the unpacked extension
```

Then **Load unpacked** on `dist/`.

> The extension ID is **pinned** by a `key` in the manifest, so it is the same on every machine no
> matter where the folder lives. That is what lets one Google OAuth client cover every install.

## Connect Google Drive

Open the extension's options page (right-click the toolbar icon → **Options**). The **Setup** panel
at the top is the whole process:

1. It shows your **Redirect URI** with a copy button, and deep-links to the three Google Cloud
   Console pages you need.
2. In the console: create an OAuth client of type **Web application**, paste the Redirect URI into
   its *Authorized redirect URIs*, enable the **Google Drive API** in the same project, and add your
   own Google account under **Test users** on the consent screen.
3. Paste the client ID back into the options page and press **Connect Google Drive**.

No file editing, no rebuild, no extension reload. If anything is off, the panel's checklist names
the specific problem and links straight to the page that fixes it.

`drive.file` is a non-sensitive scope, so **no Google verification review is required**. You will
see an "unverified app" notice while the consent screen is in Testing — that is expected. You can
also **Publish** the app in the console to remove it, still without review.

### Shipping it to other people

If you are distributing this, do the console step once and compile the client ID in, so nobody
downstream touches Google Cloud at all:

1. Create an OAuth client of type **Chrome Extension**, with the **Item ID** set to the pinned
   extension ID (the Setup panel shows it, and `node scripts/make-key.mjs` prints it).
2. Put it in `public/manifest.json` under `oauth2.client_id`, and `npm run build`.

Users then just install and click **Connect**. Anyone who prefers their own Google project can
still override it from the options page — the pasted client ID always wins.

---

## Using it

| Trigger | What happens |
| --- | --- |
| <kbd>Ctrl</kbd>+<kbd>P</kbd> / <kbd>⌘</kbd>+<kbd>P</kbd> | Intercepted, saved to Drive |
| A page's own Print button (`window.print()`) | Intercepted, saved to Drive |
| <kbd>Alt</kbd>+<kbd>Shift</kbd>+<kbd>P</kbd> | Saves immediately, skipping any "ask" prompt |
| Toolbar icon → **Save this page to Drive** | Same as above |
| Right-click → **Save this page to Drive as PDF** | Same as above |
| Chrome menu (⋮ → Print) | **Not** intercepted — see limitations |

A status card appears in the corner of the page while the PDF renders and uploads, then turns into
a link to the saved file. If anything fails, the card offers **Use system dialog** so you can still
print the normal way.

### Settings worth knowing

- **Default behaviour** — `Save to Drive automatically`, `Ask me each time`, or
  `Use Chrome's print dialog`.
- **Per-site rules** — exceptions by host, with `*.example.com` wildcards. Useful for a banking
  portal whose own print flow you want to keep. The most specific rule wins.
- **File name** — a template such as `{title} - {date}`. Available tokens: `{title}`, `{host}`,
  `{path}`, `{url}`, `{date}`, `{time}`, `{datetime}`, `{timestamp}`, `{year}`, `{month}`, `{day}`,
  `{hour}`, `{minute}`, `{second}`.
- **Page setup** — paper size, orientation, margins, scale, background graphics, header/footer, and
  an option to let the site's own `@page` rules win.

### Picking a folder you already had

With `drive.file` the extension only sees folders it created, so the folder list starts empty and
you create one from the options page. To target a folder you already had, use **allow browsing my
Drive**. That requests `drive.readonly`, a *restricted* scope that Google grants an unverified app
only for accounts on its test-user list.

---

## Limitations

These are Chrome's constraints, not implementation gaps:

- **A yellow banner appears while the PDF renders.** Rendering uses the debugger API, and Chrome
  always announces that. It disappears as soon as the PDF is captured. Launching Chrome with
  `--silent-debugger-extension-api` suppresses it.
- **The Chrome menu's own Print item cannot be intercepted.** No extension API can hook browser
  chrome. Use <kbd>Ctrl</kbd>+<kbd>P</kbd>, the toolbar button, or the context menu.
- **DevTools and this extension cannot both be attached to a tab.** Close DevTools on the page you
  are printing.
- **`chrome://` pages, the Chrome Web Store, and `file://` URLs are off-limits** to extension
  content scripts and the debugger.

## Troubleshooting

Run **Re-check** in the Setup panel first — it diagnoses most of this in place and links to the fix.

| Symptom | Cause and fix |
| --- | --- |
| `bad client id` | The client ID does not match the OAuth client. Paste it again in Setup, or check the Item ID on a Chrome-Extension-type client. |
| `access_denied` | Your account is not under **Test users** on the consent screen. |
| `Authorization page could not be loaded` | The Drive API is not enabled in that project. |
| `redirect_uri_mismatch` | The Redirect URI in Setup is not listed on the Web-application client. |
| **Connect hangs, then times out** | Stale OAuth state. Fully quit and reopen Chrome, then retry. |
| Nothing happens on <kbd>Ctrl</kbd>+<kbd>P</kbd> | Reload the page; content scripts only inject on load. |
| `Another debugger is attached to this tab` | DevTools is open on that tab. Close it. |
| PDF looks like the screen, not a printout | The site's print CSS. Try turning off **Print background graphics**, or on **Respect the page's own @page size**. |

Google warns that console changes can take **5 minutes to a few hours** to propagate. If everything
looks right but still fails, wait before hunting for a mistake.

---

## How it works

```
Ctrl+P  or  window.print()
        │
        ▼
content-main.js   MAIN world. Captures the real window.print() at document_start
        │         and replaces it with a stub that fires a DOM event.
        ▼
content-isolated.js  ISOLATED world. Owns the Ctrl+P handler, relays the request
        │            to the worker, and draws the status card.
        ▼
service-worker.js  1. chrome.debugger.attach → Page.printToPDF → IO.read (streamed)
                   2. auth.ts → an access token
                   3. POST to the Drive upload endpoint
                   4. status card + desktop notification + history
```

The two-world split is what makes `window.print()` interception possible: only code in the page's
own JavaScript world can replace `window.print`, and only code in the isolated world can call
`chrome.*`. They talk over custom DOM events.

Uploads under 5 MB go out as a single multipart request; larger ones use a resumable session.

### Two auth backends

`src/background/auth.ts` picks one at runtime:

| Backend | When | Client type needed |
| --- | --- | --- |
| `chrome-identity` | A client ID is in the manifest and `getAuthToken` exists | **Chrome Extension**, keyed by Item ID |
| `web-auth-flow` | A client ID was entered in options, or the browser lacks `getAuthToken` | **Web application**, keyed by Redirect URI |

`chrome-identity` lets Chrome manage token refresh. `web-auth-flow` drives the OAuth redirect
through `launchWebAuthFlow`, which accepts a client ID supplied at runtime and works on Chromium
browsers that do not implement `getAuthToken`. Every sign-in is bounded by a timeout, so a stalled
auth window surfaces an error instead of spinning forever.

### Project layout

```
src/
  background/
    service-worker.ts  message routing and the save pipeline
    auth.ts            token acquisition, both backends, caching, timeouts
    drive.ts           folder CRUD and multipart + resumable upload
    diagnostics.ts     the checks behind the Setup panel
    pdf.ts             chrome.debugger → Page.printToPDF, streamed back in chunks
    history.ts         the "recently saved" list
  content/
    main-world.ts      the window.print() override
    isolated.ts        shortcut handling and the bridge to the worker
    toast.ts           the in-page status card (shadow DOM)
  shared/              settings schema, typed messages, filename and host matching
  ui/
    options.tsx        settings page (React)
    setup.tsx          the guided Setup panel and diagnostics
    popup.tsx          toolbar popup
public/                manifest, HTML shells, generated icons
scripts/
  make-key.mjs         generates/prints the key that pins the extension ID
  make_icons.py        regenerates the PNG icons from primitives
test/                  vitest unit tests, plus smoke.mjs (real-browser end-to-end)
```

### Development

```bash
npm run dev        # esbuild in watch mode
npm run typecheck  # tsc --noEmit
npm test           # vitest, for the pure logic
npm run smoke      # loads dist/ into a real Chromium and exercises the print path
npm run zip        # build and package for distribution
```

`npm run smoke` needs Playwright, deliberately not a dependency because installing it downloads a
browser:

```bash
npm install --no-save playwright
npx playwright install chromium
npm run build && npm run smoke
```

Tagging `v1.2.3` builds, tests, and attaches an installable zip to a GitHub release.

### The pinned extension ID

`public/manifest.json` carries a `key`, the public half of an RSA keypair, from which Chrome derives
a fixed extension ID instead of hashing the install path. `node scripts/make-key.mjs` prints the
current ID and redirect URI; `--write` regenerates and rewrites the manifest.

The private half lands in `.extension-key.pem` (gitignored) and is **only** needed to sign a `.crx`.
Losing it costs nothing for unpacked or zip distribution. Changing the key changes the extension ID,
which invalidates any OAuth client bound to the old one.

## Privacy

Everything runs locally in your browser. The PDF goes from Chrome's renderer straight to
`googleapis.com` with your own OAuth token; there is no server in between, and no analytics. The
extension holds `drive.file`, so it can only touch files it created. Settings live in
`chrome.storage.sync`, recent saves in `chrome.storage.local`, and access tokens in
`chrome.storage.session`, which never reaches disk.
