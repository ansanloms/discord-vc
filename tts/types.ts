/**
 * 音声合成（Text-to-Speech）の抽象化。
 *
 * このインターフェースを実装することで、新しい TTS バックエンド
 * （例: Google Text-to-Speech、OpenAI TTS API）をパイプラインの
 * 他の部分を変更せずに追加できる。
 */

import { Buffer } from "node:buffer";

/**
 * テキスト文字列を合成音声のバイト列に変換する。
 */
export interface TextToSpeech {
  /**
   * 指定されたテキストを音声に合成する。
   *
   * @param text - 読み上げるテキスト。
   * @returns 音声バイト列（形式は実装依存）。失敗時は空の Buffer。
   */
  synthesize(text: string): Promise<Buffer>;
}
