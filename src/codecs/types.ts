/**
 * Common interface for audio codecs
 */
export interface Codec {
  readonly payloadType: number;
  readonly name: string;
  readonly sampleRate: number;
  readonly clockRate: number;
  encode(pcm: Int16Array): Buffer;
  decode(encoded: Buffer): Int16Array;
}