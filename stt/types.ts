/**
 * 音声認識（Speech-to-Text）の抽象化。
 *
 * このインターフェースを実装することで、新しい STT バックエンド
 * （例: Google Speech-to-Text、OpenAI Whisper API）をパイプラインの
 * 他の部分を変更せずに追加できる。
 */

import { Buffer } from "node:buffer";

/**
 * Discord から取得した生 PCM 音声をテキストに変換する。
 */
export interface SpeechToText {
  /**
   * 指定された PCM 音声バッファを文字起こしする。
   *
   * @param pcm - 48 kHz モノラル 16 ビットの生 PCM 音声。
   * @returns 文字起こし結果。認識できなかった場合は空文字列。
   */
  transcribe(pcm: Buffer): Promise<string>;
}
