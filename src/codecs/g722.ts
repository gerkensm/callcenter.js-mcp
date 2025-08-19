import { Codec } from "./types.js";
import { createRequire } from "module";

/**
 * G.722 Codec - Wideband audio codec
 * Payload type 9, 16kHz sample rate, 8kHz clock rate (RFC 3551)
 * 
 * This implementation uses a native C++ addon wrapping the reference
 * implementation from https://github.com/sippy/libg722
 * 
 * License: Mix of public domain and permissive licenses (see LICENSE_G722)
 */

// Interface to describe the shape of our native addon
interface G722Addon {
    new(): {
        encode(pcm: Buffer): Buffer;
        decode(encoded: Buffer): Buffer;
    };
    g722Enabled: boolean;
}

// Load the CommonJS loader module
const require = createRequire(import.meta.url);
const g722Loader = require('./g722-loader.cjs');

export class G722Codec implements Codec {
  public readonly payloadType = 9;
  public readonly name = "G722";
  public readonly sampleRate = 16000;
  public readonly clockRate = 8000; // As per RFC 3551

  private nativeInstance: any = null;

  constructor() {
    if (!g722Loader.isAvailable()) {
      const reason = g722Loader.getUnavailableReason();
      const errorMsg = reason 
        ? `G.722 codec not available: ${reason}. Set ENABLE_G722=1 during build to enable.`
        : 'G.722 codec not compiled in. Set ENABLE_G722=1 during build.';
      throw new Error(errorMsg);
    }

    try {
      this.nativeInstance = new g722Loader.g722_addon.G722();
    } catch (error) {
      throw new Error(`Failed to initialize G.722 codec: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  encode(pcm: Int16Array): Buffer {
    if (!this.nativeInstance) {
      throw new Error('G.722 codec not initialized');
    }

    // The native addon expects a raw Buffer, not a TypedArray view
    const pcmBuffer = Buffer.from(pcm.buffer, pcm.byteOffset, pcm.byteLength);
    return this.nativeInstance.encode(pcmBuffer);
  }

  decode(encoded: Buffer): Int16Array {
    if (!this.nativeInstance) {
      throw new Error('G.722 codec not initialized');
    }

    const pcmBuffer = this.nativeInstance.decode(encoded);
    // Return an Int16Array view over the decoded Buffer
    return new Int16Array(pcmBuffer.buffer, pcmBuffer.byteOffset, pcmBuffer.length / 2);
  }

  /**
   * Check if G.722 codec is available
   */
  static isAvailable(): boolean {
    return g722Loader.isAvailable();
  }

  /**
   * Get the reason why G.722 is not available (if applicable)
   */
  static getUnavailableReason(): string | null {
    return g722Loader.getUnavailableReason();
  }
}