/**
 * Tracks the correlation between text deltas and audio chunks for a response.
 * This allows us to truncate text accurately when audio playback is interrupted.
 *
 * The challenge: Text deltas arrive in generation time (fast), but we need to
 * truncate based on playback time (real-time). This class correlates the two.
 */
export declare class ResponseTranscriptTracker {
    private responseId;
    private textDeltas;
    private audioSegments;
    private totalAudioDurationMs;
    private debugInfo;
    constructor(responseId: string);
    addTextDelta(text: string): void;
    addAudioDelta(base64Audio: string, sampleRate?: number): void;
    /**
     * Get the transcript truncated at the playback position.
     * @param playedMs How many milliseconds of audio were actually played
     * @returns The text that corresponds to the played audio
     */
    getTruncatedTranscript(playedMs: number): string;
    getFullTranscript(): string;
    /**
     * Check if this response has any audio content
     */
    hasAudio(): boolean;
    /**
     * Get the total audio duration for this response
     */
    getTotalAudioDurationMs(): number;
    /**
     * Get truncated transcript with planned continuation info for clean display
     * @param playedMs How many milliseconds of audio were actually played
     * @returns Object with truncated text and planned continuation
     */
    getTruncatedWithPlanned(playedMs: number): {
        spoken: string;
        planned: string;
        fullText: string;
    };
    /**
     * Get debug statistics about this tracker
     */
    getDebugStats(): any;
    clear(): void;
}
//# sourceMappingURL=response-transcript-tracker.d.ts.map