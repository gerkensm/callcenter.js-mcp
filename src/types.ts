export interface SIPConfig {
  username: string;
  password: string;
  serverIp: string;
  serverPort: number;
  localPort: number;
}

// Enhanced SIP configuration extending the basic SIPConfig
export interface SIPAdvancedConfig extends SIPConfig {
  // NAT Traversal Configuration
  stunServers?: string[];           // STUN servers for NAT detection
  turnServers?: TurnServer[];       // TURN relays for strict NAT
  iceEnabled?: boolean;             // Enable ICE candidate gathering
  
  // Transport Layer Configuration
  preferredTransports?: ('udp' | 'tcp' | 'tls')[];  // Transport priority
  tlsOptions?: TLSConfig;           // TLS-specific settings
  
  // SIP Protocol Features
  sessionTimers?: SessionTimerConfig;    // RFC 4028 session refresh
  prackSupport?: 'required' | 'supported' | 'disabled';  // RFC 3262
  keepAlive?: KeepaliveConfig;      // Connection maintenance
  
  // Provider Integration
  provider?: string;                // References built-in profile
  customProfile?: SIPProviderProfile;    // Override built-in profile
  _providerProfile?: SIPProviderProfile; // Resolved profile (internal)
  
  // Audio Configuration
  audio?: AudioConfig;              // Audio/codec preferences
}

// TURN server configuration
export interface TurnServer {
  urls: string[];
  username: string;
  password: string;
}

// TLS configuration options
export interface TLSConfig {
  rejectUnauthorized?: boolean;
  cert?: string;
  key?: string;
  ca?: string;
}

// Session timer configuration (RFC 4028)
export interface SessionTimerConfig {
  enabled: boolean;
  expires?: number;                 // Session refresh interval (seconds)
  minSE?: number;                   // Minimum session expires
  refresher?: 'uac' | 'uas';        // Who refreshes the session
}

// Keepalive configuration
export interface KeepaliveConfig {
  method: 'register' | 'options' | 'double-crlf';
  interval: number;                 // Keepalive interval (seconds)
}

// Audio configuration
export interface AudioConfig {
  preferredCodecs?: number[];       // Payload type preferences [9, 0, 8]
  dtmfMethod?: 'rfc4733' | 'info';  // DTMF transmission method
  mediaTimeout?: number;            // RTP timeout (seconds)
}

// Provider profile schema - encodes SIP provider requirements
export interface SIPProviderProfile {
  name: string;                     // Human-readable provider name
  description: string;              // Provider description
  requirements: ProviderRequirements;    // Technical requirements
  sdpOptions: SDPOptions;           // Media negotiation preferences
  quirks?: ProviderQuirks;          // Provider-specific workarounds
}

// Provider technical requirements
export interface ProviderRequirements {
  stunServers?: string[];           // Required STUN servers
  transport: string[];              // Supported transports ['udp', 'tcp', 'tls']
  sessionTimers: boolean;           // Session timer support required
  prackSupport: 'required' | 'supported' | 'disabled';  // PRACK requirement level
  authMethods: string[];            // Authentication methods ['digest']
  keepAliveMethod: string;          // Preferred keepalive method
  keepAliveInterval: number;        // Keepalive interval (seconds)
}

// SDP and media options
export interface SDPOptions {
  preferredCodecs: number[];        // Codec priority order
  dtmfMethod: string;               // DTMF method preference
  mediaTimeout: number;             // Media timeout (seconds)
}

// Provider-specific quirks and workarounds
export interface ProviderQuirks {
  [key: string]: any;               // Flexible structure for provider-specific settings
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
}

export interface Config {
  sip: SIPConfig | SIPAdvancedConfig;
  ai?: AIVoiceConfig;
  openai?: AIVoiceConfig; // For backward compatibility
  audio?: AudioConfig; // For backward compatibility
  logging?: any; // For backward compatibility
  call?: any; // For backward compatibility
}

export interface CallEvent {
  type: 'REGISTERED' | 'REGISTER_FAILED' | 'CALL_INITIATED' | 'CALL_ANSWERED' | 'CALL_ENDED' | 'ERROR' |
        'CONNECTED' | 'DISCONNECTED' | 'SESSION_REFRESH' | 'TRANSPORT_FALLBACK' | 'AUTH_RETRY' | 'CONNECTION_FAILED';
  message?: any;
  data?: any;
}

// Configuration loading and validation interfaces
export interface ConfigLoadOptions {
  provider?: string;                // Override provider detection
  validateNetwork?: boolean;        // Test network connectivity
  strictValidation?: boolean;       // Fail on warnings
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

// Provider compatibility and testing interfaces
export interface ProviderCompatibilityReport {
  score: number;                    // 0-100 compatibility score
  provider?: string;                // Provider name
  issues: string[];                 // List of compatibility issues
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

// Configuration error handling
export class ConfigurationError extends Error {
  constructor(public details: {
    message: string;
    configPath?: string;
    suggestions: string[];
    exampleConfigs?: string[];
  }) {
    super(details.message);
    this.name = 'ConfigurationError';
  }
}