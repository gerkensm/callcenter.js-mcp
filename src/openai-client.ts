import WebSocket from "ws";
import { EventEmitter } from "events";
import { AIVoiceConfig } from "./types.js";
import { getLogger } from "./logger.js";
import * as fs from "fs";
import { Writer } from "wav";

export class OpenAIClient extends EventEmitter {
  private ws: WebSocket | null = null;
  private config: AIVoiceConfig;
  private isConnected: boolean = false;
  private onAudioCallback?: (audio: Int16Array, responseId?: string) => void;
  private onEndCallCallback?: () => void;
  private watchdogTimer: any = null;
  private sawResponseCreated = false;
  private pendingEndCall: { reason: string; responseId: string } | null = null;
  private wasGoodbyeInterrupted = false;
  private openaiWavWriter: Writer | null = null;
  private debugAudioFile: boolean = false;
  private conversationItems: any[] = [];
  private perfStats = {
    eventProcessTimes: [] as number[],
    lastStatsLog: 0,
    conversationItems: 0,
  };

  constructor(config: AIVoiceConfig) {
    super();
    this.config = config;

    // Initialize WAV recording for OpenAI audio debugging
    if (this.debugAudioFile) {
      this.setupOpenAIWavRecording();
    }
  }

  private setupWebSocketHandlers(): void {
    const logger = getLogger();
    
    if (!this.ws) return;

    // Handle WebSocket messages (all OpenAI Realtime API events)
    this.ws.on('message', (message: Buffer) => {
      try {
        const event = JSON.parse(message.toString());
        const startTime = performance.now();
        
        // Track performance
        const processingTime = performance.now() - startTime;
        this.perfStats.eventProcessTimes.push(processingTime);
        if (this.perfStats.eventProcessTimes.length > 50) {
          this.perfStats.eventProcessTimes.shift();
        }

        // Log stats every 30 seconds
        if (performance.now() - this.perfStats.lastStatsLog > 30000) {
          this.logOpenAIPerformanceStats();
          this.perfStats.lastStatsLog = performance.now();
        }

        // Handle different event types
        switch (event.type) {
          case 'session.created':
            logger.ai.debug('Session created', "AI");
            break;
            
          case 'session.updated':
            logger.ai.debug('Session updated', "AI");
            break;

          case 'response.audio.delta':
            // Handle audio streaming from OpenAI
            if (event.delta) {
              const audioBuffer = Buffer.from(event.delta, "base64");
              const audioData = new Int16Array(
                audioBuffer.buffer,
                audioBuffer.byteOffset,
                audioBuffer.length / 2
              );

              // Record raw OpenAI audio to WAV file for debugging
              if (this.openaiWavWriter) {
                const wavBuffer = Buffer.from(
                  audioData.buffer,
                  audioData.byteOffset,
                  audioData.byteLength
                );
                this.openaiWavWriter.write(wavBuffer);
              }

              if (this.onAudioCallback) {
                // Pass the response_id along with audio data
                this.onAudioCallback(audioData, event.response_id);
              }
            } else {
              logger.ai.warn("response.audio.delta event missing delta:", JSON.stringify(event));
            }
            break;

          case 'response.output_item.done':
            logger.ai.debug(`output_item.done: ${event.item?.type}, name: ${event.item?.name}`, "AI");
            
            // Handle function calls - this is the key event for function execution
            if (event.item?.type === "function_call" && event.item.name === "end_call") {
              const args = event.item.arguments ? JSON.parse(event.item.arguments) : {};
              const reason = args?.reason ?? "unknown";
              
              logger.ai.info(`AI decided to end call: ${reason}`, "AI");
              
              // Emit the reason so VoiceAgent can track it
              this.emit('aiEndCallDecision', reason);
              
              // Set flag to execute end_call after THIS specific response finishes streaming
              this.pendingEndCall = { reason, responseId: event.response_id };
              logger.ai.debug(`End call queued for response ${event.response_id}`, "AI");

              // Send function call output back
              this.send("conversation.item.create", {
                item: {
                  type: "function_call_output",
                  call_id: event.item.call_id,
                  output: `Call ended successfully. Reason: ${reason}`,
                },
              });
              
              // Don't send response.create - call should end here
            }
            break;

          case 'response.function_call_arguments.delta':
            logger.ai.debug(`Function call arguments delta: ${event.name} - ${event.delta}`, "AI");
            break;

          case 'response.function_call_arguments.done':
            logger.ai.debug(`Function call arguments done: ${event.name}, call_id: ${event.call_id}, args: ${event.arguments}`, "AI");
            break;

          case 'input_audio_buffer.speech_started':
            logger.ai.debug("Speech started (user is talking) - interrupting AI");
            
            // Track if we're canceling a goodbye
            const wasCancelingGoodbye = !!this.pendingEndCall;
            
            // If end_call is pending, user is interrupting during goodbye
            if (this.pendingEndCall) {
              logger.ai.info("User interrupted during goodbye - canceling end_call and continuing conversation", "AI");
              // Clear the pending end call since user wants to say something
              this.pendingEndCall = null;
              this.wasGoodbyeInterrupted = true;
              // Also notify AudioBridge to cancel any pending callbacks
              this.emit("cancelPendingEndCall");
            }
            
            // Cancel any ongoing response
            this.send("response.cancel");
            
            // Stop audio bridge playback
            logger.ai.debug("User interrupted - stopping audio playback", "AI");
            this.emit("conversationInterrupted");
            
            // If we canceled a goodbye, ensure we'll create a response after speech stops
            if (wasCancelingGoodbye) {
              // Force a slightly longer watchdog to ensure response creation
              clearTimeout(this.watchdogTimer);
              this.watchdogTimer = setTimeout(() => {
                logger.ai.info("Creating response after goodbye interruption", "AI");
                this.createResponse();
              }, 800); // Give user time to finish speaking
            }
            break;

          case 'input_audio_buffer.speech_stopped':
            logger.ai.debug("Speech stopped (user finished talking)");
            // Only start watchdog if we don't already have one running (from goodbye interruption)
            if (!this.watchdogTimer) {
              this.startResponseWatchdog();
            }
            break;

          case 'conversation.interrupted':
            logger.ai.debug("User interrupted - stopping current response", "AI");
            this.emit("conversationInterrupted");
            // Create new response turn immediately when user interrupts
            this.createResponse();
            break;

          case 'response.created':
            this.sawResponseCreated = true;
            clearTimeout(this.watchdogTimer);
            break;

          case 'conversation.item.input_audio_transcription.completed':
            logger.ai.debug("Received user transcription completion event", event);
            if (event.transcript) {
              logger.transcript("user", event.transcript, false);
            }
            break;

          case 'input_audio_buffer.transcription':
            logger.ai.debug("Received transcription event", event);
            if (event.transcript) {
              logger.transcript("user", event.transcript, true);
            }
            break;

          case 'conversation.item.created':
            logger.ai.debug("Conversation item created", event);
            // Store conversation items for getConversationItems()
            if (event.item) {
              this.conversationItems.push(event.item);
            }
            
            // Handle function calls
            if (event.item?.type === "function_call") {
              logger.ai.debug(`Function call created: ${event.item.name}`, "AI");
              if (event.item.name === "end_call") {
                logger.ai.info(`AI ending call`, "AI");
              }
            }

            // Handle user audio content transcripts
            if (event.item?.role === "user" && event.item.content) {
              const content = event.item.content;
              if (Array.isArray(content)) {
                content.forEach((c) => {
                  if (c.type === "input_audio" && c.transcript) {
                    logger.transcript("user", c.transcript, false);
                  }
                });
              } else if (content.type === "input_audio" && content.transcript) {
                logger.transcript("user", content.transcript, false);
              }
            }
            break;

          case 'response.audio_transcript.done':
            // Handle assistant transcript completion
            if (event.transcript) {
              logger.transcript("assistant", event.transcript, false);
            }
            break;

          case 'response.text.done':
            // Handle assistant text completion
            if (event.text) {
              logger.transcript("assistant", event.text, false);
            }
            break;

          case 'response.done':
            // Note: response.done uses event.response.id not event.response_id
            const responseId = event.response?.id || event.response_id;
            logger.ai.debug(`Response completed: ${responseId}`, "AI");
            
            // Execute pending end_call only if THIS is the response that contains the end_call
            if (this.pendingEndCall && this.pendingEndCall.responseId === responseId) {
              logger.ai.debug(`Goodbye message generated, waiting for audio to finish playing`, "AI");
              
              // Emit event to notify that this response needs to finish playing before ending
              this.emit('responseWithEndCallComplete', responseId);
            }
            break;

          case 'response.canceled':
            logger.ai.debug("Response canceled by user interruption", "AI");
            // Clear any pending end call if response was canceled
            this.pendingEndCall = null;
            break;

          case 'response.failed':
            logger.ai.error(`Response failed: ${JSON.stringify(event)}`, "AI");
            // Clear any pending end call if response failed
            this.pendingEndCall = null;
            break;

          case 'error':
            // Don't log "Cancellation failed" as error - it's expected when user interrupts
            if (event.error?.message?.includes("Cancellation failed")) {
              logger.ai.debug("Response cancellation attempted but no active response", "AI");
            } else {
              logger.ai.error("Realtime API error:", event.error);
            }
            break;

          default:
            // Log function-related events at debug level
            if (
              event.type.includes("function") ||
              event.type.includes("tool") ||
              event.type.includes("call")
            ) {
              logger.ai.debug(`Function Event: ${event.type}`, "AI");
            }
            // Log other response events that might contain function calls
            else if (
              event.type.includes("response") &&
              !event.type.includes("audio")
            ) {
              const eventStr = JSON.stringify(event, null, 2);
              if (
                eventStr.includes("end_call") ||
                eventStr.includes("function") ||
                eventStr.includes("tool")
              ) {
                logger.ai.debug(`Found function data in response event: ${event.type}`, "AI");
              } else {
                logger.ai.verbose(`Response Event: ${event.type}`, "AI");
              }
            }
            // Log other conversation events
            else if (event.type.includes("conversation")) {
              logger.ai.debug(`Conversation Event: ${event.type}`, "AI");
            }
            // Log everything else at verbose level
            else {
              logger.ai.verbose(`Event: ${event.type}`, "AI");
            }
            break;
        }
      } catch (error) {
        logger.ai.error("Error parsing WebSocket message:", error);
      }
    });

    this.ws.on('open', () => {
      logger.ai.debug('WebSocket connection opened', "AI");
      this.isConnected = true;
      this.setupSession();
    });

    this.ws.on('close', () => {
      logger.ai.debug('WebSocket connection closed', "AI");
      this.isConnected = false;
    });

    this.ws.on('error', (error) => {
      logger.ai.error('WebSocket error:', error);
    });
  }

