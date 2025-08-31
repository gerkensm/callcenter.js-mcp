# CallCenter.js MCP Project - Claude Context

## Project Overview
**CallCenter.js MCP** - AI-powered VoIP calling system that bridges OpenAI Real-Time Voice API with SIP networks
- **"Vibe-coded"** - Only Fritz!Box tested, other SIP providers are educated guesses (configs exist but YMMV)
- **Primary usage**: MCP Server for Claude Code integration enabling AI phone calls
- **Stack**: TypeScript/Node.js 20+, ESM modules, native G.722 C++ codec, SIP/RTP protocols

## Architecture
```
MCP Client -> VoiceAgent -> [CallBriefProcessor(o3-mini) + SIPClient + AudioBridge]
                          -> OpenAI RealTime API + VoIP Network
```

### Core Components
- **VoiceAgent** (`voice-agent.ts`) - Main orchestrator with EventEmitter pattern
- **CallBriefProcessor** (`call-brief-processor.ts`) - o3-mini instruction generation from natural language
- **SIPClient** (`sip-client.ts`) - SIP protocol with provider profiles (Fritz!Box, Asterisk, Cisco, 3CX) 
- **AudioBridge** (`audio-bridge.ts`) - RTP streaming, codec negotiation, optional stereo recording
- **ConnectionManager** (`connection-manager.ts`) - Smart reconnection with exponential backoff

## Code Style & Architecture Patterns

### TypeScript Standards
- **Strict mode** enabled, full type safety with interfaces extending base types
- **ESM modules** (`"type": "module"`) with `.js` imports for compiled output
- **Event-driven architecture** - EventEmitter pattern for component communication
- **Error boundaries** - Comprehensive error handling with custom error types (ConfigurationError)
- **Performance monitoring** - Event loop lag detection, RTP packet tracking

### Key Patterns
- **Provider Profiles** (`providers/profiles.ts`) - Data-driven SIP configuration per provider
- **Validation Layers** (`validation.ts`) - 5-layer validation: syntax→fields→provider→network→codec
- **Audio Processing Pipeline** - Batched audio (20ms chunks), dynamic buffer sizing, codec abstraction
- **State Management** - Boolean flags for call state, Map-based tracking for responses/transcripts
- **Resource Management** - Explicit cleanup timers, socket disposal, WAV file writers

### Library Dependencies & Quirks
- **sipjs-udp** - SIP protocol library (CommonJS require in ESM context)
- **OpenAI SDK** - WebSocket for real-time, REST for o3-mini brief processing  
- **winston** - Structured logging with custom levels (transcript=0, quiet→verbose)
- **wav** - Stereo recording (left=human, right=AI)
- **node-gyp** - Native G.722 codec compilation (auto-fallback to G.711)

### Critical Commands
```bash
npm run validate:detailed     # 5-layer validation + network tests
npm start call "**620" --brief "test" --user-name "X" --duration 30  # Fritz!Box self-test
npm run build:no-g722        # Fallback when C++ compilation fails

# Testing after changes
npm run build                # Rebuild TypeScript and native modules
npm run test:codecs          # Test audio codec functionality
```

### Testing Requirements After Changes
When making changes that could affect the API surface or guarantees:
1. **Check mcp-server.ts**: Review how it consumes the changed APIs - look for:
   - Tool parameter mappings in `simple_call` and `advanced_call` handlers
   - Error handling and result formatting
   - Any assumptions about return types or behavior
2. **Check neighboring modules**: Verify all consumers of changed APIs:
   - If changing `voice-agent.ts` → check `mcp-server.ts`, `cli.ts`, `index.ts`
   - If changing `call-brief-processor.ts` → check where `processCallBrief()` is called
   - If changing types/interfaces → grep for all usages across the codebase
3. **Test the full stack**:
   - **CLI**: `npm start call ...` to verify command-line interface
   - **MCP Server**: Start server and test both tools with actual calls
   - **API Module**: If using as library, test `makeCall()` programmatically
