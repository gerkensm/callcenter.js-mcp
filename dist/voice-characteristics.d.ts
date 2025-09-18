/**
 * Voice characteristics for OpenAI Realtime API voices
 * Based on community testing and OpenAI documentation
 */
export type VoiceGender = 'male' | 'female' | 'androgynous';
export type VoiceGeneration = 'standard' | 'new';
export interface VoiceCharacteristics {
    name: string;
    gender: VoiceGender;
    generation: VoiceGeneration;
    description: string;
    genderScale: number;
    steerable: boolean;
}
export declare const VOICE_CHARACTERISTICS: Record<string, VoiceCharacteristics>;
/**
 * List of all valid voice names
 */
export declare const VALID_VOICE_NAMES: string[];
/**
 * Get voice characteristics for a given voice name
 */
export declare function getVoiceCharacteristics(voiceName: string): VoiceCharacteristics | undefined;
/**
 * Check if a voice name is valid
 */
export declare function isValidVoiceName(voiceName: string | undefined): boolean;
/**
 * Validate and sanitize a voice name
 * Returns 'auto' for auto mode, validated voice name, or undefined for invalid
 */
export declare function sanitizeVoiceName(voiceName: string | undefined): string | undefined;
/**
 * Get appropriate pronoun for voice gender
 */
export declare function getVoicePronoun(voiceName: string, type: 'subject' | 'object' | 'possessive'): string;
/**
 * Get voice description for inclusion in prompts
 */
export declare function getVoiceDescription(voiceName: string): string;
//# sourceMappingURL=voice-characteristics.d.ts.map