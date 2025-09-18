import { SIPProviderProfile } from '../types.js';
export declare const PROVIDER_PROFILES: Record<string, SIPProviderProfile>;
export declare function getProviderProfile(providerId: string): SIPProviderProfile;
export declare function detectProviderFromDomain(domain: string): string | null;
export declare function validateProviderProfile(profile: SIPProviderProfile): string[];
export declare function getAvailableProviders(): string[];
export declare function getProviderProfileByName(name: string): SIPProviderProfile | null;
//# sourceMappingURL=profiles.d.ts.map