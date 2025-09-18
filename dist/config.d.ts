import { Config, SIPAdvancedConfig, ConfigLoadOptions, ConfigLoadResult, ValidationResult } from './types.js';
export declare function loadConfig(configPath?: string): Config;
export declare function loadConfigWithProvider(configPath?: string, options?: ConfigLoadOptions): Promise<ConfigLoadResult>;
export declare function createSampleConfig(outputPath: string): void;
export declare function validateAndResolve(config: SIPAdvancedConfig): Promise<ValidationResult>;
export declare function loadConfigFromEnv(): Partial<Config>;
//# sourceMappingURL=config.d.ts.map