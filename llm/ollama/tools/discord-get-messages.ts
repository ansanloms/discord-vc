/**
 * Discord チャンネルのメッセージ取得ツール（Ollama 形式）。
 *
 * ツール定義のみ Ollama（OpenAI 互換）形式で提供し、
 * 実行ロジックは Claude 側の実装を再利用する。
 * Claude 版は画像ブロックを返す場合があるが、
 * Ollama ではテキスト部分のみ使用する。
 */

import type { Tool } from "ollama";

export { execute } from "../../claude/tools/discord-get-messages.ts";

/**
 * ツール定義。
 */
export const tool: Tool = {
  type: "function",
  function: {
    name: "discord_get_messages",
    description: "Fetch the latest messages from a specified channel.",
    parameters: {
      type: "object",
      properties: {
        channelId: {
          type: "string",
          description: "The channel ID to fetch messages from.",
        },
        limit: {
          type: "number",
          description: "Maximum number of messages to fetch. Defaults to 20.",
        },
      },
      required: ["channelId"],
    },
  },
};
