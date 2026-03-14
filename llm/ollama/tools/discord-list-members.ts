/**
 * Discord ギルドメンバー一覧取得ツール（Ollama 形式）。
 *
 * ツール定義のみ Ollama（OpenAI 互換）形式で提供し、
 * 実行ロジックは Claude 側の実装を再利用する。
 */

import type { Tool } from "ollama";

export { execute } from "../../claude/tools/discord-list-members.ts";

/**
 * ツール定義。
 */
export const tool: Tool = {
  type: "function",
  function: {
    name: "discord_list_members",
    description: "List members in the current guild (Discord server).",
    parameters: {
      type: "object",
      properties: {
        limit: {
          type: "number",
          description: "Maximum number of members to fetch. Defaults to 100.",
        },
      },
      required: [],
    },
  },
};
