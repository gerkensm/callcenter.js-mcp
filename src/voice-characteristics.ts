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
  // Standard voices (less steerable, used in ChatGPT)
  nova: {
    name: 'nova',
    gender: 'female',
    generation: 'standard',
    description: 'Clear, bright feminine voice with excellent clarity',
    genderScale: 10,
    steerable: false
  },
  shimmer: {
    name: 'shimmer',
    gender: 'female',
    generation: 'standard',
    description: 'Warm, expressive feminine voice',
    genderScale: 7,
    steerable: false
  },
  fable: {
    name: 'fable',
    gender: 'androgynous',
    generation: 'standard',
    description: 'British-accented voice with neutral characteristics',
    genderScale: 6,
    steerable: false
  },
  onyx: {
    name: 'onyx',
    gender: 'male',
    generation: 'standard',
    description: 'Deep, authoritative masculine voice',
    genderScale: 1,
    steerable: false
  },
  
  // New generation voices (more adaptive and steerable)
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
    description: 'Neutral voice with good clarity and adaptability',
    genderScale: 5,
    steerable: true
  },
  ballad: {
    name: 'ballad',
    gender: 'female',
    generation: 'new',
    description: 'Warm, expressive feminine voice with emotional range',
    genderScale: 8,
    steerable: true
  },
  coral: {
    name: 'coral',
    gender: 'female',
    generation: 'new',
    description: 'Friendly, approachable feminine voice',
    genderScale: 8,
    steerable: true
  },
  sage: {
    name: 'sage',
    gender: 'androgynous',
    generation: 'new',
    description: 'Calm, measured voice with neutral characteristics',
    genderScale: 5,
    steerable: true
  },
  verse: {
    name: 'verse',
    gender: 'androgynous',
    generation: 'new',
    description: 'Versatile voice with good range and adaptability',
    genderScale: 6,
    steerable: true
  },
  
  // Latest voices (December 2024)
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
  },
  
  // Newest voices (2025)
  arbor: {
    name: 'arbor',
    gender: 'androgynous',
    generation: 'new',
    description: 'Easygoing and versatile voice',
    genderScale: 5,
    steerable: true
  },
  breeze: {
    name: 'breeze',
    gender: 'androgynous',
    generation: 'new',
    description: 'Animated and earnest voice',
    genderScale: 6,
    steerable: true
  },
  cove: {
    name: 'cove',
    gender: 'androgynous',
    generation: 'new',
    description: 'Composed and direct voice',
    genderScale: 4,
    steerable: true
  },
  ember: {
    name: 'ember',
    gender: 'female',
    generation: 'new',
    description: 'Confident and optimistic voice',
    genderScale: 7,
    steerable: true
  },
  juniper: {
    name: 'juniper',
    gender: 'female',
    generation: 'new',
    description: 'Open and upbeat voice',
    genderScale: 8,
    steerable: true
  },
  maple: {
    name: 'maple',
    gender: 'androgynous',
    generation: 'new',
    description: 'Cheerful and candid voice',
    genderScale: 6,
    steerable: true
  },
  sol: {
    name: 'sol',
    gender: 'androgynous',
    generation: 'new',
    description: 'Savvy and relaxed voice',
    genderScale: 5,
    steerable: true
  },
  spruce: {
    name: 'spruce',
    gender: 'male',
    generation: 'new',
    description: 'Calm and affirming voice',
    genderScale: 3,
    steerable: true
  },
  vale: {
    name: 'vale',
    gender: 'female',
    generation: 'new',
    description: 'Bright and inquisitive voice',
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