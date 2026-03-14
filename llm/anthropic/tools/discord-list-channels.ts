/**
 * Discord ギルドチャンネル一覧取得ツール。
 */

import type { Client } from "discord.js";
import { ChannelType } from "discord.js";
import type { Tool } from "@anthropic-ai/sdk/resources/messages";
import { createLogger } from "../../../logger.ts";

const log = createLogger("llm:anthropic:tools:discord");

/**
 * ツール定義。
 */
export const tool: Tool = {
  name: "discord_list_channels",
  description: "現在のギルド（Discord サーバー）のチャンネル一覧を取得する。",
  input_schema: {
    type: "object" as const,
    properties: {},
    required: [],
  },
};

/**
 * ツールを実行する。
 */
export async function execute(
  client: Client,
  guildId: string,
  _input: Record<string, unknown>,
): Promise<string> {
  const guild = await client.guilds.fetch(guildId);
  const channels = await guild.channels.fetch();

  const result = channels
    .filter((ch): ch is NonNullable<typeof ch> => ch !== null)
    .map((ch) => ({
      id: ch.id,
      name: ch.name,
      type: ChannelType[ch.type],
    }));

  log.debug(`listed ${result.length} channels`);
  return JSON.stringify(result);
}
