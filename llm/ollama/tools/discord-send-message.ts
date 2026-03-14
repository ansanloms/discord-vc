/**
 * Discord チャンネルへのメッセージ送信ツール（Ollama 形式）。
 *
 * ツール定義のみ Ollama（OpenAI 互換）形式で提供し、
 * 実行ロジックは Claude 側の実装を再利用する。
 */

import type { Tool } from "ollama";

export { execute } from "../../claude/tools/discord-send-message.ts";

/**
 * ツール定義。
 */
export const tool: Tool = {
  type: "function",
  function: {
    name: "discord_send_message",
    description: "Send a text message to a specified channel.",
    parameters: {
      type: "object",
      properties: {
        channelId: {
          type: "string",
          description: "The destination channel ID.",
        },
        content: {
          type: "string",
          description: "The message content to send.",
        },
      },
      required: ["channelId", "content"],
    },
  },
};
