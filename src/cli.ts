#!/usr/bin/env node

import 'dotenv/config';
import { Command } from 'commander';
import { VoiceAgent } from './voice-agent.js';
import { loadConfig, createSampleConfig, loadConfigFromEnv } from './config.js';
import { Config } from './types.js';
import { initializeLogger, LogLevel } from './logger.js';
import { CallBriefProcessor, CallBriefError } from './call-brief-processor.js';
import { isValidLanguageCode } from './language-utils.js';
import { sanitizeVoiceName } from './voice-characteristics.js';
import * as path from 'path';

const program = new Command();

program
  .name('ai-voice-agent')
  .description('AI Voice Agent for SIP calls using OpenAI Realtime API')
  .version('1.0.0')
  .option('--mcp', 'Start MCP server mode for integration with MCP clients');

program
  .command('call')
  .description('Make a call to a phone number')
  .argument('<number>', 'Phone number to call')
  .option('-c, --config <path>', 'Configuration file path', 'config.json')
  .option('-d, --duration <seconds>', 'Maximum call duration in seconds', '600')
  .option('-v, --verbose', 'Verbose mode - show all debug information')
  .option('-q, --quiet', 'Quiet mode - show only transcripts, errors, and warnings')
  .option('--log-level <level>', 'Set log level (quiet|error|warn|info|debug|verbose)', 'info')
  .option('--no-colors', 'Disable colored output')
  .option('--no-timestamp', 'Disable timestamps in logs')
  .option('--record [filename]', 'Enable stereo call recording (optional filename, defaults to call-recording-TIMESTAMP.wav)')
  .option('--brief <text>', 'Call brief to generate instructions from (e.g., "Call Bocca di Bacco and book a table for 2 at 19:30 for Torben")')
  .option('--instructions <text>', 'Direct instructions for the AI agent (overrides config and brief)')
  .option('--user-name <name>', 'Your name for the AI to use when calling on your behalf')
  .option('--voice <name>', 'Voice to use (auto, alloy, echo, nova, etc.). Default: auto')
  .action(async (number: string, options: any) => {
    try {
      // Determine log level from options (default to info mode)
      let logLevel = LogLevel.INFO;
      if (options.verbose) {
        logLevel = LogLevel.VERBOSE;
      } else if (options.quiet) {
        logLevel = LogLevel.QUIET;
      } else if (options.logLevel) {
        logLevel = options.logLevel as LogLevel;
      }

      // Initialize logger
      const logger = initializeLogger({
        level: logLevel,
        enableColors: !options.noColors,
        enableTimestamp: !options.noTimestamp,
        transcriptOnly: logLevel === LogLevel.QUIET
      });

      logger.info(`Starting AI voice agent call to ${number}...`, "CONFIG");
      
      let config: Config;
      try {
        config = loadConfig(options.config);
      } catch (error) {
        logger.warn('Failed to load config file, trying environment variables...', 'CONFIG');
        const envConfig = loadConfigFromEnv();
        
        if (!envConfig.sip?.username || !envConfig.ai?.openaiApiKey) {
          logger.error('No valid configuration found.', 'CONFIG');
          logger.error('Either provide a config file with --config or set environment variables:', 'CONFIG');
          logger.error('  SIP_USERNAME, SIP_PASSWORD, SIP_SERVER_IP, OPENAI_API_KEY', 'CONFIG');
          process.exit(1);
        }
        
        config = envConfig as Config;
      }

      // Process instructions: CLI instructions > CLI brief > config instructions > config brief
      let finalInstructions: string | undefined;
      let detectedLanguage: string | undefined;
      let selectedVoice: string | undefined;
      
      // Validate and sanitize voice option
      const requestedVoice = options.voice || config.ai?.voice || (config as any).openai?.voice || 'auto';
      const validatedVoice = sanitizeVoiceName(requestedVoice);
      
      if (!validatedVoice) {
        logger.warn(`Invalid voice '${requestedVoice}', defaulting to auto selection`, "CONFIG");
      }
      
      const voiceToUse = validatedVoice || 'auto';
      logger.info(`Using voice mode: ${voiceToUse}`, "CONFIG");
      
      if (options.instructions) {
        // Direct instructions provided via CLI (highest priority)
        finalInstructions = options.instructions;
        logger.info('Using instructions provided via --instructions', 'CONFIG');
      } else if (options.brief) {
        // Generate instructions from CLI brief (second priority)
        logger.info('Generating instructions from CLI call brief...', "AI");
        try {
          const processor = new CallBriefProcessor({
            openaiApiKey: config.ai?.openaiApiKey || (config as any).openai?.apiKey || process.env.OPENAI_API_KEY || '',
            defaultUserName: options.userName || process.env.USER_NAME || config.ai?.userName,
            voice: voiceToUse
          });
          
          const result = await processor.generateInstructions(
            options.brief, 
            options.userName || process.env.USER_NAME || config.ai?.userName,
            voiceToUse
          );
          finalInstructions = result.instructions;
          detectedLanguage = result.language;
          selectedVoice = result.selectedVoice;
          logger.info('Successfully generated instructions from CLI call brief', "AI");
        } catch (error) {
          if (error instanceof CallBriefError) {
            logger.error(`Call brief error: ${error.message}`, "AI");
          } else {
            logger.error(`Failed to generate instructions: ${error instanceof Error ? error.message : 'Unknown error'}`, "AI");
          }
          process.exit(1);
        }
      } else if (config.ai?.instructions || (config as any).openai?.instructions) {
        // Use instructions from config (third priority)
        finalInstructions = config.ai?.instructions || (config as any).openai?.instructions;
        logger.info('Using instructions from config file', "CONFIG");
      } else if (config.ai?.brief || (config as any).openai?.brief) {
        // Generate instructions from config brief (fourth priority)
        logger.info('Generating instructions from config call brief...', "AI");
        try {
          const processor = new CallBriefProcessor({
            openaiApiKey: config.ai?.openaiApiKey || (config as any).openai?.apiKey || process.env.OPENAI_API_KEY || '',
            defaultUserName: options.userName || process.env.USER_NAME || config.ai?.userName,
            voice: voiceToUse
          });
          
          const configBrief = config.ai?.brief || (config as any).openai?.brief || '';
          const result = await processor.generateInstructions(
            configBrief, 
            options.userName || process.env.USER_NAME || config.ai?.userName,
            voiceToUse
          );
          finalInstructions = result.instructions;
          detectedLanguage = result.language;
          selectedVoice = result.selectedVoice;
          logger.info('Successfully generated instructions from config call brief', "AI");
        } catch (error) {
          if (error instanceof CallBriefError) {
            logger.error(`Config call brief error: ${error.message}`, "AI");
          } else {
            logger.error(`Failed to generate instructions from config: ${error instanceof Error ? error.message : 'Unknown error'}`, "AI");
          }
          process.exit(1);
        }
      } else {
        // No instructions or brief provided anywhere
        logger.error('No instructions or brief provided. Use --instructions, --brief, or set instructions/brief in config file.');
        process.exit(1);
      }

      // Update config with final instructions, language, and voice
      const finalVoice = selectedVoice || (voiceToUse !== 'auto' ? voiceToUse : 'marin');
      
      if (config.ai) {
        config.ai.instructions = finalInstructions;
        config.ai.voice = finalVoice;
        if (detectedLanguage && isValidLanguageCode(detectedLanguage)) {
          config.ai.language = detectedLanguage;
          logger.info(`Detected language for transcription: ${detectedLanguage}`, "AI");
        } else if (detectedLanguage) {
          logger.warn(`Invalid detected language '${detectedLanguage}' - Whisper will auto-detect`, "AI");
        }
        if (selectedVoice) {
          logger.info(`Auto-selected voice: ${selectedVoice}`, "AI");
        }
      } else if ((config as any).openai) {
        (config as any).openai.instructions = finalInstructions;
        (config as any).openai.voice = finalVoice;
        if (detectedLanguage && isValidLanguageCode(detectedLanguage)) {
          (config as any).openai.language = detectedLanguage;
          logger.info(`Detected language for transcription: ${detectedLanguage}`, "AI");
        } else if (detectedLanguage) {
          logger.warn(`Invalid detected language '${detectedLanguage}' - Whisper will auto-detect`, "AI");
        }
        if (selectedVoice) {
          logger.info(`Auto-selected voice: ${selectedVoice}`, "AI");
        }
      }

      const agent = new VoiceAgent(config, { 
        enableCallRecording: options.record !== undefined,
        recordingFilename: options.record === true ? undefined : options.record
      });
      
      agent.on('sipEvent', (event) => {
        logger.sip.debug(`${event.type}`);
      });

      agent.on('callInitiated', ({ target }) => {
        logger.sip.info(`Call initiated to ${target}`);
      });

      agent.on('callEnded', () => {
        // In quiet mode, show final transcript summary
        if (logLevel === LogLevel.QUIET) {
          const transcript = logger.getFullTranscript();
          if (transcript.length === 0) {
            logger.info('No conversation recorded.');
          }
        }
        process.exit(0);
      });

      agent.on('error', (error) => {
        logger.error(`Agent error: ${error.message}`);
        process.exit(1);
      });

      await agent.initialize();
      
      await agent.makeCall({
        targetNumber: number,
        duration: parseInt(options.duration)
      });

      if (options.duration) {
        setTimeout(async () => {
          logger.info(`Call duration reached (${options.duration}s), ending call...`, "CONFIG");
          await agent.endCall();
        }, parseInt(options.duration) * 1000);
      }

      process.on('SIGINT', async () => {
        logger.info('\nReceived SIGINT, shutting down gracefully...', "CONFIG");
        await agent.shutdown();
        process.exit(0);
      });

      process.on('SIGTERM', async () => {
        logger.info('\nReceived SIGTERM, shutting down gracefully...', "CONFIG");
        await agent.shutdown();
        process.exit(0);
      });

    } catch (error) {
      // Initialize basic logger if not already done
      const logger = initializeLogger({ level: LogLevel.ERROR, enableColors: true, enableTimestamp: false });
      logger.error(error instanceof Error ? error.message : 'Unknown error');
      process.exit(1);
    }
  });

