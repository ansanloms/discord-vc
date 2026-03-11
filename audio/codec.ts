/**
 * 音声コーデックユーティリティ。
 *
 * opusscript による Opus デコードと PCM/WAV 変換ヘルパーを提供する。
 * 音声受信パイプラインで使用する。
 */

import { Buffer } from "node:buffer";
import OpusScript from "opusscript";

/**
 * テスト時のモック用に最小限のインターフェースとして定義。
 */
export type OpusDecoder = { decode(chunk: Buffer): Buffer };

/**
 * Discord の音声フォーマットに対応した Opus デコーダを生成する。
 * 48 kHz サンプリングレート、モノラル、AUDIO アプリケーションモード。
 */
export function createOpusDecoder(): OpusDecoder {
  return new OpusScript(48000, 1, OpusScript.Application.AUDIO);
}

/**
 * 生 PCM データに WAV コンテナの 44 バイトヘッダを付与する。
 *
 * 48 kHz、モノラル、16 ビット リトルエンディアン PCM を前提とする。
 * これは Discord の Opus デコーダが出力する形式。
 *
 * @param pcm - 生 PCM バイト列。
 * @returns WAV ファイルバイト列（44 バイトヘッダ + PCM ペイロード）。
 */
export function pcmToWav(pcm: Buffer): Buffer {
  const sampleRate = 48000;
  const channels = 1;
  const bitsPerSample = 16;
  const dataSize = pcm.length;
  const header = Buffer.alloc(44);

  header.write("RIFF", 0);
  header.writeUInt32LE(36 + dataSize, 4);
  header.write("WAVE", 8);
  header.write("fmt ", 12);
  header.writeUInt32LE(16, 16); // fmt サブチャンクサイズ
  header.writeUInt16LE(1, 20); // PCM = 1
  header.writeUInt16LE(channels, 22);
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(sampleRate * channels * (bitsPerSample / 8), 28); // バイトレート
  header.writeUInt16LE(channels * (bitsPerSample / 8), 32); // ブロックアライン
  header.writeUInt16LE(bitsPerSample, 34);
  header.write("data", 36);
  header.writeUInt32LE(dataSize, 40);

  return Buffer.concat([header, pcm]);
}

/**
 * 16 ビット PCM サンプルの二乗平均平方根（RMS）を計算する。
 * 簡易的なノイズフロアフィルタとして使用する。
 * 無音またはほぼ無音のフレームは 0 に近い値を返す。
 *
 * @param pcm - 生 PCM バイト列（16 ビット リトルエンディアン、モノラル）。
 * @returns RMS 値（範囲: [0, 32767]）。
 */
export function calcRms(pcm: Buffer): number {
  const samples = new Int16Array(
    pcm.buffer,
    pcm.byteOffset,
    pcm.byteLength / 2,
  );
  let sumSq = 0;
  for (let i = 0; i < samples.length; i++) {
    sumSq += samples[i] * samples[i];
  }
  return Math.sqrt(sumSq / samples.length);
}
