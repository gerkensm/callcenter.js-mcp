import { EventEmitter } from "events";
import * as dgram from "dgram";
import * as fs from "fs";
import { Writer } from "wav";
import { AudioProcessor } from "./audio-processor.js";
import { getCodec, Codec } from "./codecs/index.js";
import { getLogger } from "./logger.js";

export interface AudioBridgeConfig {
  localRtpPort: number;
  localRtpHost?: string;
  remoteRtpHost?: string;
  remoteRtpPort?: number;
  sampleRate: number;
  enableCallRecording?: boolean;
  recordingFilename?: string;
}

export class AudioBridge extends EventEmitter {
  private config: AudioBridgeConfig;
  private udpSocket: dgram.Socket | null = null;
  private sendSocket: dgram.Socket | null = null;
  private isActive: boolean = false;
  private lastSequenceNumber: number = 0;
  private hasReceivedAudio: boolean = false;
  private startTime: number = 0;
  private rtpTimestamp: number = 0;
  private incomingWavWriter: Writer | null = null;
  private outgoingWavWriter: Writer | null = null;
  private stereoWavWriter: Writer | null = null;
  private currentRecordingFilename: string | null = null;
  private callRecordingEnabled: boolean = true;
  private stereoRecorder: RealTimeStereoRecorder | null = null;
  private packetCount: number = 0;
  private sendCount: number = 0;
  private rtpPacketQueue: { packet: Buffer; pcm: Int16Array }[] = [];
  private responseAudioTracking: Map<string, {
    packetsQueued: number;
    packetsSent: number;
    callback?: () => void;
    safetyTimeout?: NodeJS.Timeout;
  }> = new Map();
  private currentResponseId?: string;
  private rtpSendInterval: NodeJS.Timeout | null = null;
  private audioProcessor: AudioProcessor;
  private needsInitialBurst: boolean = true;
  private lastSendTime: number = 0;
  private sendTimeJitter: number[] = [];
  private lastAudioReceived: number = 0;
  private audioGapCount: number = 0;
  private dynamicBufferSize: number = 30; // Start with 300ms buffer
  private negotiatedCodec: Codec | null = null;
  private rtpTimeoutTimer: NodeJS.Timeout | null = null;
  private readonly RTP_TIMEOUT_MS = 2000; // 2-second timeout for RTP inactivity
  private perfStats = {
    rtpSendTimes: [] as number[],
    lastStatsLog: 0,
    processStartTime: 0,
    gcTimes: [] as number[],
    resampleTimes: [] as number[],
    encodeTimes: [] as number[],
    networkTimes: [] as number[],
  };

  constructor(config: AudioBridgeConfig) {
    super();
    this.config = config;
    this.callRecordingEnabled = config.enableCallRecording ?? true; // Default to enabled

    // Initialize RTP timestamp with random value (RFC 3550 requirement)
    // Use a smaller initial value to avoid overflow issues
    this.rtpTimestamp = Math.floor(Math.random() * 0x7fffffff);

    // Initialize audio processor with standard quality
    this.audioProcessor = new AudioProcessor({ quality: "standard" });
  }

  async start(): Promise<void> {
    if (this.isActive) return;

    try {
      // Use single socket for both send and receive to ensure symmetric RTP
      this.udpSocket = dgram.createSocket("udp4");
      this.sendSocket = this.udpSocket; // Same socket for both operations

      this.udpSocket.on("message", (msg, rinfo) => {
        // Only log first packet for debugging
        if (!this.hasReceivedAudio) {
          getLogger().rtp.debug(
            `First RTP packet: ${msg.length} bytes from ${rinfo.address}:${rinfo.port}`
          );
        }
        this.handleIncomingRtp(msg, rinfo);
      });

      this.udpSocket.on("error", (err) => {
        getLogger().rtp.error("UDP socket error:", err);
        this.emit("error", err);
      });

      await new Promise<void>((resolve, reject) => {
        // Bind to specific IP if provided, otherwise use 0.0.0.0
        const bindHost = this.config.localRtpHost || "0.0.0.0";

        this.udpSocket!.bind(0, bindHost, () => {
          const address = this.udpSocket!.address() as any;
          this.config.localRtpPort = address.port;
          getLogger().audio.debug(
            `Audio bridge listening on ${address.address}:${this.config.localRtpPort}`
          );
          getLogger().audio.debug(
            `Single socket for symmetric RTP - Fritz Box will see packets from advertised port`
          );

          this.isActive = true;
          this.startTime = Date.now();

          // Initialize stereo WAV call recording
          if (this.callRecordingEnabled) {
            this.setupStereoCallRecording();
          }

          resolve();
        });

        this.udpSocket!.on("error", (err: any) => {
          reject(err);
        });
      });
    } catch (error) {
      getLogger().audio.error("Failed to start audio bridge:", error);
      throw error;
    }
  }