  async connect(): Promise<void> {
    if (this.isConnected) return;

    try {
      const url = "wss://api.openai.com/v1/realtime?model=gpt-realtime";
      
      // Create WebSocket with proper authentication headers
      this.ws = new WebSocket(url, [], {
        finishRequest: (request) => {
          request.setHeader('Authorization', `Bearer ${this.config.openaiApiKey}`);
          request.setHeader('OpenAI-Beta', 'realtime=v1');
          request.end();
        },
      });

      // Setup WebSocket event handlers
      this.setupWebSocketHandlers();

      // Wait for connection to open
      await new Promise<void>((resolve, reject) => {
        const connectionErrorHandler = (error: Error) => {
          this.disconnect();
          reject(new Error(`Could not connect to OpenAI Realtime API: ${error.message}`));
        };

        this.ws!.on('error', connectionErrorHandler);
        this.ws!.on('open', () => {
          getLogger().ai.debug("Connected to OpenAI Realtime API", "AI");
          this.ws!.removeListener('error', connectionErrorHandler);
          this.isConnected = true;
          resolve();
        });
      });

    } catch (error) {
      getLogger().ai.error("Failed to connect to OpenAI:", error);
      throw error;
    }
  }

  private setupSession(): void {
    if (!this.isConnected || !this.ws) return;

    // Send session.update with all configuration including tools
    this.send('session.update', {
      session: {
        instructions: this.config.instructions,
        voice: this.config.voice || "marin",
        turn_detection: { type: "server_vad" },
        input_audio_transcription: { model: "whisper-1" },
        modalities: ["text", "audio"],
        input_audio_format: "pcm16",
        output_audio_format: "pcm16",
        temperature: 0.8,
        tool_choice: "auto",
        tools: [
          {
            type: "function",
            name: "end_call",
            description: "End the phone call immediately when requested or when conversation is complete",
            parameters: {
              type: "object",
              properties: {
                reason: {
                  type: "string",
                  description: "Reason for ending call",
                },
              },
              required: [],
            },
          },
        ],
      },
    });

    getLogger().ai.debug("Session configured with tools", "AI");
  }

