import { getLogger } from './logger.js';
/**
 * Tracks the correlation between text deltas and audio chunks for a response.
 * This allows us to truncate text accurately when audio playback is interrupted.
 *
 * The challenge: Text deltas arrive in generation time (fast), but we need to
 * truncate based on playback time (real-time). This class correlates the two.
 */
export class ResponseTranscriptTracker {
    responseId;
    textDeltas = [];
    audioSegments = [];
    totalAudioDurationMs = 0;
    // Debug tracking
    debugInfo = {
        totalTextDeltas: 0,
        totalAudioChunks: 0,
        firstTextTime: 0,
        firstAudioTime: 0,
    };
    constructor(responseId) {
        this.responseId = responseId;
        getLogger().ai.debug(`Created tracker for response ${responseId}`, "AI");
    }
    addTextDelta(text) {
        if (this.textDeltas.length === 0) {
            this.debugInfo.firstTextTime = Date.now();
        }
        this.textDeltas.push(text);
        this.debugInfo.totalTextDeltas++;
        // Reduced logging: only log every 10th delta to reduce verbosity
        if (this.debugInfo.totalTextDeltas % 10 === 0) {
            getLogger().ai.verbose(`Text delta #${this.debugInfo.totalTextDeltas}: "${text}" (${text.length} chars)`, "AI");
        }
    }
    addAudioDelta(base64Audio, sampleRate = 24000) {
        if (this.audioSegments.length === 0) {
            this.debugInfo.firstAudioTime = Date.now();
        }
        // Calculate duration from base64 audio data
        // Base64 decoding: 4 chars = 3 bytes
        const audioBytes = Math.floor(base64Audio.length * 0.75);
        // PCM16 = 2 bytes per sample
        const samples = audioBytes / 2;
        // Duration in milliseconds
        const durationMs = (samples / sampleRate) * 1000;
        this.totalAudioDurationMs += durationMs;
        this.debugInfo.totalAudioChunks++;
        // Record which text delta was last received when this audio arrived
        const currentTextIndex = Math.max(0, this.textDeltas.length - 1);
        this.audioSegments.push({
            durationMs,
            cumulativeEndMs: this.totalAudioDurationMs,
            textIndexAtArrival: currentTextIndex
        });
        // Reduced logging: only log every 10th chunk to reduce verbosity
        if (this.debugInfo.totalAudioChunks % 10 === 0) {
            getLogger().ai.verbose(`Audio chunk #${this.debugInfo.totalAudioChunks}: ${durationMs.toFixed(1)}ms, ` +
                `total: ${this.totalAudioDurationMs.toFixed(1)}ms, ` +
                `text index: ${currentTextIndex}/${this.textDeltas.length}`, "AI");
        }
    }
    /**
     * Get the transcript truncated at the playback position.
     * @param playedMs How many milliseconds of audio were actually played
     * @returns The text that corresponds to the played audio
     */
    getTruncatedTranscript(playedMs) {
        getLogger().ai.debug(`Truncating transcript at ${playedMs.toFixed(1)}ms playback ` +
            `(total audio: ${this.totalAudioDurationMs.toFixed(1)}ms, ` +
            `text deltas: ${this.textDeltas.length})`, "AI");
        // Guard against division by zero and no audio correlation
        if (this.totalAudioDurationMs <= 0) {
            getLogger().ai.debug(`No audio correlation possible (total audio: ${this.totalAudioDurationMs}ms), ` +
                `returning full text`, "AI");
            return this.getFullTranscript();
        }
        // Find which audio segment was playing at interruption
        let textIndexLimit = -1;
        let segmentFound = false;
        for (let i = 0; i < this.audioSegments.length; i++) {
            const segment = this.audioSegments[i];
            if (playedMs <= segment.cumulativeEndMs) {
                textIndexLimit = segment.textIndexAtArrival;
                segmentFound = true;
                getLogger().ai.debug(`Found segment #${i + 1}: played ${playedMs.toFixed(1)}ms <= ` +
                    `segment end ${segment.cumulativeEndMs.toFixed(1)}ms, ` +
                    `using text index ${textIndexLimit}`, "AI");
                break;
            }
        }
        // If we found a segment, use its text index
        if (segmentFound && textIndexLimit >= 0) {
            const truncatedDeltas = this.textDeltas.slice(0, textIndexLimit + 1);
            const truncatedText = truncatedDeltas.join('');
            getLogger().ai.debug(`Truncated to ${truncatedDeltas.length}/${this.textDeltas.length} deltas: ` +
                `"${truncatedText.substring(0, 50)}${truncatedText.length > 50 ? '...' : ''}"`, "AI");
            return truncatedText;
        }
        // Fallback: proportional truncation (safe now that we've checked for zero)
        getLogger().ai.debug(`No exact segment match for ${playedMs.toFixed(1)}ms, using proportional truncation`, "AI");
        const playedFraction = Math.min(1, playedMs / this.totalAudioDurationMs);
        const fullText = this.textDeltas.join('');
        const truncateAt = Math.floor(fullText.length * playedFraction);
        // Snap to word/sentence boundary
        let snapPoint = truncateAt;
        const snapChars = ['.', '!', '?', ' ', ','];
        while (snapPoint > 0 && !snapChars.includes(fullText[snapPoint])) {
            snapPoint--;
        }
        // If we snapped too far back (more than 20 chars), use the original point
        if (truncateAt - snapPoint > 20) {
            snapPoint = truncateAt;
        }
        const truncatedText = fullText.substring(0, snapPoint).trim();
        getLogger().ai.info(`Proportional truncation at ${(playedFraction * 100).toFixed(1)}%: ` +
            `"${truncatedText.substring(0, 50)}${truncatedText.length > 50 ? '...' : ''}"`, "AI");
        return truncatedText;
    }
    getFullTranscript() {
        return this.textDeltas.join('');
    }
    /**
     * Check if this response has any audio content
     */
    hasAudio() {
        return this.totalAudioDurationMs > 0;
    }
    /**
     * Get the total audio duration for this response
     */
    getTotalAudioDurationMs() {
        return this.totalAudioDurationMs;
    }
    /**
     * Get truncated transcript with planned continuation info for clean display
     * @param playedMs How many milliseconds of audio were actually played
     * @returns Object with truncated text and planned continuation
     */
    getTruncatedWithPlanned(playedMs) {
        const truncatedText = this.getTruncatedTranscript(playedMs);
        const fullText = this.getFullTranscript();
        // Find what was planned but not spoken
        let plannedContinuation = '';
        if (truncatedText && fullText.length > truncatedText.length) {
            plannedContinuation = fullText.substring(truncatedText.length);
        }
        return {
            spoken: truncatedText,
            planned: plannedContinuation,
            fullText: fullText
        };
    }
    /**
     * Get debug statistics about this tracker
     */
    getDebugStats() {
        const textAudioLag = this.debugInfo.firstAudioTime - this.debugInfo.firstTextTime;
        return {
            responseId: this.responseId,
            textDeltas: this.debugInfo.totalTextDeltas,
            audioChunks: this.debugInfo.totalAudioChunks,
            totalAudioMs: this.totalAudioDurationMs.toFixed(1),
            textAudioLagMs: textAudioLag,
            fullTextLength: this.getFullTranscript().length,
            audioSegments: this.audioSegments.length
        };
    }
    clear() {
        this.textDeltas = [];
        this.audioSegments = [];
        this.totalAudioDurationMs = 0;
        getLogger().ai.debug(`Cleared tracker for response ${this.responseId}`, "AI");
    }
}
//# sourceMappingURL=response-transcript-tracker.js.map