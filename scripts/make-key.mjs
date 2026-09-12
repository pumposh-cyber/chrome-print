#!/usr/bin/env node
/**
 * Generate (or reuse) the keypair that pins this extension's ID.
 *
 * Chrome derives an unpacked extension's ID from its install path unless the
 * manifest carries a "key" field. With one, every install everywhere gets the
 * same ID, which is what lets a single OAuth client work for all users instead
 * of each person creating their own.
 *
 *   node scripts/make-key.mjs          print the key and the resulting ID
 *   node scripts/make-key.mjs --write  also write it into public/manifest.json
 *
 * The private key is written to .extension-key.pem (gitignored). It is NOT
 * needed for "Load unpacked" or zip distribution — only for signing a .crx.
 * The public half in the manifest is what fixes the ID, and publishing it is
 * both safe and the entire point.
 */
import { createHash, generateKeyPairSync, createPublicKey } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(fileURLToPath(import.meta.url)) + '/..';
const PRIVATE_KEY_PATH = join(root, '.extension-key.pem');
const MANIFEST_PATH = join(root, 'public', 'manifest.json');

function loadOrCreatePrivateKey() {
  if (existsSync(PRIVATE_KEY_PATH)) {
    return { pem: readFileSync(PRIVATE_KEY_PATH, 'utf8'), created: false };
  }
  const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const pem = privateKey.export({ type: 'pkcs8', format: 'pem' });
  writeFileSync(PRIVATE_KEY_PATH, pem, { mode: 0o600 });
  return { pem, created: true };
}

/**
 * Chrome's extension ID is the first 16 bytes of the SHA-256 of the DER public
 * key, with each hex digit mapped from 0-f onto a-p.
 */
function extensionIdFromDer(der) {
  const digest = createHash('sha256').update(der).digest();
  return [...digest.subarray(0, 16)]
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('')
    .replace(/[0-9a-f]/g, (hex) => String.fromCharCode(97 + parseInt(hex, 16)));
}

const { pem, created } = loadOrCreatePrivateKey();
const der = createPublicKey(pem).export({ type: 'spki', format: 'der' });
const key = der.toString('base64');
const extensionId = extensionIdFromDer(der);

if (process.argv.includes('--write')) {
  const manifest = JSON.parse(readFileSync(MANIFEST_PATH, 'utf8'));
  manifest.key = key;
  writeFileSync(MANIFEST_PATH, `${JSON.stringify(manifest, null, 2)}\n`);
  console.log(`wrote key into ${MANIFEST_PATH}`);
}

console.log(`${created ? 'generated' : 'reused'} ${PRIVATE_KEY_PATH}`);
console.log(`\nextension id: ${extensionId}`);
console.log(`redirect uri: https://${extensionId}.chromiumapp.org/`);
console.log(`\nmanifest "key":\n${key}`);
