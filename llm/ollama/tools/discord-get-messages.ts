/**
 * Discord チャンネルのメッセージ取得ツール（Ollama 形式）。
 *
 * ツール定義のみ Ollama（OpenAI 互換）形式で提供し、
 * 実行ロジックは Anthropic 側の実装を再利用する。
 * Anthropic 版は画像ブロックを返す場合があるが、
 * Ollama ではテキスト部分のみ使用する。
 */

import type { Tool } from "ollama";

export { execute } from "../../anthropic/tools/discord-get-messages.ts";

/**
 * ツール定義。
 */
export const tool: Tool = {
  type: "function",
  function: {
    name: "discord_get_messages",
    description: "指定したチャンネルの最新メッセージを取得する。",
    parameters: {
      type: "object",
      properties: {
        channelId: {
          type: "string",
          description: "メッセージを取得するチャンネル ID。",
        },
        limit: {
          type: "number",
          description: "取得するメッセージの最大数。デフォルトは 20。",
        },
      },
      required: ["channelId"],
    },
  },
};
