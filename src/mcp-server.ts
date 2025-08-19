#!/usr/bin/env node

/**
 * MCP Server for AI Voice Agent
 * 
 * Provides two tools for MCP clients:
 * 1. simple_call - Easy calling with brief generation via o3
 * 2. advanced_call - Granular control over all call parameters
 * 
 * This is a simplified MCP-compatible server that communicates via stdio
 */

import { makeCall, CallOptions, CallResult } from './index.js';

/**
 * Simple call tool for basic usage with o3 instruction generation
 */
const SIMPLE_CALL_TOOL = {
  name: "simple_call",
  description: "Make an AI-powered phone call with automatic instruction generation. Requires a brief description, your name, and phone number. The system will use OpenAI's o3 model to generate detailed instructions.\n\nWhy this works better than manual instructions: OpenAI's real-time voice models are optimized for speed, not sophistication. They struggle with complex, goal-oriented tasks without very specific instructions. The o3 model automatically transforms your simple brief (like 'Call the restaurant and book a table for 2 at 7pm') into sophisticated, detailed instructions with conversation states, fallback strategies, and appropriate tone - saving you from writing lengthy manual instructions while achieving much better call results.",
  inputSchema: {
    type: "object",
    properties: {
      phone_number: {
        type: "string",
        description: "Phone number to call (international format, extension, or service code, e.g., +1234567890, **621, #123)",
        pattern: "^[\\+\\*#0-9]+$"
      },
      brief: {
        type: "string",
        description: "Brief description of what you want to accomplish on the call. Be specific about the goal, context, and any important details. Example: 'Call Bocca di Bacco restaurant and book a table for 2 people at 19:30 today for dinner. Mention dietary restrictions: vegetarian options needed.'",
        minLength: 20,
        maxLength: 500
      },
      caller_name: {
        type: "string",
        description: "Your name that the AI should use when introducing itself on the call. Example: 'John Smith' or 'Sarah Johnson'",
        minLength: 2,
        maxLength: 50
      },
      config_path: {
        type: "string",
        description: "Optional path to configuration file. If not provided, will use environment variables for SIP and OpenAI credentials.",
        default: "config.json"
      },
      duration: {
        type: "number",
        description: "Optional maximum call duration in seconds. If not set, call continues until naturally concluded or manually ended. WARNING: This will abruptly cut off the phone call when reached, so use a reasonable duration that allows the conversation to complete naturally.",
        minimum: 10,
        maximum: 1800
      },
      recording: {
        type: "boolean",
        description: "Whether to record the call for later review. Recorded files are saved with timestamp.",
        default: false
      }
    },
    required: ["phone_number", "brief", "caller_name"],
    examples: [
      {
        phone_number: "+12125551234",
        brief: "Call Mama's Italian Kitchen and make a reservation for 4 people tonight at 7 PM. Ask about their wine selection and mention we're celebrating an anniversary.",
        caller_name: "Jennifer Martinez"
      },
      {
        phone_number: "+14155552468",
        brief: "Call TechFix repair shop to inquire about the status of my iPhone repair. Reference ticket number TF-2024-0892. Ask for estimated completion time.",
        caller_name: "Michael Chen",
        duration: 300,
        recording: true
      }
    ]
  }
};

/**
 * Advanced call tool for granular control over all call brief components
 */
