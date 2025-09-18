/**
 * AI Voice Agent Library
 *
 * A high-level library for making AI-powered phone calls with simple, well-crafted entry points.
 * Supports configuration via file path or object, with brief or instruction-based call control.
 */
import { VoiceAgent } from './voice-agent.js';
import { Config } from './types.js';
export interface CallOptions {
    /** Phone number to call */
    number: string;
    /** Call duration in seconds (optional, defaults to no limit) */
    duration?: number;
    /** Configuration - either file path or config object */
    config?: string | Config;
    /** Direct instructions for the AI agent (highest priority) */
    instructions?: string;
    /** Call brief to generate instructions from (if instructions not provided) */
    brief?: string;
    /** Your name for the AI to use when calling on your behalf */
    userName?: string;
    /** Voice to use ('auto' for AI selection, or specific voice name) */
    voice?: string;
    /** Enable call recording with optional filename */
    recording?: boolean | string;
    /** Log level for the call */
    logLevel?: 'quiet' | 'error' | 'warn' | 'info' | 'debug' | 'verbose';
    /** Enable colored output */
    colors?: boolean;
    /** Enable timestamps in logs */
    timestamps?: boolean;
}
export interface CallResult {
    /** Call ID if successful */
    callId?: string;
    /** Call duration in seconds */
    duration: number;
    /** Full transcript if available */
    transcript?: string;
    /** Whether call was successful */
    success: boolean;
    /** Error message if failed */
    error?: string;
}
/**
 * Make a phone call with AI agent
 *
 * @example
 * ```typescript
 * import { makeCall } from 'ai-voice-agent';
 *
 * // Simple call with brief
 * const result = await makeCall({
 *   number: '+1234567890',
 *   brief: 'Call Bocca di Bacco and book a table for 2 at 19:30 for Torben',
 *   userName: 'Torben',
 *   config: 'config.json'
 * });
 *
 * // Call with direct instructions
 * const result = await makeCall({
 *   number: '+1234567890',
 *   instructions: 'You are calling to book a restaurant reservation...',
 *   config: myConfigObject
 * });
 * ```
 */
export declare function makeCall(options: CallOptions): Promise<CallResult>;
/**
 * Create a VoiceAgent instance for more advanced use cases
 *
 * @example
 * ```typescript
 * import { createAgent } from 'ai-voice-agent';
 *
 * const agent = await createAgent('config.json');
 *
 * agent.on('callEnded', () => {
 *   console.log('Call finished!');
 * });
 *
 * await agent.makeCall({ targetNumber: '+1234567890' });
 * ```
 */
export declare function createAgent(config: string | Config, options?: {
    enableCallRecording?: boolean;
    recordingFilename?: string;
}): Promise<VoiceAgent>;
export { VoiceAgent } from './voice-agent.js';
export { SIPClient } from './sip-client.js';
export { OpenAIClient } from './openai-client.js';
export { AudioBridge } from './audio-bridge.js';
export { loadConfig, createSampleConfig, loadConfigFromEnv } from './config.js';
export { CallBriefProcessor, CallBriefError } from './call-brief-processor.js';
export * from './codecs/index.js';
export * from './types.js';
export { LogLevel } from './logger.js';
export { PerformanceMonitor } from './performance-monitor.js';
export * as Codecs from './codecs/index.js';
//# sourceMappingURL=index.d.ts.map