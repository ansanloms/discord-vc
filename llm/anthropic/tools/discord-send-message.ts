/**
 * Discord チャンネルへのメッセージ送信ツール。
 */

import type { Client } from "discord.js";
import type { Tool } from "@anthropic-ai/sdk/resources/messages";
import { createLogger } from "../../../logger.ts";

const log = createLogger("llm:anthropic:tools:discord");

/**
 * ツール定義。
 */
export const tool: Tool = {
  name: "discord_send_message",
  description: "指定したチャンネルにテキストメッセージを送信する。",
  input_schema: {
    type: "object" as const,
    properties: {
      channelId: {
        type: "string",
        description: "送信先のチャンネル ID。",
      },
      content: {
        type: "string",
        description: "送信するメッセージ内容。",
        maxLength: 2000,
      },
    },
    required: ["channelId", "content"],
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
  const channelId = input.channelId as string;
  const content = input.content as string;

  const guild = await client.guilds.fetch(guildId);
  const channel = await guild.channels.fetch(channelId);
  if (!channel || !channel.isTextBased()) {
    throw new Error(`channel ${channelId} is not a text channel`);
  }

  // DM チャンネルでない text-based チャンネルにのみ send が存在する。
  if (!("send" in channel)) {
    throw new Error(`channel ${channelId} does not support sending`);
  }

  const msg = await channel.send(content);
  log.debug(`sent message to ${channelId}: ${msg.id}`);
  return JSON.stringify({ messageId: msg.id });
}