const ADVANCED_CALL_TOOL = {
  name: "advanced_call",  
  description: "Make an AI-powered phone call with granular control over all call brief components. Specify each field individually instead of using a natural language brief. The system will use o3 to generate optimized instructions from your structured data.\n\nThis tool gives you fine-grained control over every aspect of the call brief - target name, goal, constraints, fallback options, formality level, industry context, etc. The o3 model will still generate sophisticated instructions, but based on your structured input rather than a free-form brief. Use this when you need precise control over specific parameters or have complex requirements that benefit from structured specification.",
  inputSchema: {
    type: "object",
    properties: {
      phone_number: {
        type: "string",
        description: "Phone number to call (international format, extension, or service code, e.g., +1234567890, **621, #123)",
        pattern: "^[\\+\\*#0-9]+$"
      },
      
      // Core call brief components
      user_name: {
        type: "string",
        description: "Your name that the AI should use when introducing itself (e.g., 'John Smith')",
        minLength: 2,
        maxLength: 50
      },
      target_name: {
        type: "string",
        description: "Name of the person/business being called (e.g., 'Mario's Pizza', 'Dr. Johnson')",
        maxLength: 100
      },
      goal: {
        type: "string", 
        description: "Primary objective of the call. Be specific and actionable (e.g., 'book a table for 4 people tonight at 7 PM', 'reschedule appointment from Tuesday to Friday morning')",
        minLength: 10,
        maxLength: 200
      },
      
      // Optional contextual details
      language: {
        type: "string",
        description: "Preferred language for the call (e.g., 'English', 'Spanish', 'French')",
        default: "English"
      },
      date: {
        type: "string", 
        description: "Specific date if relevant to the call (e.g., 'today', 'December 25th', '2024-01-15')",
        maxLength: 50
      },
      time: {
        type: "string",
        description: "Specific time if relevant (e.g., '7:30 PM', 'morning', 'between 2-4 PM')",
        maxLength: 50
      },
      location: {
        type: "string",
        description: "Location details if relevant (e.g., 'downtown Manhattan', '123 Main St', 'conference room A')",
        maxLength: 100
      },
      constraints: {
        type: "string",
        description: "Any constraints or requirements (e.g., 'vegetarian options needed', 'wheelchair accessible', 'urgent - same day delivery')",
        maxLength: 200
      },
      fallback_options: {
        type: "string",
        description: "Alternative options if primary goal can't be achieved (e.g., 'if 7 PM not available, try 6 or 8 PM', 'if no appointments this week, schedule for next week')",
        maxLength: 200
      },
      user_contact_return: {
        type: "string", 
        description: "Contact info for callbacks or confirmations (e.g., 'john@email.com', '+1234567890', 'call back at this number')",
        maxLength: 100
      },
      budget: {
        type: "string",
        description: "Budget constraints if relevant (e.g., 'under $50', 'flexible budget', '$100-200 range')",
        maxLength: 50
      },
      urgency: {
        type: "string",
        description: "Urgency level and timing (e.g., 'urgent - needed today', 'flexible timing', 'by end of week')",
        maxLength: 100
      },
      industry: {
        type: "string", 
        description: "Industry context for appropriate tone (e.g., 'restaurant', 'medical', 'legal', 'retail', 'automotive')",
        maxLength: 50
      },
      jurisdiction: {
        type: "string",
        description: "Legal/regulatory context if relevant (e.g., 'California', 'HIPAA compliant', 'EU GDPR')",
        maxLength: 50
      },
      allow_persuasion_white_lies: {
        type: "boolean",
        description: "Whether the agent can use minor persuasive techniques or white lies to achieve the goal (default: false for maximum honesty)",
        default: false
      },
      requires_formality: {
        type: "string",
        enum: ["low", "medium", "high"],
        description: "Required formality level: 'low' (casual, friendly), 'medium' (professional), 'high' (very formal, corporate)",
        default: "medium"
      },
      
      // Configuration and call settings
      config: {
        type: "object",
        description: "Complete configuration object with SIP and AI settings",
        properties: {
          sip: {
            type: "object",
            properties: {
              username: { type: "string", description: "SIP username" },
              password: { type: "string", description: "SIP password" },
              serverIp: { type: "string", description: "SIP server IP address" },
              serverPort: { type: "number", default: 5060 },
              localPort: { type: "number", default: 5060 }
            },
            required: ["username", "password", "serverIp"]
          },
          ai: {
            type: "object",
            properties: {
              openaiApiKey: { type: "string", description: "OpenAI API key" },
              voice: { type: "string", enum: ["alloy", "echo", "fable", "onyx", "nova", "shimmer"], default: "nova" }
            },
            required: ["openaiApiKey"]
          }
        },
        required: ["sip", "ai"]
      },
      config_path: {
        type: "string",
        description: "Alternative to config object - path to configuration file"
      },
      duration: {
        type: "number",
        description: "Maximum call duration in seconds. WARNING: This will abruptly cut off the phone call when reached, so use a reasonable duration that allows the conversation to complete naturally.",
        minimum: 10,
        maximum: 1800
      },
      recording: {
        type: "boolean",
        description: "Enable call recording",
        default: false
      },
      recording_filename: {
        type: "string",
        description: "Custom filename for call recording (if recording enabled)"
      },
      log_level: {
        type: "string",
        enum: ["quiet", "error", "warn", "info", "debug", "verbose"],
        description: "Logging verbosity level",
        default: "quiet"
      },
      colors: {
        type: "boolean",
        description: "Enable colored console output",
        default: true
      },
      timestamps: {
        type: "boolean", 
        description: "Include timestamps in log output",
        default: false
      }
    },
    required: ["phone_number", "user_name", "goal"],
    examples: [
      {
        phone_number: "+12125551234",
        user_name: "Jennifer Martinez",
        target_name: "Mario's Pizzeria", 
        goal: "place a delivery order for 1 large margherita pizza, 1 medium pepperoni pizza, and 2 Coke bottles",
        location: "123 Main Street, Apartment 4B, New York, NY 10001",
        constraints: "delivery needed within 45 minutes",
        fallback_options: "if delivery not available in time, ask for pickup options",
        urgency: "standard delivery timing",
        industry: "restaurant",
        requires_formality: "low",
        config_path: "config.json",
        duration: 600,
        recording: true,
        log_level: "info"
      },
      {
        phone_number: "+14155552468",
        user_name: "Dr. Sarah Johnson", 
        target_name: "ABC Medical Office",
        goal: "reschedule patient consultation from tomorrow 2 PM to Friday morning",
        date: "Friday",
        time: "between 10 AM - 12 PM",
        constraints: "patient ID #789432",
        fallback_options: "if Friday not available, next earliest slot next week",
        user_contact_return: "sarah.johnson@email.com",
        urgency: "flexible but prefer this week",
        industry: "medical",
        requires_formality: "high",
        config: {
          sip: {
            username: "user123", 
            password: "pass456",
            serverIp: "192.168.1.1"
          },
          ai: {
            openaiApiKey: "sk-...",
            voice: "nova"
          }
        },
        log_level: "quiet",
        recording: false
      }
    ]
  }
};

