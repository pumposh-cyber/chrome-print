import { describe, expect, it } from 'vitest';
import { base64ToBytes, buildPrintParams } from '../src/background/pdf';
import { DEFAULT_SETTINGS, type Settings } from '../src/shared/types';

const settings = (patch: Partial<Settings> = {}): Settings => ({ ...DEFAULT_SETTINGS, ...patch });

describe('buildPrintParams', () => {
  it('maps the paper size to inches', () => {
    const params = buildPrintParams(settings({ paperSize: 'a4' }));
    expect(params.paperWidth).toBeCloseTo(8.27);
    expect(params.paperHeight).toBeCloseTo(11.69);
  });

  it('clamps the scale to the range Chrome accepts', () => {
    expect(buildPrintParams(settings({ scale: 9 })).scale).toBe(2);
    expect(buildPrintParams(settings({ scale: 0 })).scale).toBe(0.1);
    expect(buildPrintParams(settings({ scale: Number.NaN })).scale).toBe(0.1);
  });

  it('never sends a negative margin', () => {
    const params = buildPrintParams(
      settings({ margins: { top: -1, right: 0.5, bottom: -0.2, left: 0 } }),
    );
    expect(params.marginTop).toBe(0);
    expect(params.marginBottom).toBe(0);
    expect(params.marginRight).toBe(0.5);
  });

  it('omits header and footer templates when they are turned off', () => {
    const off = buildPrintParams(settings({ headerFooter: false }));
    expect(off.displayHeaderFooter).toBe(false);
    expect(off.headerTemplate).toBe('');

    const on = buildPrintParams(settings({ headerFooter: true }));
    expect(on.displayHeaderFooter).toBe(true);
    expect(String(on.footerTemplate)).toContain('pageNumber');
  });

  it('streams the result instead of returning one large base64 string', () => {
    expect(buildPrintParams(settings()).transferMode).toBe('ReturnAsStream');
  });

  it('falls back to Letter for an unrecognised stored paper size', () => {
    const params = buildPrintParams(settings({ paperSize: 'foolscap' as Settings['paperSize'] }));
    expect(params.paperWidth).toBe(8.5);
  });
});

describe('base64ToBytes', () => {
  it('round-trips binary data', () => {
    const source = new Uint8Array([0, 1, 37, 80, 68, 70, 255, 128]);
    const base64 = btoa(String.fromCharCode(...source));
    expect(Array.from(base64ToBytes(base64))).toEqual(Array.from(source));
  });
});
