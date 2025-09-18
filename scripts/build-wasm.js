#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const repoRoot = join(__dirname, '..');
const outDir = join(repoRoot, 'dist', 'codecs');
const cacheDir = process.env.EM_CACHE || join(repoRoot, 'node_modules', '.cache', 'emscripten');

if (!existsSync(outDir)) {
  mkdirSync(outDir, { recursive: true });
}

if (!existsSync(cacheDir)) {
  mkdirSync(cacheDir, { recursive: true });
}

const emcc = process.env.EMCC || 'emcc';
const sources = [
  'native/g722/g722_encode.c',
  'native/g722/g722_decode.c',
  'native/g722/g722_wasm_shim.c',
];

const outputBase = 'g722_wasm';
const outputFile = join('dist', 'codecs', `${outputBase}.cjs`);
const outputWasm = join('dist', 'codecs', `${outputBase}.wasm`);

if (existsSync(outputFile) && existsSync(outputWasm) && process.env.FORCE_WASM_REBUILD !== '1') {
  console.log('[build-wasm] Existing g722_wasm artifacts found. Skipping rebuild.');
  process.exit(0);
}

const args = [
  ...sources,
  '-O3',
  '-s', 'ENVIRONMENT=node',
  '-s', 'MODULARIZE=0',
  '-s', 'EXPORT_ES6=0',
  '-s', 'WASM_ASYNC_COMPILATION=0',
  '-s', 'ALLOW_MEMORY_GROWTH=1',
  '-s', "EXPORTED_FUNCTIONS=['_malloc','_free','_g722_wasm_enc_new','_g722_wasm_enc_destroy','_g722_wasm_encode','_g722_wasm_dec_new','_g722_wasm_dec_destroy','_g722_wasm_decode']",
  '-s', "EXPORTED_RUNTIME_METHODS=['cwrap','lengthBytesUTF8','stringToUTF8','getValue','setValue','HEAP8','HEAPU8','HEAP16','HEAP32']",
  '-o', outputFile,
];

const env = { ...process.env, EM_CACHE: cacheDir };
const result = spawnSync(emcc, args, { stdio: 'inherit', cwd: repoRoot, env });

if (result.error) {
  if (result.error.code === 'ENOENT') {
    console.warn('[build-wasm] emcc not found. Skipping WASM build. Install Emscripten or set EMCC env var.');
    process.exit(0);
  }
  console.warn(`[build-wasm] Failed to launch emcc: ${result.error.message}`);
  process.exit(0);
}

if (result.status !== 0) {
  console.warn('[build-wasm] emcc exited with non-zero status. Skipping WASM artifact.');
  process.exit(0);
}

console.log('[build-wasm] Generated dist/codecs/g722_wasm.{cjs,wasm}.');
