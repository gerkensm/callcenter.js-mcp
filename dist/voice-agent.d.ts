import { EventEmitter } from "events";
import { Config, CallConfig } from "./types.js";
export declare class VoiceAgent extends EventEmitter {
    private sipClient;
    private openaiClient;
    private audioBridge;
    private config;
    private connectionManager?;
    private isCallActive;
    private currentCallId;
    private perfMonitor;
    private enableCallRecording;
    private aiEndCallReason;
    private audioBatch;
    private readonly BATCH_SIZE;
    private batchTimer;
    private readonly BATCH_TIMEOUT_MS;
    constructor(config: Config, options?: {
        enableCallRecording?: boolean;
        recordingFilename?: string;
    });
    private isEnhancedConfig;
    private setupConnectionManager;
    private getLocalIpAddress;
    private setupAudioBridge;
    private addAudioToBatch;
    private sendBatchedAudio;
    private clearAudioBatch;
    private handleSipEvent;
    private handleCallAnswered;
    private parseSdpAndSetupAudio;
    private handleCallEnded;
    initialize(): Promise<void>;
    makeCall(callConfig: CallConfig): Promise<void>;
    endCall(): Promise<void>;
    getStatus(): any;
    shutdown(): Promise<void>;
}
//# sourceMappingURL=voice-agent.d.ts.map