4. **Validate config**: Run `npm run validate:detailed` to check configuration layers

### Post-Task Checklist
After completing each feature/fix:
1. **Update documentation**: Check if README.md needs updates for new features/changes
2. **Update API docs**: Verify JSDoc comments reflect current behavior
3. **Check CHANGELOG.md**: Document notable changes for version tracking

### Pre-Commit Cleanup
Before any commit:
1. **Remove debug code**:
   - Search for `console.log`, `console.debug`, temporary logging
   - Remove `// TODO`, `// FIXME`, `// TEMP`, `// DEBUG` comments
   - Clean up experimental/commented-out code blocks
2. **Code hygiene**:
   - Remove unused imports and variables
   - Delete dead code paths
   - Clean up temporary test values/hardcoded data
3. **Final verification**:
   - Run `npm run build` to ensure compilation
   - Check for accidental API key/credential exposure
   - Verify no temporary files are being committed

## API Patterns & Error Handling

### Call Flow
```typescript
// Brief processing (recommended)
const result = await makeCall({
  number: '+1234567890',
  brief: 'Call restaurant, book table for 2 at 7pm',  // o3-mini processes this
  userName: 'John Doe'  // Required for brief processing
});

// Direct instructions (for custom behavior)
const result = await makeCall({
  number: '+1234567890', 
  instructions: 'Detailed custom prompt...'
});
```

### Error Patterns
- **ConfigurationError** - Validation failures with suggestions array
- **CallResult.error** - String error messages for failed calls
- **Thrown exceptions** - Network/protocol failures
- **Event-based errors** - VoiceAgent.emit('error', error) for async failures

### State Management
```typescript
class VoiceAgent {
  private isCallActive: boolean = false;
  private currentCallId: string | null = null;
  private responseTrackers: Map<string, ResponseTranscriptTracker> = new Map();
  private audioQueue: { packet: Buffer; pcm: Int16Array }[] = [];
}
```

### Provider Configurations
```typescript
// Provider profile structure
interface SIPProviderProfile {
  requirements: {
    transport: string[];           // ['udp'] vs ['udp','tcp','tls']
    sessionTimers: boolean;        // RFC 4028 support
    prackSupport: 'required'|'supported'|'disabled';
    stunServers?: string[];        // NAT traversal
    keepAliveMethod: 'register'|'options'|'double-crlf';
  };
  sdpOptions: {
    preferredCodecs: number[];     // [9,0,8] = G.722,G.711μ,G.711A
    dtmfMethod: string;           // 'rfc4733'
  };
}
```

**Status**: Fritz!Box ✅ tested | Asterisk/Cisco/3CX ⚠️ vibe-coded

## MCP Integration Specifics

### Tools Available
- **`simple_call`** - Natural language briefs with o3-mini processing
- **`advanced_call`** - Granular parameter control for complex scenarios

### Configuration Priority
```
CLI flags > Config file > Environment variables
```

### Environment Variables (MCP usage)
```bash
# Required
SIP_USERNAME=extension
SIP_PASSWORD=password  
SIP_SERVER_IP=192.168.1.1
OPENAI_API_KEY=sk-...
USER_NAME="Full Name"  # Required for --brief

# Provider-specific  
SIP_PROVIDER=fritz-box  # fritz-box|asterisk|cisco|3cx|generic
STUN_SERVERS="stun:stun.l.google.com:19302"
```

## Audio Processing Pipeline

### Codec Negotiation
1. **G.722** (16kHz, native C++ addon) - Preferred for quality
2. **G.711 μ-law/A-law** (8kHz, JS implementation) - Universal fallback

### RTP Streaming
- **Batching**: 2 packets (20ms) to balance latency vs efficiency
- **Jitter handling**: Dynamic buffer sizing (30-packet initial burst)
- **Timing**: 20ms packet intervals with performance monitoring

