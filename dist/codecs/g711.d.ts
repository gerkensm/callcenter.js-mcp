import { Codec } from "./types.js";
/**
 * Base class for G.711 codecs (PCMU and PCMA)
 * Maintains backward compatibility with existing implementation
 */
declare abstract class G711Codec implements Codec {
    abstract readonly payloadType: number;
    abstract readonly name: string;
    readonly sampleRate = 8000;
    readonly clockRate = 8000;
    encode(pcm: Int16Array): Buffer;
    decode(encoded: Buffer): Int16Array;
    protected pcmToUlaw(pcm: Int16Array): Buffer;
    protected ulawToPcm(encoded: Buffer): Int16Array;
    protected pcmToAlaw(pcm: Int16Array): Buffer;
    protected alawToPcm(encoded: Buffer): Int16Array;
}
/**
 * PCMU (μ-law) Codec - G.711
 * Payload type 0, 8kHz sample rate
 */
export declare class PCMUCodec extends G711Codec {
    readonly payloadType = 0;
    readonly name = "PCMU";
    encode(pcm: Int16Array): Buffer;
    decode(encoded: Buffer): Int16Array;
}
/**
 * PCMA (A-law) Codec - G.711
 * Payload type 8, 8kHz sample rate
 */
export declare class PCMACodec extends G711Codec {
    readonly payloadType = 8;
    readonly name = "PCMA";
    encode(pcm: Int16Array): Buffer;
    decode(encoded: Buffer): Int16Array;
}
export {};
//# sourceMappingURL=g711.d.ts.map