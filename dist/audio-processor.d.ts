export interface AudioProcessorConfig {
    quality: "fast" | "standard" | "high";
}
export declare class AudioProcessor {
    private config;
    constructor(config?: AudioProcessorConfig);
    /**
     * Resample from 24kHz to 16kHz with minimal processing to avoid artifacts
     */
    resample24kTo16k(audioData: Int16Array): Int16Array;
    /**
     * Resample from 16kHz to 24kHz with minimal processing
     */
    resample16kTo24k(audioData: Int16Array): Int16Array;
    /**
     * Generic resampling with simpler approach to prevent artifacts
     */
    private resampleWithRatio;
    /**
     * Simple linear interpolation without complex processing
     */
    private simpleLinearInterpolate;
    /**
     * Linear interpolation with proper saturation handling (legacy)
     */
    private linearInterpolate;
    /**
     * Soft saturation to prevent harsh clipping artifacts
     */
    private softSaturate;
    /**
     * Cubic interpolation for better quality
     */
    private cubicInterpolate;
    /**
     * Lanczos interpolation for highest quality
     */
    private lanczosInterpolate;
    /**
     * Lanczos kernel function
     */
    private lanczosKernel;
    /**
     * Apply simple moving average filter for anti-aliasing (more stable than IIR)
     */
    private applyLowPassFilter;
    /**
     * Legacy methods for backward compatibility - simplified to avoid artifacts
     */
    resample24kTo8k(audioData: Int16Array): Int16Array;
    resample8kTo24k(audioData: Int16Array): Int16Array;
    resample16kTo8k(audioData: Int16Array): Int16Array;
}
//# sourceMappingURL=audio-processor.d.ts.map