interface MCPRequest {
  jsonrpc: '2.0';
  id: string | number;
  method: string;
  params?: any;
}

interface MCPResponse {
  jsonrpc: '2.0';
  id: string | number;
  result?: any;
  error?: {
    code: number;
    message: string;
    data?: any;
  };
}

class MCPServer {
  constructor() {
    this.setupStdioHandling();
  }

  private setupStdioHandling(): void {
    let buffer = '';
    
    process.stdin.on('data', (chunk) => {
      buffer += chunk.toString();
      
      // Process complete JSON-RPC messages
      let lines = buffer.split('\n');
      buffer = lines.pop() || ''; // Keep incomplete line in buffer
      
      for (const line of lines) {
        if (line.trim()) {
          try {
            const request: MCPRequest = JSON.parse(line.trim());
            this.handleRequest(request);
          } catch (error) {
            this.sendError(null, -32700, 'Parse error');
          }
        }
      }
    });

    process.stdin.on('end', () => {
      process.exit(0);
    });
  }

  private async handleRequest(request: MCPRequest): Promise<void> {
    try {
      switch (request.method) {
        case 'tools/list':
          this.sendResponse(request.id, {
            tools: [SIMPLE_CALL_TOOL, ADVANCED_CALL_TOOL]
          });
          break;
          
        case 'tools/call':
          const result = await this.handleToolCall(request.params);
          this.sendResponse(request.id, result);
          break;
          
        case 'initialize':
          this.sendResponse(request.id, {
            protocolVersion: "2024-11-05",
            capabilities: {
              tools: {}
            },
            serverInfo: {
              name: "ai-voice-agent",
              version: "1.0.0"
            }
          });
          break;
          
        default:
          this.sendError(request.id, -32601, `Method not found: ${request.method}`);
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      this.sendError(request.id, -32603, `Internal error: ${errorMessage}`);
    }
  }

  private async handleToolCall(params: any): Promise<any> {
    const { name, arguments: args } = params;

    switch (name) {
      case "simple_call":
        return await this.handleSimpleCall(args);
      
      case "advanced_call":
        return await this.handleAdvancedCall(args);
      
      default:
        throw new Error(`Unknown tool: ${name}`);
    }
  }

  private sendResponse(id: string | number, result: any): void {
    const response: MCPResponse = {
      jsonrpc: '2.0',
      id,
      result
    };
    process.stdout.write(JSON.stringify(response) + '\n');
  }

  private sendError(id: string | number | null, code: number, message: string, data?: any): void {
    const response: MCPResponse = {
      jsonrpc: '2.0',
      id: id || 0,
      error: {
        code,
        message,
        data
      }
    };
    process.stdout.write(JSON.stringify(response) + '\n');
  }

  private async handleSimpleCall(args: any): Promise<{ content: any[] }> {
    const { phone_number, brief, caller_name, config_path, duration, recording } = args;

    // Validate required parameters
    if (!phone_number || !brief || !caller_name) {
      throw new Error("Missing required parameters: phone_number, brief, and caller_name are required");
    }

    // Validate phone number format
    if (!/^[\+\*#0-9]+$/.test(phone_number)) {
      throw new Error("Invalid phone number format. Use digits, +, *, or # characters (e.g., +1234567890, **621, #123)");
    }

    // Validate brief length and content
    if (brief.length < 20) {
      throw new Error("Brief too short. Provide at least 20 characters with specific details about what you want to accomplish.");
    }

    if (brief.length > 500) {
      throw new Error("Brief too long. Keep it under 500 characters for optimal instruction generation.");
    }

    const callOptions: CallOptions = {
      number: phone_number,
      brief,
      userName: caller_name,
      config: config_path || 'config.json',
      duration,
      recording,
      logLevel: 'quiet'
    };

    try {
      const result = await makeCall(callOptions);
      
      return {
        content: [
          {
            type: "text",
            text: this.formatCallResult(result, 'simple')
          }
        ]
      };
    } catch (error) {
      throw new Error(`Call failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  private async handleAdvancedCall(args: any): Promise<{ content: any[] }> {
    const {
      phone_number,
      user_name,
      target_name,
      goal,
      language,
      date,
      time,
      location,
      constraints,
      fallback_options,
      user_contact_return,
      budget,
      urgency,
      industry,
      jurisdiction,
      allow_persuasion_white_lies,
      requires_formality,
      config,
      config_path,
      duration,
      recording,
      recording_filename,
      log_level,
      colors,
      timestamps
    } = args;

    // Validate required parameters
    if (!phone_number || !user_name || !goal) {
      throw new Error("Missing required parameters: phone_number, user_name, and goal are required");
    }

    // Validate configuration is provided
    if (!config && !config_path) {
      throw new Error("Either config object or config_path must be provided");
    }

    // Validate phone number format
    if (!/^[\+\*#0-9]+$/.test(phone_number)) {
      throw new Error("Invalid phone number format. Use digits, +, *, or # characters (e.g., +1234567890, **621, #123)");
    }

    // Validate goal length
    if (goal.length < 10) {
      throw new Error("Goal too short. Provide a specific, actionable goal (at least 10 characters).");
    }

    if (goal.length > 200) {
      throw new Error("Goal too long. Keep goals concise and focused (under 200 characters).");
    }

    // Build structured brief text from individual components
    let briefText = `Call ${target_name || 'the target'} to ${goal}.`;
    
    if (language && language !== 'English') briefText += ` Language: ${language}.`;
    if (date) briefText += ` Date: ${date}.`;
    if (time) briefText += ` Time: ${time}.`;
    if (location) briefText += ` Location: ${location}.`;
    if (constraints) briefText += ` Constraints: ${constraints}.`;
    if (fallback_options) briefText += ` Fallback options: ${fallback_options}.`;
    if (user_contact_return) briefText += ` Contact for follow-up: ${user_contact_return}.`;
    if (budget) briefText += ` Budget: ${budget}.`;
    if (urgency) briefText += ` Urgency: ${urgency}.`;
    if (industry) briefText += ` Industry: ${industry}.`;
    if (jurisdiction) briefText += ` Jurisdiction: ${jurisdiction}.`;
    if (allow_persuasion_white_lies) briefText += ` Persuasion allowed: yes.`;
    if (requires_formality) briefText += ` Formality level: ${requires_formality}.`;
    
    briefText += ` Calling on behalf of ${user_name}.`;

    const callOptions: CallOptions = {
      number: phone_number,
      brief: briefText,
      userName: user_name,
      config: config || config_path,
      duration,
      recording: recording_filename ? recording_filename : recording,
      logLevel: log_level || 'quiet',
      colors,
      timestamps
    };

    try {
      const result = await makeCall(callOptions);
      
      return {
        content: [
          {
            type: "text", 
            text: this.formatCallResult(result, 'advanced')
          }
        ]
      };
    } catch (error) {
      throw new Error(`Call failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  private formatCallResult(result: CallResult, toolType: 'simple' | 'advanced'): string {
    const lines = [
      `# ${toolType === 'simple' ? 'Simple' : 'Advanced'} Call Result`,
      '',
      `**Status:** ${result.success ? '✅ Success' : '❌ Failed'}`,
      `**Duration:** ${result.duration} seconds`,
    ];

    if (result.callId) {
      lines.push(`**Call ID:** ${result.callId}`);
    }

    if (result.error) {
      lines.push(`**Error:** ${result.error}`);
    }

    if (result.transcript && result.transcript.length > 0) {
      lines.push('', '## Call Transcript', '', result.transcript);
    } else if (result.success) {
      lines.push('', '*No transcript available - call may have been too short or transcript recording disabled.*');
    }

    return lines.join('\n');
  }

  private setupErrorHandling(): void {
    process.on('SIGINT', () => {
      process.exit(0);
    });

    process.on('SIGTERM', () => {
      process.exit(0);
    });
  }

  async start(): Promise<void> {
    this.setupErrorHandling();
    console.error('[MCP Server] AI Voice Agent MCP server running on stdio');
    
    // Keep the process alive
    return new Promise(() => {
      // This promise never resolves, keeping the server running
    });
  }
}

// Export function to start the server
export async function startMCPServer(): Promise<void> {
  const server = new MCPServer();
  try {
    await server.start();
  } catch (error) {
    console.error('[MCP Server] Failed to start server:', error);
    process.exit(1);
  }
}

// If running directly (not imported), start the server
if (import.meta.url === `file://${process.argv[1]}`) {
  startMCPServer();
}