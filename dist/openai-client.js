import WebSocket from "ws";
import { EventEmitter } from "events";
import { getLogger } from "./logger.js";
import * as fs from "fs";
import { Writer } from "wav";
import { ResponseTranscriptTracker } from "./response-transcript-tracker.js";
import { isValidLanguageCode } from "./language-utils.js";
export class OpenAIClient extends EventEmitter {
    ws = null;
    config;
    isConnected = false;
    onAudioCallback;
    onEndCallCallback;
    watchdogTimer = null;
    sawResponseCreated = false;
    pendingEndCall = null;
    wasGoodbyeInterrupted = false;
    openaiWavWriter = null;
    debugAudioFile = false;
    conversationItems = [];
    // New tracker system for accurate text/audio correlation
    responseTrackers = new Map();
    // Keep track of which responses are canceled for interruption handling
    canceledResponses = new Set();
    // Track current response ID for correlation
    currentResponseId = null;
    // Track which responses actually produced audio
    responseHasAudio = new Set();
    // Track accumulated user transcription from delta events
    currentUserTranscript = "";
    // Queue completed transcripts until audio finishes playing
    pendingTranscripts = new Map();
    // Map item_id to response_id for accurate truncation handling
    itemToResponseMap = new Map();
    // Track responses whose audio playback has completed before transcript was ready
    playbackCompleted = new Set();
    // Safety cleanup timers to prevent memory leaks
    cleanupTimers = new Map();
    perfStats = {
        eventProcessTimes: [],
        lastStatsLog: 0,
        conversationItems: 0,
    };
    constructor(config) {
        super();
        this.config = config;
        // Initialize WAV recording for OpenAI audio debugging
        if (this.debugAudioFile) {
            this.setupOpenAIWavRecording();
        }
    }
    setupWebSocketHandlers() {
        const logger = getLogger();
        if (!this.ws)
            return;
        // Handle WebSocket messages (all OpenAI Realtime API events)
        this.ws.on("message", (message) => {
            try {
                const event = JSON.parse(message.toString());
                const startTime = performance.now();
                // Track performance
                const processingTime = performance.now() - startTime;
                this.perfStats.eventProcessTimes.push(processingTime);
                if (this.perfStats.eventProcessTimes.length > 50) {
                    this.perfStats.eventProcessTimes.shift();
                }
                // Log stats every 30 seconds
                if (performance.now() - this.perfStats.lastStatsLog > 30000) {
                    this.logOpenAIPerformanceStats();
                    this.perfStats.lastStatsLog = performance.now();
                }
                // Handle different event types
                switch (event.type) {
                    case "session.created":
                        logger.ai.debug("Session created", "AI");
                        break;
                    case "session.updated":
                        logger.ai.debug("Session updated", "AI");
                        break;
                    case "response.audio.delta":
                        // Handle audio streaming from OpenAI
                        if (event.delta) {
                            // Mark that this response produced audio
                            if (event.response_id) {
                                this.responseHasAudio.add(event.response_id);
                            }
                            // Track audio delta in our tracker for correlation
                            if (event.response_id) {
                                const tracker = this.responseTrackers.get(event.response_id);
                                if (tracker) {
                                    // OpenAI Realtime uses 24kHz sample rate
                                    tracker.addAudioDelta(event.delta, 24000);
                                }
                            }
                            const audioBuffer = Buffer.from(event.delta, "base64");
                            const audioData = new Int16Array(audioBuffer.buffer, audioBuffer.byteOffset, audioBuffer.length / 2);
                            // Record raw OpenAI audio to WAV file for debugging
                            if (this.openaiWavWriter) {
                                const wavBuffer = Buffer.from(audioData.buffer, audioData.byteOffset, audioData.byteLength);
                                this.openaiWavWriter.write(wavBuffer);
                            }
                            if (this.onAudioCallback) {
                                // Pass the response_id along with audio data
                                this.onAudioCallback(audioData, event.response_id);
                            }
                        }
                        else {
                            logger.ai.warn("response.audio.delta event missing delta:", JSON.stringify(event));
                        }
                        break;
                    case "response.output_item.done":
                        logger.ai.debug(`output_item.done: ${event.item?.type}, name: ${event.item?.name}`, "AI");
                        // Map item_id to response_id for accurate truncation handling
                        if (event.item?.id && event.response_id) {
                            this.itemToResponseMap.set(event.item.id, event.response_id);
                            logger.ai.debug(`Mapped item ${event.item.id} to response ${event.response_id}`, "AI");
                        }
                        // Handle function calls - this is the key event for function execution
                        if (event.item?.type === "function_call" &&
                            event.item.name === "end_call") {
                            const args = event.item.arguments
                                ? JSON.parse(event.item.arguments)
                                : {};
                            const reason = args?.reason ?? "unknown";
                            logger.ai.info(`AI decided to end call: ${reason}`, "AI");
                            // Emit the reason so VoiceAgent can track it
                            this.emit("aiEndCallDecision", reason);
                            // Set flag to execute end_call after THIS specific response finishes streaming
                            this.pendingEndCall = { reason, responseId: event.response_id };
                            logger.ai.debug(`End call queued for response ${event.response_id}`, "AI");
                            // Send function call output back
                            this.send("conversation.item.create", {
                                item: {
                                    type: "function_call_output",
                                    call_id: event.item.call_id,
                                    output: `Call ended successfully. Reason: ${reason}`,
                                },
                            });
                            // Don't send response.create - call should end here
                        }
                        break;
                    case "response.function_call_arguments.delta":
                        logger.ai.debug(`Function call arguments delta: ${event.name} - ${event.delta}`, "AI");
                        break;
                    case "response.function_call_arguments.done":
                        logger.ai.debug(`Function call arguments done: ${event.name}, call_id: ${event.call_id}, args: ${event.arguments}`, "AI");
                        break;
                    case "input_audio_buffer.speech_started":
                        logger.ai.debug("Speech started (user is talking) - interrupting AI");
                        // Reset user transcript accumulation for new utterance
                        this.currentUserTranscript = "";
                        // Track if we're canceling a goodbye
                        const wasCancelingGoodbye = !!this.pendingEndCall;
                        // Only mark the actively playing response as interrupted
                        // We need to get this from AudioBridge via VoiceAgent
                        this.emit("getPlayingResponseId", (playingResponseId) => {
                            if (playingResponseId &&
                                this.responseTrackers.has(playingResponseId)) {
                                this.canceledResponses.add(playingResponseId);
                                logger.ai.debug(`Marked actively playing response ${playingResponseId} as interrupted`, "AI");
                                // Find the correct item ID for this response
                                let itemIdForPlaying = null;
                                for (const [itemId, respId] of this.itemToResponseMap) {
                                    if (respId === playingResponseId) {
                                        itemIdForPlaying = itemId;
                                        break;
                                    }
                                }
                                // Only truncate if we found the correct item
                                if (itemIdForPlaying) {
                                    // Get actual audio playback position from AudioBridge
                                    let audioEndMs = 0;
                                    this.emit("getPlaybackPosition", (position) => {
                                        audioEndMs = Math.max(0, position);
                                    });
                                    // Clamp audioEndMs to avoid "already shorter than" errors
                                    const tracker = this.responseTrackers.get(playingResponseId);
                                    if (tracker) {
                                        const requestedEndMs = audioEndMs; // Save original value for logging
                                        const totalMs = tracker.getTotalAudioDurationMs();
                                        if (totalMs > 0 && audioEndMs > totalMs) {
                                            audioEndMs = totalMs;
                                            logger.ai.debug(`Clamped audioEndMs from ${requestedEndMs}ms to ${totalMs}ms (total audio)`, "AI");
                                        }
                                    }
                                    logger.ai.debug(`Truncating item ${itemIdForPlaying} at ${audioEndMs}ms`, "AI");
                                    // Send truncate after getting position, then retrieve after server processing
                                    setTimeout(() => {
                                        this.send("conversation.item.truncate", {
                                            item_id: itemIdForPlaying,
                                            content_index: 0,
                                            audio_end_ms: audioEndMs,
                                        });
                                    }, 10);
                                    // Retrieve the item after truncation processing
                                    setTimeout(() => {
                                        this.send("conversation.item.retrieve", {
                                            item_id: itemIdForPlaying,
                                        });
                                    }, 1010);
                                }
                                else {
                                    logger.ai.debug(`Could not find item ID for playing response ${playingResponseId}, skipping truncation`, "AI");
                                }
                            }
                        });
                        // If end_call is pending, user is interrupting during goodbye
                        if (this.pendingEndCall) {
                            logger.ai.info("User interrupted during goodbye - canceling end_call and continuing conversation", "AI");
                            // Clear the pending end call since user wants to say something
                            this.pendingEndCall = null;
                            this.wasGoodbyeInterrupted = true;
                            // Also notify AudioBridge to cancel any pending callbacks
                            this.emit("cancelPendingEndCall");
                        }
                        // Cancel any ongoing response
                        this.send("response.cancel");
                        // Truncation is now handled in the getPlayingResponseId callback above
                        // This ensures we truncate the correct item for the currently playing response
                        // Stop audio bridge playback
                        logger.ai.debug("User interrupted - stopping audio playback", "AI");
                        this.emit("conversationInterrupted");
                        // If we canceled a goodbye, ensure we'll create a response after speech stops
                        if (wasCancelingGoodbye) {
                            // Force a slightly longer watchdog to ensure response creation
                            clearTimeout(this.watchdogTimer);
                            this.watchdogTimer = setTimeout(() => {
                                logger.ai.info("Creating response after goodbye interruption", "AI");
                                this.createResponse();
                            }, 800); // Give user time to finish speaking
                        }
                        break;
                    case "input_audio_buffer.speech_stopped":
                        logger.ai.debug("Speech stopped (user finished talking)");
                        // Only start watchdog if we don't already have one running (from goodbye interruption)
                        if (!this.watchdogTimer) {
                            this.startResponseWatchdog();
                        }
                        break;
                    case "conversation.interrupted":
                        logger.ai.debug("User interrupted - stopping current response", "AI");
                        this.emit("conversationInterrupted");
                        // Flush any accumulated user transcript during interruption
                        if (this.currentUserTranscript &&
                            this.currentUserTranscript.trim()) {
                            logger.transcript("user", this.currentUserTranscript.trim(), false);
                            this.currentUserTranscript = ""; // Reset for next user speech
                        }
                        // Create new response turn immediately when user interrupts
                        this.createResponse();
                        break;
                    case "response.created":
                        this.sawResponseCreated = true;
                        clearTimeout(this.watchdogTimer);
                        // Initialize transcript tracking for this response
                        const createdResponseId = event.response?.id;
                        if (createdResponseId) {
                            this.currentResponseId = createdResponseId;
                            const tracker = new ResponseTranscriptTracker(createdResponseId);
                            this.responseTrackers.set(createdResponseId, tracker);
                            logger.ai.debug(`Created tracker for response ${createdResponseId}`, "AI");
                        }
                        break;
                    case "response.audio_transcript.delta":
                        // Track transcript deltas as they come in
                        if (event.response_id && event.delta) {
                            const tracker = this.responseTrackers.get(event.response_id);
                            if (tracker) {
                                tracker.addTextDelta(event.delta);
                            }
                        }
                        break;
                    case "conversation.item.input_audio_transcription.delta":
                        // Accumulate user transcription deltas
                        if (!this.currentUserTranscript) {
                            this.currentUserTranscript = "";
                        }
                        this.currentUserTranscript += event.delta || "";
                        break;
                    case "conversation.item.input_audio_transcription.completed":
                        // Log the accumulated transcript
                        if (this.currentUserTranscript) {
                            logger.transcript("user", this.currentUserTranscript, false);
                            this.currentUserTranscript = ""; // Reset for next user speech
                        }
                        else if (event.transcript) {
                            logger.transcript("user", event.transcript, false);
                        }
                        break;
                    case "input_audio_buffer.transcription":
                        logger.ai.debug("Received transcription event", event);
                        if (event.transcript) {
                            logger.transcript("user", event.transcript, true);
                        }
                        break;
                    case "conversation.item.created":
                        logger.ai.debug("Conversation item created", event);
                        // Store conversation items for getConversationItems()
                        if (event.item) {
                            this.conversationItems.push(event.item);
                            // Map assistant items immediately when created
                            if (event.item.role === "assistant" && event.item.id) {
                                // Try to map to current response if available
                                if (this.currentResponseId) {
                                    this.itemToResponseMap.set(event.item.id, this.currentResponseId);
                                    logger.ai.debug(`Early mapped item ${event.item.id} to response ${this.currentResponseId}`, "AI");
                                }
                            }
                        }
                        // Handle function calls
                        if (event.item?.type === "function_call") {
                            logger.ai.debug(`Function call created: ${event.item.name}`, "AI");
                            if (event.item.name === "end_call") {
                                logger.ai.info(`AI ending call`, "AI");
                            }
                        }
                        // Handle user audio content transcripts
                        if (event.item?.role === "user" && event.item.content) {
                            const content = event.item.content;
                            if (Array.isArray(content)) {
                                content.forEach((c) => {
                                    if (c.type === "input_audio" && c.transcript) {
                                        logger.transcript("user", c.transcript, false);
                                    }
                                });
                            }
                            else if (content.type === "input_audio" && content.transcript) {
                                logger.transcript("user", content.transcript, false);
                            }
                        }
                        break;
                    case "response.audio_transcript.done":
                        // We get the full transcript here, but we don't log it yet
                        // We'll log in response.done (for completed) or conversation.item.truncated (for interrupted)
                        if (event.transcript && event.response_id) {
                            logger.ai.debug(`Full transcript available for response ${event.response_id}`, "AI");
                        }
                        break;
                    case "response.text.delta":
                        // Handle text deltas for text-only responses
                        if (event.response_id && event.delta) {
                            const tracker = this.responseTrackers.get(event.response_id);
                            if (tracker) {
                                tracker.addTextDelta(event.delta);
                            }
                        }
                        break;
                    case "response.text.done":
                        // Handle text-only responses (fallback when no audio is generated)
                        if (event.text && event.response_id) {
                            logger.ai.debug(`Text response done for ${event.response_id}`, "AI");
                            const tracker = this.responseTrackers.get(event.response_id);
                            if (tracker) {
                                // If this is a text-only response (no audio), log immediately
                                if (!tracker.hasAudio()) {
                                    const fullText = tracker.getFullTranscript() || event.text;
                                    if (fullText) {
                                        logger.transcript("assistant", fullText, false);
                                        logger.ai.debug(`Logged text-only response ${event.response_id} immediately`, "AI");
                                        this.cleanupResponse(event.response_id);
                                    }
                                }
                                else {
                                    // Has audio, queue for playback completion as usual
                                    const fullText = tracker.getFullTranscript() || event.text;
                                    if (fullText &&
                                        !this.pendingTranscripts.has(event.response_id)) {
                                        this.pendingTranscripts.set(event.response_id, fullText);
                                        logger.ai.debug(`Queued transcript for audio response ${event.response_id}`, "AI");
                                    }
                                }
                            }
                        }
                        break;
                    case "response.done":
                        // Note: response.done uses event.response.id not event.response_id
                        {
                            const rid = event.response?.id || event.response_id;
                            // If this response contains an end_call and there was NO audio generated,
                            // we should end immediately (no need to wait for playback).
                            if (this.pendingEndCall &&
                                this.pendingEndCall.responseId === rid) {
                                const hadAudio = this.responseHasAudio.has(rid);
                                if (!hadAudio) {
                                    // Try to log any transcript we already have, otherwise mark for later flush
                                    const tracker = this.responseTrackers.get(rid);
                                    const fullText = (tracker && tracker.getFullTranscript()) ||
                                        this.pendingTranscripts.get(rid);
                                    if (fullText && fullText.trim().length > 0) {
                                        getLogger().transcript("assistant", fullText, false);
                                        this.pendingTranscripts.delete(rid);
                                    }
                                    else {
                                        // No transcript yet; mark playback as completed so when text arrives,
                                        // logQueuedTranscript() will flush it immediately.
                                        this.playbackCompleted.add(rid);
                                    }
                                    // Execute end_call right now (no audio expected)
                                    this.executePendingEndCall();
                                }
                                // If there WAS audio, fall through to normal handling below
                            }
                        }
                        // Note: response.done uses event.response.id not event.response_id
                        const responseId = event.response?.id || event.response_id;
                        logger.ai.debug(`Response completed: ${responseId}`, "AI");
                        // Handle response completion based on whether it has audio
                        const tracker = this.responseTrackers.get(responseId);
                        if (tracker && !this.canceledResponses.has(responseId)) {
                            const fullTranscript = tracker.getFullTranscript();
                            if (fullTranscript) {
                                // If playback already finished earlier, log immediately now
                                if (this.playbackCompleted.has(responseId)) {
                                    this.pendingTranscripts.set(responseId, fullTranscript);
                                    this.logQueuedTranscript(responseId);
                                    break;
                                }
                                // If text-only response, log immediately
                                if (!tracker.hasAudio()) {
                                    logger.transcript("assistant", fullTranscript, false);
                                    logger.ai.debug(`Logged text-only response ${responseId} immediately on response.done`, "AI");
                                    this.cleanupResponse(responseId);
                                }
                                else {
                                    // Has audio, queue transcript to be logged when audio finishes playing
                                    this.pendingTranscripts.set(responseId, fullTranscript);
                                    // Emit event so VoiceAgent can set up transcript logging callback
                                    this.emit("responseGenerated", responseId);
                                }
                            }
                        }
                        else if (this.canceledResponses.has(responseId)) {
                            // This response was interrupted - will be logged in truncation handler
                            logger.ai.debug(`Skipping interrupted response ${responseId}`, "AI");
                        }
                        // If playback already finished but transcript wasn't ready, try to flush now
                        if (responseId && this.playbackCompleted.has(responseId)) {
                            logger.ai.debug(`Playback finished earlier; flushing transcript for ${responseId} on response.done`, "AI");
                            this.logQueuedTranscript(responseId);
                        }
                        // Only set up safety cleanup timer for responses that still need it
                        if (tracker &&
                            tracker.hasAudio() &&
                            !this.canceledResponses.has(responseId)) {
                            this.scheduleSafetyCleanup(responseId, 120000); // 2 minutes safety timeout
                        }
                        // Execute pending end_call only if THIS is the response that contains the end_call
                        if (this.pendingEndCall &&
                            this.pendingEndCall.responseId === responseId) {
                            logger.ai.debug(`Goodbye message generated, waiting for audio to finish playing`, "AI");
                            // Emit event to notify that this response needs to finish playing before ending
                            this.emit("responseWithEndCallComplete", responseId);
                        }
                        break;
                    case "response.canceled":
                        logger.ai.debug(`Response canceled event received`, "AI");
                        // Clear any pending end call if response was canceled
                        this.pendingEndCall = null;
                        break;
                    case "conversation.item.truncated":
                        // Extract the actual playback position and item ID
                        const playedMs = event.audio_end_ms || 0;
                        const playedSeconds = playedMs / 1000;
                        const itemId = event.item?.id;
                        logger.ai.debug(`Assistant message truncated at ${playedSeconds.toFixed(2)}s playback for item ${itemId}`, "AI");
                        // Find the correct response using item_id mapping first
                        let foundInterrupted = false;
                        if (itemId) {
                            const responseId = this.itemToResponseMap.get(itemId);
                            if (responseId && this.canceledResponses.has(responseId)) {
                                const tracker = this.responseTrackers.get(responseId);
                                if (tracker) {
                                    // Get the truncated transcript with planned continuation
                                    const result = tracker.getTruncatedWithPlanned(playedMs);
                                    if (result.spoken) {
                                        // Create clean interrupted transcript format
                                        const truncTime = playedSeconds.toFixed(1);
                                        let cleanMessage = result.spoken;
                                        // Add concise interruption info
                                        cleanMessage += ` [interrupted by user here, after ${truncTime} sec.]`;
                                        logger.transcript("assistant", cleanMessage, false);
                                        // Log planned continuation separately as info (not in transcript)
                                        if (result.planned) {
                                            const plannedClean = result.planned
                                                .replace(/\n/g, " ")
                                                .replace(/"/g, "'")
                                                .trim();
                                            logger.ai.info(`Assistant planned to continue: "${plannedClean}" (not spoken)`, "AI");
                                        }
                                    }
                                    else {
                                        logger.ai.debug(`No transcript available for interrupted response ${responseId}`, "AI");
                                    }
                                    // Clean up immediately after logging truncated transcript
                                    this.cleanupResponse(responseId);
                                    foundInterrupted = true;
                                }
                            }
                        }
                        // Fallback: scan all canceled responses if item mapping failed
                        if (!foundInterrupted) {
                            logger.ai.debug(`No item mapping found for ${itemId}, scanning canceled responses`, "AI");
                            for (const [responseId, tracker] of this.responseTrackers) {
                                if (this.canceledResponses.has(responseId)) {
                                    const result = tracker.getTruncatedWithPlanned(playedMs);
                                    if (result.spoken) {
                                        const truncTime = playedSeconds.toFixed(1);
                                        let cleanMessage = result.spoken;
                                        cleanMessage += ` [interrupted by user here, after ${truncTime} sec.]`;
                                        logger.transcript("assistant", cleanMessage, false);
                                        if (result.planned) {
                                            const plannedClean = result.planned
                                                .replace(/\n/g, " ")
                                                .replace(/"/g, "'")
                                                .trim();
                                            logger.ai.info(`Assistant planned to continue: "${plannedClean}" (not spoken)`, "AI");
                                        }
                                    }
                                    this.cleanupResponse(responseId);
                                    foundInterrupted = true;
                                    break;
                                }
                            }
                        }
                        if (!foundInterrupted) {
                            logger.ai.debug(`No canceled response found for truncation event`, "AI");
                        }
                        break;
                    case "conversation.item.retrieved":
                        // For debugging purposes only
                        logger.ai.debug(`Retrieved conversation item: ${event.item?.id}`, "AI");
                        break;
                    case "response.failed":
                        logger.ai.error(`Response failed: ${JSON.stringify(event)}`, "AI");
                        // Clear any pending end call if response failed
                        this.pendingEndCall = null;
                        break;
                    case "error":
                        // Don't log "Cancellation failed" as error - it's expected when user interrupts
                        if (event.error?.message?.includes("Cancellation failed")) {
                            logger.ai.debug("Response cancellation attempted but no active response", "AI");
                        }
                        else {
                            logger.ai.error("Realtime API error:", event.error);
                            // Handle truncation errors by logging fallback transcript
                            if (event.error?.message?.includes("Audio content of") &&
                                event.error?.message?.includes("is already shorter than")) {
                                logger.ai.debug("Truncation failed - logging fallback transcript", "AI");
                                // Find the currently playing response and log its transcript
                                this.emit("getPlayingResponseId", (playingResponseId) => {
                                    if (playingResponseId &&
                                        this.canceledResponses.has(playingResponseId)) {
                                        const tracker = this.responseTrackers.get(playingResponseId);
                                        if (tracker) {
                                            // Use a safe truncation point based on tracker's total audio
                                            const totalMs = tracker.getTotalAudioDurationMs();
                                            const safeMs = Math.min(1000, totalMs); // Use smaller of 1s or total audio
                                            const result = tracker.getTruncatedWithPlanned(safeMs);
                                            if (result.spoken) {
                                                const truncTime = (safeMs / 1000).toFixed(1);
                                                let cleanMessage = result.spoken;
                                                cleanMessage += ` [interrupted by user here, after ${truncTime} sec.]`;
                                                logger.transcript("assistant", cleanMessage, false);
                                                if (result.planned) {
                                                    const plannedClean = result.planned
                                                        .replace(/\n/g, " ")
                                                        .replace(/"/g, "'")
                                                        .trim();
                                                    logger.ai.info(`Assistant planned to continue: "${plannedClean}" (not spoken)`, "AI");
                                                }
                                            }
                                            else {
                                                // Fallback: log whatever text we have
                                                const fullText = tracker.getFullTranscript();
                                                if (fullText) {
                                                    logger.transcript("assistant", `${fullText} [interrupted by user]`, false);
                                                }
                                            }
                                            this.cleanupResponse(playingResponseId);
                                        }
                                    }
                                });
                            }
                        }
                        break;
                    default:
                        // Log function-related events at debug level
                        if (event.type.includes("function") ||
                            event.type.includes("tool") ||
                            event.type.includes("call")) {
                            logger.ai.debug(`Function Event: ${event.type}`, "AI");
                        }
                        // Log other response events that might contain function calls
                        else if (event.type.includes("response") &&
                            !event.type.includes("audio")) {
                            const eventStr = JSON.stringify(event, null, 2);
                            if (eventStr.includes("end_call") ||
                                eventStr.includes("function") ||
                                eventStr.includes("tool")) {
                                logger.ai.debug(`Found function data in response event: ${event.type}`, "AI");
                            }
                        }
                        // Log other conversation events
                        else if (event.type.includes("conversation")) {
                            logger.ai.debug(`Conversation Event: ${event.type}`, "AI");
                        }
                        // Log everything else at verbose level
                        else {
                            logger.ai.verbose(`Event: ${event.type}`, "AI");
                        }
                        break;
                }
            }
            catch (error) {
                logger.ai.error("Error parsing WebSocket message:", error);
            }
        });
        this.ws.on("open", () => {
            logger.ai.debug("WebSocket connection opened", "AI");
            this.isConnected = true;
            this.setupSession();
        });
        this.ws.on("close", () => {
            logger.ai.debug("WebSocket connection closed", "AI");
            this.isConnected = false;
        });
        this.ws.on("error", (error) => {
            logger.ai.error("WebSocket error:", error);
        });
    }
    async connect() {
        if (this.isConnected)
            return;
        try {
            const url = "wss://api.openai.com/v1/realtime?model=gpt-realtime";
            // Create WebSocket with proper authentication headers
            this.ws = new WebSocket(url, [], {
                finishRequest: (request) => {
                    request.setHeader("Authorization", `Bearer ${this.config.openaiApiKey}`);
                    request.setHeader("OpenAI-Beta", "realtime=v1");
                    request.end();
                },
            });
            // Setup WebSocket event handlers
            this.setupWebSocketHandlers();
            // Wait for connection to open
            await new Promise((resolve, reject) => {
                const connectionErrorHandler = (error) => {
                    this.disconnect();
                    reject(new Error(`Could not connect to OpenAI Realtime API: ${error.message}`));
                };
                this.ws.on("error", connectionErrorHandler);
                this.ws.on("open", () => {
                    getLogger().ai.debug("Connected to OpenAI Realtime API", "AI");
                    this.ws.removeListener("error", connectionErrorHandler);
                    this.isConnected = true;
                    resolve();
                });
            });
        }
        catch (error) {
            getLogger().ai.error("Failed to connect to OpenAI:", error);
            throw error;
        }
    }
    setupSession() {
        if (!this.isConnected || !this.ws)
            return;
        // Build transcription config, only including language if valid
        const transcriptionConfig = { model: "whisper-1" };
        if (this.config.language && isValidLanguageCode(this.config.language)) {
            transcriptionConfig.language = this.config.language;
            getLogger().ai.debug(`Using language '${this.config.language}' for transcription`);
        }
        else if (this.config.language) {
            getLogger().ai.warn(`Invalid language code '${this.config.language}' - letting Whisper auto-detect`);
        }
        // Send session.update with all configuration including tools
        this.send("session.update", {
            session: {
                instructions: this.config.instructions,
                voice: this.config.voice || "marin",
                turn_detection: { type: "server_vad" },
                input_audio_transcription: transcriptionConfig,
                modalities: ["text", "audio"],
                input_audio_format: "pcm16",
                output_audio_format: "pcm16",
                temperature: 0.8,
                tool_choice: "auto",
                tools: [
                    {
                        type: "function",
                        name: "end_call",
                        description: "End the phone call immediately when requested or when conversation is complete",
                        parameters: {
                            type: "object",
                            properties: {
                                reason: {
                                    type: "string",
                                    description: "Reason for ending call",
                                },
                            },
                            required: [],
                        },
                    },
                ],
            },
        });
        getLogger().ai.debug("Session configured with tools", "AI");
    }
    async disconnect() {
        if (!this.isConnected)
            return;
        try {
            if (this.ws) {
                this.ws.close();
                this.ws = null;
            }
            this.isConnected = false;
            // Close WAV writer for OpenAI audio
            if (this.openaiWavWriter) {
                this.openaiWavWriter.end();
                this.openaiWavWriter = null;
                getLogger().ai.debug("OpenAI audio saved to openai-audio-*.wav");
            }
            getLogger().ai.debug("Disconnected from OpenAI Realtime API");
        }
        catch (error) {
            getLogger().ai.error("Error disconnecting from OpenAI:", error);
        }
    }
    // Send message to OpenAI WebSocket
    send(eventName, data = {}) {
        if (!this.isConnected || !this.ws) {
            throw new Error("Not connected to OpenAI Realtime API");
        }
        const event = {
            event_id: this.generateEventId(),
            type: eventName,
            ...data,
        };
        this.ws.send(JSON.stringify(event));
    }
    // Generate unique event ID
    generateEventId() {
        const chars = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
        const length = 21;
        const str = Array(length - 4)
            .fill(0)
            .map(() => chars[Math.floor(Math.random() * chars.length)])
            .join("");
        return `evt_${str}`;
    }
    sendAudio(audioData) {
        if (!this.isConnected) {
            getLogger().ai.warn("Cannot send audio: not connected to OpenAI");
            return;
        }
        // Don't send audio if end_call is pending - let current response finish
        if (this.pendingEndCall) {
            getLogger().ai.debug("Blocking audio input - end_call is pending");
            return;
        }
        try {
            // Convert audio data to base64
            const base64Audio = this.arrayBufferToBase64(audioData);
            this.send("input_audio_buffer.append", {
                audio: base64Audio,
            });
        }
        catch (error) {
            getLogger().ai.error("Error sending audio to OpenAI:", error);
        }
    }
    // Utility to convert ArrayBuffer/Int16Array to base64
    arrayBufferToBase64(arrayBuffer) {
        if (arrayBuffer instanceof Int16Array) {
            arrayBuffer = arrayBuffer.buffer;
        }
        let binary = "";
        const bytes = new Uint8Array(arrayBuffer);
        const chunkSize = 0x1000; // 4KB chunk size for lower latency
        for (let i = 0; i < bytes.length; i += chunkSize) {
            const chunk = bytes.subarray(i, i + chunkSize);
            binary += String.fromCharCode.apply(null, Array.from(chunk));
        }
        return btoa(binary);
    }
    sendText(text) {
        if (!this.isConnected) {
            getLogger().ai.warn("Cannot send text: not connected to OpenAI");
            return;
        }
        try {
            getLogger().ai.debug(`Sending text to OpenAI: "${text}"`);
            // Create conversation item with text content
            this.send("conversation.item.create", {
                item: {
                    type: "message",
                    role: "user",
                    content: [{ type: "input_text", text }],
                },
            });
            // Request response generation
            this.createResponse();
        }
        catch (error) {
            getLogger().ai.error("Error sending text to OpenAI:", error);
        }
    }
    createResponse() {
        if (!this.isConnected) {
            getLogger().ai.warn("Cannot create response: not connected to OpenAI");
            return;
        }
        try {
            getLogger().ai.debug("Creating response with tools included", "AI");
            // If we're recovering from a goodbye interruption, add context
            let instructions = this.config.instructions;
            if (this.wasGoodbyeInterrupted) {
                instructions =
                    "The user interrupted your goodbye. They want to continue the conversation. Listen to what they have to say and respond appropriately. " +
                        instructions;
                this.wasGoodbyeInterrupted = false; // Reset flag
            }
            // Send response.create with tools included to ensure function calling works
            this.send("response.create", {
                response: {
                    modalities: ["text", "audio"],
                    instructions: instructions,
                    tool_choice: "auto",
                    tools: [
                        {
                            type: "function",
                            name: "end_call",
                            description: "End the phone call immediately when requested or when conversation is complete",
                            parameters: {
                                type: "object",
                                properties: {
                                    reason: {
                                        type: "string",
                                        description: "Reason for ending call",
                                    },
                                },
                                required: [],
                            },
                        },
                    ],
                },
            });
        }
        catch (error) {
            getLogger().ai.error("Error creating response:", error);
        }
    }
    onAudioReceived(callback) {
        this.onAudioCallback = callback;
    }
    onEndCall(callback) {
        this.onEndCallCallback = callback;
    }
    getConversationItems() {
        return this.conversationItems;
    }
    isReady() {
        return this.isConnected;
    }
    setupOpenAIWavRecording() {
        try {
            const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
            // WAV format: 24kHz, 16-bit, mono (OpenAI's output format)
            const wavOptions = {
                sampleRate: 24000,
                channels: 1,
                bitDepth: 16,
            };
            // Create WAV file for OpenAI audio debugging
            const openaiFile = fs.createWriteStream(`openai-audio-${timestamp}.wav`);
            this.openaiWavWriter = new Writer(wavOptions);
            this.openaiWavWriter.pipe(openaiFile);
        }
        catch (error) {
            getLogger().ai.error("Failed to setup OpenAI WAV recording:", error);
        }
    }
    /**
     * Log a queued transcript when audio playback finishes
     */
    logQueuedTranscript(responseId) {
        const transcript = this.pendingTranscripts.get(responseId);
        if (transcript && transcript.trim().length > 0) {
            // We finally have the transcript and playback finished (either now or earlier)
            getLogger().transcript("assistant", transcript, false);
            this.pendingTranscripts.delete(responseId);
            this.playbackCompleted.delete(responseId);
            this.cleanupResponse(responseId);
            return;
        }
        // Transcript not ready yet: mark playback completed so we can log when it arrives
        if (!this.playbackCompleted.has(responseId)) {
            getLogger().ai.debug(`Playback completed before transcript ready for ${responseId} - will log on response.done`, "AI");
            this.playbackCompleted.add(responseId);
        }
        // Optionally, as a fallback if the response is text-only and already fully accumulated in the tracker:
        const tracker = this.responseTrackers.get(responseId);
        if (tracker && !tracker.hasAudio()) {
            const full = tracker.getFullTranscript();
            if (full && full.trim().length > 0) {
                this.pendingTranscripts.set(responseId, full);
                this.logQueuedTranscript(responseId);
            }
        }
    }
    /**
     * Schedule a safety cleanup timer to prevent memory leaks
     */
    scheduleSafetyCleanup(responseId, timeoutMs) {
        // Cancel any existing timer for this response
        const existingTimer = this.cleanupTimers.get(responseId);
        if (existingTimer) {
            clearTimeout(existingTimer);
        }
        // Set up new safety timer
        const timer = setTimeout(() => {
            getLogger().ai.debug(`Safety cleanup triggered for response ${responseId}`, "AI");
            this.cleanupResponse(responseId);
        }, timeoutMs);
        this.cleanupTimers.set(responseId, timer);
    }
    /**
     * Clean up tracking data for a response
     */
    cleanupResponse(responseId) {
        // Cancel safety cleanup timer
        const timer = this.cleanupTimers.get(responseId);
        if (timer) {
            clearTimeout(timer);
            this.cleanupTimers.delete(responseId);
        }
        // Clean up all tracking data
        this.responseTrackers.delete(responseId);
        this.canceledResponses.delete(responseId);
        this.playbackCompleted.delete(responseId);
        this.responseHasAudio.delete(responseId);
        this.pendingTranscripts.delete(responseId);
        // Clean up item mapping (scan and remove entries pointing to this response)
        for (const [itemId, mappedResponseId] of this.itemToResponseMap) {
            if (mappedResponseId === responseId) {
                this.itemToResponseMap.delete(itemId);
            }
        }
        getLogger().ai.debug(`Cleaned up tracking data for response ${responseId}`, "AI");
    }
    startResponseWatchdog() {
        clearTimeout(this.watchdogTimer);
        this.sawResponseCreated = false;
        this.watchdogTimer = setTimeout(() => {
            if (this.sawResponseCreated)
                return;
            getLogger().ai.debug("Server did not start turn, forcing response.create", "AI");
            // Server hasn't started a turn → create response with tools included
            this.createResponse();
        }, 400); // 400ms is enough to detect if server will start a turn
    }
    forceEndCallTurn(reason = "user_request") {
        getLogger().ai.debug(`Forcing end call turn with reason: ${reason}`, "AI");
        // Cancel current output
        this.send("response.cancel");
        // Force tool-only turn with explicit tools (don't rely on session)
        this.send("response.create", {
            response: {
                modalities: ["text"],
                instructions: "End the call now by calling the end_call tool. Output nothing else.",
                tool_choice: "required",
                tools: [
                    {
                        type: "function",
                        name: "end_call",
                        description: "Immediately end the current phone call when appropriate, specifying the reason for ending the call.",
                        parameters: {
                            type: "object",
                            properties: {
                                reason: {
                                    type: "string",
                                    description: "Reason for ending the call (e.g. conversation_complete, user_request, task_accomplished)",
                                },
                            },
                            required: [],
                        },
                    },
                ],
            },
        });
        // Safety timer → hang up locally if tool doesn't arrive
        let done = false;
        const timer = setTimeout(() => {
            if (!done) {
                getLogger().ai.info("Safety latch: ending call locally (no tool_call in 1200ms)", "AI");
                this.onEndCallCallback?.();
            }
        }, 1200);
        // Listen for response.done to clear the timer
        const checkDone = () => {
            done = true;
            clearTimeout(timer);
        };
        // Set a flag to check for function call completion
        this.once("functionCallExecuted", checkDone);
    }
    executePendingEndCall() {
        if (this.pendingEndCall) {
            getLogger().ai.debug(`Executing pending end_call: ${this.pendingEndCall.reason}`, "AI");
            this.executeEndCallFunction(this.pendingEndCall.reason);
            this.pendingEndCall = null;
        }
    }
    executeEndCallFunction(reason) {
        getLogger().ai.debug(`Executing end_call function`, "AI");
        // Execute the actual end call callback
        if (this.onEndCallCallback) {
            this.onEndCallCallback();
        }
        // Emit event for forceEndCallTurn timer cleanup
        this.emit("functionCallExecuted");
        // Return success result
        return `Call ended successfully. Reason: ${reason}`;
    }
    logOpenAIPerformanceStats() {
        const times = this.perfStats.eventProcessTimes;
        if (times.length === 0)
            return;
        const avg = times.reduce((a, b) => a + b) / times.length;
        const max = Math.max(...times);
        const conversationItems = this.getConversationItems().length;
        getLogger().perf.verbose(`OpenAI Event Stats (last ${times.length} events):`);
        getLogger().perf.verbose(`   Avg processing: ${avg.toFixed(2)}ms | Max: ${max.toFixed(2)}ms`);
        getLogger().perf.verbose(`   Conversation items: ${conversationItems}`);
        this.perfStats.conversationItems = conversationItems;
    }
}
//# sourceMappingURL=openai-client.js.map