  stop(): void {
    if (!this.isActive) return;

    if (this.rtpTimeoutTimer) {
      clearTimeout(this.rtpTimeoutTimer);
      this.rtpTimeoutTimer = null;
    }

    if (this.udpSocket) {
      this.udpSocket.close();
      this.udpSocket = null;
    }
    // sendSocket is same as udpSocket now, so don't close it twice
    this.sendSocket = null;

    // Stop RTP sender
    this.stopRtpSender();

    // Close WAV writers
    if (this.incomingWavWriter) {
      this.incomingWavWriter.end();
      this.incomingWavWriter = null;
      getLogger().audio.debug("Incoming audio saved to incoming-audio-*.wav");
    }
    if (this.outgoingWavWriter) {
      this.outgoingWavWriter.end();
      this.outgoingWavWriter = null;
      getLogger().audio.debug("Outgoing audio saved to outgoing-audio-*.wav");
    }
    if (this.stereoRecorder) {
      try {
        this.stereoRecorder.stop();
      } catch (e) {
        getLogger().audio.warn(`Error while stopping stereo recorder: ${e instanceof Error ? e.message : String(e)}`);
      }
      this.stereoRecorder = null;
    }
    if (this.stereoWavWriter) {
      this.stereoWavWriter.end();
      this.stereoWavWriter = null;
      getLogger().audio.info(
        `Stereo call recording saved to ${this.currentRecordingFilename}`
      );
      this.currentRecordingFilename = null;
    }

    this.isActive = false;
    getLogger().audio.info("Audio bridge stopped");
  }

  public startRtpDetection(): void {
    getLogger().rtp.debug(
      `Starting RTP inactivity detection with a ${this.RTP_TIMEOUT_MS}ms timeout.`
    );
    this.resetRtpTimeout();
  }

  private resetRtpTimeout(): void {
    if (this.rtpTimeoutTimer) {
      clearTimeout(this.rtpTimeoutTimer);
    }
    this.rtpTimeoutTimer = setTimeout(() => {
      if (this.hasReceivedAudio && this.isActive) {
        getLogger().rtp.debug(
          `No RTP packets received for ${this.RTP_TIMEOUT_MS}ms. Emitting timeout.`
        );
        this.emit("rtpTimeout");
      }
    }, this.RTP_TIMEOUT_MS);
  }

  private handleIncomingRtp(data: Buffer, rinfo: dgram.RemoteInfo): void {
    this.resetRtpTimeout();

    if (!this.negotiatedCodec) {
      getLogger().rtp.debug(
        "Received RTP packet before codec negotiation. Ignoring."
      );
      return;
    }

    try {
      const rtpHeader = this.parseRtpHeader(data);

      if (!rtpHeader) {
        getLogger().rtp.warn(`Invalid RTP packet received`);
        return;
      }

      if (rtpHeader.payloadType !== this.negotiatedCodec.payloadType) {
        getLogger().rtp.warn(
          `Received RTP with unexpected payload type ${rtpHeader.payloadType}, expected ${this.negotiatedCodec.payloadType}. Ignoring.`
        );
        return;
      }

      const audioPayload = data.slice(12);
      const pcm16Audio = this.negotiatedCodec.decode(audioPayload);

      if (pcm16Audio) {
        if (!this.hasReceivedAudio) {
          this.hasReceivedAudio = true;
          getLogger().rtp.info(
            `RTP established! First audio received from ${rinfo.address}:${rinfo.port}`
          );
          getLogger().rtp.info(
            `Bidirectional RTP flow now active - ready to send audio back`
          );
        }
        if (++this.packetCount % 100 === 0) {
          getLogger().rtp.verbose(`RTP: ${this.packetCount} packets received`);
        }

        // Record caller audio to stereo left channel at EXACT negotiated sample rate
        if (this.stereoRecorder && this.callRecordingEnabled) {
          this.stereoRecorder.addCallerAudio(pcm16Audio, this.negotiatedCodec.sampleRate);
        }

        // Upsample to 24kHz for OpenAI (depends on codec sample rate)
        let upsampledAudio: Int16Array;
        if (this.negotiatedCodec.sampleRate === 16000) {
          upsampledAudio = this.audioProcessor.resample16kTo24k(pcm16Audio);
        } else {
          upsampledAudio = this.audioProcessor.resample8kTo24k(pcm16Audio);
        }
        this.emit("audioReceived", upsampledAudio);
      }
    } catch (error) {
      getLogger().rtp.error("Error processing RTP packet:", error);
    }
  }

  private parseRtpHeader(data: Buffer): any | null {
    if (data.length < 12) return null;

    const version = (data[0] >> 6) & 0x03;
    const padding = (data[0] >> 5) & 0x01;
    const extension = (data[0] >> 4) & 0x01;
    const csrcCount = data[0] & 0x0f;
    const marker = (data[1] >> 7) & 0x01;
    const payloadType = data[1] & 0x7f;
    const sequenceNumber = data.readUInt16BE(2);
    const timestamp = data.readUInt32BE(4);
    const ssrc = data.readUInt32BE(8);

    if (version !== 2) return null;

    return {
      version,
      padding,
      extension,
      csrcCount,
      marker,
      payloadType,
      sequenceNumber,
      timestamp,
      ssrc,
    };
  }

