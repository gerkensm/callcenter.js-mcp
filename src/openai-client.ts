import { RealtimeClient } from "@openai/realtime-api-beta";
import { EventEmitter } from "events";
import { AIVoiceConfig } from "./types.js";
import { getLogger } from "./logger.js";
import * as fs from "fs";
import { Writer } from "wav";

export class OpenAIClient extends EventEmitter {
  private client: RealtimeClient;
  private config: AIVoiceConfig;
  private isConnected: boolean = false;
  private audioQueue: Int16Array[] = [];
  private onAudioCallback?: (audio: Int16Array) => void;
  private sendCount: number = 0;
  private deltaCount: number = 0;
  private openaiWavWriter: Writer | null = null;
  private debugAudioFile: boolean = true;
  private perfStats = {
    eventProcessTimes: [] as number[],
    lastStatsLog: 0,
    conversationItems: 0,
  };

  constructor(config: AIVoiceConfig) {
    super();
    this.config = config;
    this.client = new RealtimeClient({
      apiKey: config.openaiApiKey,
      dangerouslyAllowAPIKeyInBrowser: false,
    });

    this.setupEventHandlers();

    // Initialize WAV recording for OpenAI audio debugging
    if (this.debugAudioFile) {
      this.setupOpenAIWavRecording();
    }
  }

  private setupEventHandlers(): void {
    const logger = getLogger();

    this.client.on("conversation.updated", ({ item, delta }: any) => {
      const startTime = performance.now();
      logger.ai.debug(
        `Conversation updated: ${item.type} (role: ${item.role || "unknown"})`
      );

      // Log text content
      if (item.formatted && item.formatted.text) {
        logger.ai.debug(`Text: "${item.formatted.text}"`);
      }
      if (delta?.text) {
        logger.ai.debug(`Text delta: "${delta.text}"`);
      }

      // Handle audio content from conversation.updated
      if (delta?.audio) {
        logger.ai.debug(
          `Audio delta received in conversation.updated: ${delta.audio.length} samples`
        );

        // Record raw OpenAI audio to WAV file for debugging
        if (this.openaiWavWriter) {
          const audioBuffer = Buffer.from(
            delta.audio.buffer,
            delta.audio.byteOffset,
            delta.audio.byteLength
          );
          this.openaiWavWriter.write(audioBuffer);
        }

        if (this.onAudioCallback) {
          this.onAudioCallback(delta.audio);
        }
      }

      // Track performance with minimal overhead
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

      // Handle transcripts - avoid duplication
      // Delta updates contain cumulative text, mark them as deltas
      if (delta) {
        // Delta updates - mark as isDelta=true
        if (delta.transcript) {
          const role = item.role === "assistant" ? "assistant" : "user";
          logger.ai.debug(
            `Delta transcript - role: ${item.role} -> ${role}, text: "${delta.transcript}"`
          );
          logger.transcript(role, delta.transcript, true);
        } else if (delta.text) {
          const role = item.role === "assistant" ? "assistant" : "user";
          logger.ai.debug(
            `Delta text - role: ${item.role} -> ${role}, text: "${delta.text}"`
          );
          // logger.transcript(role, delta.text, true); // Commented out to avoid spam - we log complete text in conversation.item.completed
        }
      } else if (item.formatted) {
        // Complete utterances - mark as isDelta=false
        if (item.formatted.transcript) {
          const role = item.role === "assistant" ? "assistant" : "user";
          logger.ai.debug(
            `Formatted transcript - role: ${item.role} -> ${role}, text: "${item.formatted.transcript}"`
          );
          logger.transcript(role, item.formatted.transcript, false);
        } else if (item.formatted.text) {
          const role = item.role === "assistant" ? "assistant" : "user";
          logger.ai.debug(
            `Formatted text - role: ${item.role} -> ${role}, text: "${item.formatted.text}"`
          );
          logger.transcript(role, item.formatted.text, false);
        }
      }
    });

    this.client.on("conversation.item.completed", ({ item }: any) => {
      // Log the final text/transcript for this item
      const role = item.role === "assistant" ? "assistant" : "user";

      if (item.formatted?.transcript) {
        // Transcript is available (for audio input)
        logger.transcript(role, item.formatted.transcript, false);
      } else if (item.formatted?.text) {
        // Text is available (for text responses)
        logger.transcript(role, item.formatted.text, false);
      } else if (item.transcript) {
        // Sometimes transcript is directly on the item
        logger.transcript(role, item.transcript, false);
      } else if (item.content) {
        // Check if content array has text
        const textContent = item.content?.find(
          (c: any) => c.type === "input_text" || c.type === "text"
        );
        if (textContent?.text) {
          logger.transcript(role, textContent.text, false);
        } else if (textContent?.transcript) {
          logger.transcript(role, textContent.transcript, false);
        }
      }
    });

    this.client.on("error", (event: any) => {
      logger.ai.error("Realtime API error:", event);
    });

    this.client.on("conversation.interrupted", () => {
      logger.ai.info("Conversation interrupted - stopping audio playback");
      // Notify audio bridge to stop current playback
      this.emit("conversationInterrupted");
    });

    this.client.on("input_audio_buffer.speech_started", () => {
      logger.ai.debug("Speech started (user is talking)");
    });

    this.client.on("input_audio_buffer.speech_stopped", () => {
      logger.ai.debug("Speech stopped (user finished talking)");
    });

    // Handle user input transcription completion
    this.client.on(
      "conversation.item.input_audio_transcription.completed",
      (event: any) => {
        logger.ai.debug("Received user transcription completion event", event);
        if (event.transcript) {
          logger.transcript("user", event.transcript, false);
        }
      }
    );

    // Handle user transcription deltas (the main source of user transcripts)
    this.client.on("input_audio_buffer.transcription", (event: any) => {
      logger.ai.debug("Received transcription event", event);
      
      
      if (event.transcript) {
        // User transcripts come as deltas, so mark them as such
        logger.transcript("user", event.transcript, true);
      }
    });

    // Add more specific user audio event handlers
    this.client.on("input_audio_buffer.committed", (event: any) => {
      logger.ai.debug("User audio buffer committed", event);
    });

    this.client.on("conversation.item.created", (event: any) => {
      logger.ai.debug("Conversation item created", event);
      if (event.item && event.item.role === "user" && event.item.content) {
        const content = event.item.content;
        if (Array.isArray(content)) {
          content.forEach(c => {
            if (c.type === "input_audio" && c.transcript) {
              logger.transcript("user", c.transcript, false);
            }
          });
        } else if (content.type === "input_audio" && content.transcript) {
          logger.transcript("user", content.transcript, false);
        }
      }
    });

    // Handle audio delta events - this is the continuous audio stream from OpenAI
    this.client.on("response.audio.delta", (event: any) => {
      if (event && event.delta) {
        // Convert base64 audio to Int16Array
        const audioBuffer = Buffer.from(event.delta, "base64");
        const audioData = new Int16Array(
          audioBuffer.buffer,
          audioBuffer.byteOffset,
          audioBuffer.length / 2
        );

        // Record raw OpenAI audio to WAV file for debugging
        if (this.openaiWavWriter) {
          const audioBuffer = Buffer.from(
            audioData.buffer,
            audioData.byteOffset,
            audioData.byteLength
          );
          this.openaiWavWriter.write(audioBuffer);
        }

        if (this.onAudioCallback) {
          this.onAudioCallback(audioData);
        }
      } else {
        logger.ai.warn(
          "response.audio.delta event missing delta:",
          JSON.stringify(event)
        );
      }
    });

    // Log ALL events to debug what we're actually receiving
    this.client.on("*", (event: any) => {
      if (
        event.type &&
        !event.type.includes("conversation.updated") &&
        !event.type.includes("input_audio")
      ) {
        logger.ai.verbose(`Event: ${event.type}`);
      }
    });
  }

