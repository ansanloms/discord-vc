/**
 * 環境変数からアプリケーション設定を読み込む。
 *
 * 必須変数: DISCORD_TOKEN, GUILD_ID, CHANNEL_ID。
 * その他はデフォルト値が設定されている。
 *
 * STT/TTS/LLM の設定は判別共用体で表現し、
 * `type` フィールドでバックエンドを識別する。
 */

import type { WhisperSttConfig } from "./stt/whisper.ts";
import type { OpenAiTtsConfig } from "./tts/openai.ts";
import type { OpenAiLlmConfig } from "./llm/openai.ts";
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
export type LlmConfig = { type: "openai"; config: OpenAiLlmConfig };

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
   * 参加するボイスチャンネルの ID。
   */
  channelId: string;

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
}

/**
 * 環境変数から設定を読み込む。
 * 必須変数が未設定の場合はエラーを出力して終了する。
 */
export function loadConfig(): Config {
  const discordToken = Deno.env.get("DISCORD_TOKEN");
  if (!discordToken) {
    throw new Error("必須環境変数が未設定: DISCORD_TOKEN");
  }

  const guildId = Deno.env.get("GUILD_ID");
  if (!guildId) {
    throw new Error("必須環境変数が未設定: GUILD_ID");
  }

  const channelId = Deno.env.get("CHANNEL_ID");
  if (!channelId) {
    throw new Error("必須環境変数が未設定: CHANNEL_ID");
  }

  return {
    discordToken,
    guildId,
    channelId,
    voice: {
      minSpeechMs: Number(Deno.env.get("MIN_SPEECH_MS") ?? "500"),
      speechRms: Number(Deno.env.get("SPEECH_RMS") ?? "200"),
      interruptRms: Number(Deno.env.get("INTERRUPT_RMS") ?? "500"),
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
    llm: {
      type: "openai",
      config: {
        baseUrl: Deno.env.get("OPENAI_LLM_URL") ?? "",
        apiKey: Deno.env.get("OPENAI_LLM_API_KEY"),
        model: Deno.env.get("OPENAI_LLM_MODEL") ?? "",
        systemPrompt: Deno.env.get("SYSTEM_PROMPT"),
      },
    },
  };
}
