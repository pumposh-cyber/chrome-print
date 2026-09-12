import { describe, expect, it } from 'vitest';
import { renderFilename, sanitize } from '../src/shared/filename';

const now = new Date(2026, 8, 11, 14, 5, 9); // 2026-09-11 14:05:09 local

describe('renderFilename', () => {
  it('expands the default template', () => {
    expect(
      renderFilename('{title} - {date}', {
        title: 'Quarterly Report',
        url: 'https://example.com/reports/q3',
        now,
      }),
    ).toBe('Quarterly Report - 2026-09-11.pdf');
  });

  it('expands host, path, and time tokens', () => {
    expect(
      renderFilename('{host} {path} {time}', {
        title: 'ignored',
        url: 'https://docs.example.com/a/b/c/',
        now,
      }),
    ).toBe('docs.example.com a-b-c 140509.pdf');
  });

  it('leaves unknown tokens alone so typos are visible', () => {
    expect(renderFilename('{titel}', { title: 'x', url: 'https://a.test', now })).toBe('{titel}.pdf');
  });

  it('falls back to the host when the page has no title', () => {
    expect(renderFilename('{title}', { title: '', url: 'https://a.test/x', now })).toBe('a.test.pdf');
  });

  it('tolerates a URL it cannot parse', () => {
    expect(renderFilename('{title}-{host}', { title: 'Doc', url: 'about:blank', now })).toBe(
      'Doc-.pdf',
    );
  });

  it('does not double up the extension', () => {
    expect(renderFilename('{title}.pdf', { title: 'Doc', url: 'https://a.test', now })).toBe(
      'Doc.pdf',
    );
    expect(renderFilename('{title}.PDF', { title: 'Doc', url: 'https://a.test', now })).toBe(
      'Doc.PDF',
    );
  });
});

describe('sanitize', () => {
  it('strips characters Drive and desktop filesystems reject', () => {
    expect(sanitize('a/b\\c:d*e?f"g<h>i|j')).toBe('a b c d e f g h i j');
  });

  it('keeps spaces and hyphens, which are legal', () => {
    expect(sanitize('Q3 Report - final')).toBe('Q3 Report - final');
  });

  it('trims leading and trailing dots and whitespace', () => {
    expect(sanitize('  ..report..  ')).toBe('report');
  });

  it('never returns an empty name', () => {
    expect(sanitize('///')).toBe('Untitled');
  });

  it('caps the length', () => {
    expect(sanitize('x'.repeat(500))).toHaveLength(180);
  });
});
