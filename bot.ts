/**
 * Discord ボイスボット。
 *
 * ボイスチャンネルに参加し、発話を検出して
 * STT → LLM → TTS パイプラインに通し、合成音声を再生する。
 *
 * パイプライン概要:
 *   Opus フレーム (Discord)
 *     → Opus デコード (opusscript)
 *     → PCM バッファ
 *     → ノイズ / 長さフィルタ
 *     → SpeechToText.transcribe()
 *     → LanguageModel.chat()
 *     → VoicePlayer.speak()
 *     → 音声再生 (discordjs/voice)
 */

import { Buffer } from "node:buffer";
import { Client, GatewayIntentBits } from "discord.js";
import {
  EndBehaviorType,
  entersState,
  generateDependencyReport,
  getVoiceConnection,
  joinVoiceChannel,
  VoiceConnectionStatus,
} from "@discordjs/voice";
import type { VoiceConnection } from "@discordjs/voice";
import { createLogger } from "./logger.ts";
import { calcRms, createOpusDecoder } from "./audio/codec.ts";
import type { Config } from "./config.ts";
import type { SpeechToText } from "./stt/types.ts";
import type { LanguageModel } from "./llm/types.ts";
import type { VoicePlayer } from "./audio/player.ts";

/**
 * 音声パイプラインのしきい値設定。
 */
export interface VoiceThresholds {
  /**
   * STT に送る最小発話時間（ミリ秒）。
   * これ未満の音声は無視される。
   */
  minSpeechMs: number;

  /**
   * 発話とみなす最小 RMS 振幅。
   * この値未満の音声はノイズ / 無音として破棄される。
   */
  speechRms: number;

  /**
   * AI の再生を中断する最小 RMS 振幅。
   * speechRms より高く設定することで、小さな雑音では中断されなくなる。
   */
  interruptRms: number;
}

const log = createLogger("bot");

/**
 * ミリ秒を PCM バイト数に変換する。
 * 48 kHz モノラル 16 ビット = 96 bytes/ms。
 */
function msToBytes(ms: number): number {
  return Math.floor(48000 * 2 * ms / 1000);
}

/**
 * Discord クライアント、ボイスコネクション、
 * STT → LLM → TTS パイプラインを統括する。
 */
export class DiscordBot {
  private readonly client: Client;

  /**
   * アクティブなボイスコネクション。未接続時は null。
   */
  private currentConnection: VoiceConnection | null = null;

  /**
   * 共有の Opus デコーダインスタンス。
   * 注意: opusscript はインスタンスごとにコーデック状態を持つため、
   * 複数ユーザーが同時に発話すると音声にアーティファクトが生じうる。
   * 単一ユーザーのセッションでは問題ない。
   */
  private readonly opusDecoder = createOpusDecoder();

  /**
   * minSpeechMs から算出した最小 PCM バイト数。
   */
  private readonly minPcmBytes: number;

