/**
 * Language utilities for validating and handling ISO-639-1 language codes
 */
/**
 * Valid ISO-639-1 language codes supported by OpenAI Whisper
 * Based on OpenAI documentation for supported languages
 */
export declare const VALID_LANGUAGE_CODES: Set<string>;
/**
 * Validates if a language code is a valid ISO-639-1 code supported by Whisper
 */
export declare function isValidLanguageCode(code: string | undefined): boolean;
/**
 * Sanitizes and validates a language code
 * Returns the code if valid, undefined otherwise
 */
export declare function sanitizeLanguageCode(code: string | undefined): string | undefined;
//# sourceMappingURL=language-utils.d.ts.map