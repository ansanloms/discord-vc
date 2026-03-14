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
   * ユーザーメッセージを送信し、モデルの返答を取得する。
   * 実装側で会話履歴を管理することを期待する。
   *
   * @param message - ユーザーのメッセージ。
   * @returns モデルの返答。失敗時は空文字列。
   */
  chat(message: string): Promise<string>;

  /**
   * 会話履歴をクリアする。
   */
  clearHistory(): void;

  /**
   * テンプレート変数のコンテキストを設定する。
   * システムプロンプト内の `{{KEY}}` が対応する値で置換される。
   * 既存のコンテキストにマージされる。
   * 値が `undefined` のキーはコンテキストから削除される。
   *
   * @param context - キーと値のマップ。
   */
  setContext(context: Record<string, string | undefined>): void;

  /**
   * Discord クライアントを設定する。
   * ツール非対応の実装では何もしなくてよい。
   *
   * @param discord - Discord クライアントとギルド ID。
   */
  setDiscordClient(discord: DiscordContext): void;
}