  /**
   * @param config      - アプリケーション設定。
   * @param stt         - 音声認識バックエンド。
   * @param llm         - 言語モデルバックエンド。
   * @param voicePlayer - TTS 合成・再生キュー。
   */
  constructor(
    private readonly config: Config,
    private readonly stt: SpeechToText,
    private readonly llm: LanguageModel,
    private readonly voicePlayer: VoicePlayer,
  ) {
    this.minPcmBytes = msToBytes(config.voice.minSpeechMs);
    this.client = new Client({
      intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildVoiceStates,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
      ],
    });
    this.setupHandlers();
  }

  /**
   * Discord クライアントのイベントハンドラを登録する。
   * clientReady は start() 内で待機するため、ここでは登録しない。
   */
  private setupHandlers(): void {
    // Discord クライアント自体のエラーでプロセスが死なないようにする。
    this.client.on("error", (err) => {
      log.error("discord client error:", err);
    });

    this.client.on("messageCreate", (msg) => {
      if (msg.author.bot) return;

      // !leave — ボイスチャンネルから切断する。
      if (msg.content === "!leave") {
        const conn = getVoiceConnection(this.config.guildId);
        if (conn) {
          conn.destroy();
          this.currentConnection = null;
          msg.reply("Left VC").catch((e) => log.warn("failed to reply:", e));
        }
        return;
      }

      // !ping — 疎通確認。
      if (msg.content === "!ping") {
        msg.reply("pong").catch((e) => log.warn("failed to reply:", e));
        return;
      }

      // VC チャットのテキストを LLM に渡して音声で返答する。
      if (msg.channelId === this.config.channelId) {
        this.onTextMessage(msg.content, msg.author.tag);
      }
    });
  }

  /**
   * Discord クライアントの準備完了時に呼ばれる。VC に参加する。
   * ギルドが見つからない、または VC 参加に失敗した場合は例外を投げる。
   * 呼び出し元（start()）で catch し、リトライ判断に使う。
   */
  private async onReady(): Promise<void> {
    log.info(`logged in as ${this.client.user?.tag}`);
    log.info(generateDependencyReport());
    log.info(
      `STT: ${this.config.stt.type} (${this.config.stt.config.baseUrl})`,
    );
    log.info(
      `TTS: ${this.config.tts.type} (${this.config.tts.config.baseUrl})`,
    );
    log.info(
      `LLM: ${this.config.llm.type} (${this.config.llm.config.baseUrl})`,
    );
    log.info(
      `voice thresholds: minSpeechMs=${this.config.voice.minSpeechMs}, speechRms=${this.config.voice.speechRms}, interruptRms=${this.config.voice.interruptRms}`,
    );

    const guild = this.client.guilds.cache.get(this.config.guildId);
    if (!guild) {
      throw new Error(
        `guild ${this.config.guildId} not found in cache`,
      );
    }

    const connection = joinVoiceChannel({
      channelId: this.config.channelId,
      guildId: this.config.guildId,
      adapterCreator: guild.voiceAdapterCreator,
      selfDeaf: false,
    });
    this.currentConnection = connection;

    connection.on("stateChange", (_old, newState) => {
      log.debug(`voice state: ${newState.status}`);
    });

    // VC 接続が Ready になるまで待機する。
    await entersState(connection, VoiceConnectionStatus.Ready, 30_000);
    log.info("voice connection ready");
    connection.subscribe(this.voicePlayer.discordPlayer);
    this.setupVoiceReceiver(connection);

    // 切断時に自動再接続を試みる。
    connection.on(VoiceConnectionStatus.Disconnected, () => {
      this.handleDisconnect(connection);
    });

    connection.on("error", (err) => {
      log.error("voice connection error:", err);
    });
  }

  /**
   * VoiceConnection が切断された際に再接続を試みる。
   * rejoin() で再接続シーケンスを開始し、5 秒以内に Ready にならなければ
   * コネクションを破棄する（プロセスは死なない）。
   */
  private async handleDisconnect(connection: VoiceConnection): Promise<void> {
    log.warn("voice connection disconnected, attempting rejoin...");
    try {
      // rejoin() は Disconnected → Signalling に遷移させ、再接続を開始する。
      connection.rejoin();
      await entersState(connection, VoiceConnectionStatus.Ready, 5_000);
      log.info("voice connection rejoined");
    } catch {
      log.error("rejoin failed, destroying connection");
      try {
        connection.destroy();
      } catch {
        // 既に destroyed の場合は無視する。
      }
      this.currentConnection = null;
    }
  }

  /**
   * VC チャットのテキストを LLM → TTS パイプラインに通す。
   */
  private async onTextMessage(
    content: string,
    authorTag: string,
  ): Promise<void> {
    try {
      log.info(`VC text from ${authorTag}: ${content}`);
      const reply = await this.llm.chat(content);
      if (!reply) {
        return;
      }

      log.info(`reply: ${reply}`);
      await this.voicePlayer.speak(reply);
    } catch (e: unknown) {
      log.error("text pipeline error:", e);
    }
  }

  /**
   * ボイスレシーバーに発話リスナーを設定する。
   */
  private setupVoiceReceiver(connection: VoiceConnection): void {
    const receiver = connection.receiver;
    // 重複サブスクリプションを防ぐため、録音中のユーザーを追跡する。
    const activeUsers = new Set<string>();

    receiver.speaking.on("start", (userId) => {
      // AI 中断はフレーム単位の RMS 判定で行う（data イベント内）。
      if (activeUsers.has(userId)) {
        return;
      }
      activeUsers.add(userId);
      log.info(`recording user ${userId}`);

      // ユーザーの音声ストリームを購読する。1.5 秒の無音で終了。
      const opusStream = receiver.subscribe(userId, {
        end: {
          behavior: EndBehaviorType.AfterSilence,
          duration: 1500,
        },
      });

      const pcmChunks: Buffer[] = [];

      opusStream.on("data", (chunk: Buffer) => {
        try {
          const pcm = this.opusDecoder.decode(chunk);
          pcmChunks.push(pcm);

          // AI 再生中ならフレーム単位で RMS を判定し、即中断する。
          if (this.voicePlayer.isSpeaking) {
            const rms = calcRms(pcm);
            if (rms >= this.config.voice.interruptRms) {
              log.info(
                `interrupting AI speech in real-time (RMS: ${rms.toFixed(0)})`,
              );
              this.voicePlayer.interrupt();
            }
          }
        } catch {
          // 不正な Opus フレームはスキップする。
        }
      });

      opusStream.on("end", () => {
        this.onSpeechEnd(userId, pcmChunks, activeUsers);
      });

      opusStream.on("error", (err: Error) => {
        activeUsers.delete(userId);
        log.error(`stream error for user ${userId}:`, err.message);
      });
    });
  }

  /**
   * 発話完了後の STT → LLM → TTS パイプラインを実行する。
   * 文字起こし前に最小長・最小 RMS フィルタを適用する。
   *
   * AI が再生中の場合は interruptRms で判定し、
   * 超えていれば割り込む。超えていなければ無視する。
   *
   * イベントハンドラから呼ばれるため、例外がプロセスを殺さないよう
   * 全体を try/catch で保護する。
   */
  private async onSpeechEnd(
    userId: string,
    pcmChunks: Buffer[],
    activeUsers: Set<string>,
  ): Promise<void> {
    activeUsers.delete(userId);

    try {
      if (pcmChunks.length === 0) return;

      const pcm = Buffer.concat(pcmChunks);

      if (pcm.length < this.minPcmBytes) {
        log.debug("audio too short, skipping");
        return;
      }

      const rms = calcRms(pcm);

      // AI が喋っている場合は高い閾値（interruptRms）で判定する。
      if (this.voicePlayer.isSpeaking) {
        if (rms < this.config.voice.interruptRms) {
          log.debug(
            `audio during AI speech too quiet to interrupt (RMS: ${
              rms.toFixed(0)
            }), skipping`,
          );
          return;
        }
        log.info(`interrupting AI speech (RMS: ${rms.toFixed(0)})`);
        this.voicePlayer.interrupt();
      } else {
        // 通常の発話判定。
        if (rms < this.config.voice.speechRms) {
          log.debug(`audio too quiet (RMS: ${rms.toFixed(0)}), skipping`);
          return;
        }
      }

      log.info(
        `processing ${pcmChunks.length} frame(s), ${
          (pcm.length / 1024).toFixed(1)
        } KB PCM, RMS: ${rms.toFixed(0)}`,
      );

      const text = await this.stt.transcribe(pcm);
      if (!text) {
        log.info("no transcription result");
        return;
      }

      log.info(`transcript: ${text}`);
      const reply = await this.llm.chat(text);
      if (!reply) return;

      log.info(`reply: ${reply}`);
      await this.voicePlayer.speak(reply);
    } catch (e: unknown) {
      log.error(`pipeline error for user ${userId}:`, e);
    }
  }

  /**
   * Discord に接続し、VC に参加するまで待機する。
   * clientReady 後の VC 参加に失敗した場合はクライアントを破棄して例外を再送する。
   * 呼び出し元でリトライ可能。
   */
  async start(): Promise<void> {
    log.info("logging in...");

    // clientReady イベントを Promise 化して待機する。
    const readyPromise = new Promise<void>((resolve, reject) => {
      this.client.once("clientReady", () => {
        this.onReady().then(resolve, reject);
      });
    });

    await this.client.login(this.config.discordToken);

    try {
      await readyPromise;
    } catch (err) {
      // VC 参加に失敗した場合はクライアントを破棄して呼び出し元に伝播させる。
      log.error("onReady failed, destroying client:", err);
      this.client.destroy();
      throw err;
    }
  }

  /**
   * ボイスから切断し Discord クライアントを破棄する。
   */
  shutdown(): void {
    log.info("shutting down...");
    if (this.currentConnection) {
      this.currentConnection.destroy();
      log.info("disconnected from voice channel");
    }
    this.client.destroy();
    log.info("client destroyed");
  }
}
