/**
 * OpenAI Agents SDK を使った LLM 実装。
 *
 * `@openai/agents` の `Agent` / `run()` で通信する。
 * OpenClaw / Ollama など OpenAI 互換のエンドポイントならそのまま利用可能。
 * MAX_HISTORY ターン分のローリング会話履歴を保持する。
 * `addTools()` で外部からツールを注入でき、Agent を再構築する。
 */

import OpenAI from "@openai/openai";
import { Agent, OpenAIResponsesModel, run, user } from "@openai/agents";
import type { AgentInputItem, Tool } from "@openai/agents";
import { createLogger } from "../logger.ts";
import type { LanguageModel } from "./types.ts";
import { replaceTemplateVariables } from "./template.ts";

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
   * カスタム fetch 関数。テストでのモック注入用。
   */
  fetch?: typeof globalThis.fetch;
}

/**
 * OpenAI Agents SDK 経由の言語モデル。
 *
 * 会話履歴はメモリ上に保持し、MAX_HISTORY * 2 メッセージを
 * 超えると古いものから自動的に切り捨てる。
 * ツール呼び出しループは SDK 内部で自動的に完結する。
 */
export class OpenAiLlm implements LanguageModel {
  private readonly agentModel: OpenAIResponsesModel;
  private readonly systemPromptTemplate?: string;
  private context: Record<string, string> = {};
  private agent: Agent;
  private externalTools: Tool[] = [];
  private history: AgentInputItem[] = [];

  constructor(config: OpenAiLlmConfig) {
    // deno-lint-ignore no-explicit-any
    const clientOptions: Record<string, any> = {
      baseURL: `${config.baseUrl}/v1`,
      apiKey: config.apiKey ?? "dummy",
    };
    if (config.fetch) {
      clientOptions.fetch = config.fetch;
    }
    const client = new OpenAI(clientOptions);

    // Agent ごとに OpenAI クライアントを紐付けるため
    // グローバルの setDefaultOpenAIClient ではなく
    // OpenAIResponsesModel を直接使う。
    // deno-lint-ignore no-explicit-any
    this.agentModel = new OpenAIResponsesModel(client as any, config.model);
    this.systemPromptTemplate = config.systemPrompt;
    this.agent = this.buildAgent();
  }

  /**
   * 現在の設定で Agent インスタンスを構築する。
   */
  private buildAgent(): Agent {
    const instructions = this.systemPromptTemplate
      ? replaceTemplateVariables(this.systemPromptTemplate, this.context)
      : undefined;

    return new Agent({
      name: "openai-llm",
      instructions: instructions ?? "",
      model: this.agentModel,
      tools: this.externalTools,
    });
  }

  /**
   * 外部からツールを追加し、Agent を再構築する。
   *
   * @param tools - 追加するツールの配列。
   */
  addTools(tools: Tool[]): void {
    this.externalTools.push(...tools);
    this.agent = this.buildAgent();
  }

  /**
   * @inheritdoc
   */
  async chat(userMessage: string): Promise<string> {
    this.history.push(user(userMessage));

    // 直近のターンのみ保持するよう履歴をトリミングする。
    while (this.history.length > MAX_HISTORY * 2) {
      this.history.shift();
    }

    try {
      // システムプロンプトにコンテキスト変数を反映するため Agent を再構築する。
      this.agent = this.buildAgent();

      const result = await run(this.agent, this.history);
      const reply = result.finalOutput ?? "";

      // SDK が返す履歴で上書きする（ツール呼び出し等も含まれる）。
      this.history = [...result.history];

      return reply;
    } catch (e: unknown) {
      log.error("API error:", e);
      // 追加したユーザーメッセージを削除する — このターンは失敗した。
      this.history.pop();
      return "";
    }
  }

  /**
   * @inheritdoc
   */
  clearHistory(): void {
    this.history = [];
    log.info("conversation history cleared");
  }

  /**
   * @inheritdoc
   */
  setContext(context: Record<string, string | undefined>): void {
    for (const [key, value] of Object.entries(context)) {
      if (value === undefined) {
        delete this.context[key];
      } else {
        this.context[key] = value;
      }
    }
  }
}
