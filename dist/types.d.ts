export interface SIPConfig {
    username: string;
    password: string;
    serverIp: string;
    serverPort: number;
    localPort: number;
}
export interface SIPAdvancedConfig extends SIPConfig {
    stunServers?: string[];
    turnServers?: TurnServer[];
    iceEnabled?: boolean;
    preferredTransports?: ('udp' | 'tcp' | 'tls')[];
    tlsOptions?: TLSConfig;
    sessionTimers?: SessionTimerConfig;
    prackSupport?: 'required' | 'supported' | 'disabled';
    keepAlive?: KeepaliveConfig;
    provider?: string;
    customProfile?: SIPProviderProfile;
    _providerProfile?: SIPProviderProfile;
    audio?: AudioConfig;
}
export interface TurnServer {
    urls: string[];
    username: string;
    password: string;
}
export interface TLSConfig {
    rejectUnauthorized?: boolean;
    cert?: string;
    key?: string;
    ca?: string;
}
export interface SessionTimerConfig {
    enabled: boolean;
    expires?: number;
    minSE?: number;
    refresher?: 'uac' | 'uas';
}
export interface KeepaliveConfig {
    method: 'register' | 'options' | 'double-crlf';
    interval: number;
}
export interface AudioConfig {
    preferredCodecs?: number[];
    dtmfMethod?: 'rfc4733' | 'info';
    mediaTimeout?: number;
}
export interface SIPProviderProfile {
    name: string;
    description: string;
    requirements: ProviderRequirements;
    sdpOptions: SDPOptions;
    quirks?: ProviderQuirks;
}
export interface ProviderRequirements {
    stunServers?: string[];
    transport: string[];
    sessionTimers: boolean;
    prackSupport: 'required' | 'supported' | 'disabled';
    authMethods: string[];
    keepAliveMethod: string;
    keepAliveInterval: number;
}
export interface SDPOptions {
    preferredCodecs: number[];
    dtmfMethod: string;
    mediaTimeout: number;
}
export interface ProviderQuirks {
    [key: string]: any;
}
export interface CallConfig {
    targetNumber: string;
    duration?: number;
}
export interface AIVoiceConfig {
    openaiApiKey: string;
    voice?: string;
    instructions?: string;
    brief?: string;
    userName?: string;
    language?: string;
}
export interface Config {
    sip: SIPConfig | SIPAdvancedConfig;
    ai?: AIVoiceConfig;
    openai?: AIVoiceConfig;
    audio?: AudioConfig;
    logging?: any;
    call?: any;
}
export interface CallEvent {
    type: 'REGISTERED' | 'REGISTER_FAILED' | 'CALL_INITIATED' | 'CALL_ANSWERED' | 'CALL_ENDED' | 'ERROR' | 'CONNECTED' | 'DISCONNECTED' | 'SESSION_REFRESH' | 'TRANSPORT_FALLBACK' | 'AUTH_RETRY' | 'CONNECTION_FAILED';
    message?: any;
    data?: any;
    endedBy?: 'remote' | 'local';
}
export interface ConfigLoadOptions {
    provider?: string;
    validateNetwork?: boolean;
    strictValidation?: boolean;
}
export interface ConfigLoadResult {
    config: SIPAdvancedConfig;
    warnings: string[];
    suggestions: string[];
    providerInfo: {
        id: string;
        name: string;
        autoDetected: boolean;
    };
}
export interface ValidationResult {
    config: SIPAdvancedConfig;
    warnings: ValidationWarning[];
    suggestions: ValidationSuggestion[];
    errors: ValidationError[];
    isValid: boolean;
}
export interface ValidationError {
    type: string;
    message: string;
    field?: string;
    suggestion?: string;
}
export interface ValidationWarning {
    type: string;
    message: string;
    suggestion?: string;
}
export interface ValidationSuggestion {
    type: string;
    message: string;
    priority?: 'low' | 'medium' | 'high' | 'info';
}
export interface ProviderCompatibilityReport {
    score: number;
    provider?: string;
    issues: string[];
}
export interface NetworkTestResult {
    sipServer: {
        reachable: boolean;
        latency?: number;
        error?: string;
        protocol?: string;
    };
    stunServers: Array<{
        server: string;
        reachable: boolean;
        error?: string;
        natType?: string;
    }>;
    recommendations: string[];
}
export interface ValidationReport {
    isValid: boolean;
    errors: ValidationError[];
    warnings: ValidationWarning[];
    suggestions: ValidationSuggestion[];
    providerCompatibility: ProviderCompatibilityReport;
    networkConnectivity?: NetworkTestResult;
}
export declare class ConfigurationError extends Error {
    details: {
        message: string;
        configPath?: string;
        suggestions: string[];
        exampleConfigs?: string[];
    };
    constructor(details: {
        message: string;
        configPath?: string;
        suggestions: string[];
        exampleConfigs?: string[];
    });
}
//# sourceMappingURL=types.d.ts.map