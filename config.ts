/**
 * 環境変数からアプリケーション設定を読み込む。
 *
 * 必須変数: DISCORD_TOKEN, GUILD_ID。
 * その他はデフォルト値が設定されている。
 *
 * STT/TTS/LLM の設定は判別共用体で表現し、
 * `type` フィールドでバックエンドを識別する。
 */

import type { WhisperSttConfig } from "./stt/whisper.ts";
import type { OpenAiTtsConfig } from "./tts/openai.ts";
import type { OpenAiLlmConfig } from "./llm/openai/mod.ts";
import type { AnthropicLlmConfig } from "./llm/anthropic/mod.ts";
import type { OllamaLlmConfig } from "./llm/ollama/mod.ts";
import type { VoiceThresholds } from "./bot.ts";

/**
 * STT バックエンド設定。将来バックエンドを追加する場合はここに union を足す。
 */
export type SttConfig = { type: "whisper"; config: WhisperSttConfig };

/**
 * TTS バックエンド設定。
 */
export type TtsConfig = { type: "openai"; config: OpenAiTtsConfig };

/**
 * LLM バックエンド設定。
 */
export type LlmConfig =
  | { type: "openai"; config: OpenAiLlmConfig }
  | { type: "anthropic"; config: AnthropicLlmConfig }
  | { type: "ollama"; config: OllamaLlmConfig };

/**
 * バリデーション済みのアプリケーション設定。
 */
export interface Config {
  /**
   * Discord bot トークン。
   */
  discordToken: string;

  /**
   * 参加する Discord ギルド（サーバー）の ID。
   */
  guildId: string;

  /**
   * 音声パイプラインのしきい値設定。
   */
  voice: VoiceThresholds;

  /**
   * 音声認識バックエンド設定。
   */
  stt: SttConfig;

  /**
   * 音声合成バックエンド設定。
   */
  tts: TtsConfig;

  /**
   * 言語モデルバックエンド設定。
   */
  llm: LlmConfig;

  /**
   * ユーザーメッセージのテンプレート。
   * `{{discord.user.name}}`, `{{discord.user.id}}`, `{{message}}` が置換される。
   * 未設定時はメッセージをそのまま渡す。
   */
  messageTemplate?: string;
}

/**
 * システムプロンプトをファイルから読み込む。
 *
 * SYSTEM_PROMPT_FILE 環境変数で指定されたパス（デフォルト: config/SYSTEM_PROMPT.md）の
 * ファイルを読み込む。ファイルが存在しない場合は undefined を返す。
 */
function loadSystemPrompt(): string | undefined {
  const filePath = Deno.env.get("SYSTEM_PROMPT_FILE") ??
    "config/SYSTEM_PROMPT.md";

  try {
    const content = Deno.readTextFileSync(filePath).trim();
    if (content.length > 0) {
      return content;
    }
  } catch (e: unknown) {
    if (!(e instanceof Deno.errors.NotFound)) {
      throw e;
    }
  }

  return undefined;
}

/**
 * LLM_TYPE 環境変数に基づいて LLM 設定を構築する。
 * 未指定または "openai" なら OpenAI 互換、"anthropic" なら Anthropic SDK を使用する。
 */
function buildLlmConfig(): LlmConfig {
  const llmType = Deno.env.get("LLM_TYPE") ?? "openai";

  switch (llmType) {
    case "anthropic":
      return {
        type: "anthropic",
        config: {
          apiKey: Deno.env.get("ANTHROPIC_API_KEY"),
          model: Deno.env.get("ANTHROPIC_MODEL") ?? "claude-haiku-4-5-20251001",
          systemPrompt: loadSystemPrompt(),
          maxTokens: Number(Deno.env.get("ANTHROPIC_MAX_TOKENS") ?? "1024"),
          maxToolRounds: Number(
            Deno.env.get("ANTHROPIC_MAX_TOOL_ROUNDS") ?? "5",
          ),
        },
      };
    case "openai":
      return {
        type: "openai",
        config: {
          baseUrl: Deno.env.get("OPENAI_LLM_URL") ?? "",
          apiKey: Deno.env.get("OPENAI_LLM_API_KEY"),
          model: Deno.env.get("OPENAI_LLM_MODEL") ?? "",
          systemPrompt: loadSystemPrompt(),
        },
      };
    case "ollama":
      return {
        type: "ollama",
        config: {
          host: Deno.env.get("OLLAMA_HOST"),
          model: Deno.env.get("OLLAMA_MODEL") ?? "",
          systemPrompt: loadSystemPrompt(),
          maxToolRounds: Number(
            Deno.env.get("OLLAMA_MAX_TOOL_ROUNDS") ?? "5",
          ),
        },
      };
    default:
      throw new Error(`Unsupported LLM_TYPE: ${llmType}`);
  }
}

/**
 * 環境変数から設定を読み込む。
 * 必須変数が未設定の場合はエラーを出力して終了する。
 */
export function loadConfig(): Config {
  const discordToken = Deno.env.get("DISCORD_TOKEN");
  if (!discordToken) {
    throw new Error("Required environment variable not set: DISCORD_TOKEN");
  }

  const guildId = Deno.env.get("GUILD_ID");
  if (!guildId) {
    throw new Error("Required environment variable not set: GUILD_ID");
  }

  return {
    discordToken,
    guildId,
    voice: {
      minSpeechMs: Number(Deno.env.get("MIN_SPEECH_MS") ?? "500"),
      speechRms: Number(Deno.env.get("SPEECH_RMS") ?? "200"),
      interruptRms: Number(Deno.env.get("INTERRUPT_RMS") ?? "500"),
      autoLeaveMs: Number(Deno.env.get("AUTO_LEAVE_MS") ?? "600000"),
    },
    stt: {
      type: "whisper",
      config: {
        baseUrl: Deno.env.get("WHISPER_URL") ?? "",
      },
    },
    tts: {
      type: "openai",
      config: {
        baseUrl: Deno.env.get("OPENAI_TTS_URL") ?? "",
        apiKey: Deno.env.get("OPENAI_TTS_API_KEY"),
        model: Deno.env.get("OPENAI_TTS_MODEL") ?? "",
        voice: Deno.env.get("OPENAI_TTS_SPEAKER") ?? "1",
        speed: Number(Deno.env.get("OPENAI_TTS_SPEED") ?? "1"),
      },
    },
    llm: buildLlmConfig(),
    messageTemplate: Deno.env.get("MESSAGE_TEMPLATE"),
  };
}
