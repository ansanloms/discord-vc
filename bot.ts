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
import {
  ChannelType,
  Client,
  GatewayIntentBits,
  MessageFlags,
  REST,
  Routes,
  SlashCommandBuilder,
} from "discord.js";
import type { ChatInputCommandInteraction } from "discord.js";
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
import { replaceTemplateVariables } from "./llm/template.ts";
import { calcRms, createOpusDecoder } from "./audio/codec.ts";
import type { Config } from "./config.ts";
import { buildLlmConfig } from "./config.ts";
import { createLlm } from "./services.ts";
import type { SpeechToText } from "./stt/types.ts";
import type { LanguageModel } from "./llm/types.ts";
import type { VoicePlayer } from "./audio/player.ts";

/**
 * LLM バックエンドの選択肢。
 */
const LLM_CHOICES = [
  { name: "openai", value: "openai" },
  { name: "anthropic", value: "anthropic" },
  { name: "ollama", value: "ollama" },
] as const;

/**
 * /aivc スラッシュコマンドの定義。
 */
const vcCommand = new SlashCommandBuilder()
  .setName("aivc")
  .setDescription("Voice channel operations")
  .addSubcommand((sub) =>
    sub
      .setName("join")
      .setDescription("Join a voice channel")
      .addStringOption((opt) =>
        opt
          .setName("llm")
          .setDescription("LLM backend to use")
          .setRequired(false)
          .addChoices(...LLM_CHOICES)
      )
  )
  .addSubcommand((sub) =>
    sub
      .setName("leave")
      .setDescription("Leave the voice channel")
  )
  .addSubcommand((sub) =>
    sub
      .setName("ping")
      .setDescription("Health check")
  )
  .addSubcommand((sub) =>
    sub
      .setName("message")
      .setDescription("Send text to LLM and reply with voice")
      .addStringOption((opt) =>
        opt
          .setName("text")
          .setDescription("Message to send")
          .setRequired(true)
      )
  )
  .addSubcommandGroup((group) =>
    group
      .setName("clear")
      .setDescription("Clear various data")
      .addSubcommand((sub) =>
        sub
          .setName("history")
          .setDescription("Clear LLM conversation history")
      )
  );

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

  /**
   * VC にボット以外のメンバーがいなくなってから自動退出するまでの時間（ミリ秒）。
   * -1 の場合は自動退出しない。
   */
  autoLeaveMs: number;

  /**
   * 発話デバウンス待機時間（ミリ秒）。
   * この時間内に同一ユーザーの追加発話があればまとめて LLM に投げる。
   */
  speechDebounceMs: number;
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
 * テンプレートを使ってユーザーメッセージに発言者情報を付与する。
 * テンプレート未指定時はメッセージをそのまま返す。
 *
 * @param template - メッセージテンプレート（`{{discord.user.name}}`, `{{discord.user.id}}`, `{{message}}` を含む）。未指定時は変換しない。
 * @param message - 元のメッセージ。
 * @param displayName - ユーザーの表示名。
 * @param userId - Discord ユーザー ID。
 * @returns テンプレート置換後の文字列、またはそのままのメッセージ。
 */
