import * as fs from 'fs';
import * as path from 'path';
import { 
  Config, 
  SIPAdvancedConfig, 
  ConfigLoadOptions, 
  ConfigLoadResult, 
  ValidationResult,
  ConfigurationError 
} from './types.js';
import { getLogger } from './logger.js';
import { 
  getProviderProfile, 
  detectProviderFromDomain, 
  getAvailableProviders 
} from './providers/profiles.js';

// Legacy function - maintained for backward compatibility
export function loadConfig(configPath?: string): Config {
  const defaultConfigPath = path.join(process.cwd(), 'config.json');
  const finalConfigPath = configPath || defaultConfigPath;

  if (!fs.existsSync(finalConfigPath)) {
    throw new Error(`Configuration file not found: ${finalConfigPath}`);
  }

  try {
    const configData = fs.readFileSync(finalConfigPath, 'utf8');
    const config = JSON.parse(configData);
    
    validateConfig(config);
    return config;
  } catch (error) {
    throw new Error(`Failed to load configuration: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
}

// Enhanced configuration loading with provider support
export async function loadConfigWithProvider(
  configPath?: string, 
  options: ConfigLoadOptions = {}
): Promise<ConfigLoadResult> {
  const defaultConfigPath = path.join(process.cwd(), 'config.json');
  const finalConfigPath = configPath || defaultConfigPath;
  
  getLogger().configLogs.info(`Loading configuration from: ${finalConfigPath}`);
  
  try {
    // Step 1: Load and parse base configuration
    const baseConfig = await loadBaseConfig(finalConfigPath);
    
    // Step 2: Determine provider (explicit > auto-detect > default)
    const providerId = determineProvider(baseConfig, options);
    
    // Step 3: Load provider profile
    const providerProfile = getProviderProfile(providerId);
    
    // Step 4: Merge all configuration sources
    const mergedConfig = mergeConfigurationSources({
      baseConfig,
      providerProfile,
      environmentOverrides: loadEnvironmentOverrides(),
      cliOptions: options
    });
    
    // Step 5: Validate and resolve dependencies
    const validationResult = await validateAndResolve(mergedConfig);
    
    // Step 6: Return comprehensive result
    return {
      config: validationResult.config,
      warnings: validationResult.warnings.map(w => w.message),
      suggestions: validationResult.suggestions.map(s => s.message),
      providerInfo: {
        id: providerId,
        name: providerProfile.name,
        autoDetected: !baseConfig.provider && !options.provider
      }
    };
    
  } catch (error) {
    // Enhanced error handling with helpful suggestions
    throw new ConfigurationError({
      message: `Failed to load configuration: ${error instanceof Error ? error.message : 'Unknown error'}`,
      configPath: finalConfigPath,
      suggestions: getConfigurationSuggestions(error),
      exampleConfigs: getExampleConfigPaths()
    });
  }
}

// Load base configuration from file
async function loadBaseConfig(configPath: string): Promise<any> {
  if (!fs.existsSync(configPath)) {
    throw new Error(`Configuration file not found: ${configPath}`);
  }

  try {
    const configData = fs.readFileSync(configPath, 'utf8');
    return JSON.parse(configData);
  } catch (error) {
    if (error instanceof SyntaxError) {
      throw new Error(`Invalid JSON in configuration file: ${error.message}`);
    }
    throw error;
  }
}

// Determine which provider to use
function determineProvider(baseConfig: any, options: ConfigLoadOptions): string {
  // Priority: CLI option > config file > auto-detect > default
  if (options.provider) {
    return options.provider;
  }
  
  if (baseConfig.provider) {
    return baseConfig.provider;
  }
  
  // Auto-detect from domain
  if (baseConfig.sip?.domain || baseConfig.sip?.serverIp) {
    const domain = baseConfig.sip.domain || baseConfig.sip.serverIp;
    const detected = detectProviderFromDomain(domain);
    if (detected) {
      return detected;
    }
  }
  
  // Default to fritz-box for backward compatibility
  return 'fritz-box';
}

// Configuration merging with conflict resolution
function mergeConfigurationSources(sources: {
  baseConfig: any;
  providerProfile: any;
  environmentOverrides: Partial<SIPAdvancedConfig>;
  cliOptions: ConfigLoadOptions;
}): SIPAdvancedConfig {
  
  const { baseConfig, providerProfile, environmentOverrides, cliOptions } = sources;
  
  // Start with base configuration, converted to new format
  let mergedConfig: SIPAdvancedConfig = convertLegacyConfig(baseConfig);
  
  // Apply provider profile (adds missing required features)
  mergedConfig = applyProviderProfile(mergedConfig, providerProfile);
  
  // Apply environment overrides (allows containerized deployments)
  mergedConfig = applyEnvironmentOverrides(mergedConfig, environmentOverrides);
  
  // Apply CLI options (highest priority for user control)
  mergedConfig = applyCLIOptions(mergedConfig, cliOptions);
  
  return mergedConfig;
}

// Convert legacy config format to new format
function convertLegacyConfig(legacyConfig: any): SIPAdvancedConfig {
  const converted: SIPAdvancedConfig = {
    // Convert old SIP format to new format
    username: legacyConfig.sip?.username || '',
    password: legacyConfig.sip?.password || '',
    serverIp: legacyConfig.sip?.serverIp || legacyConfig.sip?.domain || '',
    serverPort: legacyConfig.sip?.serverPort || 5060,
    localPort: legacyConfig.sip?.localPort || 5060,
    
    // Preserve any advanced config if present
    ...legacyConfig,
    
    // Set up audio config from AI config if present
    audio: {
      preferredCodecs: [9, 0, 8], // Default to G.722 preferred
      dtmfMethod: 'rfc4733',
      mediaTimeout: 30
    }
  };
  
  return converted;
}

// Provider profile application with intelligent merging
function applyProviderProfile(
  baseConfig: SIPAdvancedConfig, 
  profile: any
): SIPAdvancedConfig {
  
  getLogger().configLogs.info(`Applying provider profile: ${profile.name}`);
  
  return {
    ...baseConfig,
    
    // NAT Traversal: Merge STUN servers (user + provider)
    stunServers: [
      ...(baseConfig.stunServers || []),
      ...(profile.requirements.stunServers || [])
    ].filter((server, index, array) => array.indexOf(server) === index), // Deduplicate
    
    // Transport: Use provider preferences unless user explicitly set
    preferredTransports: baseConfig.preferredTransports || profile.requirements.transport,
    
    // Session Management: Enable based on provider requirements
    sessionTimers: {
      enabled: profile.requirements.sessionTimers,
      expires: baseConfig.sessionTimers?.expires || 1800,
      minSE: baseConfig.sessionTimers?.minSE || 90,
      refresher: baseConfig.sessionTimers?.refresher || 'uac'
    },
    
    // Protocol Features: Use provider requirements
    prackSupport: profile.requirements.prackSupport,
    
    // Connection Keepalive: Provider-specific method
    keepAlive: {
      method: profile.requirements.keepAliveMethod,
      interval: profile.requirements.keepAliveInterval
    },
    
    // Audio/SDP Configuration: Merge with provider preferences
    audio: {
      ...baseConfig.audio,
      // Provider codec preferences, but allow user override
      preferredCodecs: baseConfig.audio?.preferredCodecs || profile.sdpOptions.preferredCodecs,
      dtmfMethod: baseConfig.audio?.dtmfMethod || profile.sdpOptions.dtmfMethod,
      mediaTimeout: profile.sdpOptions.mediaTimeout
    },
    
    // Store profile metadata for runtime use
    provider: profile.name.toLowerCase().replace(/\s+/g, '-'),
    _providerProfile: profile
  };
}

export function createSampleConfig(outputPath: string): void {
  const sampleConfig: Config = {
    sip: {
      username: "your_sip_username",
      password: "your_sip_password",
      serverIp: "192.168.1.1",
      serverPort: 5060,
      localPort: 5060
    },
    ai: {
      openaiApiKey: "your_openai_api_key_here",
      voice: "alloy",
      instructions: "You are a helpful AI assistant speaking on a phone call. Keep your responses concise and natural, as if you're having a real conversation."
    }
  };

  fs.writeFileSync(outputPath, JSON.stringify(sampleConfig, null, 2));
  getLogger().configLogs.info(`Sample configuration created at: ${outputPath}`);
}

function validateConfig(config: any): void {
  if (!config.sip) {
    throw new Error('Missing SIP configuration');
  }

  if (!config.sip.username) {
    throw new Error('Missing SIP username');
  }

  if (!config.sip.password) {
    throw new Error('Missing SIP password');
  }

  if (!config.sip.serverIp) {
    throw new Error('Missing SIP server IP');
  }

  if (!config.ai) {
    throw new Error('Missing AI configuration');
  }

  if (!config.ai.openaiApiKey) {
    throw new Error('Missing OpenAI API key');
  }

  if (!config.sip.serverPort) {
    config.sip.serverPort = 5060;
  }

  if (!config.sip.localPort) {
    config.sip.localPort = 5060;
  }

  if (!config.ai.voice) {
    config.ai.voice = 'alloy';
  }
}

// Environment override loading
function loadEnvironmentOverrides(): Partial<SIPAdvancedConfig> {
  const overrides: Partial<SIPAdvancedConfig> = {};
  
  // SIP basic settings
  if (process.env.SIP_USERNAME) overrides.username = process.env.SIP_USERNAME;
  if (process.env.SIP_PASSWORD) overrides.password = process.env.SIP_PASSWORD;
  if (process.env.SIP_SERVER_IP) overrides.serverIp = process.env.SIP_SERVER_IP;
  if (process.env.SIP_SERVER_PORT) overrides.serverPort = parseInt(process.env.SIP_SERVER_PORT);
  if (process.env.SIP_LOCAL_PORT) overrides.localPort = parseInt(process.env.SIP_LOCAL_PORT);
  
  // Provider and advanced settings
  if (process.env.SIP_PROVIDER) overrides.provider = process.env.SIP_PROVIDER;
  if (process.env.STUN_SERVERS) overrides.stunServers = process.env.STUN_SERVERS.split(',');
  if (process.env.SIP_TRANSPORTS) overrides.preferredTransports = process.env.SIP_TRANSPORTS.split(',') as any;
  
  // Session timers
  if (process.env.SESSION_TIMERS_ENABLED) {
    overrides.sessionTimers = {
      enabled: process.env.SESSION_TIMERS_ENABLED === 'true',
      expires: parseInt(process.env.SESSION_EXPIRES || '1800'),
      minSE: parseInt(process.env.SESSION_MIN_SE || '90'),
      refresher: (process.env.SESSION_REFRESHER as any) || 'uac'
    };
  }
  
  return overrides;
}

// Apply CLI options (highest priority)
function applyEnvironmentOverrides(
  config: SIPAdvancedConfig,
  overrides: Partial<SIPAdvancedConfig>
): SIPAdvancedConfig {
  return { ...config, ...overrides };
}

// Apply CLI options
function applyCLIOptions(
  config: SIPAdvancedConfig,
  options: ConfigLoadOptions
): SIPAdvancedConfig {
  const result = { ...config };
  
  if (options.provider) {
    result.provider = options.provider;
  }
  
  return result;
}

// Configuration validation with detailed feedback
export async function validateAndResolve(config: SIPAdvancedConfig): Promise<ValidationResult> {
  const warnings: any[] = [];
  const suggestions: any[] = [];
  const errors: any[] = [];
  
  getLogger().configLogs.info('Validating configuration...');
  
  // Required field validation
  if (!config.username) {
    errors.push({ type: 'missing-username', message: 'SIP username is required', field: 'username' });
  }
  if (!config.password) {
    errors.push({ type: 'missing-password', message: 'SIP password is required', field: 'password' });
  }
  if (!config.serverIp) {
    errors.push({ type: 'missing-server', message: 'SIP server IP/domain is required', field: 'serverIp' });
  }
  
  // STUN server validation
  if (config.stunServers?.length) {
    for (const stunServer of config.stunServers) {
      if (!stunServer.startsWith('stun:')) {
        warnings.push({
          type: 'stun-format',
          message: `STUN server "${stunServer}" should start with "stun:"`,
          suggestion: 'Use format: stun:stun.server.com:19302'
        });
      }
    }
  }
  
  // Transport compatibility validation
  if (config.preferredTransports?.includes('tls') && !config.stunServers?.length) {
    warnings.push({
      type: 'tls-without-stun',
      message: 'TLS transport without STUN servers may have NAT traversal issues',
      suggestion: 'Consider adding STUN servers for TLS transport'
    });
  }
  
  // Codec compatibility check
  if (config.audio?.preferredCodecs?.length === 0) {
    warnings.push({
      type: 'no-codecs',
      message: 'No preferred codecs specified, using G.711 fallback only',
      suggestion: 'Enable G.722 for better audio quality'
    });
  }
  
  if (errors.length > 0) {
    throw new Error(`Configuration validation failed:\n${errors.map(e => e.message).join('\n')}`);
  }
  
  // Log validation results
  if (warnings.length > 0) {
    getLogger().configLogs.warn('Configuration warnings:');
    warnings.forEach(warning => getLogger().configLogs.warn(`   • ${warning.message}`));
  }
  
  if (suggestions.length > 0) {
    getLogger().configLogs.info('Suggestions for optimization:');
    suggestions.forEach(suggestion => getLogger().configLogs.info(`   • ${suggestion.message}`));
  }
  
  getLogger().configLogs.info('Configuration validation completed');
  
  return {
    config,
    warnings,
    suggestions,
    errors,
    isValid: errors.length === 0
  };
}

// Helper functions for error handling
function getConfigurationSuggestions(error: any): string[] {
  const suggestions: string[] = [];
  
  if (error?.message?.includes('not found')) {
    suggestions.push('Create a configuration file using: npm run create-config');
    suggestions.push('Use an example config: config.example.json');
  }
  
  if (error?.message?.includes('JSON')) {
    suggestions.push('Check configuration file syntax');
    suggestions.push('Validate JSON format online');
  }
  
  if (error?.message?.includes('username') || error?.message?.includes('password')) {
    suggestions.push('Check SIP credentials');
    suggestions.push('Verify with your SIP provider');
  }
  
  return suggestions;
}

function getExampleConfigPaths(): string[] {
  return [
    'config.example.json',
    'config.asterisk.example.json',
    'config.cisco.example.json'
  ];
}

// Legacy function - maintained for backward compatibility
export function loadConfigFromEnv(): Partial<Config> {
  return {
    sip: {
      username: process.env.SIP_USERNAME || '',
      password: process.env.SIP_PASSWORD || '',
      serverIp: process.env.SIP_SERVER_IP || '',
      serverPort: parseInt(process.env.SIP_SERVER_PORT || '5060'),
      localPort: parseInt(process.env.SIP_LOCAL_PORT || '5060')
    },
    ai: {
      openaiApiKey: process.env.OPENAI_API_KEY || '',
      voice: (process.env.OPENAI_VOICE as any) || 'auto',
      instructions: process.env.OPENAI_INSTRUCTIONS
    }
  };
}