/**
 * Discord ギルドチャンネル一覧取得ツール（Ollama 形式）。
 *
 * ツール定義のみ Ollama（OpenAI 互換）形式で提供し、
 * 実行ロジックは Anthropic 側の実装を再利用する。
 */

import type { Tool } from "ollama";

export { execute } from "../../anthropic/tools/discord-list-channels.ts";

/**
 * ツール定義。
 */
export const tool: Tool = {
  type: "function",
  function: {
    name: "discord_list_channels",
    description: "現在のギルド（Discord サーバー）のチャンネル一覧を取得する。",
    parameters: {
      type: "object",
      properties: {},
      required: [],
    },
  },
};