### Call Recording
```typescript
// Stereo WAV: left=human, right=AI, synchronized timestamps
const bridge = new AudioBridge({ 
  enableCallRecording: true,
  recordingFilename: 'optional.wav' 
});
```

## Critical Implementation Notes

### Performance Optimizations
- **Event loop monitoring** - Warns at >100ms lag
- **Audio batching** - Reduces OpenAI SDK overhead
- **Connection pooling** - ConnectionManager with exponential backoff
- **Memory management** - Cleanup timers prevent response tracker leaks

### Debugging Features
- **5-layer validation** with network connectivity tests
- **Performance stats** - RTP packet counts, audio gaps, timing jitter
- **Transcript correlation** - Maps OpenAI response IDs to audio completion
- **Debug WAV files** - Optional OpenAI audio stream recording

### Build System
- **Dual build targets**: Full (with G.722) vs fallback (G.711 only)
- **Native compilation**: node-gyp for G.722, graceful degradation
- **ESM compliance**: `.js` imports, proper module resolution

## File Architecture Reference
```
src/
├── voice-agent.ts          # Main orchestrator, EventEmitter-based
├── call-brief-processor.ts # o3-mini natural language→instructions  
├── sip-client.ts          # SIP protocol + provider profiles
├── audio-bridge.ts        # RTP streaming + codec management
├── openai-client.ts       # WebSocket + response correlation
├── connection-manager.ts   # Smart reconnection logic
├── validation.ts          # 5-layer config validation
├── types.ts              # Interface definitions
├── providers/profiles.ts  # SIP provider configurations
├── codecs/               # G.722/G.711 abstraction
└── mcp-server.ts        # MCP protocol implementation
```

## Coding Standards & Conventions

### Naming & Structure
- **PascalCase**: Classes (`VoiceAgent`, `SIPClient`, `AudioBridge`)
- **camelCase**: Variables, methods, interfaces (`isCallActive`, `makeCall`, `CallConfig`)
- **kebab-case**: File names (`voice-agent.ts`, `call-brief-processor.ts`)
- **SCREAMING_SNAKE_CASE**: Constants (`BATCH_SIZE`, `RTP_TIMEOUT_MS`)

### Interface Design Patterns
```typescript
// Base interfaces with extensions
interface SIPConfig { /* basic fields */ }
interface SIPAdvancedConfig extends SIPConfig { /* advanced fields */ }

// Enum-style unions for type safety
type LogLevel = "quiet" | "error" | "warn" | "info" | "debug" | "verbose";
type Transport = 'udp' | 'tcp' | 'tls';

// Callback patterns with optional parameters
interface CallOptions {
  number: string;                    // Required
  duration?: number;                 // Optional with defaults
  brief?: string;                    // Mutually exclusive with instructions
  instructions?: string;
}
```

### Error Handling Strategy
```typescript
// Custom error types with context
class ConfigurationError extends Error {
  constructor(public details: {
    message: string;
    suggestions: string[];
    exampleConfigs?: string[];
  }) { super(details.message); }
}

// Dual error reporting: exceptions + result objects
interface CallResult {
  success: boolean;
  error?: string;        // Soft errors
  callId?: string;
}
// + thrown exceptions for hard failures
```

## Logging Architecture

### Winston Configuration
```typescript
// Custom log levels with priorities
const winstonLevels = {
  transcript: 0,         // Always shown (conversation logs)
  error: 1,              // System errors
  warn: 2,               // Warnings
  info: 3,               // General info
  debug: 4,              // Debug details
  verbose: 5,            // Maximum detail
};

// Structured logging with categorization
getLogger().ai.debug("Processing brief with o3-mini");
getLogger().sip.warn("Connection retry attempt 3");
getLogger().audio.info("G.722 codec negotiated successfully");
```

