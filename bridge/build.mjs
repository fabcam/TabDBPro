import { build } from 'esbuild';
import { execSync } from 'child_process';
import { mkdirSync, copyFileSync, existsSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const outDir    = resolve(__dirname, 'dist');
const binDir    = resolve(__dirname, '../app/src-tauri/binaries');

mkdirSync(outDir, { recursive: true });
mkdirSync(binDir, { recursive: true });

// ── 1. Bundle ESM → CJS ───────────────────────────────────────────────────────
console.log('Bundling...');
await build({
  entryPoints: [resolve(__dirname, 'src/server.js')],
  bundle:      true,
  platform:    'node',
  target:      'node22',
  format:      'cjs',
  outfile:     resolve(outDir, 'bridge.cjs'),
  external:    ['*.node'],
  logOverride: { 'empty-import-meta': 'silent' },
  banner: {
    // esbuild strips import.meta — make sure dirname(process.execPath) is available
    js: '"use strict";',
  },
});
console.log('Bundle done → dist/bridge.cjs');

// ── 2. Package with pkg ───────────────────────────────────────────────────────
const targets = [
  { target: 'node22-macos-arm64', triple: 'aarch64-apple-darwin' },
  { target: 'node22-macos-x64',   triple: 'x86_64-apple-darwin'  },
];

for (const { target, triple } of targets) {
  const outBin = resolve(outDir, `tabdb-bridge-${triple}`);
  console.log(`Packaging ${target}...`);
  execSync(
    `node_modules/.bin/pkg dist/bridge.cjs --target ${target} --output ${outBin} --compress GZip`,
    { cwd: __dirname, stdio: 'inherit' },
  );

  const dest = resolve(binDir, `tabdb-bridge-${triple}`);
  copyFileSync(outBin, dest);
  // Make executable
  execSync(`chmod +x "${dest}"`);
  console.log(`Copied → app/src-tauri/binaries/tabdb-bridge-${triple}`);
}

// ── 3. Copy tray icon ─────────────────────────────────────────────────────────
const iconSrc  = resolve(__dirname, '../extension/icons/icon-48.png');
const iconDest = resolve(__dirname, '../app/src-tauri/icons/tray.png');
mkdirSync(dirname(iconDest), { recursive: true });
if (existsSync(iconSrc)) {
  copyFileSync(iconSrc, iconDest);
  console.log('Copied tray icon → app/src-tauri/icons/tray.png');
}

console.log('\nBuild complete.');