  sendAudio(audioData: Int16Array, responseId?: string): void {
    if (
      !this.isActive ||
      !this.udpSocket ||
      !this.config.remoteRtpHost ||
      !this.config.remoteRtpPort ||
      !this.negotiatedCodec
    ) {
      getLogger().audio.warn(
        "Cannot send audio: bridge not ready or configured."
      );
      return;
    }

    // Track which response this audio belongs to
    if (responseId && responseId !== this.currentResponseId) {
      getLogger().audio.debug(`New response audio starting: ${responseId}`);
      this.currentResponseId = responseId;
      if (!this.responseAudioTracking.has(responseId)) {
        this.responseAudioTracking.set(responseId, {
          packetsQueued: 0,
          packetsSent: 0,
        });
      }
    }

    try {
      // Track when we receive audio from OpenAI for gap detection
      const now = Date.now();
      if (this.lastAudioReceived > 0) {
        const gapDuration = now - this.lastAudioReceived;
        if (gapDuration > 500) {
          // 500ms gap is significant
          this.audioGapCount++;
          getLogger().audio.debug(
            `Audio gap detected: ${gapDuration}ms (total gaps: ${this.audioGapCount})`
          );

          // Increase buffer size if we're having frequent gaps
          if (this.audioGapCount % 3 === 0 && this.dynamicBufferSize < 50) {
            this.dynamicBufferSize += 5;
            getLogger().audio.debug(
              `Increasing buffer size to ${this.dynamicBufferSize} packets (${
                this.dynamicBufferSize * 10
              }ms)`
            );
          }
        }
      }
      this.lastAudioReceived = now;

      // OpenAI sends 24kHz audio, downsample based on negotiated codec
      const resampleStart = performance.now();
      let resampledAudio: Int16Array;
      if (this.negotiatedCodec.sampleRate === 16000) {
        resampledAudio = this.audioProcessor.resample24kTo16k(audioData);
      } else {
        resampledAudio = this.audioProcessor.resample24kTo8k(audioData);
      }
      const resampleTime = performance.now() - resampleStart;
      this.perfStats.resampleTimes.push(resampleTime);
      if (this.perfStats.resampleTimes.length > 50) {
        this.perfStats.resampleTimes.shift();
      }


      // Minimal logging to avoid event loop blocking
      if (++this.sendCount % 100 === 0) {
        getLogger().audio.verbose(
          `Streaming to ${this.negotiatedCodec.name}: ${
            audioData.length
          } (24kHz) → ${resampledAudio.length} (${
            this.negotiatedCodec.sampleRate / 1000
          }kHz)`
        );
      }

      this.sendAudioDirectly(resampledAudio);
    } catch (error) {
      getLogger().audio.error("Error processing audio for streaming:", error);
    }
  }

  private sendAudioDirectly(audioData: Int16Array): void {
    if (!this.negotiatedCodec) return;

    // Calculate samples per packet based on codec sample rate (10ms packets)
    const samplesPerPacket = this.negotiatedCodec.sampleRate / 100;
    const packetsToSend: { packet: Buffer; pcm: Int16Array }[] = [];

    for (let i = 0; i < audioData.length; i += samplesPerPacket) {
      const chunk = audioData.slice(i, i + samplesPerPacket);

      const encodeStart = performance.now();
      const encodedChunk = this.negotiatedCodec.encode(chunk);
      const encodeTime = performance.now() - encodeStart;
      this.perfStats.encodeTimes.push(encodeTime);
      if (this.perfStats.encodeTimes.length > 100) {
        this.perfStats.encodeTimes.shift();
      }

      const isFirstPacket = i === 0 && this.needsInitialBurst;
      const rtpPacket = this.createRtpPacketWithTimestamp(
        encodedChunk,
        this.rtpTimestamp,
        this.negotiatedCodec.payloadType,
        isFirstPacket
      );

      // Queue the RTP packet together with its PCM (what we'll record when we actually send)
      packetsToSend.push({ packet: rtpPacket, pcm: chunk });

      // Update timestamp for next packet using codec clock rate
      const timestampIncrement = Math.round(
        chunk.length *
          (this.negotiatedCodec.clockRate / this.negotiatedCodec.sampleRate)
      );
      this.rtpTimestamp = (this.rtpTimestamp + timestampIncrement) >>> 0;
    }

    if (this.needsInitialBurst) {
      const burstSize = Math.min(5, packetsToSend.length);
      getLogger().rtp.debug(
        `Initial burst: sending ${burstSize} packets for jitter buffer`
      );
      for (let i = 0; i < burstSize; i++) {
        const entry = packetsToSend.shift()!;
        this.sendQueuedEntryImmediately(entry);
      }
      this.needsInitialBurst = false;
    }

    this.rtpPacketQueue.push(...packetsToSend);
    
    // Track how many packets we've queued for the current response
    if (this.currentResponseId) {
      const tracking = this.responseAudioTracking.get(this.currentResponseId);
      if (tracking) {
        tracking.packetsQueued += packetsToSend.length;
      }
    }

    if (!this.rtpSendInterval) {
      this.startRtpSender();
    }
  }

  private startRtpSender(): void {
    // Wait until we have a dynamic buffer size to handle OpenAI audio bursts
    const waitForBuffer = () => {
      if (this.rtpPacketQueue.length >= this.dynamicBufferSize) {
        getLogger().rtp.debug(
          `Buffer ready: ${this.rtpPacketQueue.length} packets queued, starting RTP sender (buffer size: ${this.dynamicBufferSize})`
        );
        this.startActualRtpSender();
      } else {
        getLogger().rtp.verbose(
          `Waiting for buffer: ${this.rtpPacketQueue.length}/${this.dynamicBufferSize} packets queued`
        );
        setTimeout(waitForBuffer, 5); // Check every 5ms
      }
    };

    if (this.rtpSendInterval) {
      // Already running
      return;
    }

    waitForBuffer();
  }

