/** Characters that Drive, Windows, or macOS reject in a file name. */
const ILLEGAL = /[\\/:*?"<>|\u0000-\u001f]/g;

const pad = (n: number) => String(n).padStart(2, '0');

export interface FilenameContext {
  title: string;
  url: string;
  now?: Date;
}

/**
 * Expand a filename template. Supported tokens:
 *   {title} {host} {path} {url} {date} {time} {datetime} {timestamp}
 *   {year} {month} {day} {hour} {minute} {second}
 * Unknown tokens are left untouched so a typo is visible rather than silent.
 */
export function renderFilename(template: string, ctx: FilenameContext): string {
  const now = ctx.now ?? new Date();
  let host = '';
  let path = '';
  try {
    const parsed = new URL(ctx.url);
    host = parsed.hostname;
    path = parsed.pathname.replace(/^\/+|\/+$/g, '').replace(/\//g, '-');
  } catch {
    // A non-URL (e.g. about:blank) just yields empty host/path tokens.
  }

  const date = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
  const time = `${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;

  const tokens: Record<string, string> = {
    title: ctx.title || host || 'Untitled',
    host,
    path,
    url: ctx.url,
    date,
    time,
    datetime: `${date} ${time}`,
    timestamp: String(now.getTime()),
    year: String(now.getFullYear()),
    month: pad(now.getMonth() + 1),
    day: pad(now.getDate()),
    hour: pad(now.getHours()),
    minute: pad(now.getMinutes()),
    second: pad(now.getSeconds()),
  };

  const expanded = template.replace(/\{(\w+)\}/g, (match, name: string) =>
    name in tokens ? (tokens[name] as string) : match,
  );

  return ensurePdfExtension(sanitize(expanded));
}

export function sanitize(name: string): string {
  const cleaned = name
    .replace(ILLEGAL, ' ')
    .replace(/\s+/g, ' ')
    .replace(/^[\s.]+|[\s.]+$/g, '')
    .slice(0, 180)
    .trim();
  return cleaned || 'Untitled';
}

function ensurePdfExtension(name: string): string {
  return /\.pdf$/i.test(name) ? name : `${name}.pdf`;
}