  async disconnect(): Promise<void> {
    if (!this.isConnected) return;

    try {
      if (this.ws) {
        this.ws.close();
        this.ws = null;
      }
      this.isConnected = false;

      // Close WAV writer for OpenAI audio
      if (this.openaiWavWriter) {
        this.openaiWavWriter.end();
        this.openaiWavWriter = null;
        getLogger().ai.debug("OpenAI audio saved to openai-audio-*.wav");
      }

      getLogger().ai.debug("Disconnected from OpenAI Realtime API");
    } catch (error) {
      getLogger().ai.error("Error disconnecting from OpenAI:", error);
    }
  }

  // Send message to OpenAI WebSocket
  private send(eventName: string, data: any = {}): void {
    if (!this.isConnected || !this.ws) {
      throw new Error("Not connected to OpenAI Realtime API");
    }

    const event = {
      event_id: this.generateEventId(),
      type: eventName,
      ...data,
    };

    getLogger().ai.debug(`Sending: ${eventName}`, "AI");
    this.ws.send(JSON.stringify(event));
  }

  // Generate unique event ID
  private generateEventId(): string {
    const chars = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
    const length = 21;
    const str = Array(length - 4)
      .fill(0)
      .map(() => chars[Math.floor(Math.random() * chars.length)])
      .join('');
    return `evt_${str}`;
  }