  private startActualRtpSender(): void {
    if (this.rtpSendInterval) {
      return; // Already started
    }

    // Use a high-resolution timer with adaptive timing correction
    let expectedNextTime = performance.now();
    const interval = 10; // 10ms interval for 160 samples at 16kHz

    const sendPacket = () => {
      if (!this.isActive || !this.sendSocket) {
        this.stopRtpSender();
        return;
      }

      const currentTime = performance.now();

      // --- Performance Monitoring ---
      this.perfStats.processStartTime = currentTime;
      if (this.lastSendTime > 0) {
        const actualInterval = currentTime - this.lastSendTime;
        this.perfStats.rtpSendTimes.push(actualInterval);
        if (this.perfStats.rtpSendTimes.length > 100) {
          this.perfStats.rtpSendTimes.shift();
        }
      }
      this.lastSendTime = currentTime;
      // --- End Performance Monitoring ---

      if (this.rtpPacketQueue.length > 0) {
        const entry = this.rtpPacketQueue.shift()!;
        // Record exactly what we're actually sending (PCM at negotiated sample rate)
        if (this.stereoRecorder && this.callRecordingEnabled && this.negotiatedCodec) {
          this.stereoRecorder.addAIAudio(entry.pcm, this.negotiatedCodec.sampleRate);
        }
        this.trackPacketSent();
        this.sendSocket!.send(entry.packet, this.config.remoteRtpPort, this.config.remoteRtpHost, (err) => {
          if (err) {
            getLogger().rtp.error("Error sending RTP packet:", err);
          }
        });

        // Warn if the buffer is getting low
        // if (this.rtpPacketQueue.length < 10) {
        //   // < 100ms buffer
        //   getLogger().rtp.warn(
        //     `Low buffer: ${this.rtpPacketQueue.length} packets remaining`
        //   );
        // }
      } else if (this.negotiatedCodec) {
        // Queue is empty (underrun). Inject silence to maintain a smooth RTP stream.
        const samplesPerPacket = this.negotiatedCodec.sampleRate / 100;
        const silenceData = new Int16Array(samplesPerPacket).fill(0);
        const encodedSilence = this.negotiatedCodec.encode(silenceData);
        const silencePacket = this.createRtpPacketWithTimestamp(
          encodedSilence,
          this.rtpTimestamp,
          this.negotiatedCodec.payloadType
        );
        // Also record the silence we send, to keep the timeline exact
        if (this.stereoRecorder && this.callRecordingEnabled) {
          this.stereoRecorder.addAIAudio(silenceData, this.negotiatedCodec.sampleRate);
        }
        this.sendSocket!.send(
          silencePacket,
          this.config.remoteRtpPort,
          this.config.remoteRtpHost,
          (err) => {
            if (err)
              getLogger().rtp.error("Error sending silence packet:", err);
          }
        );
      }

      // Increment timestamp for the next packet using codec clock rate
      if (this.negotiatedCodec) {
        const samplesPerPacket = this.negotiatedCodec.sampleRate / 100;
        const timestampIncrement = Math.round(
          samplesPerPacket *
            (this.negotiatedCodec.clockRate / this.negotiatedCodec.sampleRate)
        );
        this.rtpTimestamp = (this.rtpTimestamp + timestampIncrement) >>> 0;
      }

      // --- Self-Correcting Timer Logic ---
      expectedNextTime += interval;
      const drift = currentTime - expectedNextTime;
      // Calculate the next timeout, correcting for any drift from processing time or event loop lag.
      // Ensure the timeout is at least 0 to prevent negative values.
      const nextTimeout = Math.max(0, interval - drift);

      this.rtpSendInterval = setTimeout(sendPacket, nextTimeout);

      // Log performance stats periodically
      if (currentTime - this.perfStats.lastStatsLog > 30000) {
        const processingTime =
          performance.now() - this.perfStats.processStartTime;
        this.logPerformanceStats(processingTime);
        this.perfStats.lastStatsLog = currentTime;
      }
    };

    // Start the sender loop
    this.rtpSendInterval = setTimeout(sendPacket, 0);
  }

  private trackPacketSent(): void {
    // Go through all tracked responses and increment sent count
    for (const [responseId, tracking] of this.responseAudioTracking) {
      if (tracking.packetsSent < tracking.packetsQueued) {
        tracking.packetsSent++;
        
        // Check if this response is complete
        if (tracking.packetsSent === tracking.packetsQueued && tracking.callback) {
          getLogger().audio.debug(`Response audio playback complete for ${responseId}`, "AUDIO");
          
          // Execute callback after a small delay to ensure audio has been heard
          setTimeout(() => {
            const finalCallback = tracking.callback!;
            // Clear safety timeout if it exists
            if (tracking.safetyTimeout) {
              clearTimeout(tracking.safetyTimeout);
            }
            // Clean up tracking for completed responses
            this.responseAudioTracking.delete(responseId);
            finalCallback(); // This will clear the safety timeout through wrappedCallback (backup)
          }, 100); // 100ms safety margin for network/playback latency
          
          break; // Only one response can own this packet
        }
      }
    }
  }

  public cancelPendingCallbacks(): void {
    getLogger().audio.debug("Canceling all pending response callbacks", "AUDIO");
    // Clear all callbacks and safety timeouts without executing them
    for (const [responseId, tracking] of this.responseAudioTracking) {
      if (tracking.callback) {
        getLogger().audio.debug(`Canceled callback for response ${responseId}`, "AUDIO");
        tracking.callback = undefined;
      }
      if (tracking.safetyTimeout) {
        getLogger().audio.debug(`Cleared safety timeout for response ${responseId}`, "AUDIO");
        clearTimeout(tracking.safetyTimeout);
        tracking.safetyTimeout = undefined;
      }
    }
  }
  
  /**
   * Get the response ID that is currently playing (has packets queued but not all sent).
   * @returns The response ID of the currently playing response, or null if none
   */
  public getCurrentlyPlayingResponseId(): string | null {
    // Find the first response in insertion order that has unsent packets
    for (const [responseId, tracking] of this.responseAudioTracking) {
      if (tracking.packetsSent < tracking.packetsQueued) {
        return responseId;
      }
    }
    return null;
  }

