export interface CallBriefProcessorConfig {
    openaiApiKey: string;
    defaultUserName?: string;
    voice?: string;
}
export interface GeneratedInstructions {
    instructions: string;
    language: string;
    selectedVoice?: string;
}
export declare class CallBriefProcessor {
    private openai;
    private config;
    constructor(config: CallBriefProcessorConfig);
    /**
     * Generate voice agent instructions from a call brief using o3 model
     * Returns both the instructions and the detected language
     */
    generateInstructions(briefText: string, userName?: string, voice?: string): Promise<GeneratedInstructions>;
}
export declare class CallBriefError extends Error {
    readonly cause?: Error | undefined;
    constructor(message: string, cause?: Error | undefined);
}
//# sourceMappingURL=call-brief-processor.d.ts.map