/**
 * Anthropic SDK を直接使った LLM 実装。
 *
 * `@anthropic-ai/sdk` で Claude API に接続する。
 * tool use（web search + カスタムツール）に対応し、
 * ツール呼び出しのマルチターンループを chat() 内部で完結させる。
 * MAX_HISTORY ターン分のローリング会話履歴を保持する。
 */

import Anthropic from "@anthropic-ai/sdk";
import type {
  MessageParam,
  Tool,
  ToolResultBlockParam,
  ToolUseBlock,
} from "@anthropic-ai/sdk/resources/messages";
import { createLogger } from "../logger.ts";
import type { LanguageModel } from "./types.ts";
import { replaceTemplateVariables } from "./template.ts";

const log = createLogger("llm:anthropic");

/**
 * 保持するユーザー＋アシスタントのターンペア数の上限。
 */
const MAX_HISTORY = 20;

/**
 * ツール実行結果の型。
 * 文字列またはコンテンツブロック配列（画像を含めたい場合など）を返せる。
 */
export type ToolExecutorResult = NonNullable<ToolResultBlockParam["content"]>;

/**
 * カスタムツールの実行関数。
 * ツール入力を受け取り、結果を返す。
 */
export type ToolExecutor = (
  input: Record<string, unknown>,
) => Promise<ToolExecutorResult>;

/**
 * web search のユーザー位置情報。
 */
export interface WebSearchUserLocation {
  type: "approximate";
  city?: string;
  region?: string;
  country?: string;
  timezone?: string;
}

/**
 * web search の設定。
 */
export interface WebSearchConfig {
  /** web search の最大使用回数。 */
  maxUses?: number;
  /** ユーザー位置情報。 */
  userLocation?: WebSearchUserLocation;
}

/**
 * AnthropicLlm のコンストラクタ設定。
 */
export interface AnthropicLlmConfig {
  /**
   * API キー。未指定なら ANTHROPIC_API_KEY 環境変数を使用する。
   */
  apiKey?: string;

  /**
   * 使用するモデル名。
   */
  model: string;

  /**
   * LLM に渡すシステムプロンプト。未指定ならデフォルトを使用する。
   */
  systemPrompt?: string;

  /**
   * レスポンスの最大トークン数。
   */
  maxTokens?: number;

  /**
   * Anthropic サーバーサイドの web search を有効にする。
   * true で既定設定、オブジェクトで詳細設定。
   */
  webSearch?: boolean | WebSearchConfig;

  /**
   * クライアントサイドで実行するカスタムツール定義。
   */
  customTools?: Tool[];

  /**
   * カスタムツールの実行関数マップ。キーはツール名。
   */
  customToolExecutors?: Record<string, ToolExecutor>;

  /**
   * ツール呼び出しの最大ラウンドトリップ数。
   */
  maxToolRounds?: number;
}

/**
 * Anthropic SDK 経由の言語モデル。
 *
 * 会話履歴はメモリ上に保持し、MAX_HISTORY * 2 メッセージを
 * 超えると古いものから自動的に切り捨てる。
 * tool use のループは chat() 内部で完結する。
 */
export class AnthropicLlm implements LanguageModel {
  private readonly client: Anthropic;
  private readonly model: string;
  private readonly systemPromptTemplate?: string;
  private context: Record<string, string> = {};
  private readonly maxTokens: number;
  private tools: (Tool | Record<string, unknown>)[];
  private customToolExecutors: Record<string, ToolExecutor>;
  private readonly maxToolRounds: number;
  private readonly history: MessageParam[] = [];