  /**
   * Get the current playback position of the currently playing response.
   * @returns The playback position in milliseconds, or 0 if no response is playing
   */
  public getCurrentPlaybackPosition(): number {
    const playingId = this.getCurrentlyPlayingResponseId();
    return playingId ? this.getResponsePlaybackPosition(playingId) : 0;
  }

  /**
   * Get the current playback position for a response in milliseconds.
   * Returns the estimated time of audio that has been sent to the SIP endpoint.
   * 
   * @param responseId - The response ID to check, or undefined for the currently playing response
   * @returns The playback position in milliseconds, or 0 if response not found
   */
  public getResponsePlaybackPosition(responseId?: string): number {
    // If no responseId provided, use the currently playing response
    const targetId = responseId || this.getCurrentlyPlayingResponseId();
    
    if (!targetId) {
      return 0;
    }
    
    const tracking = this.responseAudioTracking.get(targetId);
    if (!tracking) {
      return 0;
    }
    
    // Each packet represents 10ms of audio (samplesPerPacket = sampleRate / 100)
    // So packetsSent * 10 = milliseconds of audio played
    const playbackMs = tracking.packetsSent * 10;
    
    getLogger().audio.debug(
      `Response ${targetId} playback position: ${playbackMs}ms (${tracking.packetsSent}/${tracking.packetsQueued} packets sent)`,
      "AUDIO"
    );
    
    return playbackMs;
  }

  public notifyWhenResponseComplete(responseId: string, callback: () => void): void {
    getLogger().audio.debug(`Setting up completion callback for response ${responseId}`, "AUDIO");
    const tracking = this.responseAudioTracking.get(responseId);
    
    // Set up a safety timeout to prevent hanging calls
    const timeoutMs = 10000; // 10 second timeout
    const safetyTimeout = setTimeout(() => {
      getLogger().audio.warn(`Safety timeout triggered for response ${responseId} - executing callback anyway`, "AUDIO");
      this.responseAudioTracking.delete(responseId);
      callback();
    }, timeoutMs);
    
    // Wrap the callback to clear the timeout
    const wrappedCallback = () => {
      clearTimeout(safetyTimeout);
      callback();
    };
    
    if (tracking) {
      // Clear any existing timeout
      if (tracking.safetyTimeout) {
        clearTimeout(tracking.safetyTimeout);
      }
      tracking.callback = wrappedCallback;
      tracking.safetyTimeout = safetyTimeout;
      getLogger().audio.debug(`Response tracking: ${tracking.packetsSent}/${tracking.packetsQueued} packets sent`, "AUDIO");
      
      // Check if already complete
      if (tracking.packetsSent === tracking.packetsQueued && tracking.packetsQueued > 0) {
        getLogger().audio.debug(`Response already complete, executing callback`, "AUDIO");
        clearTimeout(safetyTimeout);
        setTimeout(callback, 100);
        this.responseAudioTracking.delete(responseId);
      } else if (tracking.packetsQueued === 0) {
        // Special case: if no packets are queued after a short delay, assume no audio and execute callback
        setTimeout(() => {
          const updatedTracking = this.responseAudioTracking.get(responseId);
          if (updatedTracking && updatedTracking.packetsQueued === 0) {
            getLogger().audio.debug(`No audio packets for response ${responseId}, executing callback`, "AUDIO");
            clearTimeout(safetyTimeout);
            this.responseAudioTracking.delete(responseId);
            callback();
          }
        }, 500); // Wait 500ms for audio to arrive
      }
    } else {
      // Create tracking entry if it doesn't exist yet
      getLogger().audio.debug(`Response not yet tracked, creating entry with callback`, "AUDIO");
      this.responseAudioTracking.set(responseId, {
        packetsQueued: 0,
        packetsSent: 0,
        callback: wrappedCallback,
        safetyTimeout: safetyTimeout,
      });
      
      // Special case: if no packets arrive within a short time, execute callback anyway
      setTimeout(() => {
        const updatedTracking = this.responseAudioTracking.get(responseId);
        if (updatedTracking && updatedTracking.packetsQueued === 0 && updatedTracking.callback) {
          getLogger().audio.debug(`No audio packets received for response ${responseId}, executing callback`, "AUDIO");
          clearTimeout(safetyTimeout);
          this.responseAudioTracking.delete(responseId);
          callback();
        }
      }, 500); // Wait 500ms for audio to arrive
    }
  }

  private sendQueuedEntryImmediately(entry: { packet: Buffer; pcm: Int16Array }): void {
    if (!this.sendSocket) return;
    
    // Track packet sending for immediate sends too
    this.trackPacketSent();

    // Record exactly what we're sending right now
    if (this.stereoRecorder && this.callRecordingEnabled && this.negotiatedCodec) {
      this.stereoRecorder.addAIAudio(entry.pcm, this.negotiatedCodec.sampleRate);
    }

    this.sendSocket.send(
      entry.packet,
      this.config.remoteRtpPort,
      this.config.remoteRtpHost,
      (err) => {
        if (err) {
          getLogger().rtp.error("Error sending burst packet:", err);
        }
      }
    );
  }

  private stopRtpSender(): void {
    if (this.rtpSendInterval) {
      clearTimeout(this.rtpSendInterval);
      this.rtpSendInterval = null;
    }
    this.rtpPacketQueue = [];
  }

