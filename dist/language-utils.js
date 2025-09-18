/**
 * Language utilities for validating and handling ISO-639-1 language codes
 */
/**
 * Valid ISO-639-1 language codes supported by OpenAI Whisper
 * Based on OpenAI documentation for supported languages
 */
export const VALID_LANGUAGE_CODES = new Set([
    'af', // Afrikaans
    'ar', // Arabic
    'hy', // Armenian
    'az', // Azerbaijani
    'be', // Belarusian
    'bs', // Bosnian
    'bg', // Bulgarian
    'ca', // Catalan
    'zh', // Chinese
    'hr', // Croatian
    'cs', // Czech
    'da', // Danish
    'nl', // Dutch
    'en', // English
    'et', // Estonian
    'fi', // Finnish
    'fr', // French
    'gl', // Galician
    'de', // German
    'el', // Greek
    'he', // Hebrew
    'hi', // Hindi
    'hu', // Hungarian
    'is', // Icelandic
    'id', // Indonesian
    'it', // Italian
    'ja', // Japanese
    'kn', // Kannada
    'kk', // Kazakh
    'ko', // Korean
    'lv', // Latvian
    'lt', // Lithuanian
    'mk', // Macedonian
    'ms', // Malay
    'mr', // Marathi
    'mi', // Maori
    'ne', // Nepali
    'no', // Norwegian
    'fa', // Persian
    'pl', // Polish
    'pt', // Portuguese
    'ro', // Romanian
    'ru', // Russian
    'sr', // Serbian
    'sk', // Slovak
    'sl', // Slovenian
    'es', // Spanish
    'sw', // Swahili
    'sv', // Swedish
    'tl', // Tagalog
    'ta', // Tamil
    'th', // Thai
    'tr', // Turkish
    'uk', // Ukrainian
    'ur', // Urdu
    'vi', // Vietnamese
    'cy', // Welsh
]);
/**
 * Validates if a language code is a valid ISO-639-1 code supported by Whisper
 */
export function isValidLanguageCode(code) {
    if (!code)
        return false;
    return VALID_LANGUAGE_CODES.has(code.toLowerCase());
}
/**
 * Sanitizes and validates a language code
 * Returns the code if valid, undefined otherwise
 */
export function sanitizeLanguageCode(code) {
    if (!code)
        return undefined;
    const normalized = code.toLowerCase().trim();
    // Handle common variations
    if (normalized === 'english')
        return 'en';
    if (normalized === 'spanish')
        return 'es';
    if (normalized === 'french')
        return 'fr';
    if (normalized === 'german')
        return 'de';
    if (normalized === 'italian')
        return 'it';
    if (normalized === 'portuguese')
        return 'pt';
    if (normalized === 'russian')
        return 'ru';
    if (normalized === 'chinese' || normalized === 'mandarin')
        return 'zh';
    if (normalized === 'japanese')
        return 'ja';
    if (normalized === 'korean')
        return 'ko';
    if (normalized === 'arabic')
        return 'ar';
    if (normalized === 'dutch')
        return 'nl';
    // Return if valid ISO code
    if (isValidLanguageCode(normalized)) {
        return normalized;
    }
    // Extract potential ISO code from longer strings (e.g., "en-US" -> "en")
    const potentialCode = normalized.split(/[-_]/)[0];
    if (isValidLanguageCode(potentialCode)) {
        return potentialCode;
    }
    return undefined;
}
//# sourceMappingURL=language-utils.js.map