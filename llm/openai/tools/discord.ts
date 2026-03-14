/**
 * Discord 操作ツール（OpenAI Agents SDK 版）。
 *
 * OpenAI Agents SDK の `tool()` + Zod スキーマ形式で
 * Discord のギルド情報を取得・操作するツールを定義する。
 * ロジックは Anthropic 版 (`llm/anthropic/tools/discord.ts`) と同等。
 */

import { Buffer } from "node:buffer";
import type { Client } from "discord.js";
import { ChannelType } from "discord.js";
import { tool } from "@openai/agents";
import type { Tool } from "@openai/agents";
import { z } from "zod";
import { createLogger } from "../../../logger.ts";

const log = createLogger("llm:openai:tools:discord");

/**
 * 画像添付ファイルの最大バイト数（5 MB）。
 * これを超える画像はスキップされる。
 */
const MAX_IMAGE_BYTES = 5 * 1024 * 1024;

/**
 * サポートする画像メディアタイプ。
 */
const SUPPORTED_IMAGE_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "image/gif",
  "image/webp",
]);

/**
 * Discord 操作ツール群を生成する。
 *
 * @param client - Discord.js クライアントインスタンス。
 * @param guildId - 操作対象のギルド ID。
 * @returns OpenAI Agents SDK のツール配列。
 */
export function createDiscordTools(
  client: Client,
  guildId: string,
): Tool[] {
  const listMembers = tool({
    name: "discord_list_members",
    description: "現在のギルド（Discord サーバー）のメンバー一覧を取得する。",
    parameters: z.object({
      limit: z.number().optional().describe(
        "取得するメンバーの最大数。デフォルトは 100。",
      ),
    }),
    execute: async (input) => {
      const limit = input.limit ?? 100;
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
    },
  });

  const listChannels = tool({
    name: "discord_list_channels",
    description: "現在のギルド（Discord サーバー）のチャンネル一覧を取得する。",
    parameters: z.object({}),
    execute: async () => {
      const guild = await client.guilds.fetch(guildId);
      const channels = await guild.channels.fetch();

      const result = channels
        .filter((ch) => ch !== null)
        .map((ch) => ({
          id: ch!.id,
          name: ch!.name,
          type: ChannelType[ch!.type],
        }));

      log.debug(`listed ${result.length} channels`);
      return JSON.stringify(result);
    },
  });

  const sendMessage = tool({
    name: "discord_send_message",
    description: "指定したチャンネルにテキストメッセージを送信する。",
    parameters: z.object({
      channelId: z.string().describe("送信先のチャンネル ID。"),
      content: z.string().describe("送信するメッセージ内容。"),
    }),
    execute: async (input) => {
      const channel = await client.channels.fetch(input.channelId);
      if (!channel || !channel.isTextBased()) {
        throw new Error(
          `channel ${input.channelId} is not a text channel`,
        );
      }

      if (!("send" in channel)) {
        throw new Error(
          `channel ${input.channelId} does not support sending`,
        );
      }

      const msg = await channel.send(input.content);
      log.debug(`sent message to ${input.channelId}: ${msg.id}`);
      return JSON.stringify({ messageId: msg.id });
    },
  });

  const getMessages = tool({
    name: "discord_get_messages",
    description: "指定したチャンネルの最新メッセージを取得する。",
    parameters: z.object({
      channelId: z.string().describe("メッセージを取得するチャンネル ID。"),
      limit: z.number().optional().describe(
        "取得するメッセージの最大数。デフォルトは 20。",
      ),
    }),
    execute: async (input) => {
      const limit = input.limit ?? 20;

      const channel = await client.channels.fetch(input.channelId);
      if (!channel || !channel.isTextBased()) {
        throw new Error(
          `channel ${input.channelId} is not a text channel`,
        );
      }

      if (!("messages" in channel)) {
        throw new Error(
          `channel ${input.channelId} does not support messages`,
        );
      }

      const messages = await channel.messages.fetch({ limit });
      const result = messages.map((m) => ({
        id: m.id,
        author: {
          id: m.author.id,
          username: m.author.username,
          displayName: m.member?.displayName ?? m.author.username,
          bot: m.author.bot,
        },
        content: m.content,
        attachments: m.attachments.map((a) => ({
          id: a.id,
          name: a.name,
          contentType: a.contentType,
          size: a.size,
        })),
        createdAt: m.createdAt.toISOString(),
      }));

      log.debug(`fetched ${result.length} messages from ${input.channelId}`);

      // 画像添付ファイルを収集して base64 エンコードする。
      // OpenAI Responses API の function_call_output は string のため、
      // 画像 URL を添付情報として含める。
      const imageUrls: { name: string; url: string }[] = [];
      for (const msg of messages.values()) {
        for (const attachment of msg.attachments.values()) {
          if (!attachment.contentType) continue;
          if (!SUPPORTED_IMAGE_TYPES.has(attachment.contentType)) continue;
          if (attachment.size > MAX_IMAGE_BYTES) {
            log.debug(
              `skipping large image: ${attachment.name} (${attachment.size} bytes)`,
            );
            continue;
          }

          // base64 エンコードを試みるが、OpenAI の function output は
          // string のみ対応のため、URL 文字列をフォールバックとして使う。
          try {
            const res = await fetch(attachment.url);
            if (!res.ok) {
              log.warn(
                `failed to fetch image ${attachment.name}: ${res.status}`,
              );
              continue;
            }
            const buf = await res.arrayBuffer();
            const base64 = Buffer.from(buf).toString("base64");
            imageUrls.push({
              name: attachment.name ?? "image",
              url: `data:${attachment.contentType};base64,${base64}`,
            });
          } catch (e) {
            log.warn(`failed to fetch image ${attachment.name}:`, e);
            // フォールバック: Discord CDN の URL を使う。
            imageUrls.push({
              name: attachment.name ?? "image",
              url: attachment.url,
            });
          }
        }
      }

      if (imageUrls.length > 0) {
        return JSON.stringify({ messages: result, images: imageUrls });
      }

      return JSON.stringify(result);
    },
  });

  return [listMembers, listChannels, sendMessage, getMessages];
}