program
  .command('status')
  .description('Check agent and connection status')
  .option('-c, --config <path>', 'Configuration file path', 'config.json')
  .action(async (options: any) => {
    try {
      const logger = initializeLogger({ level: LogLevel.INFO, enableColors: true, enableTimestamp: false });
      
      const config = loadConfig(options.config);
      const agent = new VoiceAgent(config, { 
        enableCallRecording: false  // No recording needed for status check
      });
      
      logger.info('Initializing agent to check status...');
      await agent.initialize();
      
      const status = agent.getStatus();
      logger.info('\nAgent Status:');
      logger.info(`  SIP Connected: ${status.sipConnected ? '✓' : '✗'}`);
      logger.info(`  AI Connected: ${status.aiConnected ? '✓' : '✗'}`);
      logger.info(`  Audio Bridge: ${status.audioBridgeActive ? '✓' : '✗'}`);
      logger.info(`  Call Active: ${status.callActive ? '✓' : '✗'}`);
      
      if (status.currentCallId) {
        logger.info(`  Current Call ID: ${status.currentCallId}`);
      }
      
      await agent.shutdown();
    } catch (error) {
      const logger = initializeLogger({ level: LogLevel.ERROR, enableColors: true, enableTimestamp: false });
      logger.error(error instanceof Error ? error.message : 'Unknown error');
      process.exit(1);
    }
  });