  async connect(): Promise<void> {
    if (this.isConnected) return;

    try {
      await this.client.connect();
      this.isConnected = true;

      this.client.updateSession({
        instructions: this.config.instructions,
        voice: (this.config.voice as any) || "verse",
        turn_detection: { type: "server_vad" },
        input_audio_transcription: { model: "whisper-1" },
        modalities: ["text", "audio"],
        input_audio_format: "pcm16",
        output_audio_format: "pcm16",
        temperature: 0.8,
      });

      getLogger().ai.info("Connected to OpenAI Realtime API");
    } catch (error) {
      getLogger().ai.error("Failed to connect to OpenAI:", error);
      throw error;
    }
  }

  async disconnect(): Promise<void> {
    if (!this.isConnected) return;

    try {
      this.client.disconnect();
      this.isConnected = false;

      // Close WAV writer for OpenAI audio
      if (this.openaiWavWriter) {
        this.openaiWavWriter.end();
        this.openaiWavWriter = null;
        getLogger().ai.debug("OpenAI audio saved to openai-audio-*.wav");
      }

      getLogger().ai.info("Disconnected from OpenAI Realtime API");
    } catch (error) {
      getLogger().ai.error("Error disconnecting from OpenAI:", error);
    }
  }

  sendAudio(audioData: Int16Array): void {
    if (!this.isConnected) {
      getLogger().ai.warn("Cannot send audio: not connected to OpenAI");
      return;
    }

    try {
      // Reduce logging - only log every 50th packet
      if (++this.sendCount % 50 === 0) {
        getLogger().ai.verbose(
          `Sent ${this.sendCount} audio packets to OpenAI`
        );
      }
      this.client.appendInputAudio(audioData);
    } catch (error) {
      getLogger().ai.error("Error sending audio to OpenAI:", error);
    }
  }

  sendText(text: string): void {
    if (!this.isConnected) {
      getLogger().ai.warn("Cannot send text: not connected to OpenAI");
      return;
    }

    try {
      getLogger().ai.debug(`Sending text to OpenAI: "${text}"`);
      this.client.sendUserMessageContent([{ type: "input_text", text }]);
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
      // Request response (modalities set in session config)
      this.client.createResponse();
    } catch (error) {
      getLogger().ai.error("Error creating response:", error);
    }
  }

  onAudioReceived(callback: (audio: Int16Array) => void): void {
    this.onAudioCallback = callback;
  }

  getConversationItems(): any[] {
    return this.client.conversation.getItems();
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
