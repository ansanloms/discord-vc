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
   * 音声の合成中または再生中に true。
   */
  public isSpeaking = false;

  /**
   * @param tts - 音声チャンクの合成に使う TTS バックエンド。
   */
  constructor(private readonly tts: TextToSpeech) {
    this.player = createAudioPlayer();

    this.player.on(AudioPlayerStatus.Playing, () => {
      this.isSpeaking = true;
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
    this.player.stop();
    this.queue.length = 0;
    this.isPlaying = false;
    this.isSpeaking = false;
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
