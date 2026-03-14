/**
 * Discord ギルドメンバー一覧取得ツール。
 */

import type { Client } from "discord.js";
import type { Tool } from "@anthropic-ai/sdk/resources/messages";
import { createLogger } from "../../../logger.ts";

const log = createLogger("llm:anthropic:tools:discord");

/**
 * ツール定義。
 */
export const tool: Tool = {
  name: "discord_list_members",
  description: "現在のギルド（Discord サーバー）のメンバー一覧を取得する。",
  input_schema: {
    type: "object" as const,
    properties: {
      limit: {
        type: "number",
        description: "取得するメンバーの最大数。デフォルトは 100。",
        maximum: 1000,
      },
    },
    required: [],
  },
};

/**
 * ツールを実行する。
 */
export async function execute(
  client: Client,
  guildId: string,
  input: Record<string, unknown>,
): Promise<string> {
  const limit = (input.limit as number | undefined) ?? 100;
  const guild = await client.guilds.fetch(guildId);
  const members = await guild.members.list({ limit });

  const result = members.map((m) => ({
    id: m.id,
    username: m.user.username,
    displayName: m.displayName,
    bot: m.user.bot,
  }));

  log.debug(`listed ${result.length} members`);
  return JSON.stringify(result);
}
