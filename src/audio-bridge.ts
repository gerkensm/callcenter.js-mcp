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
  private audioMixer: AudioMixer | null = null;
  private packetCount: number = 0;
  private sendCount: number = 0;
  private rtpPacketQueue: Buffer[] = [];
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
    if (this.stereoWavWriter) {
      // Flush any remaining audio in the mixer
      if (this.audioMixer) {
        this.audioMixer.flush();
        this.audioMixer = null;
      }
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
        getLogger().rtp.info(
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

        // Record caller audio to stereo left channel
        if (this.audioMixer && this.callRecordingEnabled) {
          this.audioMixer.addCallerAudio(
            pcm16Audio,
            this.negotiatedCodec.sampleRate
          );
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

  sendAudio(audioData: Int16Array): void {
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

      // Record OpenAI audio to stereo right channel (before resampling, at 24kHz)
      if (this.audioMixer && this.callRecordingEnabled) {
        this.audioMixer.addAIAudio(audioData);
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
    const packetsToSend: Buffer[] = [];

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

      packetsToSend.push(rtpPacket);

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
        this.sendPacketImmediately(packetsToSend.shift()!);
      }
      this.needsInitialBurst = false;
    }

    this.rtpPacketQueue.push(...packetsToSend);

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
        const packet = this.rtpPacketQueue.shift()!;
        this.sendSocket!.send(
          packet,
          this.config.remoteRtpPort,
          this.config.remoteRtpHost,
          (err) => {
            if (err) {
              getLogger().rtp.error("Error sending RTP packet:", err);
            }
          }
        );

        // Warn if the buffer is getting low
        // if (this.rtpPacketQueue.length < 10) {
        //   // < 100ms buffer
        //   getLogger().rtp.warn(
        //     `Low buffer: ${this.rtpPacketQueue.length} packets remaining`
        //   );
        // }
      } else if (this.negotiatedCodec) {
        // Queue is empty (underrun). Inject silence to maintain a smooth RTP stream.
        // getLogger().rtp.debug(`Queue starvation: No packets available, injecting silence.`);
        const samplesPerPacket = this.negotiatedCodec.sampleRate / 100;
        const silenceData = new Int16Array(samplesPerPacket).fill(0);
        const encodedSilence = this.negotiatedCodec.encode(silenceData);
        const silencePacket = this.createRtpPacketWithTimestamp(
          encodedSilence,
          this.rtpTimestamp,
          this.negotiatedCodec.payloadType
        );
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

  private sendPacketImmediately(packet: Buffer): void {
    if (!this.sendSocket) return;

    this.sendSocket.send(
      packet,
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
    getLogger().rtp.info(`Remote RTP endpoint set to ${host}:${port}`);

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
        getLogger().rtp.info(
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

    // Clear audio mixer buffers to stop recording interrupted OpenAI audio
    if (this.audioMixer) {
      this.audioMixer.clearBuffers();
    }

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

      // Initialize audio mixer for synchronized stereo recording
      this.audioMixer = new AudioMixer(
        this.stereoWavWriter,
        this.audioProcessor
      );

      getLogger().audio.info(
        `Stereo call recording started: ${filename} (Left: caller, Right: AI)`
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

class AudioMixer {
  private wavWriter: Writer;
  private callerBuffer: Int16Array = new Int16Array(0);
  private aiBuffer: Int16Array = new Int16Array(0);
  private readonly FRAME_SIZE = 480; // 20ms at 24kHz
  private audioProcessor: AudioProcessor;

  constructor(wavWriter: Writer, audioProcessor: AudioProcessor) {
    this.wavWriter = wavWriter;
    this.audioProcessor = audioProcessor;
  }

  addCallerAudio(audio: Int16Array, codecSampleRate: number): void {
    // Upsample to 24kHz if needed
    let upsampled: Int16Array;
    if (codecSampleRate === 16000) {
      upsampled = this.audioProcessor.resample16kTo24k(audio);
    } else {
      upsampled = this.audioProcessor.resample8kTo24k(audio);
    }

    // Append to caller buffer
    const newBuffer = new Int16Array(
      this.callerBuffer.length + upsampled.length
    );
    newBuffer.set(this.callerBuffer);
    newBuffer.set(upsampled, this.callerBuffer.length);
    this.callerBuffer = newBuffer;

    this.processFrames();
  }

  addAIAudio(audio: Int16Array): void {
    // Append to AI buffer (already 24kHz)
    const newBuffer = new Int16Array(this.aiBuffer.length + audio.length);
    newBuffer.set(this.aiBuffer);
    newBuffer.set(audio, this.aiBuffer.length);
    this.aiBuffer = newBuffer;

    this.processFrames();
  }

  private processFrames(): void {
    // Process complete frames while we have enough data from both streams
    const minAvailable = Math.min(
      this.callerBuffer.length,
      this.aiBuffer.length
    );
    const framesToProcess = Math.floor(minAvailable / this.FRAME_SIZE);

    for (let frame = 0; frame < framesToProcess; frame++) {
      const frameStart = frame * this.FRAME_SIZE;
      const frameEnd = frameStart + this.FRAME_SIZE;

      // Create stereo frame
      const stereoFrame = new Int16Array(this.FRAME_SIZE * 2);
      for (let i = 0; i < this.FRAME_SIZE; i++) {
        stereoFrame[i * 2] = this.callerBuffer[frameStart + i]; // Left: caller
        stereoFrame[i * 2 + 1] = this.aiBuffer[frameStart + i]; // Right: AI
      }

      // Write to WAV
      const audioBuffer = Buffer.from(
        stereoFrame.buffer,
        stereoFrame.byteOffset,
        stereoFrame.byteLength
      );
      this.wavWriter.write(audioBuffer);
    }

    // Remove processed samples
    const samplesToRemove = framesToProcess * this.FRAME_SIZE;
    if (samplesToRemove > 0) {
      this.callerBuffer = this.callerBuffer.slice(samplesToRemove);
      this.aiBuffer = this.aiBuffer.slice(samplesToRemove);
    }
  }

  flush(): void {
    // Process any remaining samples with zero-padding for the shorter buffer
    const maxLength = Math.max(this.callerBuffer.length, this.aiBuffer.length);
    if (maxLength === 0) return;

    // Pad shorter buffer with zeros
    const paddedCaller = new Int16Array(maxLength);
    const paddedAI = new Int16Array(maxLength);

    paddedCaller.set(this.callerBuffer);
    paddedAI.set(this.aiBuffer);

    // Create final stereo frames
    const stereoFrame = new Int16Array(maxLength * 2);
    for (let i = 0; i < maxLength; i++) {
      stereoFrame[i * 2] = paddedCaller[i]; // Left: caller
      stereoFrame[i * 2 + 1] = paddedAI[i]; // Right: AI
    }

    // Write to WAV
    const audioBuffer = Buffer.from(
      stereoFrame.buffer,
      stereoFrame.byteOffset,
      stereoFrame.byteLength
    );
    this.wavWriter.write(audioBuffer);

    // Clear buffers
    this.callerBuffer = new Int16Array(0);
    this.aiBuffer = new Int16Array(0);
  }

  clearBuffers(): void {
    // Clear both audio buffers without writing remaining data
    // Used during interruptions to stop recording abruptly stopped audio
    this.callerBuffer = new Int16Array(0);
    this.aiBuffer = new Int16Array(0);
    getLogger().audio.debug("Audio mixer buffers cleared due to interruption");
  }
}
