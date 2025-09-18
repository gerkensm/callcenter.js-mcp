import { createRequire } from "module";
// Load the CommonJS loader module
const require = createRequire(import.meta.url);
const g722Loader = require('./g722-loader.cjs');
export class G722Codec {
    payloadType = 9;
    name = "G722";
    sampleRate = 16000;
    clockRate = 8000; // As per RFC 3551
    nativeInstance = null;
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
        }
        catch (error) {
            throw new Error(`Failed to initialize G.722 codec: ${error instanceof Error ? error.message : 'Unknown error'}`);
        }
    }
    encode(pcm) {
        if (!this.nativeInstance) {
            throw new Error('G.722 codec not initialized');
        }
        // The native addon expects a raw Buffer, not a TypedArray view
        const pcmBuffer = Buffer.from(pcm.buffer, pcm.byteOffset, pcm.byteLength);
        return this.nativeInstance.encode(pcmBuffer);
    }
    decode(encoded) {
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
    static isAvailable() {
        return g722Loader.isAvailable();
    }
    /**
     * Get the reason why G.722 is not available (if applicable)
     */
    static getUnavailableReason() {
        return g722Loader.getUnavailableReason();
    }
}
//# sourceMappingURL=g722.js.map