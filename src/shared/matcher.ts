import type { PrintAction, SiteRule } from './types';

/**
 * Resolve which action applies to a URL. The most specific matching rule wins,
 * where specificity is the length of the host pattern, so "docs.example.com"
 * beats "*.example.com".
 */
export function resolveAction(
  url: string,
  rules: SiteRule[],
  fallback: PrintAction,
): PrintAction {
  let host: string;
  try {
    host = new URL(url).hostname.toLowerCase();
  } catch {
    return fallback;
  }

  let best: SiteRule | null = null;
  for (const rule of rules) {
    if (!rule.pattern || !matchesHost(host, rule.pattern)) continue;
    if (!best || rule.pattern.length > best.pattern.length) best = rule;
  }
  return best ? best.action : fallback;
}

export function matchesHost(host: string, pattern: string): boolean {
  const p = pattern.trim().toLowerCase();
  if (!p) return false;
  if (p === '*') return true;
  if (p.startsWith('*.')) {
    const base = p.slice(2);
    return host === base || host.endsWith(`.${base}`);
  }
  return host === p;
}

/** Pages where Chrome refuses to run content scripts or attach the debugger. */
export function isRestrictedUrl(url: string | undefined): boolean {
  if (!url) return true;
  return (
    /^(chrome|edge|brave|devtools|chrome-extension|chrome-untrusted|about|view-source|file):/i.test(
      url,
    ) ||
    /^https:\/\/chromewebstore\.google\.com\//i.test(url) ||
    /^https:\/\/chrome\.google\.com\/webstore\//i.test(url)
  );
}
