import { Codec } from "./types.js";
import { PCMUCodec, PCMACodec } from "./g711.js";
import { G722Codec } from "./g722.js";
export declare function logCodecStatus(): void;
/**
 * Get a codec instance by payload type
 * @param payloadType RTP payload type
 * @returns Codec instance or undefined if not supported
 */
export declare function getCodec(payloadType: number): Codec | undefined;
/**
 * Get list of supported payload types
 */
export declare function getSupportedPayloadTypes(): number[];
/**
 * Check if a payload type is supported
 */
export declare function isPayloadTypeSupported(payloadType: number): boolean;
export { Codec, PCMUCodec, PCMACodec, G722Codec };
//# sourceMappingURL=index.d.ts.map