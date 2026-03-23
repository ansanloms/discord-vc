/**
 * 言語モデル（Language Model）の抽象化。
 *
 * このインターフェースを実装することで、LLM バックエンド
 * （例: Claude、Ollama）をパイプラインの他の部分を
 * 変更せずに差し替えられる。
 */

import type { Client } from "discord.js";

/**
 * Discord クライアントと操作対象ギルドの組。
 * LLM が Discord 操作ツールを実行する際に必要な情報。
 */
export interface DiscordContext {
  /** Discord.js クライアントインスタンス。 */
  client: Client;
  /** 操作対象のギルド ID。 */
  guildId: string;
}

/**
 * 会話履歴を内部で管理するステートフルな対話型 LLM。
 */
export interface LanguageModel {
  /**
   * ユーザーメッセージを送信し、モデルの返答を逐次取得する。
   * 実装側で会話履歴を管理することを期待する。
   *
   * ツール呼び出しを伴う場合、中間応答（例: 「調べます」）と
   * 最終応答が順に yield される。ツールなしの場合は 1 回の yield で完了する。
   * エラー時は何も yield せずに終了する。
   *
   * @param message - ユーザーのメッセージ。
   * @returns 応答テキストを逐次返す AsyncGenerator。
   */
  chat(message: string): AsyncGenerator<string>;

  /**
   * 会話履歴をクリアする。
   */
  clearHistory(): void | Promise<void>;

  /**
   * システムプロンプトを設定する。
   * 呼び出し以降の chat() で使用される。
   *
   * @param prompt - システムプロンプト文字列。undefined でクリア。
   */
  setSystemPrompt(prompt: string | undefined): void;

  /**
   * テンプレート変数のコンテキストを設定する。
   * システムプロンプトのパス解決や内容の変数置換に使用される。
   * 既存のコンテキストにマージされる。
   * 値が `undefined` のキーはコンテキストから削除される。
   *
   * @param context - キーと値のマップ。
   */
  setContext(context: Record<string, string | undefined>): void;

  /**
   * 現在のテンプレート変数コンテキストを返す。
   */
  getContext(): Record<string, string>;

  /**
   * Discord クライアントを設定する。
   * ツール非対応の実装では何もしなくてよい。
   *
   * @param discord - Discord クライアントとギルド ID。
   */
  setDiscordClient(discord: DiscordContext): void;
}