function formatUserMessage(
  template: string | undefined,
  message: string,
  displayName: string,
  userId: string,
): string {
  if (!template) {
    return message;
  }

  return replaceTemplateVariables(template, {
    "discord.user.name": displayName,
    "discord.user.id": userId,
    "message": message,
  });
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
   * 現在参加中のボイスチャンネル ID。未接続時は null。
   */
  private currentChannelId: string | null = null;

  /**
   * 自動退出タイマーの ID。タイマー未設定時は null。
   */
  private autoLeaveTimer: ReturnType<typeof setTimeout> | null = null;

  /**
   * 発話デバウンス用バッファ。
   * ユーザーごとに STT 結果テキストを溜め、一定時間後にまとめて LLM に投げる。
   */
  private readonly speechDebounce = new Map<string, {
    texts: string[];
    displayName: string;
    timer: ReturnType<typeof setTimeout>;
  }>();

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
    private config: Config,
    private readonly stt: SpeechToText,
    private llm: LanguageModel,
    private readonly voicePlayer: VoicePlayer,
  ) {
    this.minPcmBytes = msToBytes(config.voice.minSpeechMs);
    this.client = new Client({
      intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildVoiceStates,
        GatewayIntentBits.GuildMembers,
      ],
    });
    this.llm.setContext({ "discord.guild.id": config.guildId });
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

    this.client.on("interactionCreate", (interaction) => {
      if (!interaction.isChatInputCommand()) {
        return;
      }
      if (interaction.commandName !== vcCommand.name) {
        return;
      }

      this.handleVcCommand(interaction).catch((e) =>
        log.error("slash command error:", e)
      );
    });

    // VC メンバーの入退室を監視し、誰もいなくなったら自動退出する。
    this.client.on("voiceStateUpdate", (_oldState, newState) => {
      if (!this.currentChannelId) return;
      if (
        newState.channelId !== this.currentChannelId &&
        _oldState.channelId !== this.currentChannelId
      ) {
        return;
      }
      this.checkAutoLeave();
    });
  }

  /**
   * 現在の VC にボット以外のメンバーがいるか確認し、
   * いなければ自動退出タイマーを開始する。
   * メンバーが戻ってきた場合はタイマーをキャンセルする。
   */
  private checkAutoLeave(): void {
    if (!this.currentChannelId || this.config.voice.autoLeaveMs < 0) return;

    const channel = this.client.channels.cache.get(this.currentChannelId);
    if (!channel || channel.type !== ChannelType.GuildVoice) return;

    // ボット自身を除いたメンバー数。
    const memberCount = channel.members.filter((m) => !m.user.bot).size;

    if (memberCount === 0) {
      // 既にタイマーが動いていれば何もしない。
      if (this.autoLeaveTimer) return;

      log.info(
        `no members in VC, auto-leave in ${
          this.config.voice.autoLeaveMs / 1000
        }s`,
      );
      this.autoLeaveTimer = setTimeout(() => {
        this.autoLeaveTimer = null;
        // 再度確認してまだ誰もいなければ退出する。
        const ch = this.client.channels.cache.get(this.currentChannelId!);
        if (
          ch && ch.type === ChannelType.GuildVoice &&
          ch.members.filter((m) => !m.user.bot).size === 0
        ) {
          log.info("auto-leaving VC (no members)");
          const conn = getVoiceConnection(this.config.guildId);
          if (conn) {
            conn.destroy();
            this.currentConnection = null;
            this.currentChannelId = null;
            this.llm.setContext({
              "discord.channel.current.id": undefined,
              "discord.channel.current.name": undefined,
            });
          }
        }
      }, this.config.voice.autoLeaveMs);
    } else {
      // メンバーがいるのでタイマーをキャンセルする。
      if (this.autoLeaveTimer) {
        clearTimeout(this.autoLeaveTimer);
        this.autoLeaveTimer = null;
        log.info("auto-leave cancelled (member joined)");
      }
    }
  }

  /**
   * /vc サブコマンドのディスパッチ。
   */
  private async handleVcCommand(
    interaction: ChatInputCommandInteraction,
  ): Promise<void> {
    const group = interaction.options.getSubcommandGroup();
    const sub = interaction.options.getSubcommand();
    const isVoiceChannel = interaction.channel?.type === ChannelType.GuildVoice;

    // /vc clear <type>
    if (group === "clear") {
      switch (sub) {
        case "history": {
          this.llm.clearHistory();
          await interaction.reply("Conversation history cleared.");
          return;
        }
      }
      return;
    }

    switch (sub) {
      case "join": {
        if (!isVoiceChannel) {
          await interaction.reply({
            content: "Please run this from a VC text chat.",
            flags: MessageFlags.Ephemeral,
          });
          return;
        }
        await interaction.deferReply();

        // LLM バックエンドの切り替え。
        const llmType = interaction.options.getString("llm");
        if (llmType) {
          this.switchLlm(llmType);
        }

        await this.joinChannel(interaction.channelId);

        const activeLlm = llmType ?? this.config.llm.type;
        await interaction.editReply(`Joined VC (LLM: ${activeLlm})`);
        return;
      }

      case "leave": {
        if (
          !isVoiceChannel || interaction.channelId !== this.currentChannelId
        ) {
          await interaction.reply({
            content: "Please run this from the text chat of the VC I'm in.",
            flags: MessageFlags.Ephemeral,
          });
          return;
        }
        const conn = getVoiceConnection(this.config.guildId);
        if (conn) {
          conn.destroy();
          this.currentConnection = null;
          this.currentChannelId = null;
          this.llm.setContext({
            "discord.channel.current.id": undefined,
            "discord.channel.current.name": undefined,
          });
        }
        await interaction.reply("Left VC");
        return;
      }

      case "ping": {
        if (
          !isVoiceChannel || interaction.channelId !== this.currentChannelId
        ) {
          await interaction.reply({
            content: "Please run this from the text chat of the VC I'm in.",
            flags: MessageFlags.Ephemeral,
          });
          return;
        }
        await interaction.reply("pong");
        return;
      }

      case "message": {
        if (
          !isVoiceChannel || interaction.channelId !== this.currentChannelId
        ) {
          await interaction.reply({
            content: "Please run this from the text chat of the VC I'm in.",
            flags: MessageFlags.Ephemeral,
          });
          return;
        }
        const text = interaction.options.getString("text", true);
        const displayName = interaction.member &&
            "displayName" in interaction.member
          ? interaction.member.displayName
          : interaction.user.displayName;
        await interaction.deferReply();
        await this.onTextMessage(
          text,
          displayName,
          interaction.user.id,
          interaction,
        );
        return;
      }
    }
  }

  /**
   * テキストメッセージを LLM → TTS パイプラインに通す。
   */
  private async onTextMessage(
    content: string,
    displayName: string,
    userId: string,
    interaction: ChatInputCommandInteraction,
  ): Promise<void> {
    try {
      log.info(`text from ${displayName} (${userId}): ${content}`);
      const formatted = formatUserMessage(
        this.config.messageTemplate,
        content,
        displayName,
        userId,
      );
      const reply = await this.llm.chat(formatted);
      if (!reply) {
        await interaction.editReply("(No response)");
        return;
      }

      log.info(`reply: ${reply}`);
      await interaction.editReply(reply);
      await this.voicePlayer.speak(reply);
    } catch (e: unknown) {
      log.error("text pipeline error:", e);
      await interaction.editReply("An error occurred.").catch(() => {});
    }
  }

  /**
   * Discord クライアントの準備完了時に呼ばれる。
   * スラッシュコマンドをギルドに登録し、バックエンド情報を出力する。
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
      `LLM: ${this.config.llm.type} (${
        this.config.llm.type === "openai"
          ? this.config.llm.config.baseUrl
          : this.config.llm.config.model
      })`,
    );
    log.info(
      `voice thresholds: minSpeechMs=${this.config.voice.minSpeechMs}, speechRms=${this.config.voice.speechRms}, interruptRms=${this.config.voice.interruptRms}`,
    );

    // ギルド名をコンテキストに設定する。
    const guild = this.client.guilds.cache.get(this.config.guildId);
    if (guild) {
      this.llm.setContext({ "discord.guild.name": guild.name });
    }

    // LLM バックエンドに Discord クライアントを設定する。
    this.llm.setDiscordClient({
      client: this.client,
      guildId: this.config.guildId,
    });

    // スラッシュコマンドをギルドに登録する。
    const rest = new REST().setToken(this.config.discordToken);
    const clientId = this.client.user!.id;
    await rest.put(
      Routes.applicationGuildCommands(clientId, this.config.guildId),
      { body: [vcCommand.toJSON()] },
    );
    log.info("slash commands registered");
  }

  /**
   * LLM バックエンドを切り替える。
   * 環境変数から対応する設定を読み込み、新しいインスタンスを生成して差し替える。
   * 会話履歴はリセットされる。
   */
  private switchLlm(llmType: string): void {
    const llmConfig = buildLlmConfig(llmType);
    this.llm = createLlm(llmConfig);
    this.config = { ...this.config, llm: llmConfig };

    // コンテキストを再設定する。
    this.llm.setContext({ "discord.guild.id": this.config.guildId });
    const guild = this.client.guilds.cache.get(this.config.guildId);
    if (guild) {
      this.llm.setContext({ "discord.guild.name": guild.name });
    }
    this.llm.setDiscordClient({
      client: this.client,
      guildId: this.config.guildId,
    });
    if (this.currentChannelId) {
      const channel = guild?.channels.cache.get(this.currentChannelId);
      this.llm.setContext({
        "discord.channel.current.id": this.currentChannelId,
        "discord.channel.current.name": channel?.name ?? this.currentChannelId,
      });
    }

    log.info(`LLM switched to ${llmType}`);
  }

  /**
   * 指定されたボイスチャンネルに参加する。
   * 既に別の VC に参加中の場合は切断してから参加する。
   */
  private async joinChannel(channelId: string): Promise<void> {
    // 既存の接続を破棄する。
    if (this.currentConnection) {
      this.currentConnection.destroy();
      this.currentConnection = null;
      this.currentChannelId = null;
    }

    const guild = this.client.guilds.cache.get(this.config.guildId);
    if (!guild) {
      throw new Error(`guild ${this.config.guildId} not found in cache`);
    }

    const connection = joinVoiceChannel({
      channelId,
      guildId: this.config.guildId,
      adapterCreator: guild.voiceAdapterCreator,
      selfDeaf: false,
    });
    this.currentConnection = connection;
    this.currentChannelId = channelId;
    const channel = guild.channels.cache.get(channelId);
    this.llm.setContext({
      "discord.channel.current.id": channelId,
      "discord.channel.current.name": channel?.name ?? channelId,
    });

    connection.on("stateChange", (_old, newState) => {
      log.debug(`voice state: ${newState.status}`);
    });

    await entersState(connection, VoiceConnectionStatus.Ready, 30_000);
    log.info(`voice connection ready (channel: ${channelId})`);
    connection.subscribe(this.voicePlayer.discordPlayer);
    this.setupVoiceReceiver(connection);

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
      this.currentChannelId = null;
      this.llm.setContext({
        "discord.channel.current.id": undefined,
        "discord.channel.current.name": undefined,
      });
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
      if (pcmChunks.length === 0) {
        return;
      }

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

      // ギルドメンバーキャッシュから表示名を解決する。
      const guild = this.client.guilds.cache.get(this.config.guildId);
      const member = guild?.members.cache.get(userId);
      const displayName = member?.displayName ?? userId;

      log.info(`transcript from ${displayName} (${userId}): ${text}`);

      // デバウンス: 連続発話をまとめてから LLM に投げる。
      this.enqueueSpeech(userId, displayName, text);
    } catch (e: unknown) {
      log.error(`pipeline error for user ${userId}:`, e);
    }
  }

  /**
   * 発話テキストをデバウンスバッファに追加する。
   * DEBOUNCE_MS 以内に同一ユーザーの追加発話があればまとめ、
   * タイムアウト後にまとめて LLM → TTS パイプラインに投げる。
   */
  private enqueueSpeech(
    userId: string,
    displayName: string,
    text: string,
  ): void {
    const existing = this.speechDebounce.get(userId);
    const scheduleFlush = () =>
      setTimeout(
        () =>
          this.flushSpeech(userId).catch((e) =>
            log.error(`flush error for user ${userId}:`, e)
          ),
        this.config.voice.speechDebounceMs,
      );

    if (existing) {
      clearTimeout(existing.timer);
      existing.texts.push(text);
      existing.timer = scheduleFlush();
    } else {
      const timer = scheduleFlush();
      this.speechDebounce.set(userId, { texts: [text], displayName, timer });
    }
  }

  /**
   * デバウンスバッファをフラッシュし、LLM → TTS パイプラインを実行する。
   */
  private async flushSpeech(userId: string): Promise<void> {
    const entry = this.speechDebounce.get(userId);
    this.speechDebounce.delete(userId);
    if (!entry || entry.texts.length === 0) {
      return;
    }

    const mergedText = entry.texts.join("");
    const formatted = formatUserMessage(
      this.config.messageTemplate,
      mergedText,
      entry.displayName,
      userId,
    );

    try {
      log.info(
        `sending to LLM (${entry.texts.length} segment(s)): ${mergedText}`,
      );
      const reply = await this.llm.chat(formatted);
      if (!reply) {
        return;
      }

      log.info(`reply: ${reply}`);
      await this.voicePlayer.speak(reply);
    } catch (e: unknown) {
      log.error(`pipeline error for user ${userId}:`, e);
    }
  }

  /**
   * Discord に接続し、スラッシュコマンドを登録する。
   * VC への参加は /vc join コマンドで行う。
   */
  async start(): Promise<void> {
    log.info("logging in...");

    const readyPromise = new Promise<void>((resolve, reject) => {
      this.client.once("clientReady", () => {
        this.onReady().then(resolve, reject);
      });
    });

    await this.client.login(this.config.discordToken);

    try {
      await readyPromise;
    } catch (err) {
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
    if (this.autoLeaveTimer) {
      clearTimeout(this.autoLeaveTimer);
      this.autoLeaveTimer = null;
    }
    // デバウンスタイマーをすべてキャンセルする。
    for (const entry of this.speechDebounce.values()) {
      clearTimeout(entry.timer);
    }
    this.speechDebounce.clear();
    if (this.currentConnection) {
      try {
        this.currentConnection.destroy();
      } catch {
        // 既に destroyed の場合は無視する。
      }
      this.currentConnection = null;
      this.currentChannelId = null;
      log.info("disconnected from voice channel");
    }
    this.client.destroy();
    log.info("client destroyed");
  }
}