  private createRtpPacketWithTimestamp(
    audioData: Buffer,
    timestamp: number,
    payloadType: number = 0,
    markerBit: boolean = false
  ): Buffer {
    const rtpHeaderSize = 12;
    const rtpPacket = Buffer.alloc(rtpHeaderSize + audioData.length);

    rtpPacket[0] = 0x80; // Version=2, P=0, X=0, CC=0
    rtpPacket[1] = (markerBit ? 0x80 : 0x00) | payloadType; // M=markerBit, PT=payloadType
    rtpPacket.writeUInt16BE(++this.lastSequenceNumber, 2);
    rtpPacket.writeUInt32BE(timestamp, 4);
    rtpPacket.writeUInt32BE(0x12345678, 8); // SSRC

    audioData.copy(rtpPacket, rtpHeaderSize);

    return rtpPacket;
  }

  setNegotiatedCodec(payloadType: number): void {
    this.negotiatedCodec = getCodec(payloadType) || null;
    if (this.negotiatedCodec) {
      getLogger().codec.debug(
        `Audio codec set to: ${this.negotiatedCodec.name} (PT=${payloadType}, SampleRate=${this.negotiatedCodec.sampleRate}Hz)`
      );
    } else {
      getLogger().codec.error(
        `Unsupported codec with payload type: ${payloadType}`
      );
    }
  }

  setRemoteEndpoint(host: string, port: number): void {
    this.config.remoteRtpHost = host;
    this.config.remoteRtpPort = port;
    getLogger().rtp.debug(`Remote RTP endpoint set to ${host}:${port}`);

    // Don't connect the UDP socket - keep it unconnected for bidirectional RTP
    // Connected sockets can interfere with receiving RTP from Fritz Box
    getLogger().rtp.debug(
      `UDP socket ready for bidirectional RTP with ${host}:${port}`
    );

    // Send a few empty/silence RTP packets to "open" the NAT path
    // This is a common SIP technique for NAT traversal
    this.sendNATKeepAlivePackets();
  }

  private sendNATKeepAlivePackets(): void {
    if (
      !this.isActive ||
      !this.udpSocket ||
      !this.config.remoteRtpHost ||
      !this.config.remoteRtpPort
    ) {
      return;
    }

    getLogger().rtp.debug(
      `Fritz Box RTP setup: Establishing listening path for incoming RTP...`
    );

    // For Fritz Box: Instead of sending packets immediately, we prepare to RECEIVE
    // Fritz Box will initiate the RTP flow when it's ready
    // Send minimal keep-alive to ensure our NAT/firewall is open
    setTimeout(() => {
      if (this.udpSocket && this.isActive && !this.hasReceivedAudio) {
        getLogger().rtp.debug(
          `Fritz Box RTP: Sending minimal RTP probe to open NAT path...`
        );

        // Send ONE small probe packet only
        const silenceBuffer = Buffer.alloc(10);
        const rtpPacket = this.createRtpPacketWithTimestamp(
          silenceBuffer,
          this.rtpTimestamp,
          this.negotiatedCodec?.payloadType ?? 0
        );

        try {
          getLogger().rtp.debug(
            `Socket state check: active=${this.isActive}, socket=${!!this
              .udpSocket}`
          );
          if (this.udpSocket) {
            try {
              const addr = this.udpSocket.address();
              getLogger().rtp.debug(
                `Local socket bound to: ${JSON.stringify(addr)}`
              );
            } catch (e) {
              getLogger().rtp.debug(`Socket not bound or invalid: ${e}`);
            }
          }

          // CRITICAL FIX: Use the SAME socket for sending to establish symmetric RTP
          // Fritz Box will send RTP back to the source IP:port of our first packet
          getLogger().rtp.debug(
            `Using same listening socket for RTP probe to establish symmetric RTP`
          );

          this.sendSocket!.send(
            rtpPacket,
            this.config.remoteRtpPort,
            this.config.remoteRtpHost,
            (err) => {
              if (err) {
                getLogger().rtp.warn(
                  `Fritz Box RTP probe error: ${(err as any).code} - ${
                    err.message
                  }`
                );
              } else {
                getLogger().rtp.debug(
                  `Fritz Box RTP probe sent from listening socket ${this.config.localRtpHost}:${this.config.localRtpPort}`
                );
                getLogger().rtp.debug(
                  `Fritz Box should now send RTP back to this exact socket for symmetric RTP`
                );
              }
            }
          );
        } catch (err: any) {
          getLogger().rtp.warn(
            `Fritz Box RTP probe exception: ${err.code} - ${err.message}`
          );
        }
      }
    }, 1000); // Wait 1 second before sending probe

    // Schedule periodic status updates while waiting for Fritz Box
    this.scheduleFritzBoxStatusUpdates();
  }

  private scheduleFritzBoxStatusUpdates(): void {
    const statusInterval = setInterval(() => {
      if (!this.isActive) {
        clearInterval(statusInterval);
        return;
      }

      if (!this.hasReceivedAudio) {
        const timeSinceStart = Date.now() - this.startTime;
        if (timeSinceStart > 30000) {
          // 30 seconds
          getLogger().rtp.warn(
            `Fritz Box RTP: Still waiting after ${Math.floor(
              timeSinceStart / 1000
            )}s - check Fritz Box telephony configuration`
          );
          clearInterval(statusInterval);
        } else {
          getLogger().rtp.debug(
            `Fritz Box RTP: Listening for incoming packets (${Math.floor(
              timeSinceStart / 1000
            )}s elapsed)...`
          );
        }
      } else {
        getLogger().rtp.debug(
          `Fritz Box RTP: Successfully receiving audio, bidirectional flow established!`
        );
        clearInterval(statusInterval);
      }
    }, 5000); // Update every 5 seconds
  }

