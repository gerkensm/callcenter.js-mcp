// CommonJS loader for G.722 codec
// Prefers the native N-API addon when available, otherwise falls back to WASM.

const fs = require('fs');
const path = require('path');

let g722_addon = null;
let g722LoadError = null;

function setAddon(addon) {
  if (addon && addon.g722Enabled && typeof addon.G722 === 'function') {
    g722_addon = addon;
    g722LoadError = null;
  }
}

function tryLoadNativeAddon() {
  const nativePaths = [
    path.resolve(__dirname, '../../build/Release/g722.node'),
    path.resolve(__dirname, '../../build/Debug/g722.node'),
  ];

  for (const candidate of nativePaths) {
    try {
      if (fs.existsSync(candidate)) {
        const nativeModule = require(candidate);
        setAddon(nativeModule);
        if (g722_addon) {
          return;
        }
      }
    } catch (error) {
      g722LoadError = `Native load failed: ${error.message}`;
    }
  }
}

function makeWasmAddon(module) {
  const encNew = module.cwrap('g722_wasm_enc_new', 'number', ['number', 'number']);
  const encDestroy = module.cwrap('g722_wasm_enc_destroy', null, ['number']);
  const encRun = module.cwrap('g722_wasm_encode', 'number', ['number', 'number', 'number', 'number']);
  const decNew = module.cwrap('g722_wasm_dec_new', 'number', ['number', 'number']);
  const decDestroy = module.cwrap('g722_wasm_dec_destroy', null, ['number']);
  const decRun = module.cwrap('g722_wasm_decode', 'number', ['number', 'number', 'number', 'number']);

  class G722 {
    constructor() {
      this._module = module;
      this._encPtr = encNew(64000, 0);
      this._decPtr = decNew(64000, 0);
      if (!this._encPtr || !this._decPtr) {
        throw new Error('Failed to initialize G.722 WASM codec');
      }
      G722._instances.add(this);
    }

    encode(pcmBuffer) {
      if (!Buffer.isBuffer(pcmBuffer)) {
        throw new TypeError('PCM buffer expected');
      }
      if (pcmBuffer.byteLength % 2 !== 0) {
        throw new Error('PCM buffer must contain 16-bit samples');
      }

      if (pcmBuffer.byteLength === 0) {
        return Buffer.alloc(0);
      }

      const samples = pcmBuffer.byteLength / 2;
      const inPtr = this._module._malloc(pcmBuffer.byteLength);
      if (!inPtr) {
        throw new Error('Failed to allocate WASM memory for PCM input');
      }
      this._module.HEAPU8.set(pcmBuffer, inPtr);

      const outCapacity = (samples + 1) >>> 1; // 2 samples -> 1 byte
      const outPtr = this._module._malloc(outCapacity);
      if (!outPtr) {
        this._module._free(inPtr);
        throw new Error('Failed to allocate WASM memory for G.722 output');
      }

      const written = encRun(this._encPtr, inPtr, samples, outPtr);
      const bytesWritten = Number(written);
      if (bytesWritten < 0 || bytesWritten > outCapacity) {
        this._module._free(inPtr);
        this._module._free(outPtr);
        throw new Error('G.722 encode failed');
      }

      const output = Buffer.from(this._module.HEAPU8.subarray(outPtr, outPtr + bytesWritten));
      this._module._free(inPtr);
      this._module._free(outPtr);
      return output;
    }

    decode(encodedBuffer) {
      if (!Buffer.isBuffer(encodedBuffer)) {
        throw new TypeError('Encoded buffer expected');
      }

      const inputLen = encodedBuffer.byteLength;
      if (inputLen === 0) {
        return Buffer.alloc(0);
      }

      const inPtr = this._module._malloc(inputLen);
      if (!inPtr) {
        throw new Error('Failed to allocate WASM memory for encoded input');
      }
      this._module.HEAPU8.set(encodedBuffer, inPtr);

      const maxSamples = inputLen * 2;
      const outPtr = this._module._malloc(maxSamples * 2);
      if (!outPtr) {
        this._module._free(inPtr);
        throw new Error('Failed to allocate WASM memory for PCM output');
      }

      const decodedSamples = decRun(this._decPtr, inPtr, inputLen, outPtr);
      const sampleCount = Number(decodedSamples);
      if (sampleCount < 0 || sampleCount > maxSamples) {
        this._module._free(inPtr);
        this._module._free(outPtr);
        throw new Error('G.722 decode failed');
      }

      const pcmBytes = sampleCount * 2;
      const output = Buffer.from(this._module.HEAPU8.subarray(outPtr, outPtr + pcmBytes));
      this._module._free(inPtr);
      this._module._free(outPtr);
      return output;
    }

    dispose() {
      if (this._encPtr) {
        encDestroy(this._encPtr);
        this._encPtr = 0;
      }
      if (this._decPtr) {
        decDestroy(this._decPtr);
        this._decPtr = 0;
      }
      G722._instances.delete(this);
    }
  }

  G722._instances = new Set();

  process.once('exit', () => {
    for (const instance of G722._instances) {
      instance.dispose();
    }
    G722._instances.clear();
  });

  return { G722, g722Enabled: true };
}

function tryLoadWasmAddon() {
  const candidates = [
    path.resolve(__dirname, 'g722_wasm.cjs'),
    path.resolve(__dirname, 'g722_wasm.js'),
    path.resolve(__dirname, '../../dist/codecs/g722_wasm.cjs'),
    path.resolve(__dirname, '../../dist/codecs/g722_wasm.js'),
  ];

  for (const candidate of candidates) {
    try {
      if (!fs.existsSync(candidate)) {
        continue;
      }
      const wasmModule = require(candidate);
      if (!wasmModule || typeof wasmModule.cwrap !== 'function') {
        continue;
      }
      const addon = makeWasmAddon(wasmModule);
      setAddon(addon);
      if (g722_addon) {
        return;
      }
    } catch (error) {
      g722LoadError = `WASM load failed: ${error.message}`;
    }
  }
}

tryLoadNativeAddon();
if (!g722_addon) {
  tryLoadWasmAddon();
}

module.exports = {
  g722_addon,
  g722LoadError,
  isAvailable: () => g722_addon !== null && g722_addon.g722Enabled,
  getUnavailableReason: () => {
    if (g722_addon !== null && g722_addon.g722Enabled) {
      return null;
    }
    return g722LoadError || 'G.722 codec not available';
  }
};
