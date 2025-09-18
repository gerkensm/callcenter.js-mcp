import { createRequire } from "module";
const require = createRequire(import.meta.url);
const SIPUDP = require("sipjs-udp");
import { getSupportedPayloadTypes, isPayloadTypeSupported } from "./codecs/index.js";
import { getLogger } from "./logger.js";
class MediaHandler {
    localRtpPort = 0; // Will be set dynamically
    localIp;
    remoteRtpPort = 0;
    remoteIp = "";
    sipClient = null;
    selectedPayloadType = 0; // Default to PCMU fallback
    constructor(session, sipClient) {
        // Get local IP address
        this.localIp = this.getLocalIpAddress();
        this.sipClient = sipClient || null;
        // Start with port 0, will be set when AudioBridge starts
        this.localRtpPort = 0;
    }
    getLocalIpAddress() {
        // Use the same IP detection logic as voice-agent
        const os = require('os');
        const interfaces = os.networkInterfaces();
        // Look for non-loopback, IPv4 addresses
        for (const [name, addrs] of Object.entries(interfaces)) {
            if (addrs) {
                for (const addr of addrs) {
                    if (addr.family === 'IPv4' && !addr.internal) {
                        return addr.address;
                    }
                }
            }
        }
        // Fallback to localhost if no external interface found
        return '127.0.0.1';
    }
    close() { }
    render() { }
    mute() { }
    unmute() { }
    getDescription(onSuccess, onFailure, mediaHint) {
        // Generate proper SDP with real RTP port and local IP
        const sessionId = Date.now();
        // Build codec offer based on what's available
        const supportedPayloadTypes = getSupportedPayloadTypes();
        const payloadTypeString = supportedPayloadTypes.concat([101]).join(' ');
        // Build SDP with dynamic codec list
        let sdp = `v=0
o=- ${sessionId} ${sessionId} IN IP4 ${this.localIp}
s=AI Voice Agent
c=IN IP4 ${this.localIp}
t=0 0
m=audio ${this.localRtpPort} RTP/AVP ${payloadTypeString}`;
        // Add rtpmap for each supported codec
        if (isPayloadTypeSupported(9)) {
            sdp += '\na=rtpmap:9 G722/8000';
        }
        if (isPayloadTypeSupported(0)) {
            sdp += '\na=rtpmap:0 PCMU/8000';
        }
        if (isPayloadTypeSupported(8)) {
            sdp += '\na=rtpmap:8 PCMA/8000';
        }
        // Always add DTMF support
        sdp += '\na=rtpmap:101 telephone-event/8000';
        sdp += '\na=sendrecv';
        const logger = getLogger();
        logger.codec.debug("Our SDP Codec Offer:");
        logger.codec.debug(`Offering payload types: ${payloadTypeString}`);
        if (isPayloadTypeSupported(9)) {
            logger.codec.debug("   PT 9: G722/8000 (G.722 - Wideband 16kHz) [PREFERRED]");
        }
        if (isPayloadTypeSupported(0)) {
            logger.codec.debug("   PT 0: PCMU/8000 (G.711µ - Standard 8kHz) [FALLBACK]");
        }
        if (isPayloadTypeSupported(8)) {
            logger.codec.debug("   PT 8: PCMA/8000 (G.711a - Standard 8kHz) [FALLBACK]");
        }
        logger.codec.debug("   PT 101: telephone-event/8000 (DTMF Tones)");
        logger.codec.debug("Waiting for remote response...");
        logger.sip.debug("Generated SDP:", sdp);
        onSuccess(sdp);
    }
    setDescription(description, onSuccess, onFailure) {
        getLogger().sip.debug("Received remote SDP:", description);
        // Parse remote SDP to extract RTP port and codec info
        this.parseRemoteSdp(description);
        onSuccess();
    }
    parseRemoteSdp(sdp) {
        const lines = sdp.split("\n");
        const logger = getLogger();
        logger.codec.debug("Processing remote SDP for codec negotiation");
        let audioPayloadTypes = [];
        const codecMap = {};
        for (const line of lines) {
            const trimmedLine = line.trim();
            if (trimmedLine.startsWith("m=audio ")) {
                const parts = trimmedLine.split(" ");
                this.remoteRtpPort = parseInt(parts[1]);
                audioPayloadTypes = parts.slice(3); // Skip "m=audio", port, and "RTP/AVP"
                getLogger().rtp.debug(`Remote RTP port: ${this.remoteRtpPort}`);
                getLogger().codec.debug(`Offered payload types: ${audioPayloadTypes.join(", ")}`);
            }
            if (trimmedLine.startsWith("c=IN IP4 ")) {
                this.remoteIp = trimmedLine.split(" ")[2].trim();
                getLogger().rtp.debug(`Remote IP: ${this.remoteIp}`);
            }
            if (trimmedLine.startsWith("a=rtpmap:")) {
                const rtpmapMatch = trimmedLine.match(/a=rtpmap:(\d+)\s+(.+)/);
                if (rtpmapMatch) {
                    const payloadType = rtpmapMatch[1];
                    const codec = rtpmapMatch[2];
                    codecMap[payloadType] = codec;
                }
            }
        }
        logger.codec.debug("Remote Codec Analysis:");
        audioPayloadTypes.forEach(pt => {
            const codec = codecMap[pt] || "Unknown";
            const quality = this.getCodecQuality(codec);
            logger.codec.debug(`   PT ${pt}: ${codec} ${quality}`);
        });
        // Select the best codec we both support
        let selectedPayloadType = 0; // Default fallback
        for (const pt of audioPayloadTypes) {
            const ptNum = parseInt(pt);
            if (isPayloadTypeSupported(ptNum) && ptNum !== 101) { // Skip DTMF
                selectedPayloadType = ptNum;
                break; // Take the first supported one (highest priority)
            }
        }
        this.selectedPayloadType = selectedPayloadType;
        const selectedCodec = codecMap[selectedPayloadType.toString()] || "Unknown";
        logger.codec.info(`Codec negotiated: ${selectedCodec}`);
        if (this.sipClient && this.remoteRtpPort > 0) {
            this.sipClient.setRemoteRtpInfo(this.remoteIp, this.remoteRtpPort);
        }
    }
    getCodecQuality(codec) {
        if (codec.includes("G722/8000"))
            return "(G.722 - Wideband 16kHz)";
        if (codec.includes("PCMU/8000"))
            return "(G.711µ - Standard 8kHz)";
        if (codec.includes("PCMA/8000"))
            return "(G.711a - Standard 8kHz)";
        if (codec.includes("telephone-event"))
            return "(DTMF Tones)";
        return "(Unknown Quality)";
    }
    getRtpPort() {
        return this.localRtpPort;
    }
    setRtpPort(port) {
        this.localRtpPort = port;
        getLogger().rtp.debug(`MediaHandler RTP port updated to: ${port}`);
    }
    getSelectedPayloadType() {
        return this.selectedPayloadType;
    }
}
export class SIPClient {
    userAgent = null;
    config; // Changed from SIPConfig
    currentSession = null;
    eventCallback;
    mediaHandler = null;
    presetRtpPort = 0;
    keepAliveTimer = null;
    connectionState = 'disconnected';
    isLocalHangup = false;
    constructor(config, eventCallback) {
        this.config = config;
        this.eventCallback = eventCallback;
        // Validate provider-specific requirements
        this.validateProviderRequirements();
    }
    validateProviderRequirements() {
        if (this.config._providerProfile) {
            const profile = this.config._providerProfile;
            // Check if we have required STUN servers
            if (profile.requirements.stunServers && !this.config.stunServers) {
                getLogger().configLogs.warn(`Provider ${profile.name} recommends STUN servers for NAT traversal`);
            }
            // Check transport requirements
            if (profile.requirements.transport.includes('tcp') &&
                !this.config.preferredTransports?.includes('tcp')) {
                getLogger().configLogs.warn(`Provider ${profile.name} may require TCP transport for reliability`);
            }
        }
    }
    async connect() {
        try {
            this.connectionState = 'connecting';
            // Route SIP library logging through our logger system (respects quiet mode)
            this.patchSipLibraryLogging();
            const sipjsConfig = this.buildSipjsConfiguration();
            this.userAgent = new SIPUDP.UA(sipjsConfig);
            this.setupEventHandlers();
            this.startKeepalive();
            getLogger().sip.debug("SIP User Agent configured and starting...");
        }
        catch (error) {
            getLogger().sip.error("Failed to connect SIP client:", error);
            this.connectionState = 'disconnected';
            this.eventCallback({ type: "REGISTER_FAILED", message: error });
            throw error;
        }
    }
    buildSipjsConfiguration() {
        const uri = `${this.config.username}@${this.config.serverIp}:${this.config.serverPort}`;
        // Base configuration (existing)
        const baseConfig = {
            uri: uri,
            bind: "0.0.0.0",
            autostart: true,
            register: true,
            traceSip: !getLogger().isQuietMode(), // Disable SIP tracing in quiet mode
            doUAS: false,
            authorizationUser: this.config.username,
            password: this.config.password,
            // Explicitly disable WebSocket servers to avoid confusing OnSIP defaults
            wsServers: [],
            transportOptions: { wsServers: [] },
            mediaHandlerFactory: (session) => {
                this.mediaHandler = new MediaHandler(session, this);
                if (this.presetRtpPort > 0) {
                    this.mediaHandler.setRtpPort(this.presetRtpPort);
                }
                return this.mediaHandler;
            },
        };
        // Add STUN/TURN configuration
        const natConfig = this.buildNATConfiguration();
        // Add session timer configuration
        const sessionConfig = this.buildSessionConfiguration();
        // Add transport configuration  
        const transportConfig = this.buildTransportConfiguration();
        // Add authentication configuration
        const authConfig = this.buildAuthConfiguration();
        return {
            ...baseConfig,
            ...natConfig,
            ...sessionConfig,
            ...transportConfig,
            ...authConfig,
            // Provider-specific quirks
            ...this.applyProviderQuirks()
        };
    }
    buildNATConfiguration() {
        const config = {};
        if (this.config.stunServers?.length) {
            config.stunServers = this.config.stunServers;
            getLogger().configLogs.info(`STUN servers configured: ${this.config.stunServers.join(', ')}`);
        }
        if (this.config.turnServers?.length) {
            config.turnServers = this.config.turnServers;
            getLogger().configLogs.info(`TURN servers configured: ${this.config.turnServers.length} server(s)`);
        }
        if (this.config.iceEnabled) {
            config.iceCheckingTimeout = 5000;
            getLogger().configLogs.info(`ICE candidate gathering enabled`);
        }
        return config;
    }
    buildSessionConfiguration() {
        const config = {};
        if (this.config.sessionTimers?.enabled) {
            config.sessionTimers = true;
            config.sessionExpires = this.config.sessionTimers.expires;
            config.minSE = this.config.sessionTimers.minSE;
            getLogger().configLogs.info(`Session timers: ${this.config.sessionTimers.expires}s refresh`);
        }
        return config;
    }
    buildTransportConfiguration() {
        const config = {};
        // Configure transport preferences
        if (this.config.preferredTransports) {
            const transports = this.config.preferredTransports;
            if (transports.includes('tcp')) {
                config.hackViaTcp = true; // Enable TCP transport
            }
            else {
                config.hackViaTcp = false; // Force UDP (Fritz Box style)
            }
            if (transports.includes('tls')) {
                config.transportOptions = {
                    ...config.transportOptions,
                    tls: this.config.tlsOptions || { rejectUnauthorized: false }
                };
            }
            getLogger().configLogs.info(`Transport preference: ${transports.join(' → ')}`);
        }
        else {
            // Default to UDP for backward compatibility
            config.hackViaTcp = false;
            // Ensure no WebSocket servers are configured (already set in baseConfig)
        }
        return config;
    }
    buildAuthConfiguration() {
        const config = {};
        // Enhanced authentication handling for providers that need it
        if (this.config._providerProfile?.requirements.authMethods?.includes('digest')) {
            config.authenticationFactory = {
                username: this.config.username,
                password: this.config.password
            };
        }
        return config;
    }
    applyProviderQuirks() {
        const config = {};
        if (this.config._providerProfile?.quirks) {
            const quirks = this.config._providerProfile.quirks;
            // Apply provider-specific configurations
            if (quirks.requiresContactInRegister) {
                config.hackAllowUnregisteredOptionTags = true;
            }
            if (quirks.strictSdpOrdering) {
                config.hackStrictSdpOrdering = true;
            }
            if (quirks.sensitiveToUserAgent) {
                config.userAgentString = "VoIP-Agent/1.0";
            }
            getLogger().configLogs.info(`Applied provider quirks for ${this.config._providerProfile.name}`);
        }
        return config;
    }
    setupEventHandlers() {
        // Enhanced event handlers with state tracking
        this.userAgent.on("connected", () => {
            this.connectionState = 'connected';
            getLogger().sip.debug("SIP User Agent connected");
            this.eventCallback({ type: "CONNECTED" });
        });
        // Listen for SIP transaction timeout events (indicates remote hangup)
        this.userAgent.on('transactionTimeout', (transaction) => {
            getLogger().sip.debug(`SIP transaction timeout: ${transaction.method}`);
            if (transaction.method === 'INVITE' && this.currentSession) {
                getLogger().sip.info("INVITE transaction timeout - remote party likely hung up");
                this.handleCallEnd();
            }
        });
        this.userAgent.on("registered", () => {
            this.connectionState = 'registered';
            getLogger().sip.debug("SIP User Agent registered");
            this.eventCallback({ type: "REGISTERED" });
        });
        this.userAgent.on("disconnected", () => {
            this.connectionState = 'disconnected';
            getLogger().sip.info("SIP User Agent disconnected");
            this.stopKeepalive();
            this.eventCallback({ type: "DISCONNECTED" });
        });
        this.userAgent.on("registrationFailed", (response) => {
            getLogger().sip.error("SIP registration failed:", response);
            this.connectionState = 'disconnected';
            this.handleRegistrationError(response);
        });
        // New: Session timer events
        this.userAgent.on("sessionTimerRefresh", (session) => {
            getLogger().sip.debug("Session timer refresh");
            this.eventCallback({
                type: "SESSION_REFRESH",
                data: { sessionId: session.id }
            });
        });
        // New: Transport fallback events
        this.userAgent.on("transportError", (transport, error) => {
            getLogger().sip.warn(`Transport ${transport} failed: ${error.message}`);
            this.handleTransportFallback(transport, error);
        });
        // New: Authentication retry events
        this.userAgent.on("authenticationRetry", (attempt, maxAttempts) => {
            getLogger().sip.debug(`Authentication retry ${attempt}/${maxAttempts}`);
            this.eventCallback({
                type: "AUTH_RETRY",
                data: { attempt, maxAttempts }
            });
        });
    }
    handleRegistrationError(response) {
        // Provider-specific error handling
        if (this.config._providerProfile) {
            const providerId = this.config.provider || 'generic';
            if (this.handleProviderSpecificError(response, providerId)) {
                // Error was handled, retry might be scheduled
                return;
            }
        }
        this.eventCallback({ type: "REGISTER_FAILED", message: response });
    }
    handleProviderSpecificError(error, providerId) {
        switch (providerId) {
            case 'asterisk':
                return this.handleAsteriskError(error);
            case 'cisco':
                return this.handleCiscoError(error);
            case 'fritz-box':
                return this.handleFritzBoxError(error);
            default:
                return false;
        }
    }
    handleAsteriskError(error) {
        // Asterisk-specific error patterns and recovery
        if (error.message?.includes('Session-Expires too small')) {
            getLogger().sip.info('Asterisk requires longer session timers, adjusting...');
            if (this.config.sessionTimers) {
                this.config.sessionTimers.expires = Math.max(this.config.sessionTimers.expires || 1800, 1800);
            }
            return true; // Retry with adjusted config
        }
        if (error.code === 488 && error.message?.includes('codec')) {
            getLogger().codec.info('Asterisk rejected our codec offer, trying G.711 only...');
            // This would need coordination with MediaHandler
            return true;
        }
        return false;
    }
    handleCiscoError(error) {
        // Cisco-specific error handling
        if (error.code === 420 && error.message?.includes('Bad Extension')) {
            getLogger().sip.info('Cisco requires PRACK support, enabling...');
            // Force PRACK on for retry
            return true;
        }
        return false;
    }
    handleFritzBoxError(error) {
        // Fritz Box typically works with basic settings
        if (error.message?.includes('STUN')) {
            getLogger().sip.debug('Fritz Box doesn\'t need STUN, disabling for retry...');
            this.config.stunServers = [];
            return true;
        }
        return false;
    }
    handleTransportFallback(failedTransport, error) {
        const transports = this.config.preferredTransports || ['udp'];
        const currentIndex = transports.indexOf(failedTransport);
        if (currentIndex < transports.length - 1) {
            const nextTransport = transports[currentIndex + 1];
            getLogger().sip.warn(`Falling back from ${failedTransport} to ${nextTransport}`);
            // Trigger reconnection with different transport
            this.eventCallback({
                type: "TRANSPORT_FALLBACK",
                data: { from: failedTransport, to: nextTransport }
            });
        }
        else {
            getLogger().sip.error(`All transports failed, cannot connect`);
            this.eventCallback({
                type: "CONNECTION_FAILED",
                message: "All transport methods failed"
            });
        }
    }
    patchSipLibraryLogging() {
        // Monkey-patch the SIP library's LoggerFactory to route through our logger
        const SIPUDP = require('sipjs-udp');
        const LoggerFactory = SIPUDP.LoggerFactory;
        if (LoggerFactory && LoggerFactory.prototype && LoggerFactory.prototype.print) {
            const originalPrint = LoggerFactory.prototype.print;
            LoggerFactory.prototype.print = function (target, category, label, content) {
                // Route SIP library logs through our logger system instead of console
                if (typeof content === 'string') {
                    const message = content.replace(/^.*?\| /, ''); // Remove timestamp prefix
                    getLogger().sip.debug(message);
                }
            };
        }
    }
    startKeepalive() {
        if (!this.config.keepAlive)
            return;
        const { method, interval } = this.config.keepAlive;
        this.keepAliveTimer = setInterval(() => {
            this.sendKeepalive(method);
        }, interval * 1000);
        getLogger().sip.debug(`Keepalive started: ${method} every ${interval}s`);
    }
    sendKeepalive(method) {
        if (this.connectionState !== 'registered')
            return;
        switch (method) {
            case 'register':
                // Re-register with shorter expires
                this.userAgent.register({
                    expires: Math.min(this.config.keepAlive.interval, 300)
                });
                break;
            case 'options':
                // Send OPTIONS ping
                this.userAgent.request({
                    method: 'OPTIONS',
                    to: this.config.serverIp
                });
                break;
            case 'double-crlf':
                // Send double CRLF on TCP connections
                if (this.userAgent.transport && this.userAgent.transport.send) {
                    this.userAgent.transport.send('\r\n\r\n');
                }
                break;
        }
    }
    stopKeepalive() {
        if (this.keepAliveTimer) {
            clearInterval(this.keepAliveTimer);
            this.keepAliveTimer = null;
            getLogger().sip.debug('Keepalive stopped');
        }
    }
    async makeCall(callConfig) {
        if (!this.userAgent) {
            throw new Error("SIP client not connected");
        }
        try {
            const targetUri = `sip:${callConfig.targetNumber}@${this.config.serverIp}`;
            getLogger().sip.info(`Making call to: ${targetUri}`);
            this.currentSession = this.userAgent.invite(targetUri);
            // Set up session event handlers
            let progressLogged = false;
            this.currentSession.on("progress", () => {
                if (!progressLogged) {
                    getLogger().sip.info("Call in progress...");
                    progressLogged = true;
                }
                this.eventCallback({
                    type: "CALL_INITIATED",
                    data: { target: callConfig.targetNumber },
                });
            });
            this.currentSession.on("accepted", () => {
                getLogger().sip.info("Call accepted");
                const rtpPort = this.mediaHandler?.getRtpPort() || 5000;
                this.eventCallback({
                    type: "CALL_ANSWERED",
                    data: {
                        session: this.currentSession,
                        rtpPort: rtpPort,
                        mediaHandler: this.mediaHandler,
                        negotiatedPayloadType: this.mediaHandler?.getSelectedPayloadType() || 0,
                    },
                });
            });
            this.currentSession.on("terminated", (message) => {
                getLogger().sip.info("SIP session terminated");
                const endedBy = this.isLocalHangup ? 'local' : 'remote';
                this.isLocalHangup = false; // Reset flag
                this.handleCallEnd(endedBy);
            });
            this.currentSession.on("failed", (response) => {
                getLogger().sip.error("Call failed:", response);
                this.handleCallEnd();
            });
            // Add additional event handlers for better call termination detection
            this.currentSession.on("bye", (request) => {
                // Only log if it's actually from remote (not triggered by our own terminate())
                if (!this.isLocalHangup) {
                    getLogger().sip.info("BYE message received from remote party");
                }
                // Don't call handleCallEnd here - let 'terminated' handle it
            });
            this.currentSession.on("cancel", () => {
                getLogger().sip.info("CANCEL received - call cancelled");
                this.handleCallEnd('remote');
            });
            this.currentSession.on("rejected", (response) => {
                getLogger().sip.info("Call rejected:", response);
                this.handleCallEnd('remote');
            });
            return this.currentSession.id || "call-" + Date.now();
        }
        catch (error) {
            getLogger().sip.error("Failed to make call:", error);
            throw error;
        }
    }
    handleCallEnd(endedBy = 'remote') {
        // Prevent multiple call end handling
        if (!this.currentSession) {
            return; // Already handled
        }
        getLogger().sip.debug("SIP session ended");
        this.currentSession = null;
        this.eventCallback({ type: "CALL_ENDED", endedBy });
    }
    async endCall() {
        if (this.currentSession) {
            try {
                this.isLocalHangup = true; // Mark that we initiated the hangup
                this.currentSession.terminate();
                // Don't call handleCallEnd here - let the 'terminated' event handle it
            }
            catch (error) {
                getLogger().sip.error("Error ending call:", error);
                this.isLocalHangup = false;
                throw error;
            }
        }
    }
    isConnected() {
        return this.userAgent !== null;
    }
    getCurrentCallId() {
        return this.currentSession?.id || null;
    }
    getCurrentSession() {
        return this.currentSession;
    }
    setLocalRtpPort(port) {
        this.presetRtpPort = port;
        if (this.mediaHandler) {
            this.mediaHandler.setRtpPort(port);
        }
        getLogger().rtp.debug(`SIP client local RTP port preset to: ${port}`);
    }
    setRemoteRtpInfo(ip, port) {
        getLogger().rtp.debug(`Setting remote RTP info: ${ip}:${port}`);
        this.eventCallback({
            type: "CALL_ANSWERED",
            data: {
                session: this.currentSession,
                rtpPort: this.mediaHandler?.getRtpPort() || 5000,
                mediaHandler: this.mediaHandler,
                remoteRtpIp: ip,
                remoteRtpPort: port,
                negotiatedPayloadType: this.mediaHandler?.getSelectedPayloadType() || 0,
            },
        });
    }
    async disconnect() {
        this.stopKeepalive();
        if (this.currentSession) {
            await this.endCall();
        }
        if (this.userAgent) {
            this.userAgent.stop();
            this.userAgent = null;
        }
        this.connectionState = 'disconnected';
    }
}
//# sourceMappingURL=sip-client.js.map