import { cp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as esbuild from 'esbuild';

const root = dirname(fileURLToPath(import.meta.url));
const outdir = join(root, 'dist');
const watch = process.argv.includes('--watch');
const dev = watch || process.argv.includes('--dev');

/**
 * Content scripts and the service worker have different module rules, so each
 * group is built with its own esbuild config rather than one shared one.
 */
const shared = {
  bundle: true,
  target: 'chrome116',
  logLevel: 'info',
  sourcemap: dev ? 'inline' : false,
  minify: !dev,
  define: { 'process.env.NODE_ENV': JSON.stringify(dev ? 'development' : 'production') },
};

const builds = [
  {
    ...shared,
    // MV3 service workers are declared with "type": "module".
    entryPoints: { 'service-worker': 'src/background/service-worker.ts' },
    format: 'esm',
    outdir,
  },
  {
    ...shared,
    // Content scripts are plain scripts: they must be self-contained IIFEs.
    entryPoints: {
      'content-main': 'src/content/main-world.ts',
      'content-isolated': 'src/content/isolated.ts',
    },
    format: 'iife',
    outdir,
  },
  {
    ...shared,
    entryPoints: { options: 'src/ui/options.tsx', popup: 'src/ui/popup.tsx' },
    format: 'esm',
    splitting: false,
    jsx: 'automatic',
    loader: { '.css': 'css' },
    outdir,
  },
];

async function copyStatic() {
  await cp(join(root, 'public'), outdir, { recursive: true });
  await syncManifestVersion();
}

/** Keep manifest.json's version in lockstep with package.json. */
async function syncManifestVersion() {
  const pkg = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'));
  const manifestPath = join(outdir, 'manifest.json');
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
  if (manifest.version !== pkg.version) {
    manifest.version = pkg.version;
    await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  }
}

await rm(outdir, { recursive: true, force: true });
await mkdir(outdir, { recursive: true });
await copyStatic();

if (watch) {
  const contexts = await Promise.all(builds.map((config) => esbuild.context(config)));
  await Promise.all(contexts.map((context) => context.watch()));
  console.log('watching for changes; load dist/ as an unpacked extension');
} else {
  await Promise.all(builds.map((config) => esbuild.build(config)));
  console.log(`built to ${outdir}`);
}
