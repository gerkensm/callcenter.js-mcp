import { SIPAdvancedConfig, ValidationReport } from './types.js';
export interface ValidationOptions {
    testConnectivity?: boolean;
    strictValidation?: boolean;
}
export declare class ConfigurationValidator {
    validateConfiguration(config: SIPAdvancedConfig, options?: ValidationOptions): Promise<ValidationReport>;
    private validateSyntax;
    private validateRequiredFields;
    private validateProviderRequirements;
    private testNetworkConnectivity;
    private validateCodecCompatibility;
    private testG722Availability;
}
export declare function validateConfigFile(configPath: string): Promise<void>;
//# sourceMappingURL=validation.d.ts.map