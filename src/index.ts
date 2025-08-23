/**
 * AI Voice Agent Library
 * 
 * A high-level library for making AI-powered phone calls with simple, well-crafted entry points.
 * Supports configuration via file path or object, with brief or instruction-based call control.
 */

import { VoiceAgent } from './voice-agent.js';
import { loadConfig, loadConfigFromEnv } from './config.js';
import { CallBriefProcessor, CallBriefError } from './call-brief-processor.js';
import { Config, CallConfig, AIVoiceConfig } from './types.js';
import { initializeLogger, LogLevel, getLogger } from './logger.js';

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
export async function makeCall(options: CallOptions): Promise<CallResult> {
  const startTime = Date.now();
  
  try {
    // Initialize logger
    const logLevel = options.logLevel === 'quiet' ? LogLevel.QUIET : 
                    options.logLevel === 'error' ? LogLevel.ERROR :
                    options.logLevel === 'warn' ? LogLevel.WARN :
                    options.logLevel === 'info' ? LogLevel.INFO :
                    options.logLevel === 'debug' ? LogLevel.DEBUG :
                    options.logLevel === 'verbose' ? LogLevel.VERBOSE :
                    LogLevel.QUIET; // Default to quiet mode
                    
    const logger = initializeLogger({
      level: logLevel,
      enableColors: options.colors ?? true,
      enableTimestamp: options.timestamps ?? false,
      transcriptOnly: logLevel === LogLevel.QUIET
    });

    logger.info(`Starting AI voice agent call to ${options.number}...`, 'CONFIG');
    
    // Load configuration
    let config: Config;
    if (typeof options.config === 'string') {
      try {
        config = loadConfig(options.config);
      } catch (error) {
        logger.warn('Failed to load config file, trying environment variables...', 'CONFIG');
        const envConfig = loadConfigFromEnv();
        
        if (!envConfig.sip?.username || !envConfig.ai?.openaiApiKey) {
          throw new Error('No valid configuration found. Either provide a config file or set environment variables.');
        }
        
        config = envConfig as Config;
      }
    } else if (options.config) {
      config = options.config;
    } else {
      // Try environment variables
      const envConfig = loadConfigFromEnv();
      if (!envConfig.sip?.username || !envConfig.ai?.openaiApiKey) {
        throw new Error('No configuration provided. Either provide config parameter or set environment variables.');
      }
      config = envConfig as Config;
    }

    // Process instructions: options.instructions > options.brief > config instructions > config brief
    let finalInstructions: string | undefined;
    
    if (options.instructions) {
      finalInstructions = options.instructions;
      logger.info('Using instructions provided via options', 'CONFIG');
    } else if (options.brief) {
      logger.info('Generating instructions from call brief...', 'AI');
      try {
        const processor = new CallBriefProcessor({
          openaiApiKey: config.ai?.openaiApiKey || (config as any).openai?.apiKey || process.env.OPENAI_API_KEY || '',
          defaultUserName: options.userName
        });
        
        finalInstructions = await processor.generateInstructions(options.brief, options.userName);
        logger.info('Successfully generated instructions from call brief', 'AI');
      } catch (error) {
        if (error instanceof CallBriefError) {
          throw new Error(`Call brief error: ${error.message}`);
        } else {
          throw new Error(`Failed to generate instructions: ${error instanceof Error ? error.message : 'Unknown error'}`);
        }
      }
    } else if (config.ai?.instructions || (config as any).openai?.instructions) {
      finalInstructions = config.ai?.instructions || (config as any).openai?.instructions;
      logger.info('Using instructions from config', 'CONFIG');
    } else if (config.ai?.brief || (config as any).openai?.brief) {
      logger.info('Generating instructions from config call brief...', 'AI');
      try {
        const processor = new CallBriefProcessor({
          openaiApiKey: config.ai?.openaiApiKey || (config as any).openai?.apiKey || process.env.OPENAI_API_KEY || '',
          defaultUserName: options.userName
        });
        
        const configBrief = config.ai?.brief || (config as any).openai?.brief || '';
        finalInstructions = await processor.generateInstructions(configBrief, options.userName);
        logger.info('Successfully generated instructions from config call brief', 'AI');
      } catch (error) {
        if (error instanceof CallBriefError) {
          throw new Error(`Config call brief error: ${error.message}`);
        } else {
          throw new Error(`Failed to generate instructions from config: ${error instanceof Error ? error.message : 'Unknown error'}`);
        }
      }
    } else {
      throw new Error('No instructions or brief provided. Provide instructions, brief, or set them in config file.');
    }

    // Update config with final instructions
    if (config.ai) {
      config.ai.instructions = finalInstructions;
    } else if ((config as any).openai) {
      (config as any).openai.instructions = finalInstructions;
    }

    // Create and initialize voice agent
    const agent = new VoiceAgent(config, { 
      enableCallRecording: options.recording !== undefined,
      recordingFilename: typeof options.recording === 'string' ? options.recording : undefined
    });

    // Set up event handlers
    let callId: string | undefined;
    let callEnded = false;
    
    return new Promise<CallResult>((resolve, reject) => {
      const cleanup = async () => {
        try {
          await agent.shutdown();
        } catch (error) {
          logger.error('Error during cleanup:', error instanceof Error ? error.message : String(error), 'CONFIG');
        }
      };

      agent.on('callInitiated', ({ callId: id, target }) => {
        callId = id;
        logger.info(`Call initiated to ${target}`, 'SIP');
      });

      agent.on('callEnded', async () => {
        if (callEnded) return;
        callEnded = true;
        
        logger.info('Call ended', 'SIP');
        const duration = Math.round((Date.now() - startTime) / 1000);
        
        // Get transcript if in quiet mode
        const transcriptArray = logLevel === LogLevel.QUIET ? logger.getFullTranscript() : undefined;
        const transcript = transcriptArray ? transcriptArray.join('\n') : undefined;
        
        await cleanup();
        resolve({
          callId,
          duration,
          transcript,
          success: true
        });
      });

      agent.on('error', async (error) => {
        if (callEnded) return;
        callEnded = true;
        
        logger.error(`Agent error: ${error.message}`, 'CONFIG');
        await cleanup();
        reject(new Error(`Call failed: ${error.message}`));
      });

      // Initialize and start call
      (async () => {
        try {
          await agent.initialize();
          
          await agent.makeCall({
            targetNumber: options.number,
            duration: options.duration
          });

          // Set duration timeout if specified
          if (options.duration) {
            setTimeout(async () => {
              if (!callEnded) {
                logger.info(`Call duration reached (${options.duration}s), ending call...`, 'CONFIG');
                await agent.endCall();
              }
            }, options.duration * 1000);
          }

        } catch (error) {
          if (callEnded) return;
          callEnded = true;
          await cleanup();
          reject(error);
        }
      })();
    });

  } catch (error) {
    const duration = Math.round((Date.now() - startTime) / 1000);
    return {
      duration,
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error'
    };
  }
}

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
export async function createAgent(config: string | Config, options?: {
  enableCallRecording?: boolean;
  recordingFilename?: string;
}): Promise<VoiceAgent> {
  let resolvedConfig: Config;
  
  if (typeof config === 'string') {
    try {
      resolvedConfig = loadConfig(config);
    } catch (error) {
      const envConfig = loadConfigFromEnv();
      if (!envConfig.sip?.username || !envConfig.ai?.openaiApiKey) {
        throw new Error('No valid configuration found');
      }
      resolvedConfig = envConfig as Config;
    }
  } else {
    resolvedConfig = config;
  }
  
  const agent = new VoiceAgent(resolvedConfig, options);
  await agent.initialize();
  
  return agent;
}

// Main components (for advanced usage)
export { VoiceAgent } from './voice-agent.js';
export { SIPClient } from './sip-client.js';
export { OpenAIClient } from './openai-client.js';
export { AudioBridge } from './audio-bridge.js';

// Configuration utilities
export { loadConfig, createSampleConfig, loadConfigFromEnv } from './config.js';

// Call brief processing
export { CallBriefProcessor, CallBriefError } from './call-brief-processor.js';

// Codec system
export * from './codecs/index.js';

// Types and interfaces
export * from './types.js';

// Logging
export { LogLevel } from './logger.js';

// Performance monitoring
export { PerformanceMonitor } from './performance-monitor.js';

// Re-export everything for convenience
export * as Codecs from './codecs/index.js';