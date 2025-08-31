import OpenAI from "openai";
import { META_PROMPT } from "./meta-prompt.js";
import { getLogger } from "./logger.js";
import { getVoiceCharacteristics, getVoiceDescription } from "./voice-characteristics.js";
import { sanitizeLanguageCode } from "./language-utils.js";

export interface CallBriefProcessorConfig {
  openaiApiKey: string;
  defaultUserName?: string;
  voice?: string; // Voice being used for the call
}

export interface GeneratedInstructions {
  instructions: string;
  language: string; // ISO-639-1 language code
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
   * Returns both the instructions and the detected language
   */
  async generateInstructions(
    briefText: string,
    userName?: string,
    voice?: string
  ): Promise<GeneratedInstructions> {
    try {
      getLogger().ai.debug(
        "Processing call brief with o3-mini model..."
      );
      getLogger().ai.debug(`Call brief: "${briefText}"`);

      const finalUserName = userName || this.config.defaultUserName;

      if (!finalUserName) {
        throw new Error(
          "User name is required for brief instruction generation. Provide userName parameter or set defaultUserName in config."
        );
      }

      const contextualizedBrief = `${briefText}. You are calling on behalf of ${finalUserName}.`;
      
      const now = new Date();
      const currentDateTime = now.toLocaleString('en-US', {
        weekday: 'long',
        year: 'numeric', 
        month: 'long',
        day: 'numeric',
        hour: 'numeric',
        minute: '2-digit',
        timeZoneName: 'short'
      });
      
      let metaPromptWithContext = META_PROMPT;
      
      // Add voice context if voice is provided
      if (voice) {
        const voiceChar = getVoiceCharacteristics(voice);
        if (voiceChar) {
          const voiceContext = `
Voice Context: The AI agent is using the "${voice}" voice, which is ${voiceChar.description}. The voice has ${voiceChar.gender} characteristics. When referring to itself, the agent should use appropriate pronouns (${voiceChar.gender === 'male' ? 'he/him' : voiceChar.gender === 'female' ? 'she/her' : 'they/them'}) if gender references are needed, though it's better to avoid gendered self-references when possible.\n`;
          metaPromptWithContext = metaPromptWithContext.replace('[VOICE_CONTEXT]', voiceContext);
        } else {
          metaPromptWithContext = metaPromptWithContext.replace('[VOICE_CONTEXT]', '');
        }
      } else {
        metaPromptWithContext = metaPromptWithContext.replace('[VOICE_CONTEXT]', '');
      }
      
      const metaPromptWithDateTime = metaPromptWithContext.replace(
        '[Insert current date and time when generating the prompt]',
        currentDateTime
      );

      const response = await this.openai.chat.completions.create({
        model: "o3-mini",
        messages: [
          {
            role: "system",
            content: metaPromptWithDateTime,
          },
          {
            role: "user",
            content: `Call Brief: ${contextualizedBrief}`,
          },
        ],
        max_completion_tokens: 16000,
        reasoning_effort: "medium",
        response_format: {
          type: "json_schema",
          json_schema: {
            name: "voice_agent_response",
            strict: true,
            schema: {
              type: "object",
              properties: {
                language: {
                  type: "string",
                  description: "ISO-639-1 language code for the conversation (e.g., 'en', 'es', 'fr', 'de', 'it', 'pt', 'nl', 'ru', 'zh', 'ja', 'ko')"
                },
                instructions: {
                  type: "string",
                  description: "The complete voice agent instructions with all sections as specified in the prompt"
                }
              },
              required: ["language", "instructions"],
              additionalProperties: false
            }
          }
        }
      });

      const content = response.choices[0]?.message?.content?.trim();

      if (!content) {
        throw new Error("No response generated from call brief");
      }

      // Parse the structured JSON response
      let parsedResponse: { language: string; instructions: string };
      try {
        parsedResponse = JSON.parse(content);
      } catch (e) {
        getLogger().ai.error('Failed to parse structured response:', e);
        throw new Error(`Invalid JSON response from o3-mini: ${e}`);
      }

      const { language: rawLanguage, instructions } = parsedResponse;

      if (!instructions) {
        throw new Error("No instructions in structured response");
      }
      
      // Validate and sanitize the language code
      const language = sanitizeLanguageCode(rawLanguage) || 'en';
      
      if (!rawLanguage) {
        getLogger().ai.warn('No language code in response, defaulting to English');
      } else if (!sanitizeLanguageCode(rawLanguage)) {
        getLogger().ai.warn(`Invalid language code '${rawLanguage}' from o3-mini, defaulting to English`);
      } else if (language !== rawLanguage) {
        getLogger().ai.info(`Normalized language code from '${rawLanguage}' to '${language}'`);
      }

      getLogger().ai.info(`Successfully generated voice agent instructions (language: ${language})`);
      getLogger().ai.verbose(
        `Generated instructions (${instructions.length} characters):`
      );
      getLogger().ai.info("─".repeat(60));
      instructions.split("\n").map(line => getLogger().ai.info(line));
      getLogger().ai.info("─".repeat(60));

      return { instructions, language };
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