  constructor(config: AnthropicLlmConfig) {
    this.client = new Anthropic({
      apiKey: config.apiKey,
    });
    this.model = config.model;
    this.systemPromptTemplate = config.systemPrompt;
    this.maxTokens = config.maxTokens ?? 1024;
    this.customToolExecutors = config.customToolExecutors ?? {};
    this.maxToolRounds = config.maxToolRounds ?? 5;

    // ツール配列を構築する。
    this.tools = [];

    // Anthropic サーバーサイドの web search。
    if (config.webSearch) {
      const wsConfig = typeof config.webSearch === "object"
        ? config.webSearch
        : {};
      const webSearchTool: Record<string, unknown> = {
        type: "web_search_20250305",
        name: "web_search",
      };
      if (wsConfig.maxUses) webSearchTool.max_uses = wsConfig.maxUses;
      if (wsConfig.userLocation) {
        webSearchTool.user_location = wsConfig.userLocation;
      }
      this.tools.push(webSearchTool);
    }

    // クライアントサイド実行のカスタムツール。
    if (config.customTools) {
      this.tools.push(...config.customTools);
    }
  }

  /**
   * ツール定義と executor を追加する。
   * 外部から動的にツールを注入するために使用する。
   *
   * @param tools - 追加するツール定義の配列。
   * @param executors - ツール名をキーとした executor マップ。
   */
  addTools(tools: Tool[], executors: Record<string, ToolExecutor>): void {
    this.tools.push(...tools);
    Object.assign(this.customToolExecutors, executors);
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
      for (let round = 0; round <= this.maxToolRounds; round++) {
        const system = this.systemPromptTemplate
          ? replaceTemplateVariables(this.systemPromptTemplate, this.context)
          : undefined;
        const response = await this.client.messages.create({
          model: this.model,
          max_tokens: this.maxTokens,
          ...(system ? { system } : {}),
          tools: this.tools.length > 0 ? this.tools as Tool[] : undefined,
          messages: this.history,
        });

        this.history.push({ role: "assistant", content: response.content });

        // tool_use 以外の終了理由 → テキストを抽出して返す。
        if (response.stop_reason !== "tool_use") {
          return this.extractText(response.content);
        }

        // クライアントサイドの tool_use ブロックのみ解決が必要。
        // server_tool_use（web_search 等）はレスポンスに結果が含まれている。
        const clientToolUseBlocks = response.content.filter(
          (b: Anthropic.ContentBlock): b is ToolUseBlock =>
            b.type === "tool_use",
        );

        if (clientToolUseBlocks.length === 0) {
          // サーバーサイドツールのみだった場合。
          return this.extractText(response.content);
        }

        const toolResults = await this.resolveToolCalls(clientToolUseBlocks);
        this.history.push({ role: "user", content: toolResults });
      }

      log.warn("tool use round limit reached");
      return "";
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
    this.history.length = 0;
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

  /**
   * レスポンスのコンテンツブロックからテキストを抽出する。
   */
  private extractText(
    content: Anthropic.ContentBlock[],
  ): string {
    return content
      .filter((b) => b.type === "text")
      .map((b) => (b as { type: "text"; text: string }).text)
      .join("");
  }

  /**
   * クライアントサイドのツール呼び出しを実行し、結果を返す。
   */
  private resolveToolCalls(
    blocks: ToolUseBlock[],
  ): Promise<ToolResultBlockParam[]> {
    return Promise.all(
      blocks.map(async (block) => {
        const executor = this.customToolExecutors[block.name];
        if (!executor) {
          log.warn(`unknown tool: ${block.name}`);
          return {
            type: "tool_result" as const,
            tool_use_id: block.id,
            content: `Error: unknown tool "${block.name}"`,
            is_error: true,
          };
        }
        try {
          const result = await executor(
            block.input as Record<string, unknown>,
          );
          return {
            type: "tool_result" as const,
            tool_use_id: block.id,
            content: result,
          };
        } catch (e) {
          log.error(`tool "${block.name}" error:`, e);
          return {
            type: "tool_result" as const,
            tool_use_id: block.id,
            content: `Error: ${e instanceof Error ? e.message : String(e)}`,
            is_error: true,
          };
        }
      }),
    );
  }
}
