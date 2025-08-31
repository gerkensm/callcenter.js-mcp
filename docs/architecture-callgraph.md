# Architecture Call Graph

## Main Entry Points and Module Interactions

This diagram shows the primary entry points and call flow between major modules in the VoIP Agent system.

```mermaid
graph TB
    subgraph "Entry Points"
        CLI["CLI<br/>(cli.ts)"]
        MCP["MCP Server<br/>(mcp-server.ts)"]
        API["Library API<br/>(index.ts)"]
    end

    subgraph "Core API Layer"
        makeCall["makeCall()<br/>(index.ts:86)"]
        createAgent["createAgent()<br/>(index.ts:297)"]
    end

    subgraph "Main Orchestrator"
        VoiceAgent["VoiceAgent<br/>(voice-agent.ts:11)<br/>EventEmitter"]
    end

    subgraph "Brief Processing"
        CallBriefProcessor["CallBriefProcessor<br/>(call-brief-processor.ts:10)<br/>o3-mini instructions"]
    end

    subgraph "Network Components"
        SIPClient["SIPClient<br/>(sip-client.ts:190)<br/>SIP Protocol"]
        AudioBridge["AudioBridge<br/>(audio-bridge.ts:19)<br/>RTP Streaming<br/>EventEmitter"]
        ConnectionManager["ConnectionManager<br/>(connection-manager.ts:35)<br/>Reconnection Logic<br/>EventEmitter"]
    end

    subgraph "OpenAI Integration"
        OpenAIClient["OpenAIClient<br/>(openai-client.ts:9)<br/>WebSocket + REST<br/>EventEmitter"]
    end

    subgraph "Audio Processing"
        AudioProcessor["AudioProcessor<br/>(audio-processor.ts:5)<br/>Sample Rate Conversion"]
        Codecs["Codec System<br/>(codecs/index.ts)<br/>G.722 / G.711"]
    end

    subgraph "Support Systems"
        Logger["Logger<br/>(logger.ts:440)<br/>Winston + Transcript"]
        Config["Config Loader<br/>(config.ts:19)<br/>File + Env"]
        Validation["ConfigurationValidator<br/>(validation.ts:18)<br/>5-layer validation"]
        ResponseTracker["ResponseTranscriptTracker<br/>(response-transcript-tracker.ts:10)<br/>Audio correlation"]
    end

    %% Entry point connections
    CLI --> |"call command"| makeCall
    MCP --> |"simple_call<br/>advanced_call"| makeCall
    API --> |"direct import"| makeCall
    API --> |"agent creation"| createAgent

    %% Core flow
    makeCall --> |"1. Load config"| Config
    makeCall --> |"2. Process brief"| CallBriefProcessor
    makeCall --> |"3. Create agent"| VoiceAgent
    createAgent --> VoiceAgent

    %% VoiceAgent orchestration
    VoiceAgent --> |"manages"| SIPClient
    VoiceAgent --> |"manages"| AudioBridge
    VoiceAgent --> |"manages"| OpenAIClient
    VoiceAgent --> |"uses"| ConnectionManager
    VoiceAgent --> |"tracks"| ResponseTracker

    %% Component interactions
    SIPClient --> |"negotiates codecs"| Codecs
    AudioBridge --> |"processes audio"| AudioProcessor
    AudioBridge --> |"encodes/decodes"| Codecs
    OpenAIClient --> |"audio events"| VoiceAgent
    AudioBridge --> |"RTP packets"| SIPClient
    
    %% Support system usage
    Config --> |"validates with"| Validation
    CallBriefProcessor --> |"o3-mini API"| OpenAIClient
    
    %% Event flows (dashed lines for events)
    VoiceAgent -.->|"events"| Logger
    AudioBridge -.->|"audio events"| VoiceAgent
    SIPClient -.->|"call events"| VoiceAgent
    OpenAIClient -.->|"transcript events"| VoiceAgent
    ConnectionManager -.->|"connection events"| VoiceAgent

    %% Styling
    classDef entryPoint fill:#e1f5fe,stroke:#01579b,stroke-width:3px
    classDef coreAPI fill:#f3e5f5,stroke:#4a148c,stroke-width:2px
    classDef orchestrator fill:#fff3e0,stroke:#e65100,stroke-width:3px
    classDef network fill:#e8f5e9,stroke:#1b5e20,stroke-width:2px
    classDef audio fill:#fce4ec,stroke:#880e4f,stroke-width:2px
    classDef support fill:#f5f5f5,stroke:#424242,stroke-width:1px
    classDef eventEmitter fill:#fff9c4,stroke:#f57f17,stroke-width:2px

    class CLI,MCP,API entryPoint
    class makeCall,createAgent coreAPI
    class VoiceAgent orchestrator
    class SIPClient,AudioBridge,ConnectionManager network
    class AudioProcessor,Codecs audio
    class Logger,Config,Validation,ResponseTracker support
    class OpenAIClient,CallBriefProcessor eventEmitter
```

