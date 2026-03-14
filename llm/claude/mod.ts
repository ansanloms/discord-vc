/**
 * Claude（Anthropic SDK）を使った LLM 実装。
 *
 * `@anthropic-ai/sdk` で Claude API に接続する。
 * tool use（web search + Discord 操作ツール）に対応し、
 * ツール呼び出しのマルチターンループを chat() 内部で完結させる。
 * MAX_HISTORY ターン分のローリング会話履歴を保持する。
 */

import Anthropic from "@anthropic-ai/sdk";
import type {
  MessageParam,
  TextBlockParam,
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

const log = createLogger("llm:claude");

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
 * ClaudeLlm のコンストラクタ設定。
 */
export interface ClaudeLlmConfig {
  /**
   * API キー。未指定なら CLAUDE_API_KEY 環境変数を使用する。
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
 * Claude（Anthropic SDK）経由の言語モデル。
 *
 * 会話履歴はメモリ上に保持し、MAX_HISTORY * 2 メッセージを
 * 超えると古いものから自動的に切り捨てる。
 * tool use のループは chat() 内部で完結する。
 */
export class ClaudeLlm implements LanguageModel {
  private readonly client: Anthropic;
  private readonly model: string;
  private readonly systemPromptTemplate?: string;
  private context: Record<string, string> = {};
  private readonly maxTokens: number;
  private readonly tools: ToolUnion[];
  private readonly cachedTools: ToolUnion[];
  private readonly toolExecutors: Record<string, ToolExecutor>;
  private readonly maxToolRounds: number;
  private readonly history: MessageParam[] = [];
  private discord?: DiscordContext;

  /**
   * chat() の直列化用 mutex。
   * 前の呼び出しが完了するまで次の呼び出しを待機させる。
   */
  private chatMutex: Promise<void> = Promise.resolve();

  constructor(config: ClaudeLlmConfig) {
    this.client = new Anthropic({
      apiKey: config.apiKey,
      maxRetries: 5,
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

    // cache_control 付きのツール配列を事前構築する。
    // 最後のツールに breakpoint を置くことで tools 全体がキャッシュされる。
    this.cachedTools = this.tools.map((tool, i) =>
      i === this.tools.length - 1
        ? { ...tool, cache_control: { type: "ephemeral" as const } }
        : tool
    );

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
   *
   * mutex で直列化し、並行呼び出しによる履歴破壊を防ぐ。
   */
  chat(userMessage: string): Promise<string> {
    const prev = this.chatMutex;
    let resolve!: () => void;
    this.chatMutex = new Promise<void>((r) => {
      resolve = r;
    });
    return prev.then(() => this.chatInternal(userMessage)).finally(() =>
      resolve()
    );
  }

  /**
   * chat() の実体。mutex によって直列実行が保証される。
   */
  private async chatInternal(userMessage: string): Promise<string> {
    // エラー時に履歴を巻き戻すためのスナップショット。
    const historyLen = this.history.length;

    this.history.push({ role: "user", content: userMessage });

    // 直近のターンのみ保持するよう履歴をトリミングする。
    while (this.history.length > MAX_HISTORY * 2) {
      this.history.shift();
    }

    try {
      // system prompt と tools はラウンドトリップ間で不変なのでループ外で構築する。
      const system = this.buildSystemPrompt();

      for (let round = 0; round <= this.maxToolRounds; round++) {
        const response = await this.client.messages.create({
          model: this.model,
          max_tokens: this.maxTokens,
          ...(system ? { system } : {}),
          tools: this.cachedTools,
          messages: this.history,
        });

        this.logUsage(response.usage, round);
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
      // このターンで追加されたメッセージをすべて削除する。
      this.history.length = historyLen;
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
   * API レスポンスのトークン使用量とキャッシュヒット状況をログに出力する。
   */
  private logUsage(
    usage: Anthropic.Messages.Usage,
    round: number,
  ): void {
    const {
      input_tokens,
      output_tokens,
      cache_creation_input_tokens,
      cache_read_input_tokens,
    } = usage;

    log.info(
      `usage [round ${round}]: input=${input_tokens} output=${output_tokens}` +
        ` cache_create=${cache_creation_input_tokens ?? 0}` +
        ` cache_read=${cache_read_input_tokens ?? 0}`,
    );
  }

  /**
   * システムプロンプトを構築する。
   * Prompt Caching のため TextBlockParam 配列として返し、
   * cache_control を付与する。
   */
  private buildSystemPrompt(): TextBlockParam[] | undefined {
    if (!this.systemPromptTemplate) {
      return undefined;
    }
    const text = replaceTemplateVariables(
      this.systemPromptTemplate,
      this.context,
    );
    return [{
      type: "text",
      text,
      cache_control: { type: "ephemeral" },
    }];
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