  clearAudioBuffer(): void {
    // Clear RTP packet queue on interruption
    const clearedPackets = this.rtpPacketQueue.length;
    this.rtpPacketQueue = [];
    // Reset burst flag so next audio gets initial burst again
    this.needsInitialBurst = true;

    // Reset audio gap tracking for new conversation
    this.lastAudioReceived = 0;
    this.audioGapCount = 0;

    // Reset buffer size to reasonable default for new conversation
    this.dynamicBufferSize = Math.max(30, this.dynamicBufferSize - 10);

    // IMPORTANT: Do NOT clear stereo recorder buffers here.
    // We want WAV to reflect the real call timeline including interruptions.
    // Previously this would cut planned but unplayed audio; now we only record
    // what we actually sent (post-resampling) and what we actually received.

    getLogger().audio.debug(
      `Audio interruption: cleared ${clearedPackets} RTP packets from queue, reset burst flag, buffer size: ${this.dynamicBufferSize}`
    );

    // Reset perf stats on interruption
    this.perfStats.rtpSendTimes = [];
  }

  getLocalPort(): number {
    return this.config.localRtpPort;
  }

  isRunning(): boolean {
    return this.isActive;
  }

  setCallRecordingEnabled(enabled: boolean): void {
    this.callRecordingEnabled = enabled;
    getLogger().audio.info(
      `Call recording ${enabled ? "enabled" : "disabled"}`
    );
  }

  isCallRecordingEnabled(): boolean {
    return this.callRecordingEnabled;
  }

  private setupWavRecording(timestamp: string): void {
    try {
      // WAV format: 16kHz, 16-bit, mono for G.711 HD quality
      const wavOptions = {
        sampleRate: 16000,
        channels: 1,
        bitDepth: 16,
      };

      // Create WAV files for debugging
      const incomingFile = fs.createWriteStream(
        `incoming-audio-${timestamp}.wav`
      );
      const outgoingFile = fs.createWriteStream(
        `outgoing-audio-${timestamp}.wav`
      );

      this.incomingWavWriter = new Writer(wavOptions);
      this.outgoingWavWriter = new Writer(wavOptions);

      this.incomingWavWriter.pipe(incomingFile);
      this.outgoingWavWriter.pipe(outgoingFile);

      getLogger().audio.debug(
        `Audio recording started: incoming-audio-${timestamp}.wav, outgoing-audio-${timestamp}.wav`
      );
    } catch (error) {
      getLogger().audio.error("Failed to setup WAV recording:", error);
    }
  }

  private setupStereoCallRecording(): void {
    try {
      // Stereo WAV format: 24kHz (to match OpenAI), 16-bit, 2 channels
      // Left channel: caller audio, Right channel: OpenAI response
      const stereoWavOptions = {
        sampleRate: 24000,
        channels: 2,
        bitDepth: 16,
      };

      // Use custom filename or default with timestamp
      let filename: string;
      if (this.config.recordingFilename) {
        filename = this.config.recordingFilename.endsWith(".wav")
          ? this.config.recordingFilename
          : `${this.config.recordingFilename}.wav`;
      } else {
        const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
        filename = `call-recording-${timestamp}.wav`;
      }

      const callRecordingFile = fs.createWriteStream(filename);
      this.stereoWavWriter = new Writer(stereoWavOptions);
      this.stereoWavWriter.pipe(callRecordingFile);
      this.currentRecordingFilename = filename;

      // Initialize real-time stereo recorder with a true timeline
      this.stereoRecorder = new RealTimeStereoRecorder(this.stereoWavWriter, this.audioProcessor);

      getLogger().audio.info(
        `Stereo call recording started: ${filename} (Left: caller, Right: AI) - real-time timeline`
      );
    } catch (error) {
      getLogger().audio.error("Failed to setup stereo call recording:", error);
      this.callRecordingEnabled = false;
    }
  }

  private logPerformanceStats(currentProcessingTime: number): void {
    const times = this.perfStats.rtpSendTimes;
    if (times.length === 0) return;

    const avg = times.reduce((a, b) => a + b) / times.length;
    const max = Math.max(...times);
    const min = Math.min(...times);
    const over15ms = times.filter((t) => t > 15).length;

    // Calculate component averages
    const resampleAvg =
      this.perfStats.resampleTimes.length > 0
        ? this.perfStats.resampleTimes.reduce((a, b) => a + b) /
          this.perfStats.resampleTimes.length
        : 0;
    const encodeAvg =
      this.perfStats.encodeTimes.length > 0
        ? this.perfStats.encodeTimes.reduce((a, b) => a + b) /
          this.perfStats.encodeTimes.length
        : 0;
    const networkAvg =
      this.perfStats.networkTimes.length > 0
        ? this.perfStats.networkTimes.reduce((a, b) => a + b) /
          this.perfStats.networkTimes.length
        : 0;

    getLogger().perf.verbose(
      `RTP Timing Stats (last ${times.length} packets):`
    );
    getLogger().perf.verbose(
      `   Avg: ${avg.toFixed(2)}ms | Max: ${max.toFixed(
        2
      )}ms | Min: ${min.toFixed(2)}ms`
    );
    getLogger().perf.verbose(
      `   Over 15ms: ${over15ms}/${times.length} (${(
        (over15ms / times.length) *
        100
      ).toFixed(1)}%)`
    );
    getLogger().perf.verbose(
      `   Current processing: ${currentProcessingTime.toFixed(2)}ms`
    );
    getLogger().perf.verbose(
      `   Components - Resample: ${resampleAvg.toFixed(
        3
      )}ms | Encode: ${encodeAvg.toFixed(3)}ms | Network: ${networkAvg.toFixed(
        3
      )}ms`
    );
    getLogger().perf.verbose(
      `   Memory: ${Math.round(process.memoryUsage().heapUsed / 1024 / 1024)}MB`
    );

    // Clear component stats after logging
    this.perfStats.resampleTimes = [];
    this.perfStats.encodeTimes = [];
    this.perfStats.networkTimes = [];
  }
}