  sendAudio(audioData: Int16Array): void {
    if (!this.isConnected) {
      getLogger().ai.warn("Cannot send audio: not connected to OpenAI");
      return;
    }

    // Don't send audio if end_call is pending - let current response finish
    if (this.pendingEndCall) {
      getLogger().ai.debug("Blocking audio input - end_call is pending");
      return;
    }

    try {
      // Convert audio data to base64
      const base64Audio = this.arrayBufferToBase64(audioData);
      
      this.send('input_audio_buffer.append', {
        audio: base64Audio,
      });
    } catch (error) {
      getLogger().ai.error("Error sending audio to OpenAI:", error);
    }
  }

  // Utility to convert ArrayBuffer/Int16Array to base64
  private arrayBufferToBase64(arrayBuffer: Int16Array | ArrayBuffer): string {
    if (arrayBuffer instanceof Int16Array) {
      arrayBuffer = arrayBuffer.buffer as ArrayBuffer;
    }
    let binary = '';
    const bytes = new Uint8Array(arrayBuffer);
    const chunkSize = 0x8000; // 32KB chunk size
    for (let i = 0; i < bytes.length; i += chunkSize) {
      const chunk = bytes.subarray(i, i + chunkSize);
      binary += String.fromCharCode.apply(null, Array.from(chunk));
    }
    return btoa(binary);
  }

  sendText(text: string): void {
    if (!this.isConnected) {
      getLogger().ai.warn("Cannot send text: not connected to OpenAI");
      return;
    }

    try {
      getLogger().ai.debug(`Sending text to OpenAI: "${text}"`);
      
      // Create conversation item with text content
      this.send('conversation.item.create', {
        item: {
          type: 'message',
          role: 'user',
          content: [{ type: 'input_text', text }],
        },
      });
      
      // Request response generation
      this.createResponse();
    } catch (error) {
      getLogger().ai.error("Error sending text to OpenAI:", error);
    }
  }

  createResponse(): void {
    if (!this.isConnected) {
      getLogger().ai.warn("Cannot create response: not connected to OpenAI");
      return;
    }

    try {
      getLogger().ai.debug("Creating response with tools included", "AI");
      
      // If we're recovering from a goodbye interruption, add context
      let instructions = this.config.instructions;
      if (this.wasGoodbyeInterrupted) {
        instructions = "The user interrupted your goodbye. They want to continue the conversation. Listen to what they have to say and respond appropriately. " + instructions;
        this.wasGoodbyeInterrupted = false; // Reset flag
      }
      
      // Send response.create with tools included to ensure function calling works
      this.send("response.create", {
        response: {
          modalities: ["text", "audio"],
          instructions: instructions,
          tool_choice: "auto",
          tools: [
            {
              type: "function",
              name: "end_call",
              description: "End the phone call immediately when requested or when conversation is complete",
              parameters: {
                type: "object",
                properties: {
                  reason: {
                    type: "string",
                    description: "Reason for ending call",
                  },
                },
                required: [],
              },
            },
          ],
        },
      });
    } catch (error) {
      getLogger().ai.error("Error creating response:", error);
    }
  }

