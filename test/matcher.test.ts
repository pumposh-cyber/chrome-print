import { describe, expect, it } from 'vitest';
import { isRestrictedUrl, matchesHost, resolveAction } from '../src/shared/matcher';
import type { SiteRule } from '../src/shared/types';

describe('matchesHost', () => {
  it('matches an exact host', () => {
    expect(matchesHost('example.com', 'example.com')).toBe(true);
    expect(matchesHost('www.example.com', 'example.com')).toBe(false);
  });

  it('matches a wildcard against the base domain and its subdomains', () => {
    expect(matchesHost('example.com', '*.example.com')).toBe(true);
    expect(matchesHost('docs.example.com', '*.example.com')).toBe(true);
    expect(matchesHost('notexample.com', '*.example.com')).toBe(false);
  });

  it('treats a bare * as everything', () => {
    expect(matchesHost('anything.test', '*')).toBe(true);
  });

  it('ignores case and surrounding whitespace', () => {
    expect(matchesHost('example.com', '  EXAMPLE.com ')).toBe(true);
  });
});

describe('resolveAction', () => {
  const rules: SiteRule[] = [
    { pattern: '*.example.com', action: 'ask' },
    { pattern: 'docs.example.com', action: 'native' },
  ];

  it('prefers the more specific rule', () => {
    expect(resolveAction('https://docs.example.com/a', rules, 'auto')).toBe('native');
  });

  it('falls back to the wildcard rule', () => {
    expect(resolveAction('https://mail.example.com/a', rules, 'auto')).toBe('ask');
  });

  it('uses the default when nothing matches', () => {
    expect(resolveAction('https://other.test/a', rules, 'auto')).toBe('auto');
  });

  it('uses the default for an unparseable URL', () => {
    expect(resolveAction('not a url', rules, 'ask')).toBe('ask');
  });

  it('skips empty patterns rather than matching everything', () => {
    expect(resolveAction('https://a.test', [{ pattern: '', action: 'native' }], 'auto')).toBe('auto');
  });
});

describe('isRestrictedUrl', () => {
  it.each([
    'chrome://settings',
    'devtools://devtools/bundled/inspector.html',
    'chrome-extension://abc/options.html',
    'view-source:https://example.com',
    'about:blank',
    'https://chromewebstore.google.com/detail/x',
    'file:///Users/me/doc.html',
    undefined,
  ])('rejects %s', (url) => {
    expect(isRestrictedUrl(url)).toBe(true);
  });

  it.each(['https://example.com', 'http://localhost:3000/report'])('allows %s', (url) => {
    expect(isRestrictedUrl(url)).toBe(false);
  });
});
