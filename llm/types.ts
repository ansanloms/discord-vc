/**
 * 言語モデル（Language Model）の抽象化。
 *
 * このインターフェースを実装することで、LLM バックエンド
 * （例: OpenAI、Anthropic、Ollama）をパイプラインの他の部分を
 * 変更せずに差し替えられる。
 */

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
}
