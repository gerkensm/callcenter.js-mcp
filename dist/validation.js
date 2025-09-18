import { validateProviderProfile } from './providers/profiles.js';
import { NetworkTester } from './testing/network-tester.js';
export class ConfigurationValidator {
    async validateConfiguration(config, options = {}) {
        const report = {
            isValid: true,
            errors: [],
            warnings: [],
            suggestions: [],
            providerCompatibility: { score: 0, issues: [] }
        };
        // Layer 1: Syntax and Type Validation
        await this.validateSyntax(config, report);
        // Layer 2: Required Fields Validation
        await this.validateRequiredFields(config, report);
        // Layer 3: Provider-Specific Validation
        await this.validateProviderRequirements(config, report);
        // Layer 4: Network Connectivity (optional)
        if (options.testConnectivity) {
            report.networkConnectivity = await this.testNetworkConnectivity(config);
        }
        // Layer 5: Codec Compatibility
        await this.validateCodecCompatibility(config, report);
        // Final assessment
        report.isValid = report.errors.length === 0;
        return report;
    }
    async validateSyntax(config, report) {
        // Type validation for known fields
        if (config.serverPort && typeof config.serverPort !== 'number') {
            report.errors.push({
                type: 'invalid-type',
                message: 'Server port must be a number',
                field: 'serverPort',
                suggestion: 'Use a numeric value like 5060'
            });
        }
        if (config.localPort && typeof config.localPort !== 'number') {
            report.errors.push({
                type: 'invalid-type',
                message: 'Local port must be a number',
                field: 'localPort',
                suggestion: 'Use a numeric value like 5060'
            });
        }
        // Validate STUN server format
        if (config.stunServers) {
            config.stunServers.forEach((server, index) => {
                if (typeof server !== 'string') {
                    report.errors.push({
                        type: 'invalid-stun-server',
                        message: `STUN server ${index + 1} must be a string`,
                        field: 'stunServers',
                        suggestion: 'Use format: "stun:stun.server.com:19302"'
                    });
                }
            });
        }
        // Validate transport options
        if (config.preferredTransports) {
            const validTransports = ['udp', 'tcp', 'tls'];
            config.preferredTransports.forEach((transport, index) => {
                if (!validTransports.includes(transport)) {
                    report.errors.push({
                        type: 'invalid-transport',
                        message: `Transport "${transport}" is not valid`,
                        field: 'preferredTransports',
                        suggestion: `Use one of: ${validTransports.join(', ')}`
                    });
                }
            });
        }
    }
    async validateRequiredFields(config, report) {
        // Core SIP fields
        if (!config.username) {
            report.errors.push({
                type: 'missing-username',
                message: 'SIP username is required',
                field: 'username',
                suggestion: 'Set username in your SIP configuration'
            });
        }
        if (!config.password) {
            report.errors.push({
                type: 'missing-password',
                message: 'SIP password is required',
                field: 'password',
                suggestion: 'Set password in your SIP configuration'
            });
        }
        if (!config.serverIp) {
            report.errors.push({
                type: 'missing-server',
                message: 'SIP server IP/domain is required',
                field: 'serverIp',
                suggestion: 'Set serverIp to your SIP provider address'
            });
        }
        // Port validation
        if (config.serverPort && (config.serverPort < 1 || config.serverPort > 65535)) {
            report.errors.push({
                type: 'invalid-port',
                message: 'Server port must be between 1 and 65535',
                field: 'serverPort',
                suggestion: 'Common SIP ports: 5060 (UDP/TCP), 5061 (TLS)'
            });
        }
        if (config.localPort && (config.localPort < 1 || config.localPort > 65535)) {
            report.errors.push({
                type: 'invalid-port',
                message: 'Local port must be between 1 and 65535',
                field: 'localPort',
                suggestion: 'Use an available port above 1024'
            });
        }
    }
    async validateProviderRequirements(config, report) {
        if (!config._providerProfile) {
            report.warnings.push({
                type: 'missing-provider-profile',
                message: 'No provider profile specified, using generic settings',
                suggestion: 'Specify provider for optimized configuration'
            });
            return;
        }
        const profile = config._providerProfile;
        let compatibilityScore = 100;
        // Check STUN/TURN requirements
        if (profile.requirements.stunServers && !config.stunServers?.length) {
            report.errors.push({
                type: 'missing-stun-servers',
                message: `Provider ${profile.name} requires STUN servers for NAT traversal`,
                field: 'stunServers',
                suggestion: `Add STUN servers: ${JSON.stringify(profile.requirements.stunServers)}`
            });
            compatibilityScore -= 30;
        }
        // Check session timer requirements
        if (profile.requirements.sessionTimers && !config.sessionTimers?.enabled) {
            report.warnings.push({
                type: 'session-timers-recommended',
                message: `Provider ${profile.name} recommends session timers for connection stability`,
                suggestion: 'Enable session timers: {"enabled": true, "expires": 1800}'
            });
            compatibilityScore -= 15;
        }
        // Check PRACK requirements
        if (profile.requirements.prackSupport === 'required' &&
            config.prackSupport !== 'required') {
            report.errors.push({
                type: 'prack-required',
                message: `Provider ${profile.name} requires PRACK (RFC 3262) support`,
                field: 'prackSupport',
                suggestion: 'Set prackSupport: "required"'
            });
            compatibilityScore -= 25;
        }
        // Check transport requirements
        const requiredTransports = profile.requirements.transport;
        const configuredTransports = config.preferredTransports || ['udp'];
        const hasRequiredTransport = requiredTransports.some(transport => configuredTransports.includes(transport));
        if (!hasRequiredTransport) {
            report.warnings.push({
                type: 'transport-mismatch',
                message: `Provider prefers ${requiredTransports.join('/')} transport`,
                suggestion: `Add to preferredTransports: ${JSON.stringify(requiredTransports)}`
            });
            compatibilityScore -= 10;
        }
        // Validate provider profile itself
        const profileIssues = validateProviderProfile(profile);
        profileIssues.forEach(issue => {
            report.warnings.push({
                type: 'provider-profile-issue',
                message: issue,
                suggestion: 'Consider adjusting provider profile settings'
            });
        });
        // Update compatibility score
        report.providerCompatibility = {
            score: Math.max(0, compatibilityScore),
            provider: profile.name,
            issues: [...report.errors, ...report.warnings].map(issue => issue.type)
        };
    }
    async testNetworkConnectivity(config) {
        console.log('🌐 Testing network connectivity...');
        const networkTester = new NetworkTester();
        return await networkTester.testNetworkConnectivity(config);
    }
    async validateCodecCompatibility(config, report) {
        // Check if G.722 is available when preferred
        const preferredCodecs = config.audio?.preferredCodecs || [9, 0, 8];
        if (preferredCodecs.includes(9)) { // G.722
            try {
                // Test G.722 codec availability
                const g722Available = await this.testG722Availability();
                if (!g722Available) {
                    report.warnings.push({
                        type: 'g722-unavailable',
                        message: 'G.722 codec not available, falling back to G.711',
                        suggestion: 'Ensure G.722 native addon is built: ENABLE_G722=1 npm run build:native'
                    });
                }
                else {
                    report.suggestions.push({
                        type: 'g722-available',
                        message: 'G.722 wideband codec available for high-quality audio',
                        priority: 'info'
                    });
                }
            }
            catch (error) {
                report.errors.push({
                    type: 'codec-test-failed',
                    message: `Failed to test codec availability: ${error instanceof Error ? error.message : 'Unknown error'}`,
                    suggestion: 'Check native addon compilation'
                });
            }
        }
        // Check if fallback codecs are available
        if (!preferredCodecs.includes(0) && !preferredCodecs.includes(8)) {
            report.warnings.push({
                type: 'no-fallback-codec',
                message: 'No G.711 fallback codec specified',
                suggestion: 'Add payload type 0 (PCMU) or 8 (PCMA) for compatibility'
            });
        }
    }
    async testG722Availability() {
        try {
            // Try to import and test G.722 codec
            const { isPayloadTypeSupported } = await import('./codecs/index.js');
            return isPayloadTypeSupported(9); // G.722 payload type
        }
        catch (error) {
            return false;
        }
    }
}
// CLI-friendly validation function
export async function validateConfigFile(configPath) {
    try {
        const { loadConfigWithProvider } = await import('./config.js');
        const config = await loadConfigWithProvider(configPath);
        const validator = new ConfigurationValidator();
        const report = await validator.validateConfiguration(config.config, {
            testConnectivity: false // Skip network tests in CLI
        });
        // Pretty print results
        console.log('\n📋 Configuration Validation Report\n');
        if (report.isValid) {
            console.log('✅ Configuration is valid!\n');
        }
        else {
            console.log('❌ Configuration has errors:\n');
            report.errors.forEach(error => {
                console.log(`   • ${error.message}`);
                if (error.suggestion) {
                    console.log(`     💡 ${error.suggestion}`);
                }
            });
        }
        if (report.warnings.length > 0) {
            console.log('⚠️  Warnings:');
            report.warnings.forEach(warning => {
                console.log(`   • ${warning.message}`);
                if (warning.suggestion) {
                    console.log(`     💡 ${warning.suggestion}`);
                }
            });
            console.log('');
        }
        if (report.suggestions.length > 0) {
            console.log('💡 Suggestions for optimization:');
            report.suggestions.forEach(suggestion => {
                console.log(`   • ${suggestion.message}`);
            });
            console.log('');
        }
        console.log(`🎯 Provider Compatibility: ${report.providerCompatibility.score}%`);
    }
    catch (error) {
        console.error(`❌ Validation failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
        process.exit(1);
    }
}
//# sourceMappingURL=validation.js.map