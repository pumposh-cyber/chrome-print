import { describe, expect, it } from 'vitest';
import {
  activationUrlFromError,
  CLIENT_ID_PATTERN,
  projectNumberFromClientId,
} from '../src/background/diagnostics';

describe('CLIENT_ID_PATTERN', () => {
  it('accepts a real client ID', () => {
    expect(CLIENT_ID_PATTERN.test('918572382863-a1b2c3d4.apps.googleusercontent.com')).toBe(true);
  });

  it.each([
    'REPLACE_WITH_YOUR_CLIENT_ID.apps.googleusercontent.com',
    '918572382863-a1b2c3d4',
    '"client_id": "918572382863-abc.apps.googleusercontent.com"',
    'abc-def.apps.googleusercontent.com',
    '',
  ])('rejects %s', (value) => {
    expect(CLIENT_ID_PATTERN.test(value)).toBe(false);
  });
});

describe('projectNumberFromClientId', () => {
  it('extracts the project number prefix', () => {
    expect(projectNumberFromClientId('918572382863-abc.apps.googleusercontent.com')).toBe(
      '918572382863',
    );
  });

  it('returns null when there is no numeric prefix', () => {
    expect(projectNumberFromClientId('not-a-client-id')).toBeNull();
  });
});

describe('activationUrlFromError', () => {
  it('pulls the enable-API link out of Google’s error text', () => {
    const message =
      'Google Drive API has not been used in project 918572382863 before or it is disabled. ' +
      'Enable it by visiting https://console.developers.google.com/apis/api/drive.googleapis.com/overview?project=918572382863 ' +
      'then retry.';
    expect(activationUrlFromError(message)).toBe(
      'https://console.developers.google.com/apis/api/drive.googleapis.com/overview?project=918572382863',
    );
  });

  it('also matches the console.cloud.google.com form', () => {
    expect(
      activationUrlFromError('see https://console.cloud.google.com/apis/library/drive.googleapis.com'),
    ).toBe('https://console.cloud.google.com/apis/library/drive.googleapis.com');
  });

  it('stops at a closing quote rather than swallowing the rest', () => {
    expect(activationUrlFromError('visit "https://console.cloud.google.com/x" now')).toBe(
      'https://console.cloud.google.com/x',
    );
  });

  it('returns null when the message carries no link', () => {
    expect(activationUrlFromError('Drive rejected the upload (HTTP 500)')).toBeNull();
  });
});