### Quiet Mode & Log Level Behavior
- **`quiet` mode**: Only shows `transcript` level (0) - conversation between human and AI
- **`transcript` channel**: Special logger channel that ALWAYS outputs regardless of log level
- **Log level hierarchy**: Each level includes all lower priority levels
  - `quiet`: transcript only
  - `error`: transcript + errors
  - `warn`: transcript + errors + warnings
  - `info`: transcript + errors + warnings + info
  - `debug`: transcript + errors + warnings + info + debug
  - `verbose`: everything including performance metrics

### Transcript Channel Details
```typescript
// Transcript channel bypasses normal log filtering
getLogger().transcript.info("🎤 HUMAN: " + text);     // Always shown
getLogger().transcript.info("🤖 ASSISTANT: " + text);  // Always shown

// Usage pattern in VoiceAgent
private logTranscript(prefix: string, text: string) {
  const timestamp = new Date().toLocaleTimeString('en-US', { hour12: false });
  getLogger().transcript.info(`[${timestamp}] ${prefix}: ${text}`);
}
```

### Log Output Patterns
- **Transcript logs**: `[14:23:15] 🎤 HUMAN: Hello` / `[14:23:15] 🤖 ASSISTANT: Hi there`  
- **Component logs**: Include component prefix and severity indicators
- **Performance logs**: RTP packet counts, event loop lag, timing metrics
- **Debug correlation**: Response IDs for tracking audio/transcript alignment

## Audio Processing & Data Formats

### Sample Rate Conversion
```typescript
// OpenAI: 24kHz ↔ VoIP: 16kHz/8kHz pipeline
class AudioProcessor {
  resample24kTo16k(audio: Int16Array): Int16Array;  // OpenAI → G.722
  resample16kTo24k(audio: Int16Array): Int16Array;  // G.722 → OpenAI  
  // Linear interpolation, 0.9x gain reduction, hard clamp [-32768, 32767]
}
```

### Codec Implementation
```typescript
interface Codec {
  readonly payloadType: number;      // RTP payload type (9=G.722, 0=PCMU)
  readonly sampleRate: number;       // Audio sample rate (8000/16000)
  readonly clockRate: number;        // RTP timestamp rate
  encode(pcm: Int16Array): Buffer;   // PCM → encoded
  decode(encoded: Buffer): Int16Array; // Encoded → PCM
}

// G.722: Native C++ addon (16kHz wideband)
// G.711: JS implementation (8kHz narrowband, μ-law/A-law)
```

### RTP Data Formats
```typescript
// RTP packet structure
interface RTPPacket {
  sequenceNumber: number;            // Sequence tracking
  timestamp: number;                 // Media timing
  payload: Buffer;                   // Encoded audio data  
  payloadType: number;               // Codec identifier
}

// Audio batching for performance
private audioBatch: Int16Array[] = [];
private readonly BATCH_SIZE = 2;          // 20ms worth of audio
private readonly BATCH_TIMEOUT_MS = 20;   // Force flush interval
```

### Call Recording Format
```typescript
// Stereo WAV: 16-bit PCM, synchronized channels
// Left channel: Human audio (from SIP)
// Right channel: AI audio (from OpenAI)
class AudioBridge {
  private stereoWavWriter: Writer | null = null;
  // Real-time interleaving with timestamp correlation
}
```

### State Management Data
```typescript
// Response correlation tracking
private responseTrackers: Map<string, ResponseTranscriptTracker> = new Map();
// Maps OpenAI response IDs → transcript/audio correlation

// Audio queue with metadata
private rtpPacketQueue: { 
  packet: Buffer; 
  pcm: Int16Array;
  timestamp: number;
}[] = [];

// Performance metrics
private perfStats = {
  eventProcessTimes: number[];       // Processing latency tracking
  packetCount: number;               // RTP statistics
  audioGapCount: number;             // Quality metrics
};
```

**Key insight**: Brief processing with o3-mini produces better results than direct instructions to gpt-realtime model