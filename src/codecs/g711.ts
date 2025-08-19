import { createRequire } from "module";
import { Codec } from "./types.js";

const require = createRequire(import.meta.url);
const g711 = require("g711");

/**
 * Base class for G.711 codecs (PCMU and PCMA)
 * Maintains backward compatibility with existing implementation
 */
abstract class G711Codec implements Codec {
  abstract readonly payloadType: number;
  abstract readonly name: string;
  readonly sampleRate = 8000;
  readonly clockRate = 8000;

  public encode(pcm: Int16Array): Buffer {
    throw new Error("Subclass must implement encode");
  }

  public decode(encoded: Buffer): Int16Array {
    throw new Error("Subclass must implement decode");
  }

  protected pcmToUlaw(pcm: Int16Array): Buffer {
    const encoded = g711.ulawFromPCM(pcm);
    return Buffer.from(encoded);
  }

  protected ulawToPcm(encoded: Buffer): Int16Array {
    const decoded = g711.ulawToPCM(encoded);
    return new Int16Array(decoded.buffer, decoded.byteOffset, decoded.byteLength / 2);
  }

  protected pcmToAlaw(pcm: Int16Array): Buffer {
    const encoded = g711.alawFromPCM(pcm);
    return Buffer.from(encoded);
  }

  protected alawToPcm(encoded: Buffer): Int16Array {
    const decoded = g711.alawToPCM(encoded);
    return new Int16Array(decoded.buffer, decoded.byteOffset, decoded.byteLength / 2);
  }
}

/**
 * PCMU (μ-law) Codec - G.711
 * Payload type 0, 8kHz sample rate
 */
export class PCMUCodec extends G711Codec {
  readonly payloadType = 0;
  readonly name = "PCMU";

  encode(pcm: Int16Array): Buffer {
    return this.pcmToUlaw(pcm);
  }

  decode(encoded: Buffer): Int16Array {
    return this.ulawToPcm(encoded);
  }
}

/**
 * PCMA (A-law) Codec - G.711
 * Payload type 8, 8kHz sample rate
 */
export class PCMACodec extends G711Codec {
  readonly payloadType = 8;
  readonly name = "PCMA";

  encode(pcm: Int16Array): Buffer {
    return this.pcmToAlaw(pcm);
  }

  decode(encoded: Buffer): Int16Array {
    return this.alawToPcm(encoded);
  }
}