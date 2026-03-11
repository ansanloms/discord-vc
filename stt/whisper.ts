/**
 * ローカル whisper.cpp HTTP サーバーによる STT 実装。
 *
 * @see https://github.com/ggml-org/whisper.cpp — サーバーモードのドキュメント
 */

import { Buffer } from "node:buffer";
import { createLogger } from "../logger.ts";
import { pcmToWav } from "../audio/codec.ts";
import type { SpeechToText } from "./types.ts";

const log = createLogger("stt");

/**
 * whisper.cpp が出力する非音声プレースホルダトークンにマッチする正規表現。
 * モデルが無音や非言語音声を検出した場合に出現する。
 */
const NON_SPEECH_PATTERNS = [
  /\[.*?\]/g, // 例: [音声なし], [BLANK_AUDIO]
  /\(.*?\)/g, // 例: (音声なし), (無音)
  /\*.*?\*/g, // 例: *音声なし*
];

/**
 * WhisperStt のコンストラクタ設定。
 */
export interface WhisperSttConfig {
  /**
   * whisper.cpp サーバーのベース URL（例: `http://localhost:8178`）。
   */
  baseUrl: string;
}

/**
 * whisper.cpp の OpenAI 互換推論サーバーを使った音声認識。
 *
 * PCM 音声を WAV に変換し、`/inference` に POST する。
 * 結果から非音声プレースホルダトークンを除去して返す。
 */
export class WhisperStt implements SpeechToText {
  private readonly baseUrl: string;

  constructor(config: WhisperSttConfig) {
    this.baseUrl = config.baseUrl;
  }

  /**
   * @inheritdoc
   */
  async transcribe(pcm: Buffer): Promise<string> {
    const wav = pcmToWav(pcm);
    const form = new FormData();
    // Blob は ArrayBufferView<ArrayBuffer> を要求する。
    // Buffer の buffer プロパティは ArrayBufferLike なので明示キャストする。
    const wavBytes = new Uint8Array(
      wav.buffer as ArrayBuffer,
      wav.byteOffset,
      wav.byteLength,
    );
    form.append(
      "file",
      new Blob([wavBytes], { type: "audio/wav" }),
      "audio.wav",
    );
    form.append("response_format", "json");
    form.append("suppress_non_speech_tokens", "true");

    const res = await fetch(`${this.baseUrl}/inference`, {
      method: "POST",
      body: form,
    });

    if (!res.ok) {
      log.error("whisper error:", res.status, await res.text());
      return "";
    }

    const data = await res.json();
    const raw: string = (data.text ?? "").trim();

    // 非音声トークンを除去してクリーンな文字起こし結果を返す。
    return NON_SPEECH_PATTERNS
      .reduce((text, pattern) => text.replace(pattern, ""), raw)
      .trim();
  }
}