program
  .command('init')
  .description('Create a sample configuration file')
  .option('-o, --output <path>', 'Output configuration file path', 'config.json')
  .action((options: any) => {
    try {
      const logger = initializeLogger({ level: LogLevel.INFO, enableColors: true, enableTimestamp: false });
      
      createSampleConfig(options.output);
      logger.info('\nPlease edit the configuration file and add your credentials:');
      logger.info(`  - SIP username and password for your Fritz Box`);
      logger.info(`  - OpenAI API key`);
      logger.info(`  - SIP server IP (your Fritz Box IP address)`);
    } catch (error) {
      const logger = initializeLogger({ level: LogLevel.ERROR, enableColors: true, enableTimestamp: false });
      logger.error(error instanceof Error ? error.message : 'Unknown error');
      process.exit(1);
    }
  });

program
  .command('test-sip')
  .description('Test SIP connection only')
  .option('-c, --config <path>', 'Configuration file path', 'config.json')
  .action(async (options: any) => {
    try {
      const config = loadConfig(options.config);
      console.log('Testing SIP connection...');
      
      const { SIPClient } = await import('./sip-client.js');
      const sipClient = new SIPClient(config.sip, (event) => {
        console.log(`SIP Event: ${event.type}`);
        if (event.type === 'REGISTERED') {
          console.log('✓ SIP registration successful!');
          process.exit(0);
        } else if (event.type === 'REGISTER_FAILED') {
          console.error('✗ SIP registration failed');
          console.error(event.message);
          process.exit(1);
        }
      });
      
      await sipClient.connect();
      
      setTimeout(() => {
        console.error('✗ SIP connection timeout');
        process.exit(1);
      }, 10000);
      
    } catch (error) {
      console.error('Error:', error instanceof Error ? error.message : 'Unknown error');
      process.exit(1);
    }
  });

// Check for MCP mode before parsing to avoid Commander.js help display
if (process.argv.includes('--mcp')) {
  startMCPServer();
} else {
  program.parse();
}

async function startMCPServer() {
  try {
    const { startMCPServer: startServer } = await import('./mcp-server.js');
    await startServer();
  } catch (error) {
    console.error('Failed to start MCP server:', error instanceof Error ? error.message : 'Unknown error');
    process.exit(1);
  }
}