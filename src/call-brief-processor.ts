import OpenAI from "openai";
import { META_PROMPT } from "./meta-prompt.js";
import { getLogger } from "./logger.js";

export interface CallBriefProcessorConfig {
  openaiApiKey: string;
  defaultUserName?: string;
}

export class CallBriefProcessor {
  private openai: OpenAI;
  private config: CallBriefProcessorConfig;

  constructor(config: CallBriefProcessorConfig) {
    this.config = config;
    this.openai = new OpenAI({
      apiKey: config.openaiApiKey,
    });
  }

  /**
   * Generate voice agent instructions from a call brief using o3 model
   */
  async generateInstructions(
    briefText: string,
    userName?: string
  ): Promise<string> {
    try {
      getLogger().ai.info(
        "Generating voice agent instructions from call brief..."
      );
      getLogger().ai.debug(`Call brief: "${briefText}"`);

      const finalUserName = userName || this.config.defaultUserName;

      if (!finalUserName) {
        throw new Error(
          "User name is required for brief instruction generation. Provide userName parameter or set defaultUserName in config."
        );
      }

      const contextualizedBrief = `${briefText}. You are calling on behalf of ${finalUserName}.`;

      const response = await this.openai.chat.completions.create({
        model: "o3-mini",
        messages: [
          {
            role: "system",
            content: META_PROMPT,
          },
          {
            role: "user",
            content: `Call Brief: ${contextualizedBrief}`,
          },
        ],
        max_completion_tokens: 5000,
        reasoning_effort: "medium",
      });

      const instructions = response.choices[0]?.message?.content?.trim();

      if (!instructions) {
        throw new Error("No instructions generated from call brief");
      }

      getLogger().ai.info("Successfully generated voice agent instructions");
      getLogger().ai.info(
        `Generated instructions (${instructions.length} characters):`
      );
      getLogger().ai.info("─".repeat(60));
      getLogger().ai.info(instructions);
      getLogger().ai.info("─".repeat(60));

      return instructions;
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : "Unknown error";
      getLogger().ai.error(
        "Failed to generate instructions from call brief:",
        errorMessage
      );
      throw new Error(`Call brief processing failed: ${errorMessage}`);
    }
  }
}

export class CallBriefError extends Error {
  constructor(message: string, public readonly cause?: Error) {
    super(message);
    this.name = "CallBriefError";
  }
}
