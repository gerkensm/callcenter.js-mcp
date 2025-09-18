#!/usr/bin/env node
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

if (process.env.SKIP_BUILD === '1') {
  process.exit(0);
}

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const repoRoot = join(__dirname, '..');

const wasmJs = join(repoRoot, 'dist', 'codecs', 'g722_wasm.cjs');
const wasmBin = join(repoRoot, 'dist', 'codecs', 'g722_wasm.wasm');

if (existsSync(wasmJs) && existsSync(wasmBin)) {
  process.exit(0);
}

function runScript(script) {
  const result = spawnSync('npm', ['run', script], {
    stdio: 'inherit',
    cwd: repoRoot,
    shell: process.platform === 'win32',
  });
  if (result.error) {
    console.warn(`[postinstall] Failed to run ${script}: ${result.error.message}`);
  }
}

runScript('build:wasm');
runScript('build:ts');

process.exit(0);
