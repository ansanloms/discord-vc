/**
 * サービスファクトリファサード。
 *
 * Config の判別共用体（type フィールド）に基づいて
 * STT/TTS/LLM の具象インスタンスを生成する。
 * バックエンドを追加する場合は config.ts に union を追加し、
 * ここに switch ケースを足すだけでよい。
 */

import type { Config } from "./config.ts";
import type { SpeechToText } from "./stt/types.ts";
import type { TextToSpeech } from "./tts/types.ts";
import type { LanguageModel } from "./llm/types.ts";
import { WhisperStt } from "./stt/whisper.ts";
import { OpenAiTts } from "./tts/openai.ts";
import { OpenAiLlm } from "./llm/openai.ts";
import { AnthropicLlm } from "./llm/anthropic.ts";
import type { AnthropicLlmConfig } from "./llm/anthropic.ts";
import { VoicePlayer } from "./audio/player.ts";

/**
 * ボットの動作に必要なサービス一式。
 */
export interface Services {
  stt: SpeechToText;
  tts: TextToSpeech;
  llm: LanguageModel;
  voicePlayer: VoicePlayer;
}

/**
 * Config.stt の type に基づいて STT インスタンスを生成する。
 */
function createStt(config: Config["stt"]): SpeechToText {
  switch (config.type) {
    case "whisper":
      return new WhisperStt(config.config);
  }
}

/**
 * Config.tts の type に基づいて TTS インスタンスを生成する。
 */
function createTts(config: Config["tts"]): TextToSpeech {
  switch (config.type) {
    case "openai":
      return new OpenAiTts(config.config);
  }
}

/**
 * LLM 生成時に追加で渡すオプション。
 * Anthropic の場合にカスタムツール等を注入するために使用する。
 */
export type LlmExtras = Partial<AnthropicLlmConfig>;

function createLlm(
  config: Config["llm"],
  extras?: LlmExtras,
): LanguageModel {
  switch (config.type) {
    case "openai":
      return new OpenAiLlm(config.config);
    case "anthropic":
      return new AnthropicLlm({ ...config.config, ...extras });
  }
}

/**
 * Config に基づいてサービスインスタンスを生成する。
 */
export function createServices(
  config: Config,
  llmExtras?: LlmExtras,
): Services {
  const stt = createStt(config.stt);
  const tts = createTts(config.tts);
  const llm = createLlm(config.llm, llmExtras);
  const voicePlayer = new VoicePlayer(tts);

  return { stt, tts, llm, voicePlayer };
}
