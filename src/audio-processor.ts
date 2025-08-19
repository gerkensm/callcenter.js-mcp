export interface AudioProcessorConfig {
  quality: "fast" | "standard" | "high";
}

export class AudioProcessor {
  private config: AudioProcessorConfig;

  constructor(config: AudioProcessorConfig = { quality: "high" }) {
    this.config = config;
  }

  /**
   * Resample from 24kHz to 16kHz with minimal processing to avoid artifacts
   */
  resample24kTo16k(audioData: Int16Array): Int16Array {
    // Skip anti-aliasing filter - it's causing the "brrrr" artifacts
    // Just do clean linear interpolation downsampling
    return this.resampleWithRatio(audioData, 3, 2);
  }

  /**
   * Resample from 16kHz to 24kHz with minimal processing
   */
  resample16kTo24k(audioData: Int16Array): Int16Array {
    // Just upsample without additional filtering to avoid artifacts
    return this.resampleWithRatio(audioData, 2, 3);
  }

  /**
   * Generic resampling with simpler approach to prevent artifacts
   */
  private resampleWithRatio(
    audioData: Int16Array,
    inputRatio: number,
    outputRatio: number
  ): Int16Array {
    const outputLength = Math.floor(
      (audioData.length * outputRatio) / inputRatio
    );
    const resampled = new Int16Array(outputLength);

    // More conservative gain reduction to prevent overshoots
    const gainReduction = 0.9; // 10% headroom for safety

    for (let i = 0; i < outputLength; i++) {
      const sourceIndex = (i * inputRatio) / outputRatio;

      // Simple linear interpolation
      const interpolated = this.simpleLinearInterpolate(audioData, sourceIndex);
      const scaled = interpolated * gainReduction;

      // Hard clamp to prevent any overshoots
      resampled[i] = Math.round(Math.max(-32768, Math.min(32767, scaled)));
    }

    return resampled;
  }

  /**
   * Simple linear interpolation without complex processing
   */
  private simpleLinearInterpolate(data: Int16Array, index: number): number {
    const lowerIndex = Math.floor(index);
    const upperIndex = Math.min(lowerIndex + 1, data.length - 1);
    const fraction = index - lowerIndex;

    const lowerSample = data[lowerIndex] || 0;
    const upperSample = data[upperIndex] || 0;

    // Pure linear interpolation
    return lowerSample * (1 - fraction) + upperSample * fraction;
  }

  /**
   * Linear interpolation with proper saturation handling (legacy)
   */
  private linearInterpolate(data: Int16Array, index: number): number {
    const lowerIndex = Math.floor(index);
    const upperIndex = Math.min(lowerIndex + 1, data.length - 1);
    const fraction = index - lowerIndex;

    const lowerSample = data[lowerIndex] || 0;
    const upperSample = data[upperIndex] || 0;

    const interpolated = lowerSample * (1 - fraction) + upperSample * fraction;

    // Soft saturation to prevent harsh clipping on sharp sounds
    return this.softSaturate(interpolated);
  }

  /**
   * Soft saturation to prevent harsh clipping artifacts
   */
  private softSaturate(sample: number): number {
    const maxVal = 32767;
    const minVal = -32768;

    // If within normal range, just round
    if (sample >= minVal && sample <= maxVal) {
      return Math.round(sample);
    }

    // Soft saturation using tanh-like curve for values outside range
    if (sample > maxVal) {
      const excess = (sample - maxVal) / maxVal;
      return Math.round(maxVal * (1 - Math.exp(-excess)));
    } else {
      const excess = (minVal - sample) / maxVal;
      return Math.round(minVal * (1 - Math.exp(-excess)));
    }
  }

  /**
   * Cubic interpolation for better quality
   */
  private cubicInterpolate(data: Int16Array, index: number): number {
    const i = Math.floor(index);
    const fraction = index - i;

    // Get 4 points for cubic interpolation
    const y0 = data[Math.max(i - 1, 0)] || 0;
    const y1 = data[i] || 0;
    const y2 = data[Math.min(i + 1, data.length - 1)] || 0;
    const y3 = data[Math.min(i + 2, data.length - 1)] || 0;

    // Cubic interpolation formula
    const a0 = y3 - y2 - y0 + y1;
    const a1 = y0 - y1 - a0;
    const a2 = y2 - y0;
    const a3 = y1;

    const result =
      a0 * fraction * fraction * fraction +
      a1 * fraction * fraction +
      a2 * fraction +
      a3;

    // Clamp to 16-bit range
    return Math.round(Math.max(-32768, Math.min(32767, result)));
  }

  /**
   * Lanczos interpolation for highest quality
   */
  private lanczosInterpolate(data: Int16Array, index: number): number {
    const a = 3; // Lanczos kernel size
    const i = Math.floor(index);
    const fraction = index - i;

    let sum = 0;
    let weightSum = 0;

    for (let j = -a + 1; j <= a; j++) {
      const sampleIndex = i + j;
      if (sampleIndex >= 0 && sampleIndex < data.length) {
        const x = fraction - j;
        const weight = this.lanczosKernel(x, a);
        sum += data[sampleIndex] * weight;
        weightSum += weight;
      }
    }

    const result = weightSum > 0 ? sum / weightSum : 0;
    return Math.round(Math.max(-32768, Math.min(32767, result)));
  }

  /**
   * Lanczos kernel function
   */
  private lanczosKernel(x: number, a: number): number {
    if (x === 0) return 1;
    if (Math.abs(x) >= a) return 0;

    const piX = Math.PI * x;
    return (a * Math.sin(piX) * Math.sin(piX / a)) / (piX * piX);
  }

  /**
   * Apply simple moving average filter for anti-aliasing (more stable than IIR)
   */
  private applyLowPassFilter(
    audioData: Int16Array,
    cutoffFreq: number,
    sampleRate: number
  ): Int16Array {
    if (this.config.quality === "fast") {
      return audioData; // Skip filtering in fast mode
    }

    // Simple moving average filter - much more stable than IIR
    const filterLength = Math.max(1, Math.floor(sampleRate / (cutoffFreq * 2)));
    const filtered = new Int16Array(audioData.length);

    for (let i = 0; i < audioData.length; i++) {
      let sum = 0;
      let count = 0;

      const start = Math.max(0, i - Math.floor(filterLength / 2));
      const end = Math.min(
        audioData.length - 1,
        i + Math.floor(filterLength / 2)
      );

      for (let j = start; j <= end; j++) {
        sum += audioData[j];
        count++;
      }

      filtered[i] = Math.round(sum / count);
    }

    return filtered;
  }

  /**
   * Legacy methods for backward compatibility - simplified to avoid artifacts
   */
  resample24kTo8k(audioData: Int16Array): Int16Array {
    // Simple downsampling without aggressive filtering
    return this.resampleWithRatio(audioData, 3, 1);
  }

  resample8kTo24k(audioData: Int16Array): Int16Array {
    // Simple upsampling without additional filtering
    return this.resampleWithRatio(audioData, 1, 3);
  }

  resample16kTo8k(audioData: Int16Array): Int16Array {
    // Simple downsampling without aggressive filtering
    return this.resampleWithRatio(audioData, 2, 1);
  }
}