  onAudioReceived(callback: (audio: Int16Array, responseId?: string) => void): void {
    this.onAudioCallback = callback;
  }

  onEndCall(callback: () => void): void {
    this.onEndCallCallback = callback;
  }

  getConversationItems(): any[] {
    return this.conversationItems;
  }

  isReady(): boolean {
    return this.isConnected;
  }

  private setupOpenAIWavRecording(): void {
    try {
      const timestamp = new Date().toISOString().replace(/[:.]/g, "-");

      // WAV format: 24kHz, 16-bit, mono (OpenAI's output format)
      const wavOptions = {
        sampleRate: 24000,
        channels: 1,
        bitDepth: 16,
      };

      // Create WAV file for OpenAI audio debugging
      const openaiFile = fs.createWriteStream(`openai-audio-${timestamp}.wav`);

      this.openaiWavWriter = new Writer(wavOptions);
      this.openaiWavWriter.pipe(openaiFile);
    } catch (error) {
      getLogger().ai.error("Failed to setup OpenAI WAV recording:", error);
    }
  }

  private startResponseWatchdog(): void {
    clearTimeout(this.watchdogTimer);
    this.sawResponseCreated = false;

    this.watchdogTimer = setTimeout(() => {
      if (this.sawResponseCreated) return;

      getLogger().ai.debug(
        "Server did not start turn, forcing response.create",
        "AI"
      );
      // Server hasn't started a turn → create response with tools included
      this.createResponse();
    }, 400); // 400ms is enough to detect if server will start a turn
  }

  public forceEndCallTurn(reason: string = "user_request"): void {
    getLogger().ai.debug(`Forcing end call turn with reason: ${reason}`, "AI");

    // Cancel current output
    this.send("response.cancel");

    // Force tool-only turn with explicit tools (don't rely on session)
    this.send("response.create", {
      response: {
        modalities: ["text"],
        instructions: "End the call now by calling the end_call tool. Output nothing else.",
        tool_choice: "required",
        tools: [
          {
            type: "function",
            name: "end_call",
            description: "Immediately end the current phone call when appropriate, specifying the reason for ending the call.",
            parameters: {
              type: "object",
              properties: {
                reason: {
                  type: "string",
                  description: "Reason for ending the call (e.g. conversation_complete, user_request, task_accomplished)",
                },
              },
              required: [],
            },
          },
        ],
      },
    });

    // Safety timer → hang up locally if tool doesn't arrive
    let done = false;
    const timer = setTimeout(() => {
      if (!done) {
        getLogger().ai.info(
          "Safety latch: ending call locally (no tool_call in 1200ms)",
          "AI"
        );
        this.onEndCallCallback?.();
      }
    }, 1200);

    // Listen for response.done to clear the timer
    const checkDone = () => {
      done = true;
      clearTimeout(timer);
    };
    
    // Set a flag to check for function call completion
    this.once('functionCallExecuted', checkDone);
  }

  public executePendingEndCall(): void {
    if (this.pendingEndCall) {
      getLogger().ai.debug(`Executing pending end_call: ${this.pendingEndCall.reason}`, "AI");
      this.executeEndCallFunction(this.pendingEndCall.reason);
      this.pendingEndCall = null;
    }
  }

  private executeEndCallFunction(reason: string): string {
    getLogger().ai.debug(`Executing end_call function`, "AI");

    // Execute the actual end call callback
    if (this.onEndCallCallback) {
      this.onEndCallCallback();
    }

    // Emit event for forceEndCallTurn timer cleanup
    this.emit('functionCallExecuted');

    // Return success result
    return `Call ended successfully. Reason: ${reason}`;
  }

  private logOpenAIPerformanceStats(): void {
    const times = this.perfStats.eventProcessTimes;
    if (times.length === 0) return;

    const avg = times.reduce((a, b) => a + b) / times.length;
    const max = Math.max(...times);
    const conversationItems = this.getConversationItems().length;

    getLogger().perf.verbose(
      `OpenAI Event Stats (last ${times.length} events):`
    );
    getLogger().perf.verbose(
      `   Avg processing: ${avg.toFixed(2)}ms | Max: ${max.toFixed(2)}ms`
    );
    getLogger().perf.verbose(`   Conversation items: ${conversationItems}`);

    this.perfStats.conversationItems = conversationItems;
  }
}
