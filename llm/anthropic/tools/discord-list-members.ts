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
  description: "List members in the current guild (Discord server).",
  input_schema: {
    type: "object" as const,
    properties: {
      limit: {
        type: "number",
        description: "Maximum number of members to fetch. Defaults to 100.",
        minimum: 1,
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
