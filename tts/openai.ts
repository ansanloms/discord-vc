/**
 * OpenAI 互換 `/v1/audio/speech` エンドポイントによる TTS 実装。
 *
 * @see https://platform.openai.com/docs/api-reference/audio/createSpeech
 */

import { Buffer } from "node:buffer";
import OpenAI from "@openai/openai";
import { createLogger } from "../logger.ts";
import type { TextToSpeech } from "./types.ts";

const log = createLogger("tts");

/**
 * OpenAiTts のコンストラクタ設定。
 */
export interface OpenAiTtsConfig {
  /**
   * TTS サーバーのベース URL（例: `http://localhost:8000`）。
   */
  baseUrl: string;

  /**
   * API キー。未指定なら認証なし。
   */
  apiKey?: string;

  /**
   * 使用するモデル名。
   */
  model: string;

  /**
   * API に渡す音声 / スピーカー識別子（例: `"1"` = VOICEVOX スピーカー 1）。
   */
  voice: string;

  /**
   * 再生速度。デフォルト `1.0`。
   */
  speed?: number;

  /**
   * OpenAI SDK に渡す追加オプション。
   */
  clientOptions?: Partial<ConstructorParameters<typeof OpenAI>[0]>;
}

/**
 * OpenAI SDK を使った音声合成。
 *
 * リクエストボディは OpenAI TTS API 仕様に準拠する。
 * voicevox-openai-tts をバックエンドにする場合、
 * voice フィールドは VOICEVOX のスピーカー ID に対応する。
 */
export class OpenAiTts implements TextToSpeech {
  private readonly client: OpenAI;
  private readonly model: string;
  private readonly voice: string;
  private readonly speed: number;

  constructor(config: OpenAiTtsConfig) {
    this.client = new OpenAI({
      baseURL: `${config.baseUrl}/v1`,
      apiKey: config.apiKey ?? "dummy",
      ...config.clientOptions,
    });
    this.model = config.model;
    this.voice = config.voice;
    this.speed = config.speed ?? 1.0;
  }

  /**
   * @inheritdoc
   */
  async synthesize(text: string): Promise<Buffer> {
    try {
      const response = await this.client.audio.speech.create({
        model: this.model,
        input: text,
        voice: this.voice as "alloy",
        response_format: "mp3",
        speed: this.speed,
      });

      return Buffer.from(await response.arrayBuffer());
    } catch (e: unknown) {
      log.error("TTS API error:", e);
      return Buffer.alloc(0);
    }
  }
}
