import { EventEmitter } from "events";
export interface AudioBridgeConfig {
    localRtpPort: number;
    localRtpHost?: string;
    remoteRtpHost?: string;
    remoteRtpPort?: number;
    sampleRate: number;
    enableCallRecording?: boolean;
    recordingFilename?: string;
}
export declare class AudioBridge extends EventEmitter {
    private config;
    private udpSocket;
    private sendSocket;
    private isActive;
    private lastSequenceNumber;
    private hasReceivedAudio;
    private startTime;
    private rtpTimestamp;
    private incomingWavWriter;
    private outgoingWavWriter;
    private stereoWavWriter;
    private currentRecordingFilename;
    private callRecordingEnabled;
    private stereoRecorder;
    private packetCount;
    private sendCount;
    private rtpPacketQueue;
    private responseAudioTracking;
    private currentResponseId?;
    private rtpSendInterval;
    private interruptedResponses;
    private audioProcessor;
    private needsInitialBurst;
    private lastSendTime;
    private sendTimeJitter;
    private lastAudioReceived;
    private audioGapCount;
    private dynamicBufferSize;
    private negotiatedCodec;
    private rtpTimeoutTimer;
    private readonly RTP_TIMEOUT_MS;
    private perfStats;
    constructor(config: AudioBridgeConfig);
    start(): Promise<void>;
    stop(): void;
    startRtpDetection(): void;
    private resetRtpTimeout;
    private handleIncomingRtp;
    private parseRtpHeader;
    sendAudio(audioData: Int16Array, responseId?: string): void;
    private sendAudioDirectly;
    private startRtpSender;
    private startActualRtpSender;
    private trackPacketSent;
    cancelPendingCallbacks(): void;
    /**
     * Get the response ID that is currently playing (has packets queued but not all sent).
     * @returns The response ID of the currently playing response, or null if none
     */
    getCurrentlyPlayingResponseId(): string | null;
    /**
     * Get the current playback position of the currently playing response.
     * @returns The playback position in milliseconds, or 0 if no response is playing
     */
    getCurrentPlaybackPosition(): number;
    /**
     * Get the current playback position for a response in milliseconds.
     * Returns the estimated time of audio that has been sent to the SIP endpoint.
     *
     * @param responseId - The response ID to check, or undefined for the currently playing response
     * @returns The playback position in milliseconds, or 0 if response not found
     */
    getResponsePlaybackPosition(responseId?: string): number;
    notifyWhenResponseComplete(responseId: string, callback: () => void): void;
    private sendQueuedEntryImmediately;
    private stopRtpSender;
    private createRtpPacketWithTimestamp;
    setNegotiatedCodec(payloadType: number): void;
    setRemoteEndpoint(host: string, port: number): void;
    private sendNATKeepAlivePackets;
    private scheduleFritzBoxStatusUpdates;
    clearAudioBuffer(): void;
    getLocalPort(): number;
    isRunning(): boolean;
    setCallRecordingEnabled(enabled: boolean): void;
    isCallRecordingEnabled(): boolean;
    private setupWavRecording;
    private setupStereoCallRecording;
    private logPerformanceStats;
}
//# sourceMappingURL=audio-bridge.d.ts.map