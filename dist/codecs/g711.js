import { createRequire } from "module";
const require = createRequire(import.meta.url);
const g711 = require("g711");
/**
 * Base class for G.711 codecs (PCMU and PCMA)
 * Maintains backward compatibility with existing implementation
 */
class G711Codec {
    sampleRate = 8000;
    clockRate = 8000;
    encode(pcm) {
        throw new Error("Subclass must implement encode");
    }
    decode(encoded) {
        throw new Error("Subclass must implement decode");
    }
    pcmToUlaw(pcm) {
        const encoded = g711.ulawFromPCM(pcm);
        return Buffer.from(encoded);
    }
    ulawToPcm(encoded) {
        const decoded = g711.ulawToPCM(encoded);
        return new Int16Array(decoded.buffer, decoded.byteOffset, decoded.byteLength / 2);
    }
    pcmToAlaw(pcm) {
        const encoded = g711.alawFromPCM(pcm);
        return Buffer.from(encoded);
    }
    alawToPcm(encoded) {
        const decoded = g711.alawToPCM(encoded);
        return new Int16Array(decoded.buffer, decoded.byteOffset, decoded.byteLength / 2);
    }
}
/**
 * PCMU (μ-law) Codec - G.711
 * Payload type 0, 8kHz sample rate
 */
export class PCMUCodec extends G711Codec {
    payloadType = 0;
    name = "PCMU";
    encode(pcm) {
        return this.pcmToUlaw(pcm);
    }
    decode(encoded) {
        return this.ulawToPcm(encoded);
    }
}
/**
 * PCMA (A-law) Codec - G.711
 * Payload type 8, 8kHz sample rate
 */
export class PCMACodec extends G711Codec {
    payloadType = 8;
    name = "PCMA";
    encode(pcm) {
        return this.pcmToAlaw(pcm);
    }
    decode(encoded) {
        return this.alawToPcm(encoded);
    }
}
//# sourceMappingURL=g711.js.map