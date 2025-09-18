import { Codec } from "./types.js";
export declare class G722Codec implements Codec {
    readonly payloadType = 9;
    readonly name = "G722";
    readonly sampleRate = 16000;
    readonly clockRate = 8000;
    private nativeInstance;
    constructor();
    encode(pcm: Int16Array): Buffer;
    decode(encoded: Buffer): Int16Array;
    /**
     * Check if G.722 codec is available
     */
    static isAvailable(): boolean;
    /**
     * Get the reason why G.722 is not available (if applicable)
     */
    static getUnavailableReason(): string | null;
}
//# sourceMappingURL=g722.d.ts.map