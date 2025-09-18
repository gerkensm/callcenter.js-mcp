// Provider profiles based on real-world testing and documentation
export const PROVIDER_PROFILES = {
    'fritz-box': {
        name: 'AVM Fritz!Box',
        description: 'Home/small office router with built-in SIP support',
        requirements: {
            transport: ['udp'], // Fritz Box works great with UDP only
            sessionTimers: false, // Session timers not required
            prackSupport: 'disabled', // PRACK not used by Fritz Box
            authMethods: ['digest'], // Standard digest authentication
            keepAliveMethod: 'register', // Re-registration for keepalive
            keepAliveInterval: 300, // 5 minutes between re-registrations
        },
        sdpOptions: {
            preferredCodecs: [9, 0, 8], // G.722 first, then G.711
            dtmfMethod: 'rfc4733', // RFC 4733 telephone events
            mediaTimeout: 30, // 30 second RTP timeout
        },
        // No quirks - Fritz Box is well-behaved
    },
    'asterisk': {
        name: 'Asterisk PBX',
        description: 'Open source PBX system (FreePBX, Elastix, etc.)',
        requirements: {
            stunServers: ['stun:stun.l.google.com:19302'], // STUN for NAT detection
            transport: ['udp', 'tcp'], // UDP preferred, TCP fallback
            sessionTimers: true, // Session timers supported
            prackSupport: 'supported', // PRACK supported but optional
            authMethods: ['digest'], // Digest auth standard
            keepAliveMethod: 'options', // OPTIONS pings for keepalive
            keepAliveInterval: 60, // Every minute
        },
        sdpOptions: {
            preferredCodecs: [9, 0, 8], // G.722 if available
            dtmfMethod: 'rfc4733', // RFC 4733 standard
            mediaTimeout: 60, // Longer timeout for busy systems
        },
        quirks: {
            // Asterisk-specific workarounds
            acceptsEarlyMedia: true, // Handles 183 Session Progress well
            supportsReInvite: true, // Good re-INVITE support
            flexible_codec_negotiation: true, // Handles codec changes well
        }
    },
    'cisco': {
        name: 'Cisco Unified Communications Manager (CUCM)',
        description: 'Enterprise Cisco PBX systems and SIP trunks',
        requirements: {
            stunServers: ['stun:stun.l.google.com:19302'],
            transport: ['tcp', 'udp'], // TCP preferred for reliability
            sessionTimers: true, // Session timers mandatory
            prackSupport: 'required', // PRACK required for 100rel
            authMethods: ['digest'], // Digest with additional challenges
            keepAliveMethod: 'options', // OPTIONS keepalive
            keepAliveInterval: 30, // Frequent keepalive (30s)
        },
        sdpOptions: {
            preferredCodecs: [0, 8, 9], // Cisco prefers G.711 for reliability
            dtmfMethod: 'rfc4733', // RFC 4733 required
            mediaTimeout: 90, // Longer timeout for enterprise use
        },
        quirks: {
            requiresContactInRegister: true, // Must include Contact in REGISTER
            strictSdpOrdering: true, // Sensitive to SDP attribute order
            requires100rel: true, // Mandatory reliable provisional responses
            sensitiveToUserAgent: true, // Some versions check User-Agent header
        }
    },
    '3cx': {
        name: '3CX Phone System',
        description: 'Popular business PBX system',
        requirements: {
            stunServers: ['stun:stun.l.google.com:19302'],
            transport: ['tcp', 'udp'], // TCP for firewall traversal
            sessionTimers: true, // Session refresh supported
            prackSupport: 'supported', // PRACK optional
            authMethods: ['digest'], // Standard digest auth
            keepAliveMethod: 'register', // Re-registration keepalive
            keepAliveInterval: 180, // 3 minute intervals
        },
        sdpOptions: {
            preferredCodecs: [9, 0, 8], // G.722 supported
            dtmfMethod: 'rfc4733', // RFC 4733 preferred
            mediaTimeout: 45, // Moderate timeout
        },
        quirks: {
            prefersSRTP: true, // SRTP support when available
            handlesReInviteWell: true, // Good hold/resume support
        }
    },
    'generic': {
        name: 'Generic SIP Provider',
        description: 'Standards-compliant SIP trunk or provider',
        requirements: {
            stunServers: ['stun:stun.l.google.com:19302'],
            transport: ['udp', 'tcp'], // Both transports
            sessionTimers: true, // Most providers support this
            prackSupport: 'supported', // PRACK commonly supported
            authMethods: ['digest'], // Standard authentication
            keepAliveMethod: 'register', // Re-registration common
            keepAliveInterval: 300, // 5 minute default
        },
        sdpOptions: {
            preferredCodecs: [9, 0, 8], // G.722 preferred for quality
            dtmfMethod: 'rfc4733', // RFC 4733 standard
            mediaTimeout: 60, // Standard timeout
        },
        // No quirks - standards-compliant baseline
    }
};
export function getProviderProfile(providerId) {
    const profile = PROVIDER_PROFILES[providerId];
    if (!profile) {
        console.warn(`⚠️  Unknown provider '${providerId}', using generic profile`);
        console.log(`💡 Available providers: ${Object.keys(PROVIDER_PROFILES).join(', ')}`);
        return PROVIDER_PROFILES.generic;
    }
    console.log(`📋 Using provider profile: ${profile.name}`);
    console.log(`📝 ${profile.description}`);
    return profile;
}
// Auto-detection based on SIP domain patterns
export function detectProviderFromDomain(domain) {
    // Common domain patterns for provider auto-detection
    const patterns = {
        'fritz-box': /^192\.168\.\d+\.\d+$|^fritz\.box$/i,
        'cisco': /cucm|cisco|webex/i,
        '3cx': /3cx/i,
        'asterisk': /asterisk|freepbx|elastix/i,
    };
    for (const [provider, pattern] of Object.entries(patterns)) {
        if (pattern.test(domain)) {
            console.log(`🔍 Auto-detected provider '${provider}' from domain '${domain}'`);
            return provider;
        }
    }
    return null; // No auto-detection, use generic
}
// Validate provider profile compatibility
export function validateProviderProfile(profile) {
    const issues = [];
    if (profile.requirements.prackSupport === 'required' &&
        !profile.requirements.sessionTimers) {
        issues.push('PRACK required but session timers disabled - may cause issues');
    }
    if (profile.requirements.transport.includes('tls') &&
        !profile.requirements.stunServers?.length) {
        issues.push('TLS transport without STUN may have NAT issues');
    }
    return issues;
}
// Get all available provider IDs
export function getAvailableProviders() {
    return Object.keys(PROVIDER_PROFILES);
}
// Get provider profile by name (case-insensitive)
export function getProviderProfileByName(name) {
    const providerId = Object.keys(PROVIDER_PROFILES).find(id => PROVIDER_PROFILES[id].name.toLowerCase() === name.toLowerCase());
    return providerId ? PROVIDER_PROFILES[providerId] : null;
}
//# sourceMappingURL=profiles.js.map