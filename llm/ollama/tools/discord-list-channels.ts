/**
 * Discord ギルドチャンネル一覧取得ツール（Ollama 形式）。
 *
 * ツール定義のみ Ollama（OpenAI 互換）形式で提供し、
 * 実行ロジックは Claude 側の実装を再利用する。
 */

import type { Tool } from "ollama";

export { execute } from "../../claude/tools/discord-list-channels.ts";

/**
 * ツール定義。
 */
export const tool: Tool = {
  type: "function",
  function: {
    name: "discord_list_channels",
    description: "List all channels in the current guild (Discord server).",
    parameters: {
      type: "object",
      properties: {},
      required: [],
    },
  },
};
