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
  genderScale: number; // 1 (masculine) to 10 (feminine)
  steerable: boolean; // How well it responds to instructions
}

export const VOICE_CHARACTERISTICS: Record<string, VoiceCharacteristics> = {
  // Current Realtime API voices (10 total)
  shimmer: {
    name: 'shimmer',
    gender: 'female',
    generation: 'standard',
    description: 'Warm, expressive feminine voice',
    genderScale: 7,
    steerable: false
  },
  
  alloy: {
    name: 'alloy',
    gender: 'androgynous',
    generation: 'new',
    description: 'Neutral, professional voice with good adaptability',
    genderScale: 7,
    steerable: true
  },
  echo: {
    name: 'echo',
    gender: 'male',
    generation: 'new',
    description: 'Conversational masculine voice with natural tone',
    genderScale: 2,
    steerable: true
  },
  ash: {
    name: 'ash',
    gender: 'androgynous',
    generation: 'new',
    description: 'Clear and precise voice with good clarity',
    genderScale: 5,
    steerable: true
  },
  ballad: {
    name: 'ballad',
    gender: 'female',
    generation: 'new',
    description: 'Melodic and smooth feminine voice with emotional range',
    genderScale: 8,
    steerable: true
  },
  coral: {
    name: 'coral',
    gender: 'female',
    generation: 'new',
    description: 'Warm and friendly feminine voice',
    genderScale: 8,
    steerable: true
  },
  sage: {
    name: 'sage',
    gender: 'androgynous',
    generation: 'new',
    description: 'Calm and thoughtful voice with neutral characteristics',
    genderScale: 5,
    steerable: true
  },
  verse: {
    name: 'verse',
    gender: 'androgynous',
    generation: 'new',
    description: 'Versatile and expressive voice with good range',
    genderScale: 6,
    steerable: true
  },
  
  // Latest voices (August 2025) - Exclusive to Realtime API
  cedar: {
    name: 'cedar',
    gender: 'male',
    generation: 'new',
    description: 'Natural masculine voice with warm undertones',
    genderScale: 3,
    steerable: true
  },
  marin: {
    name: 'marin',
    gender: 'female',
    generation: 'new',
    description: 'Clear, professional feminine voice',
    genderScale: 8,
    steerable: true
  }
};

/**
 * List of all valid voice names
 */
export const VALID_VOICE_NAMES = Object.keys(VOICE_CHARACTERISTICS);

/**
 * Get voice characteristics for a given voice name
 */
export function getVoiceCharacteristics(voiceName: string): VoiceCharacteristics | undefined {
  return VOICE_CHARACTERISTICS[voiceName.toLowerCase()];
}

/**
 * Check if a voice name is valid
 */
export function isValidVoiceName(voiceName: string | undefined): boolean {
  if (!voiceName) return false;
  return voiceName.toLowerCase() === 'auto' || VOICE_CHARACTERISTICS.hasOwnProperty(voiceName.toLowerCase());
}

/**
 * Validate and sanitize a voice name
 * Returns 'auto' for auto mode, validated voice name, or undefined for invalid
 */
export function sanitizeVoiceName(voiceName: string | undefined): string | undefined {
  if (!voiceName) return undefined;
  
  const normalized = voiceName.toLowerCase().trim();
  
  // Handle auto mode
  if (normalized === 'auto' || normalized === 'automatic') {
    return 'auto';
  }
  
  // Check if it's a valid voice
  if (VOICE_CHARACTERISTICS.hasOwnProperty(normalized)) {
    return normalized;
  }
  
  return undefined;
}

/**
 * Get appropriate pronoun for voice gender
 */
export function getVoicePronoun(voiceName: string, type: 'subject' | 'object' | 'possessive'): string {
  const characteristics = getVoiceCharacteristics(voiceName);
  if (!characteristics) {
    // Default to neutral if voice not found
    return type === 'subject' ? 'they' : type === 'object' ? 'them' : 'their';
  }
  
  switch (characteristics.gender) {
    case 'male':
      return type === 'subject' ? 'he' : type === 'object' ? 'him' : 'his';
    case 'female':
      return type === 'subject' ? 'she' : type === 'object' ? 'her' : 'her';
    case 'androgynous':
    default:
      return type === 'subject' ? 'they' : type === 'object' ? 'them' : 'their';
  }
}

/**
 * Get voice description for inclusion in prompts
 */
export function getVoiceDescription(voiceName: string): string {
  const characteristics = getVoiceCharacteristics(voiceName);
  if (!characteristics) {
    return 'an AI assistant';
  }
  
  const genderDesc = characteristics.gender === 'male' ? 'male' : 
                     characteristics.gender === 'female' ? 'female' : 
                     'neutral-sounding';
  
  return `an AI assistant with a ${genderDesc} voice (${characteristics.description})`;
}