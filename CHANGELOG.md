# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased] - 2025-08-31

### Added
- **Automatic Language Detection**: o3-mini intelligently detects conversation language from call briefs and configures OpenAI transcription accordingly
- **Voice Characteristics Support**: Comprehensive lookup table for all OpenAI voices including gender and personality traits
- **Auto Voice Selection**: New 'auto' mode where o3-mini selects optimal voice based on call context, formality, and goals
- **Structured Output Integration**: Uses OpenAI's JSON schema for reliable, type-safe response parsing from o3-mini
- **Enhanced Token Limits**: Increased max_completion_tokens to 16,000 for comprehensive multilingual instructions
- **Voice Validation**: Robust validation and sanitization for voice names with fallback handling

### Fixed
- **Deterministic Call Termination**: Replaced arbitrary safety timeouts with progress-based audio completion monitoring
- **Missing Transcript Recovery**: Fixed race conditions where final AI messages weren't logged (especially in voicemail scenarios)
- **False Stall Warnings**: Eliminated misleading warnings for near-complete responses (99%+ complete now finish cleanly)
- **Interrupted Response Handling**: Properly track and handle responses interrupted by user barge-in without false warnings
- **Call Hanging Issues**: Resolved cases where calls wouldn't end properly, requiring manual termination

### Improved
- **Audio Completion Monitoring**: Real-time progress tracking (250ms intervals) instead of fixed timeouts
- **Call Reliability**: More robust call termination flow with better edge case handling  
- **Transcript Accuracy**: Enhanced playback-aware transcript logging ensures all AI responses are captured
- **WAV Recording Precision**: Accurate real-time stereo recording reflecting actual call audio timeline
- **Audio Processing Performance**: Optimized streaming latency for improved OpenAI voice recognition
- **Logging Quality**: Cleaner logs with warnings only for genuine issues, not normal operational conditions
- **Multilingual Support**: Instructions and prompts now properly localized based on detected language

### Technical Enhancements
- **Progress-based Monitoring**: Track packet sending progress with stall detection (4s threshold)
- **Near-complete Detection**: Treat ≤2 packets remaining as successful completion
- **Interruption Tracking**: Mark interrupted responses to prevent false monitoring alerts  
- **Playback Position APIs**: Added methods to query current response playback status
- **Enhanced Meta-prompts**: Updated with OpenAI Realtime API best practices and goal optimization
- **Model Compatibility**: Full compatibility with latest `gpt-realtime` model (released August 28, 2025)
- **Voice Metadata**: Voice selection now includes gender and description context for better prompt generation

## [1.2.0] - 2025-09-19

### Added
- **Bundled G.722 WebAssembly Codec**: Ship a precompiled WASM build so `npx` users get wideband audio without native toolchains
- **WASM Build & Postinstall Scripts**: New `npm run build:wasm`, `build:all`, and postinstall safeguards that cache emcc output and skip rebuilds when artifacts already exist
- **Native/WASM Loader Fallback**: Unified loader automatically prefers the native addon when present and transparently falls back to the bundled WASM module

### Changed
- **Default Build Flow**: `npm run build` now refreshes WASM + TypeScript only, leaving native compilation as an opt-in step
- **Distribution Layout**: `dist/` is tracked so prebuilt codecs ship with the package and GitHub `npx` installs work offline
- **Documentation Updates**: README and quick-start instructions highlight the compiler-free WASM codec and new build scripts

## [1.1.0] - 2025-08-28

### Added
- **MCP Server Integration**: Claude Desktop integration for voice calls directly from the chat interface
- **Language Specification**: Enhanced instruction generation with automatic language detection and localization
- **Voice Agent Naturalness**: Improved conversation flow with better number pronunciation and natural speech patterns
- **Call Status Timestamping**: Preserved timestamps in MCP transcript for accurate call timeline tracking

### Enhanced  
- **OpenAI Realtime Model**: Updated to use latest `gpt-realtime` model for improved voice quality and responsiveness
- **Instruction Generation**: Enhanced meta-prompt system with goal optimization and best practice integration

## [1.0.0] - 2025-08-18

### Added
- **G.722 Wideband Codec Support**: Native G.722 implementation with 16kHz audio quality
- **Codec Abstraction Layer**: Pluggable codec system supporting G.722, G.711 μ-law, and G.711 A-law
- **SIP Client Integration**: Full SIP protocol support with authentication and call management
- **OpenAI Realtime API**: Real-time AI voice conversations with low latency
- **Audio Bridge**: RTP streaming with automatic codec negotiation
- **Command-Line Interface**: Easy-to-use CLI for making and managing calls
- **Fritz Box Support**: Tested compatibility with AVM Fritz Box routers
- **Universal SIP Compatibility**: Works with Asterisk, FreeSWITCH, and other SIP providers
- **Native Addon Build System**: Node-gyp integration for G.722 native compilation
- **Flexible Configuration**: JSON-based configuration with environment variable support
- **Audio Quality Monitoring**: Performance metrics and codec selection logging
- **TypeScript Implementation**: Fully typed codebase for better development experience

### Technical Implementation
- **G.722 Native Addon**: C++ wrapper around reference G.722 implementation
- **ES Module Support**: Modern JavaScript module system with CommonJS compatibility
- **Conditional Compilation**: G.722 can be enabled/disabled at build time
- **Symmetric RTP**: Fritz Box compatible RTP handling
- **SDP Negotiation**: Automatic codec priority and fallback handling
- **Real-time Audio Processing**: Low-latency audio conversion and streaming

### Build System
- **Node-gyp Integration**: Native addon compilation with cross-platform support
- **TypeScript Build Pipeline**: Automated TypeScript to JavaScript compilation
- **Environment-based Configuration**: `ENABLE_G722` build flag support
- **Package Scripts**: Comprehensive npm script collection for development and production

### Documentation
- **Comprehensive README**: Setup instructions, usage examples, and troubleshooting
- **API Documentation**: TypeScript interfaces and codec specifications
- **License Compliance**: MIT license with third-party attribution
- **Development Guide**: Build instructions and project structure overview

### Third-Party Integrations
- **OpenAI Realtime API**: Voice conversation capabilities
- **SIPjs-UDP**: SIP protocol implementation
- **G.722 Reference Implementation**: Carnegie Mellon/Steve Underwood/Sippy Software
- **Node.js Native Addons**: N-API for native code integration

[Unreleased]: https://github.com/gerkensm/callcenter.js-mcp/compare/v1.2.0...HEAD
[1.2.0]: https://github.com/gerkensm/callcenter.js-mcp/compare/v1.1.0...v1.2.0
[1.1.0]: https://github.com/gerkensm/callcenter.js-mcp/compare/v1.0.0...v1.1.0
[1.0.0]: https://github.com/gerkensm/callcenter.js-mcp/releases/tag/v1.0.0
