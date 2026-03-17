/**
 * 音声再生プレイヤーとスピーチキュー。
 *
 * @discordjs/voice の AudioPlayer を TTS ベースの合成キューでラップする。
 * テキストを文単位に分割し、並列で合成してから順次再生する。
 * 最初のチャンクが準備でき次第再生を開始し、体感遅延を最小化する。
 */

import { Buffer } from "node:buffer";
import { Readable } from "node:stream";
import {
  AudioPlayerStatus,
  createAudioPlayer,
  createAudioResource,
} from "@discordjs/voice";
import type { AudioPlayer } from "@discordjs/voice";
import { createLogger } from "../logger.ts";
import type { TextToSpeech } from "../tts/types.ts";
import { generateErrorTone, generateThinkingTone } from "./tones.ts";

const log = createLogger("tts");

/**
 * 日本語の文境界（。）と改行でテキストを分割する。
 * トリム後に空になったセグメントは除外する。
 *
 * @param text - 複数文を含みうる入力テキスト。
 * @returns 空でない文字列の配列。
 */
export function splitSentences(text: string): string[] {
  return text
    .split(/(?<=[。\n])/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

/**
 * Discord ボイスコネクション向けの TTS 合成・逐次再生マネージャ。
 *
 * 使い方:
 * 1. TextToSpeech バックエンドを渡してインスタンス化する。
 * 2. discordPlayer を VoiceConnection に subscribe する。
 * 3. speak() でテキストを再生キューに追加する。
 * 4. interrupt() で現在の再生を停止しキューをクリアする。
 */
export class VoicePlayer {
  private readonly player: AudioPlayer;
  private readonly queue: Buffer[] = [];
  private isPlaying = false;

  /**
   * TTS 音声の合成中または再生中に true。
   * 処理中トーンの再生では true にならない。
   */
  public isSpeaking = false;

  /**
   * 処理中トーンのループ中に true。
   */
  public isThinking = false;

  /**
   * 処理中トーンのループタイマー。null ならループ停止中。
   */
  private thinkingTimer: ReturnType<typeof setInterval> | null = null;

  /**
   * 処理中トーンの WAV バイト列（キャッシュ）。
   */
  private readonly thinkingTone: Buffer = generateThinkingTone();

  /**
   * エラートーンの WAV バイト列（キャッシュ）。
   */
  private readonly errorTone: Buffer = generateErrorTone();

  /**
   * 通知トーンが有効かどうか。
   */
  private readonly toneEnabled: boolean;

  /**
   * @param tts - 音声チャンクの合成に使う TTS バックエンド。
   * @param toneEnabled - 通知トーンの有効/無効（デフォルト: true）。
   */
  constructor(private readonly tts: TextToSpeech, toneEnabled: boolean = true) {
    this.toneEnabled = toneEnabled;
    this.player = createAudioPlayer();

    this.player.on(AudioPlayerStatus.Playing, () => {
      // 処理中トーン再生時は isSpeaking を立てない。
      // isSpeaking が true だと interruptRms の高い閾値が適用されてしまう。
      if (!this.isThinking) {
        this.isSpeaking = true;
      }
    });

    // リソースの再生が終わったら次のキューを再生する。
    this.player.on(AudioPlayerStatus.Idle, () => {
      this.playNext();
    });

    this.player.on("error", (err) => {
      log.error("player error:", err.message);
      this.playNext();
    });
  }

  /**
   * 内部の @discordjs/voice AudioPlayer。
   * VoiceConnection が Ready になった後に subscribe する必要がある。
   */
  get discordPlayer(): AudioPlayer {
    return this.player;
  }

  /**
   * 再生を即座に停止し、キュー内の全エントリをクリアする。
   */
  interrupt(): void {
    this.stopThinking();
    this.player.stop();
    this.queue.length = 0;
    this.isPlaying = false;
    this.isSpeaking = false;
    this.isThinking = false;
  }

  /**
   * 処理中トーンのループ再生を開始する。
   * 即座に 1 回再生し、以降 0.85 秒間隔でキューに追加する。
   * 既にループ中の場合は何もしない。
   */
  startThinking(): void {
    if (!this.toneEnabled) return;
    if (this.thinkingTimer) return;

    log.debug("thinking tone started");
    this.isThinking = true;
    this.queue.push(this.thinkingTone);
    if (!this.isPlaying) this.playNext();

    this.thinkingTimer = setInterval(() => {
      this.queue.push(this.thinkingTone);
      if (!this.isPlaying) this.playNext();
    }, 850);
  }

  /**
   * 処理中トーンのループ再生を停止する。
   * キュー内のトーンも除去する。
   */
  stopThinking(): void {
    if (!this.thinkingTimer) return;

    clearInterval(this.thinkingTimer);
    this.thinkingTimer = null;
    this.isThinking = false;

    // キューからトーン用バッファを除去する。
    // トーンは同一参照なので === で判定できる。
    for (let i = this.queue.length - 1; i >= 0; i--) {
      if (this.queue[i] === this.thinkingTone) {
        this.queue.splice(i, 1);
      }
    }
    log.debug("thinking tone stopped");
  }

  /**
   * エラートーンを 1 回再生する。
   * 現在の再生キューに追加される。
   */
  playErrorTone(): void {
    if (!this.toneEnabled) return;
    log.debug("playing error tone");
    this.stopThinking();
    this.queue.push(this.errorTone);
    if (!this.isPlaying) this.playNext();
  }

  /**
   * テキストを文単位に分割し、並列で合成してから順次再生する。
   *
   * 合成リクエストは並列に発行し、最初のチャンクが到着次第
   * 再生を開始することで体感遅延を最小化する。
   *
   * @param text - 読み上げるテキスト。
   */
  async speak(text: string): Promise<void> {
    const chunks = splitSentences(text);
    if (chunks.length === 0) {
      return;
    }

    log.info(`synthesizing ${chunks.length} chunk(s)`);
    this.isSpeaking = true;

    // 全合成リクエストを並列で発行し、順序通りにキューに追加する。
    const pending = chunks.map((chunk, i) => {
      log.debug(`  [${i}] "${chunk}"`);
      return this.tts.synthesize(chunk);
    });

    for (const p of pending) {
      const buf = await p;
      if (buf.length > 0) {
        this.queue.push(buf);
        if (!this.isPlaying) this.playNext();
      }
    }
  }

  private playNext(): void {
    if (this.queue.length === 0) {
      this.isPlaying = false;
      this.isSpeaking = false;
      return;
    }
    this.isPlaying = true;
    const buf = this.queue.shift()!;
    this.player.play(createAudioResource(Readable.from(buf)));
  }
}
