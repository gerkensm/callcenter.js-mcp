import winston from "winston";

export enum LogLevel {
  QUIET = "quiet", // Only transcripts
  ERROR = "error", // Errors only
  WARN = "warn", // Warnings and errors
  INFO = "info", // General info, warnings, errors
  DEBUG = "debug", // All logs including debug info
  VERBOSE = "verbose", // Maximum verbosity
}

export interface LoggerConfig {
  level: LogLevel;
  enableColors?: boolean;
  enableTimestamp?: boolean;
  transcriptOnly?: boolean; // For quiet mode - only show conversation transcripts
}

class VoIPLogger {
  public logger: winston.Logger; // Made public for transcript access
  private config: LoggerConfig;
  private transcriptBuffer: string[] = [];
  private lastTranscriptRole: string | null = null;

  constructor(config: LoggerConfig) {
    this.config = config;

    // Map our log levels to winston levels
    // transcript has highest priority (0) so it's always shown
    const winstonLevels = {
      transcript: 0, // Always shown - for conversation transcripts
      error: 1,
      warn: 2,
      info: 3,
      debug: 4,
      verbose: 5,
      quiet: 6, // Quiet is now just a config flag, not a real level
    };

    const formats: winston.Logform.Format[] = [];

    // Add metadata format to properly handle category and other metadata
    formats.push(
      winston.format.metadata({ fillExcept: ["message", "level", "timestamp"] })
    );

    if (config.enableColors !== false) {
      formats.push(winston.format.colorize());
    }

    if (config.enableTimestamp !== false && config.level !== LogLevel.QUIET) {
      formats.push(winston.format.timestamp({ format: "HH:mm:ss" }));
    }

    // Custom format for quiet mode vs normal mode
    if (config.transcriptOnly) {
      formats.push(
        winston.format.printf((info: any) => {
          // In quiet mode, show transcript, error, and warning level messages
          // Check both the Symbol key and string key for level
          const level = info.level || info[Symbol.for("level")];
          // Clean level of any ANSI color codes for comparison
          const cleanLevel = String(level).replace(/\x1b\[[0-9;]*m/g, "");
          
          if (cleanLevel === "transcript" || cleanLevel.includes("transcript")) {
            return String(info.message);
          } else if (cleanLevel === "error" || cleanLevel === "warn") {
            // For errors and warnings, show with basic formatting
            const { message, timestamp, metadata } = info;
            const timePrefix = timestamp ? `[${timestamp}] ` : "";
            const levelPrefix = `[${cleanLevel.toUpperCase()}] `;
            const category = metadata?.category;
            const categoryEmojis: { [key: string]: string } = {
              SIP: "📞",
              AUDIO: "🔊", 
              AI: "🤖",
              RTP: "📡",
              CODEC: "🎵",
              PERF: "📊",
              CONFIG: "⚙️",
              TRANSCRIPT: "💬",
              ASSISTANT: "🤖",
              USER: "👤",
              CALL_STATUS: "📞",
            };
            const categoryPrefix = category ? `${categoryEmojis[category] || category.substring(0, 1)} ` : "";
            // Handle multi-line indentation for quiet mode
            const prefixLength = (timePrefix + levelPrefix + categoryPrefix).length;
            const indentSpaces = " ".repeat(prefixLength);
            const lines = String(message).split('\n');
            const formattedMessage = lines.map((line, index) => 
              index === 0 ? line : indentSpaces + line
            ).join('\n');
            
            return `${timePrefix}${levelPrefix}${categoryPrefix}${formattedMessage}`;
          }
          return ""; // Hide other messages (info, debug, verbose)
        })
      );
    } else {
      formats.push(
        winston.format.printf((info: any) => {
          const { level, message, timestamp, metadata } = info;

          // Strip any ANSI color codes from level (winston colorize adds them)
          const cleanLevel = level.replace(/\x1b\[[0-9;]*m/g, "");

          const timePrefix = timestamp ? `\x1b[90m[${timestamp}]\x1b[0m ` : "";

          // Add level indicator with colors (intensity based on severity)
          const levelNames: { [key: string]: string } = {
            transcript: "TRNS",
            error: "ERR",
            warn: "WARN",
            info: "INFO",
            debug: "DBG",
            verbose: "VERB",
          };
          const levelColors: { [key: string]: string } = {
            transcript: "\x1b[96m", // Bright Cyan
            error: "\x1b[91m", // Bright Red
            warn: "\x1b[93m", // Bright Yellow
            info: "\x1b[94m", // Bright Blue
            debug: "\x1b[90m", // Dim Gray
            verbose: "\x1b[37m", // Dim White
          };
          const levelColor = levelColors[cleanLevel] || "\x1b[0m";
          const shortLevel = levelNames[cleanLevel] || cleanLevel.toUpperCase();
          // Pad level to 4 characters for alignment
          const paddedLevel = shortLevel.padEnd(4);
          const levelPrefix = `${levelColor}[${paddedLevel}]\x1b[0m `;

          // Extract category from metadata
          const category = metadata?.category;

          // Add category with both text and color coding and fixed width padding
          let categoryPrefix = "";
          if (category) {
            const categoryNames: { [key: string]: string } = {
              SIP: "📞",
              AUDIO: "🔊",
              AI: "🤖",
              RTP: "📡",
              CODEC: "🎵",
              PERF: "📊",
              CONFIG: "⚙️",
              TRANSCRIPT: "💬",
              ASSISTANT: "🤖",
              USER: "👤",
              CALL_STATUS: "📞",
            };
            const categoryColors: { [key: string]: string } = {
              SIP: "\x1b[34m", // Blue
              AUDIO: "\x1b[35m", // Magenta
              AI: "\x1b[36m", // Cyan
              RTP: "\x1b[33m", // Yellow
              CODEC: "\x1b[32m", // Green
              PERF: "\x1b[37m", // White
              CONFIG: "\x1b[95m", // Bright Magenta
              TRANSCRIPT: "\x1b[92m", // Bright Green
              ASSISTANT: "\x1b[36m", // Cyan
              USER: "\x1b[92m", // Bright Green
            };
            const color = categoryColors[category] || "\x1b[0m";
            const emoji = categoryNames[category] || category.substring(0, 1);
            categoryPrefix = `${emoji} `;
          } else {
            // No category - pad with spaces to match "🔊 " format (2 chars)
            categoryPrefix = "  ";
          }

          // Clean up message formatting - remove redundant emojis if they're in the category
          let cleanMessage = String(message);
          if (category) {
            // Remove emoji prefixes that are already in the category
            cleanMessage = cleanMessage.replace(
              /^[📞🔊🤖📡🎵📊⚙️💬🎤🚀✅❌⚠️🔍🔄🎯📋📥📭🗑️🛑🎉💡🔚]+\s*/,
              ""
            );
          }

          // Handle multi-line indentation
          const prefixLength = (timePrefix + levelPrefix + categoryPrefix).length;
          const indentSpaces = " ".repeat(prefixLength);
          const lines = cleanMessage.split('\n');
          const formattedMessage = lines.map((line, index) => 
            index === 0 ? line : indentSpaces + line
          ).join('\n');
          
          return `${timePrefix}${levelPrefix}${categoryPrefix}${formattedMessage}`;
        })
      );
    }

    this.logger = winston.createLogger({
      levels: winstonLevels,
      level: config.level === LogLevel.QUIET ? "warn" : config.level, // In quiet mode, allow transcript, error, and warn levels
      format: winston.format.combine(...formats),
      transports: [
        new winston.transports.Console({
          silent: false,
        }),
      ],
    });

    winston.addColors({
      transcript: "green", // Transcripts in green
      quiet: "green",
      error: "red",
      warn: "yellow",
      info: "blue",
      debug: "gray",
      verbose: "cyan",
    });
  }

  // Standard logging methods - winston 3 expects metadata as additional arguments
  error(message: string, category?: string, meta?: any): void {
    // Always show errors, even in transcript-only mode
    this.logger.error(message, { category, ...meta });
  }

  warn(message: string, category?: string, meta?: any): void {
    // Always show warnings, even in transcript-only mode
    this.logger.warn(message, { category, ...meta });
  }

  info(message: string, category?: string, meta?: any): void {
    if (!this.config.transcriptOnly) {
      this.logger.info(message, { category, ...meta });
    }
  }

  debug(message: string, category?: string, meta?: any): void {
    if (!this.config.transcriptOnly) {
      this.logger.debug(message, { category, ...meta });
    }
  }

  verbose(message: string, category?: string, meta?: any): void {
    if (!this.config.transcriptOnly) {
      this.logger.verbose(message, { category, ...meta });
    }
  }

  // Convenience methods for common categories
  sip = {
    info: (message: string, meta?: any) => this.info(message, "SIP", meta),
    error: (message: string, meta?: any) => this.error(message, "SIP", meta),
    debug: (message: string, meta?: any) => this.debug(message, "SIP", meta),
    warn: (message: string, meta?: any) => this.warn(message, "SIP", meta),
  };

  audio = {
    info: (message: string, meta?: any) => this.info(message, "AUDIO", meta),
    error: (message: string, meta?: any) => this.error(message, "AUDIO", meta),
    debug: (message: string, meta?: any) => this.debug(message, "AUDIO", meta),
    verbose: (message: string, meta?: any) =>
      this.verbose(message, "AUDIO", meta),
    warn: (message: string, meta?: any) => this.warn(message, "AUDIO", meta),
  };

  ai = {
    info: (message: string, meta?: any) => this.info(message, "AI", meta),
    error: (message: string, meta?: any) => this.error(message, "AI", meta),
    debug: (message: string, meta?: any) => this.debug(message, "AI", meta),
    warn: (message: string, meta?: any) => this.warn(message, "AI", meta),
    verbose: (message: string, meta?: any) => this.verbose(message, "AI", meta),
  };

  rtp = {
    debug: (message: string, meta?: any) => this.debug(message, "RTP", meta),
    verbose: (message: string, meta?: any) =>
      this.verbose(message, "RTP", meta),
    warn: (message: string, meta?: any) => this.warn(message, "RTP", meta),
    info: (message: string, meta?: any) => this.info(message, "RTP", meta),
    error: (message: string, meta?: any) => this.error(message, "RTP", meta),
  };

  codec = {
    info: (message: string, meta?: any) => this.info(message, "CODEC", meta),
    debug: (message: string, meta?: any) => this.debug(message, "CODEC", meta),
    error: (message: string, meta?: any) => this.error(message, "CODEC", meta),
  };

  perf = {
    verbose: (message: string, meta?: any) =>
      this.verbose(message, "PERF", meta),
    debug: (message: string, meta?: any) => this.debug(message, "PERF", meta),
    warn: (message: string, meta?: any) => this.warn(message, "PERF", meta),
  };

  configLogs = {
    info: (message: string, meta?: any) => this.info(message, "CONFIG", meta),
    warn: (message: string, meta?: any) => this.warn(message, "CONFIG", meta),
    error: (message: string, meta?: any) => this.error(message, "CONFIG", meta),
  };

  assistant = {
    transcript: (message: string, meta?: any) => this.logger.log("transcript", message, { category: "ASSISTANT", ...meta }),
  };

  user = {
    transcript: (message: string, meta?: any) => this.logger.log("transcript", message, { category: "USER", ...meta }),
  };

  callStatus = {
    transcript: (message: string, meta?: any) => this.logger.log("transcript", message, { category: "CALL_STATUS", ...meta }),
  };

  // Special method for conversation transcripts
  transcript(
    role: "user" | "assistant",
    text: string,
    isDelta: boolean = false
  ): void {
    // In quiet mode: skip assistant deltas (they have complete versions)
    // but allow user deltas (they ONLY come as deltas)
    if (this.config.transcriptOnly && isDelta && role === "assistant") {
      return;
    }

    // Prevent duplicate transcripts
    const transcriptKey = `${role}:${text}`;

    // Get timestamp for transcript mode
    const getTimestamp = () => {
      if (this.config.transcriptOnly) {
        const now = new Date();
        return `[${now.toTimeString().substring(0, 8)}] `;
      }
      return "";
    };

    if (isDelta) {
      // For delta updates, add user deltas but skip assistant deltas in quiet mode
      if (role === "user") {
        // Always add user deltas to transcript buffer (they don't have complete versions)
        const timestamp = getTimestamp();
        this.user.transcript(`${timestamp}USER: ${text}`);
        this.transcriptBuffer.push(transcriptKey);
        this.lastTranscriptRole = role;
        
      } else if (role === "assistant") {
        // Skip assistant deltas entirely to avoid word-by-word output
        // Assistant complete utterances will be handled in the else block below
        return;
      }
    } else {
      // For complete utterances, always show but check for duplicates
      if (!this.transcriptBuffer.includes(transcriptKey)) {
        const timestamp = getTimestamp();
        if (role === "user") {
          this.user.transcript(`${timestamp}USER: ${text}`);
        } else {
          this.assistant.transcript(`${timestamp}ASSISTANT: ${text}`);
        }
        this.transcriptBuffer.push(transcriptKey);
      }
    }
  }

  // Get full conversation transcript
  getFullTranscript(): string[] {
    return [...this.transcriptBuffer].map(entry => {
      // Extract role and text from the stored format "role:text"
      const colonIndex = entry.indexOf(':');
      if (colonIndex > 0) {
        const role = entry.substring(0, colonIndex);
        const text = entry.substring(colonIndex + 1);
        const roleIcon = role === "user" ? "🎤" : "🤖";
        const timestamp = this.config.transcriptOnly ? 
          `[${new Date().toTimeString().substring(0, 8)}] ` : '';
        return `${timestamp}${roleIcon} ${role.toUpperCase()}: ${text}`;
      }
      return entry; // Fallback for any malformed entries
    });
  }

  // Clear transcript buffer (for new calls)
  clearTranscript(): void {
    this.transcriptBuffer = [];
    this.lastTranscriptRole = null;
  }

  // Update log level dynamically
  setLevel(level: LogLevel): void {
    this.config.level = level;
    this.config.transcriptOnly = level === LogLevel.QUIET;
    this.logger.level = level === LogLevel.QUIET ? "verbose" : level;
  }

  // Check if a log level is enabled
  isLevelEnabled(level: LogLevel): boolean {
    if (this.config.transcriptOnly && level !== LogLevel.QUIET) {
      return false;
    }
    return this.logger.isLevelEnabled(level);
  }

  // Check if we're in quiet/transcript-only mode
  isQuietMode(): boolean {
    return this.config.transcriptOnly || false;
  }
}

// Global logger instance
let globalLogger: VoIPLogger;

export function initializeLogger(config: LoggerConfig): VoIPLogger {
  globalLogger = new VoIPLogger(config);
  return globalLogger;
}

export function getLogger(): VoIPLogger {
  if (!globalLogger) {
    // Initialize with default config if not already initialized
    globalLogger = new VoIPLogger({
      level: LogLevel.INFO,
      enableColors: true,
      enableTimestamp: true,
      transcriptOnly: false,
    });
  }
  return globalLogger;
}

// Export the logger instance
export { VoIPLogger };
