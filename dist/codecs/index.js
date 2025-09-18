import { PCMUCodec, PCMACodec } from "./g711.js";
import { G722Codec } from "./g722.js";
import { getLogger } from "../logger.js";
/**
 * Codec registry - maintains backward compatibility while adding G.722 support
 */
const codecs = new Map();
// Always register G.711 codecs (backward compatibility)
codecs.set(0, () => new PCMUCodec());
codecs.set(8, () => new PCMACodec());
// Conditionally register G.722 if available
let g722Available = false;
let g722Reason = '';
if (G722Codec.isAvailable()) {
    codecs.set(9, () => new G722Codec());
    g722Available = true;
}
else {
    g722Reason = G722Codec.getUnavailableReason() || 'Unknown reason';
}
// Log codec status only when explicitly requested (not at import time)
export function logCodecStatus() {
    if (g722Available) {
        getLogger().codec.info('✅ G.722 codec support enabled');
    }
    else {
        getLogger().codec.info(`ℹ️  G.722 codec not available: ${g722Reason}`);
    }
}
/**
 * Get a codec instance by payload type
 * @param payloadType RTP payload type
 * @returns Codec instance or undefined if not supported
 */
export function getCodec(payloadType) {
    const codecFactory = codecs.get(payloadType);
    if (codecFactory) {
        try {
            return codecFactory();
        }
        catch (error) {
            getLogger().codec.error(`Failed to create codec for payload type ${payloadType}:`, error);
            return undefined;
        }
    }
    return undefined;
}
/**
 * Get list of supported payload types
 */
export function getSupportedPayloadTypes() {
    return Array.from(codecs.keys()).sort();
}
/**
 * Check if a payload type is supported
 */
export function isPayloadTypeSupported(payloadType) {
    return codecs.has(payloadType);
}
// Re-export types and codec classes
export { PCMUCodec, PCMACodec, G722Codec };
//# sourceMappingURL=index.js.map