## Call Flow Sequence

```mermaid
sequenceDiagram
    participant User
    participant Entry as Entry Point<br/>(CLI/MCP/API)
    participant makeCall as makeCall()
    participant Config
    participant Brief as CallBriefProcessor
    participant VA as VoiceAgent
    participant SIP as SIPClient
    participant Audio as AudioBridge
    participant OpenAI as OpenAIClient
    participant RTP as RTP/Audio

    User->>Entry: Initiate call
    Entry->>makeCall: Call with options
    
    makeCall->>Config: Load configuration
    Config-->>makeCall: Config object
    
    alt Has brief
        makeCall->>Brief: Process brief (o3-mini)
        Brief-->>makeCall: Generated instructions
    end
    
    makeCall->>VA: Create VoiceAgent
    VA->>SIP: Initialize SIP connection
    VA->>Audio: Setup audio bridge
    VA->>OpenAI: Connect WebSocket
    
    SIP->>SIP: INVITE/negotiate codecs
    SIP-->>Audio: Codec selected
    
    par Bidirectional Audio
        RTP->>Audio: Incoming RTP packets
        Audio->>Audio: Decode (G.722/G.711)
        Audio->>Audio: Resample to 24kHz
        Audio->>OpenAI: Send PCM audio
    and
        OpenAI->>Audio: AI audio (24kHz)
        Audio->>Audio: Resample to 16k/8k
        Audio->>Audio: Encode (G.722/G.711)
        Audio->>RTP: Send RTP packets
    and
        OpenAI->>VA: Transcripts
        VA->>VA: Track responses
        VA-->>Entry: Real-time events
    end
    
    VA->>SIP: Hangup
    VA->>OpenAI: Disconnect
    VA-->>makeCall: Call result
    makeCall-->>Entry: Result
    Entry-->>User: Call completed
```

## Key Design Patterns

### Event-Driven Architecture
- **EventEmitters**: VoiceAgent, AudioBridge, OpenAIClient, ConnectionManager
- **Event Flow**: Components communicate asynchronously via events
- **Decoupling**: Loose coupling between major components

### Module Responsibilities

| Module | Primary Responsibility | Key Methods/Events |
|--------|----------------------|-------------------|
| **VoiceAgent** | Main orchestrator | `startCall()`, `endCall()`, emits: `callStarted`, `callEnded`, `error` |
| **SIPClient** | SIP protocol handling | `call()`, `hangup()`, handles INVITE/BYE |
| **AudioBridge** | RTP streaming & codecs | `startRTPSession()`, `processAudio()` |
| **OpenAIClient** | OpenAI API integration | WebSocket events, REST for brief processing |
| **CallBriefProcessor** | Natural language → instructions | `generateInstructions()` using o3-mini |
| **ConnectionManager** | Reconnection with backoff | `connect()`, `reconnect()`, exponential backoff |

### Data Flow Patterns

1. **Configuration Priority**: CLI flags > Config file > Environment variables
2. **Brief Processing**: Natural language → o3-mini → structured instructions
3. **Audio Pipeline**: RTP → Decode → Resample → OpenAI → Resample → Encode → RTP
4. **Response Tracking**: OpenAI response IDs → transcript correlation → audio completion

### Critical Paths

1. **Call Initiation**:
   - Entry → makeCall → Config → VoiceAgent → SIPClient

2. **Audio Processing**:
   - RTP packets → AudioBridge → Codec → AudioProcessor → OpenAI

3. **Transcript Handling**:
   - OpenAI → ResponseTracker → VoiceAgent → Logger (transcript channel)