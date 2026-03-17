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
import type { ClaudeLlmConfig } from "./llm/claude/mod.ts";
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
  | { type: "claude"; config: ClaudeLlmConfig }
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
 * LLM バックエンド設定を構築する。
 * llmType 引数または LLM_TYPE 環境変数に基づいてバックエンドを選択する。
 * 対応バックエンド: "claude"（デフォルト）, "ollama"。
 */
export function buildLlmConfig(
  llmType?: string,
): LlmConfig {
  llmType = llmType ?? Deno.env.get("LLM_TYPE") ?? "claude";

  switch (llmType) {
    case "claude":
      return {
        type: "claude",
        config: {
          apiKey: Deno.env.get("CLAUDE_API_KEY"),
          model: Deno.env.get("CLAUDE_MODEL") ?? "claude-haiku-4-5-20251001",
          systemPrompt: loadSystemPrompt(),
          maxTokens: Number(Deno.env.get("CLAUDE_MAX_TOKENS") ?? "1024"),
          maxToolRounds: Number(
            Deno.env.get("CLAUDE_MAX_TOOL_ROUNDS") ?? "5",
          ),
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
      speechDebounceMs: Number(
        Deno.env.get("SPEECH_DEBOUNCE_MS") ?? "500",
      ),
      notificationTone:
        (Deno.env.get("NOTIFICATION_TONE") ?? "true") === "true",
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