/**
 * Real-time stereo recorder that writes a continuous timeline at 24 kHz.
 * - Left channel: remote/caller audio (what we received), resampled to 24k
 * - Right channel: AI audio actually sent to the callee (post-resampling), resampled to 24k
 * - Pads silence on either side to preserve realistic timing and interruptions.
 */
class RealTimeStereoRecorder {
  private wavWriter: Writer;
  private audioProcessor: AudioProcessor;
  private readonly SAMPLE_RATE = 24000;
  private readonly FRAME_MS = 20;
  private readonly FRAME_SAMPLES = (this.SAMPLE_RATE / 1000) * this.FRAME_MS; // 480
  private timer: NodeJS.Timeout | null = null;
  private pausedForBackpressure = false;

  // Per-channel queues of Int16Array chunks
  private callerQueue: ChunkQueue = new ChunkQueue();
  private aiQueue: ChunkQueue = new ChunkQueue();

  constructor(wavWriter: Writer, audioProcessor: AudioProcessor) {
    this.wavWriter = wavWriter;
    this.audioProcessor = audioProcessor;
    this.startTimer();
  }

  addCallerAudio(audio: Int16Array, srcSampleRate: number): void {
    // Normalize to 24kHz for the timeline
    const resampled = this.resampleTo24k(audio, srcSampleRate);
    this.callerQueue.enqueue(resampled);
  }

  addAIAudio(audio: Int16Array, srcSampleRate: number): void {
    // Normalize to 24kHz for the timeline
    const resampled = this.resampleTo24k(audio, srcSampleRate);
    this.aiQueue.enqueue(resampled);
  }

  stop(): void {
    // Drain any remaining frames until both buffers are empty
    while (!this.callerQueue.isEmpty() || !this.aiQueue.isEmpty()) {
      if (!this.writeNextFrame()) {
        // If backpressure, wait for drain synchronously (rare with small frames)
        break;
      }
    }
    this.stopTimer();
  }

  private startTimer(): void {
    if (this.timer) return;
    const tick = () => {
      if (this.pausedForBackpressure) return;
      const ok = this.writeNextFrame();
      if (!ok) {
        // Pause on backpressure until 'drain'
        this.pausedForBackpressure = true;
        this.wavWriter.once('drain', () => {
          this.pausedForBackpressure = false;
          // Immediately write next frame after drain to catch up
          setImmediate(tick);
        });
        return;
      }
      this.timer = setTimeout(tick, this.FRAME_MS);
    };
    this.timer = setTimeout(tick, this.FRAME_MS);
  }

  private stopTimer(): void {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
  }

  private resampleTo24k(audio: Int16Array, srcRate: number): Int16Array {
    if (srcRate === 24000) return audio;
    if (srcRate === 16000) return this.audioProcessor.resample16kTo24k(audio);
    if (srcRate === 8000) return this.audioProcessor.resample8kTo24k(audio);
    // Fallback: no resample if unknown (shouldn't happen)
    return audio;
  }

  private writeNextFrame(): boolean {
    // Pull a fixed 20ms frame from each channel; pad with zeros if not enough
    const left = this.callerQueue.pull(this.FRAME_SAMPLES);
    const right = this.aiQueue.pull(this.FRAME_SAMPLES);

    const stereo = new Int16Array(this.FRAME_SAMPLES * 2);
    for (let i = 0; i < this.FRAME_SAMPLES; i++) {
      stereo[i * 2] = left[i] || 0;      // Left channel: caller
      stereo[i * 2 + 1] = right[i] || 0; // Right channel: AI
    }

    const audioBuffer = Buffer.from(
      stereo.buffer,
      stereo.byteOffset,
      stereo.byteLength
    );

    return this.wavWriter.write(audioBuffer);
  }
}

/**
 * Simple chunk queue for Int16 PCM with pull semantics (pads with zeros when empty).
 */
class ChunkQueue {
  private chunks: Int16Array[] = [];
  private headIndex = 0; // index into first chunk

  enqueue(chunk: Int16Array): void {
    if (chunk && chunk.length > 0) {
      this.chunks.push(chunk);
    }
  }

  isEmpty(): boolean {
    return this.totalLength() === 0;
  }

  totalLength(): number {
    let len = 0;
    if (this.chunks.length === 0) return 0;
    len += (this.chunks[0].length - this.headIndex);
    for (let i = 1; i < this.chunks.length; i++) {
      len += this.chunks[i].length;
    }
    return len;
  }

  pull(n: number): Int16Array {
    const out = new Int16Array(n);
    let outPos = 0;

    while (outPos < n) {
      if (this.chunks.length === 0) {
        // Pad remaining with zeros
        // out is already zero-initialized
        break;
      }

      const head = this.chunks[0];
      const available = head.length - this.headIndex;
      const needed = n - outPos;
      const toCopy = Math.min(available, needed);

      out.set(head.subarray(this.headIndex, this.headIndex + toCopy), outPos);
      this.headIndex += toCopy;
      outPos += toCopy;

      if (this.headIndex >= head.length) {
        // Move to next chunk
        this.chunks.shift();
        this.headIndex = 0;
      }
    }

    return out;
  }
}
