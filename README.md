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

---

## 1. Build it

Requires Node 18 or newer.

```bash
npm install
npm run build      # writes dist/
npm run dev        # same, but rebuilds on change
```

`dist/` is the unpacked extension.

## 2. Load it in Chrome and note the extension ID

1. Open `chrome://extensions`.
2. Turn on **Developer mode** (top right).
3. Click **Load unpacked** and select the `dist/` folder.
4. Copy the **ID** shown on the extension's card — a 32-character string like
   `abcdefghijklmnopabcdefghijklmnop`.

The ID is derived from the folder path, so it stays the same as long as you do not move the
project.

## 3. Create a Google OAuth client

This is the part with no shortcut: Google requires the extension's own OAuth client, tied to the ID
from the previous step.

1. Go to the [Google Cloud Console](https://console.cloud.google.com/) and create a project (or
   pick an existing one).
2. **APIs & Services → Library →** enable the **Google Drive API**.
3. **APIs & Services → OAuth consent screen:**
   - User type **External** is fine for personal use.
   - Fill in the app name and your email.
   - Under **Test users**, add the Google account you will sign in with. While the app is in
     *Testing* status only test users can authorize it, which is all you need for yourself. You do
     **not** need to submit for verification to use `drive.file`.
4. **APIs & Services → Credentials → Create credentials → OAuth client ID:**
   - Application type: **Chrome Extension**.
   - Item ID: the extension ID you copied.
5. Copy the generated client ID.

## 4. Wire the client ID in and reload

Edit `public/manifest.json` and replace the placeholder:

```json
"oauth2": {
  "client_id": "123456789-abcdefg.apps.googleusercontent.com",
  "scopes": [
    "https://www.googleapis.com/auth/drive.file",
    "https://www.googleapis.com/auth/userinfo.email"
  ]
}
```

Then rebuild and reload:

```bash
npm run build
```

Click the reload arrow on the extension card in `chrome://extensions`.

> Edit `public/manifest.json`, not `dist/manifest.json` — the build overwrites `dist/`.

## 5. Connect Drive

Open the extension's options page (right-click the toolbar icon → **Options**), click **Connect
Google Drive**, and pick a destination folder. If you do not pick one, the first save creates a
folder called **Printed Pages** in your Drive root and remembers it.

That's it. Press <kbd>Ctrl</kbd>+<kbd>P</kbd> on any page.

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

With the `drive.file` scope the extension can only see folders it created, so the folder dropdown
starts empty and you create one from the options page. If you want to target a folder that already
exists in your Drive, use **allow browsing my Drive** on the options page. That requests
`drive.readonly`, which is a *restricted* scope: Google will only grant it to accounts listed as
test users on your consent screen unless the app goes through verification.

---

## Limitations

These are Chrome's constraints, not implementation gaps:

- **A yellow banner appears while the PDF renders.** Rendering uses the debugger API, and Chrome
  always announces that. It disappears as soon as the PDF is captured. Launching Chrome with
  `--silent-debugger-extension-api` suppresses it if the banner bothers you.
- **The Chrome menu's own Print item cannot be intercepted.** No extension API can hook browser
  chrome. Use <kbd>Ctrl</kbd>+<kbd>P</kbd>, the toolbar button, or the context menu.
- **DevTools and this extension cannot both be attached to a tab.** If DevTools is open on the page
  you are printing, the save fails with a clear message — close DevTools and retry.
- **`chrome://` pages, the Chrome Web Store, and `file://` URLs are off-limits** to extension
  content scripts and the debugger.
- **`chrome.identity` requires being signed into Chrome** with a profile, and is a Chrome-specific
  API. Chromium forks may not support it.

## Troubleshooting

| Symptom | Cause and fix |
| --- | --- |
| `OAuth2 request failed: Service responded with error: 'bad client id'` | The client ID in the manifest does not match the extension ID. Re-check step 3, then rebuild and reload. |
| `Authorization page could not be loaded` | The Drive API is not enabled on the project, or the consent screen is incomplete. |
| `access_denied` on the consent screen | Your account is not on the **Test users** list for the consent screen. |
| Nothing happens on <kbd>Ctrl</kbd>+<kbd>P</kbd> | The content script was injected before the extension was reloaded. Reload the page. |
| `Another debugger is attached to this tab` | DevTools is open on that tab. Close it. |
| The saved PDF looks like the screen, not a printout | The site's print stylesheet is doing that. Try turning off **Print background graphics** or turning on **Respect the page's own @page size**. |
| Uploads fail after an hour of idling | Expected token expiry; the extension refreshes and retries once automatically. If it persists, disconnect and reconnect in options. |

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
                   2. chrome.identity.getAuthToken  (drive.file)
                   3. POST to the Drive upload endpoint
                   4. status card + desktop notification + history
```

The two-world split is what makes `window.print()` interception possible: only code running in the
page's own JavaScript world can replace `window.print`, and only code in the isolated world can
call `chrome.*`. They talk over custom DOM events.

Uploads under 5 MB go out as a single multipart request; larger ones use a resumable session.

### Project layout

```
src/
  background/
    service-worker.ts  message routing and the save pipeline
    pdf.ts             chrome.debugger → Page.printToPDF, streamed back in chunks
    drive.ts           OAuth tokens, folder CRUD, multipart + resumable upload
    history.ts         the "recently saved" list
  content/
    main-world.ts      the window.print() override
    isolated.ts        shortcut handling and the bridge to the worker
    toast.ts           the in-page status card (shadow DOM)
  shared/
    types.ts           settings schema and defaults
    messages.ts        typed message protocol between every context
    filename.ts        filename template expansion and sanitizing
    matcher.ts         per-site rule resolution
    settings.ts        chrome.storage.sync wrapper
  ui/
    options.tsx        settings page (React)
    popup.tsx          toolbar popup (React)
public/                manifest, HTML shells, generated icons
scripts/make_icons.py  regenerates the PNG icons from primitives
test/                  vitest unit tests, plus smoke.mjs (real-browser end-to-end)
```

### Development

```bash
npm run dev        # esbuild in watch mode
npm run typecheck  # tsc --noEmit
npm test           # vitest, for the pure logic
npm run smoke      # loads dist/ into a real Chromium and exercises the print path
npm run zip        # build and package for upload
```

`npm run smoke` needs Playwright, which is deliberately not a dependency because installing it
downloads a browser:

```bash
npm install --no-save playwright
npx playwright install chromium
npm run build && npm run smoke
```

It boots Chromium with the extension loaded and asserts that `window.print` is replaced, that
Ctrl+P is captured, that settings reach the content script, that the status card appears, and that
the options page and popup both render without errors.

The icons are generated, not hand-drawn — run `python3 scripts/make_icons.py` after editing the
shapes in that script.

## Privacy

Everything runs locally in your browser. The PDF goes from Chrome's renderer straight to
`googleapis.com` with your own OAuth token; there is no server in between, and no analytics. The
extension holds `drive.file`, so it can only touch files it created. Settings live in
`chrome.storage.sync`; the list of recently saved files lives in `chrome.storage.local`.
