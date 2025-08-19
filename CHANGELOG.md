# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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

[1.0.0]: https://github.com/username/ai-voice-agent/releases/tag/v1.0.0