/**
 * Ollama を使った LLM 実装。
 *
 * `ollama` npm パッケージで Ollama サーバーに接続する。
 * tool calling（Discord 操作ツール 4 種）に対応し、
 * ツール呼び出しのマルチターンループを chat() 内部で完結させる。
 * MAX_HISTORY ターン分のローリング会話履歴を保持する。
 */

import { Ollama } from "ollama";
import type { Message, Tool } from "ollama";
import { createLogger } from "../../logger.ts";
import type { DiscordContext, LanguageModel } from "../types.ts";
import { replaceTemplateVariables } from "../template.ts";
import * as listMembers from "./tools/discord-list-members.ts";
import * as listChannels from "./tools/discord-list-channels.ts";
import * as sendMessage from "./tools/discord-send-message.ts";
import * as getMessages from "./tools/discord-get-messages.ts";

const log = createLogger("llm:ollama");

/**
 * 保持するユーザー＋アシスタントのターンペア数の上限。
 */
const MAX_HISTORY = 20;

/**
 * ツールの実行関数。
 */
type ToolExecutor = (
  input: Record<string, unknown>,
) => Promise<string | unknown>;

/**
 * OllamaLlm のコンストラクタ設定。
 */
export interface OllamaLlmConfig {
  /**
   * Ollama サーバーの URL。未指定なら http://localhost:11434。
   */
  host?: string;

  /**
   * 使用するモデル名。
   */
  model: string;

  /**
   * LLM に渡すシステムプロンプト。未指定ならデフォルトを使用する。
   */
  systemPrompt?: string;

  /**
   * ツール呼び出しの最大ラウンドトリップ数。
   */
  maxToolRounds?: number;
}

/**
 * Ollama 経由の言語モデル。
 *
 * 会話履歴はメモリ上に保持し、MAX_HISTORY * 2 メッセージを
 * 超えると古いものから自動的に切り捨てる。
 * tool calling のループは chat() 内部で完結する。
 */
export class OllamaLlm implements LanguageModel {
  private readonly client: Ollama;
  private readonly model: string;
  private readonly systemPromptTemplate?: string;
  private context: Record<string, string> = {};
  private readonly tools: Tool[];
  private readonly toolExecutors: Record<string, ToolExecutor>;
  private readonly maxToolRounds: number;
  private readonly history: Message[] = [];
  private discord?: DiscordContext;

  /**
   * chat() の直列化用 mutex。
   * 前の呼び出しが完了するまで次の呼び出しを待機させる。
   */
  private chatMutex: Promise<void> = Promise.resolve();

  constructor(config: OllamaLlmConfig) {
    this.client = new Ollama({
      host: config.host,
    });
    this.model = config.model;
    this.systemPromptTemplate = config.systemPrompt;
    this.maxToolRounds = config.maxToolRounds ?? 5;

    const discordTools = [listMembers, listChannels, sendMessage, getMessages];

    this.tools = discordTools.map((mod) => mod.tool);

    this.toolExecutors = {};
    for (const mod of discordTools) {
      const name = mod.tool.function.name;
      if (!name) continue;
      this.toolExecutors[name] = (input: Record<string, unknown>) => {
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
    this.history.push({ role: "user", content: userMessage });

    // 直近のターンのみ保持するよう履歴をトリミングする。
    while (this.history.length > MAX_HISTORY * 2) {
      this.history.shift();
    }

    try {
      // system prompt はラウンドトリップ間で不変なのでループ外で構築する。
      const system = this.systemPromptTemplate
        ? replaceTemplateVariables(this.systemPromptTemplate, this.context)
        : undefined;

      for (let round = 0; round <= this.maxToolRounds; round++) {
        const messages: Message[] = [
          ...(system ? [{ role: "system" as const, content: system }] : []),
          ...this.history,
        ];

        const response = await this.client.chat({
          model: this.model,
          messages,
          tools: this.tools,
        });

        this.history.push(response.message);

        // tool_calls がなければテキストを返す。
        if (
          !response.message.tool_calls ||
          response.message.tool_calls.length === 0
        ) {
          return response.message.content ?? "";
        }

        // ツール呼び出しを実行して結果を履歴に追加する。
        for (const toolCall of response.message.tool_calls) {
          const name = toolCall.function.name;
          const executor = this.toolExecutors[name];

          if (!executor) {
            log.warn(`unknown tool: ${name}`);
            this.history.push({
              role: "tool",
              content: `Error: unknown tool "${name}"`,
            });
            continue;
          }

          try {
            // arguments がモデルによって object か string で返る場合がある。
            const args = typeof toolCall.function.arguments === "string"
              ? JSON.parse(toolCall.function.arguments)
              : toolCall.function.arguments;

            const result = await executor(args as Record<string, unknown>);

            // discord-get-messages は配列（画像ブロック含む）を返す場合がある。
            const { text, images } = this.parseToolResult(result);

            this.history.push({ role: "tool", content: text });

            // 画像があれば user ロールのメッセージとして追加する。
            // マルチモーダル対応モデルなら画像を認識できる。
            if (images.length > 0) {
              this.history.push({
                role: "user",
                content: "Attached images:",
                images,
              });
            }
          } catch (e) {
            log.error(`tool "${name}" error:`, e);
            this.history.push({
              role: "tool",
              content: `Error: ${e instanceof Error ? e.message : String(e)}`,
            });
          }
        }
      }

      log.warn("tool use round limit reached");
      return "";
    } catch (e: unknown) {
      log.error("API error:", e);
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
   * ツール実行結果をテキストと画像（base64）に分離する。
   *
   * discord-get-messages は Anthropic 固有の ImageBlockParam を含む
   * 配列を返す場合がある。テキスト部分は tool ロールの content に、
   * 画像部分は user ロールの images フィールドに渡すために分離する。
   */
  private parseToolResult(
    result: unknown,
  ): { text: string; images: string[] } {
    if (typeof result === "string") {
      return { text: result, images: [] };
    }

    if (!Array.isArray(result)) {
      return { text: JSON.stringify(result), images: [] };
    }

    const textParts: string[] = [];
    const images: string[] = [];

    for (const block of result) {
      if (block.type === "text" && typeof block.text === "string") {
        textParts.push(block.text);
      } else if (
        block.type === "image" && block.source?.type === "base64" &&
        typeof block.source.data === "string"
      ) {
        images.push(block.source.data);
      }
    }

    const text = textParts.length > 0
      ? textParts.join("")
      : JSON.stringify(result);

    return { text, images };
  }
}
