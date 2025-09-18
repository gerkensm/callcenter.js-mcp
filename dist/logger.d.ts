import winston from "winston";
export declare enum LogLevel {
    QUIET = "quiet",// Only transcripts
    ERROR = "error",// Errors only
    WARN = "warn",// Warnings and errors
    INFO = "info",// General info, warnings, errors
    DEBUG = "debug",// All logs including debug info
    VERBOSE = "verbose"
}
export interface LoggerConfig {
    level: LogLevel;
    enableColors?: boolean;
    enableTimestamp?: boolean;
    transcriptOnly?: boolean;
}
declare class VoIPLogger {
    logger: winston.Logger;
    private config;
    private transcriptBuffer;
    private lastTranscriptRole;
    constructor(config: LoggerConfig);
    error(message: string, category?: string, meta?: any): void;
    warn(message: string, category?: string, meta?: any): void;
    info(message: string, category?: string, meta?: any): void;
    debug(message: string, category?: string, meta?: any): void;
    verbose(message: string, category?: string, meta?: any): void;
    sip: {
        info: (message: string, meta?: any) => void;
        error: (message: string, meta?: any) => void;
        debug: (message: string, meta?: any) => void;
        warn: (message: string, meta?: any) => void;
    };
    audio: {
        info: (message: string, meta?: any) => void;
        error: (message: string, meta?: any) => void;
        debug: (message: string, meta?: any) => void;
        verbose: (message: string, meta?: any) => void;
        warn: (message: string, meta?: any) => void;
    };
    ai: {
        info: (message: string, meta?: any) => void;
        error: (message: string, meta?: any) => void;
        debug: (message: string, meta?: any) => void;
        warn: (message: string, meta?: any) => void;
        verbose: (message: string, meta?: any) => void;
    };
    rtp: {
        debug: (message: string, meta?: any) => void;
        verbose: (message: string, meta?: any) => void;
        warn: (message: string, meta?: any) => void;
        info: (message: string, meta?: any) => void;
        error: (message: string, meta?: any) => void;
    };
    codec: {
        info: (message: string, meta?: any) => void;
        debug: (message: string, meta?: any) => void;
        error: (message: string, meta?: any) => void;
    };
    perf: {
        verbose: (message: string, meta?: any) => void;
        debug: (message: string, meta?: any) => void;
        warn: (message: string, meta?: any) => void;
    };
    configLogs: {
        info: (message: string, meta?: any) => void;
        warn: (message: string, meta?: any) => void;
        error: (message: string, meta?: any) => void;
    };
    assistant: {
        transcript: (message: string, meta?: any) => winston.Logger;
    };
    user: {
        transcript: (message: string, meta?: any) => winston.Logger;
    };
    callStatus: {
        transcript: (message: string, meta?: any) => void;
    };
    transcript(role: "user" | "assistant", text: string, isDelta?: boolean): void;
    getFullTranscript(): string[];
    clearTranscript(): void;
    setLevel(level: LogLevel): void;
    isLevelEnabled(level: LogLevel): boolean;
    isQuietMode(): boolean;
}
export declare function initializeLogger(config: LoggerConfig): VoIPLogger;
export declare function getLogger(): VoIPLogger;
export { VoIPLogger };
//# sourceMappingURL=logger.d.ts.map