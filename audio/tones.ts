/**
 * 通知トーンの PCM 生成。
 *
 * 外部音声ファイルに依存せず、倍音合成から直接 WAV バイト列を生成する。
 * Discord の AudioPlayer で再生可能な 48 kHz モノラル 16 ビット WAV を出力する。
 *
 * マリンバ風の音色を得るために、基音 + 4 倍音・10 倍音を重ね、
 * 指数減衰エンベロープで打楽器的な「コン」という質感を出す。
 */

import { Buffer } from "node:buffer";
import { pcmToWav } from "./codec.ts";

/** サンプリングレート（Hz）。Discord の音声フォーマットに合わせる。 */
const SAMPLE_RATE = 48000;

/**
 * 倍音の定義。
 */
interface Partial {
  /** 基音に対する周波数倍率。 */
  ratio: number;
  /** 基音に対する振幅比（0.0 〜 1.0）。 */
  amplitude: number;
  /** 減衰係数。大きいほど速く減衰する。 */
  decay: number;
}

/**
 * マリンバ風の倍音構成。
 *
 * 実際のマリンバは基音・4 倍音（2 オクターブ上）・10 倍音付近が卓越する。
 * 高次倍音ほど速く減衰させることで木質的な温かみを出す。
 */
const MARIMBA_PARTIALS: Partial[] = [
  { ratio: 1.0, amplitude: 1.0, decay: 14.0 },
  { ratio: 4.0, amplitude: 0.3, decay: 24.0 },
  { ratio: 10.0, amplitude: 0.08, decay: 40.0 },
];

/**
 * 倍音合成でマリンバ風の打音 PCM を生成する。
 *
 * 各倍音に独立した指数減衰エンベロープを適用し、
 * 先頭 2ms のフェードインでクリックノイズを防ぐ。
 * 微小なビブラート（5 Hz, ±2 Hz）で機械的な均一さを崩す。
 *
 * @param frequency - 基音の周波数（Hz）。
 * @param durationMs - 長さ（ミリ秒）。減衰で自然に消えるが、この長さで打ち切る。
 * @param volume - 全体音量（0.0 〜 1.0）。
 * @returns 16 ビットモノラル PCM バイト列。
 */
function generateMarimbaTone(
  frequency: number,
  durationMs: number,
  volume: number = 0.25,
): Buffer {
  const numSamples = Math.floor(SAMPLE_RATE * durationMs / 1000);
  const buf = Buffer.alloc(numSamples * 2);
  const fadeInSamples = Math.floor(SAMPLE_RATE * 0.002); // 2ms

  for (let i = 0; i < numSamples; i++) {
    const t = i / SAMPLE_RATE;

    // クリックノイズ防止用のフェードイン。
    const fadeIn = i < fadeInSamples ? i / fadeInSamples : 1.0;

    // 微小なビブラート。5 Hz で ±2 Hz 揺らす。
    const vibrato = 1.0 + 0.003 * Math.sin(2 * Math.PI * 5 * t);

    let sample = 0;
    for (const partial of MARIMBA_PARTIALS) {
      const freq = frequency * partial.ratio * vibrato;
      const env = Math.exp(-partial.decay * t);
      sample += Math.sin(2 * Math.PI * freq * t) * partial.amplitude * env;
    }

    const clamped = Math.max(
      -32767,
      Math.min(32767, Math.round(sample * 32767 * volume * fadeIn)),
    );
    buf.writeInt16LE(clamped, i * 2);
  }

  return buf;
}

/**
 * 無音の PCM を生成する。
 *
 * @param durationMs - 長さ（ミリ秒）。
 * @returns 16 ビットモノラル PCM バイト列（全サンプル 0）。
 */
function generateSilence(durationMs: number): Buffer {
  const numSamples = Math.floor(SAMPLE_RATE * durationMs / 1000);
  return Buffer.alloc(numSamples * 2);
}

/**
 * 処理中を示すトーンを WAV 形式で生成する。
 *
 * マリンバ風の「コン」（C4 = 262 Hz, 200ms）+ 無音で約 0.75 秒間隔。
 * ループ再生時はこれを繰り返す。
 *
 * @returns WAV バイト列。
 */
export function generateThinkingTone(): Buffer {
  const note = generateMarimbaTone(262, 200, 0.15); // C4
  const silence = generateSilence(550);
  return pcmToWav(Buffer.concat([note, silence]));
}

/**
 * エラー発生を示すトーンを WAV 形式で生成する。
 *
 * 短三度下降（E3 → C3）をマリンバ音色で。
 * 下降フレーズが直感的に「失敗・注意」を伝える。
 *
 * @returns WAV バイト列。
 */
export function generateErrorTone(): Buffer {
  const high = generateMarimbaTone(165, 200, 0.2); // E3
  const gap = generateSilence(80);
  const low = generateMarimbaTone(131, 300, 0.2); // C3
  return pcmToWav(Buffer.concat([high, gap, low]));
}
