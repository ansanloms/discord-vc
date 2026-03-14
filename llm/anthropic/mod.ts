/**
 * Anthropic SDK を直接使った LLM 実装。
 *
 * `@anthropic-ai/sdk` で Claude API に接続する。
 * tool use（web search + Discord 操作ツール）に対応し、
 * ツール呼び出しのマルチターンループを chat() 内部で完結させる。
 * MAX_HISTORY ターン分のローリング会話履歴を保持する。
 */

import Anthropic from "@anthropic-ai/sdk";
import type {
  MessageParam,
  ToolResultBlockParam,
  ToolUnion,
  ToolUseBlock,
} from "@anthropic-ai/sdk/resources/messages";
import { createLogger } from "../../logger.ts";
import type { DiscordContext, LanguageModel } from "../types.ts";
import { replaceTemplateVariables } from "../template.ts";
import * as webSearch from "./tools/web-search.ts";
import * as listMembers from "./tools/discord-list-members.ts";
import * as listChannels from "./tools/discord-list-channels.ts";
import * as sendMessage from "./tools/discord-send-message.ts";
import * as getMessages from "./tools/discord-get-messages.ts";

const log = createLogger("llm:anthropic");

/**
 * 保持するユーザー＋アシスタントのターンペア数の上限。
 */
const MAX_HISTORY = 20;

/**
 * ツール実行結果の型。
 * 文字列またはコンテンツブロック配列（画像を含めたい場合など）を返せる。
 */
type ToolExecutorResult = NonNullable<ToolResultBlockParam["content"]>;

/**
 * ツールの実行関数。
 * ツール入力を受け取り、結果を返す。
 */
type ToolExecutor = (
  input: Record<string, unknown>,
) => Promise<ToolExecutorResult>;

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
  private readonly tools: ToolUnion[];
  private readonly toolExecutors: Record<string, ToolExecutor>;
  private readonly maxToolRounds: number;
  private readonly history: MessageParam[] = [];
  private discord?: DiscordContext;

  constructor(config: AnthropicLlmConfig) {
    this.client = new Anthropic({
      apiKey: config.apiKey,
    });
    this.model = config.model;
    this.systemPromptTemplate = config.systemPrompt;
    this.maxTokens = config.maxTokens ?? 1024;
    this.maxToolRounds = config.maxToolRounds ?? 5;

    const discordTools = [listMembers, listChannels, sendMessage, getMessages];

    this.tools = [
      webSearch.tool,
      ...discordTools.map((mod) => mod.tool),
    ];

    this.toolExecutors = {};
    for (const mod of discordTools) {
      this.toolExecutors[mod.tool.name] = (input) => {
        if (!this.discord) {
          throw new Error("Discord client is not configured");
        }
        return mod.execute(this.discord.client, this.discord.guildId, input);
      };
    }
  }

  /**
   * @inheritdoc
   */
  setDiscordClient(discord: DiscordContext): void {
    this.discord = discord;
    log.info("discord client configured");
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
          tools: this.tools,
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
        const executor = this.toolExecutors[block.name];
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
