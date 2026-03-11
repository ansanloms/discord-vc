/**
 * OpenAI 互換 API を使った LLM 実装。
 *
 * OpenAI SDK の `chat.completions.create()` で通信する。
 * OpenClaw / Ollama など OpenAI 互換のエンドポイントならそのまま利用可能。
 * MAX_HISTORY ターン分のローリング会話履歴を保持する。
 */

import OpenAI from "@openai/openai";
import { createLogger } from "../logger.ts";
import type { LanguageModel } from "./types.ts";

const log = createLogger("llm");

/**
 * 保持するユーザー＋アシスタントのターンペア数の上限。
 */
const MAX_HISTORY = 20;

/**
 * OpenAiLlm のコンストラクタ設定。
 */
export interface OpenAiLlmConfig {
  /**
   * API のベース URL（例: `http://localhost:18789`）。
   */
  baseUrl: string;
  /**
   * API キー。未指定なら認証なし。
   */
  apiKey?: string;
  /**
   * LLM に渡すシステムプロンプト。未指定ならシステムメッセージを送らない。
   */
  systemPrompt?: string;
  /**
   * 使用するモデル名。
   */
  model: string;
  /**
   * OpenAI SDK に渡す追加オプション。
   */
  clientOptions?: Partial<ConstructorParameters<typeof OpenAI>[0]>;
}

/**
 * OpenAI 互換 API 経由の言語モデル。
 *
 * 会話履歴はメモリ上に保持し、MAX_HISTORY * 2 メッセージを
 * 超えると古いものから自動的に切り捨てる。
 */
export class OpenAiLlm implements LanguageModel {
  private readonly client: OpenAI;
  private readonly model: string;
  private readonly systemPrompt?: string;
  private readonly history: OpenAI.ChatCompletionMessageParam[] = [];

  constructor(config: OpenAiLlmConfig) {
    this.client = new OpenAI({
      baseURL: `${config.baseUrl}/v1`,
      apiKey: config.apiKey ?? "dummy",
      ...config.clientOptions,
    });
    this.model = config.model;
    this.systemPrompt = config.systemPrompt;
  }

  /**
   * @inheritdoc
   */
  async chat(userMessage: string): Promise<string> {
    this.history.push({ role: "user", content: userMessage });

    // 直近のターンのみ保持するよう履歴をトリミングする。
    while (this.history.length > MAX_HISTORY * 2) {
      this.history.shift();
    }

    try {
      const messages: OpenAI.ChatCompletionMessageParam[] = [];
      if (this.systemPrompt) {
        messages.push({ role: "system", content: this.systemPrompt });
      }
      messages.push(...this.history);

      const completion = await this.client.chat.completions.create({
        model: this.model,
        messages,
      });

      const reply = completion.choices?.[0]?.message?.content ?? "";
      this.history.push({ role: "assistant", content: reply });
      return reply;
    } catch (e: unknown) {
      log.error("API error:", e);
      // 追加したユーザーメッセージを削除する — このターンは失敗した。
      this.history.pop();
      return "";
    }
  }
}
