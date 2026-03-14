/**
 * Discord 操作ツール。
 *
 * Anthropic LLM バックエンドが tool use で Discord のギルド情報を
 * 取得・操作できるようにするためのツール定義と executor ファクトリ。
 */

import { Buffer } from "node:buffer";
import type { Client } from "discord.js";
import { ChannelType } from "discord.js";
import type {
  ImageBlockParam,
  Tool,
} from "@anthropic-ai/sdk/resources/messages";
import type { ToolExecutor } from "../../anthropic.ts";
import { createLogger } from "../../../logger.ts";

const log = createLogger("llm:anthropic:tools:discord");

/**
 * 画像添付ファイルの最大バイト数（5 MB）。
 * これを超える画像はスキップされる。
 * Anthropic API 側で長辺 1568px を超える画像は自動リサイズされる。
 */
const MAX_IMAGE_BYTES = 5 * 1024 * 1024;

/**
 * Anthropic API がサポートする画像メディアタイプ。
 */
type SupportedMediaType =
  | "image/jpeg"
  | "image/png"
  | "image/gif"
  | "image/webp";

const SUPPORTED_MEDIA_TYPES = new Set<SupportedMediaType>([
  "image/jpeg",
  "image/png",
  "image/gif",
  "image/webp",
]);

/**
 * contentType が Anthropic API でサポートされる画像タイプか判定する。
 */
function toSupportedMediaType(
  contentType: string | null,
): SupportedMediaType | null {
  if (!contentType) return null;
  return SUPPORTED_MEDIA_TYPES.has(contentType as SupportedMediaType)
    ? (contentType as SupportedMediaType)
    : null;
}

/**
 * 画像フェッチのタイムアウト（ミリ秒）。
 */
const IMAGE_FETCH_TIMEOUT_MS = 10_000;

/**
 * Discord 操作ツールの Anthropic Tool 定義。
 */
export const discordTools: Tool[] = [
  {
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
  },
  {
    name: "discord_list_channels",
    description: "現在のギルド（Discord サーバー）のチャンネル一覧を取得する。",
    input_schema: {
      type: "object" as const,
      properties: {},
      required: [],
    },
  },
  {
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
        },
      },
      required: ["channelId", "content"],
    },
  },
  {
    name: "discord_get_messages",
    description: "指定したチャンネルの最新メッセージを取得する。",
    input_schema: {
      type: "object" as const,
      properties: {
        channelId: {
          type: "string",
          description: "メッセージを取得するチャンネル ID。",
        },
        limit: {
          type: "number",
          description: "取得するメッセージの最大数。デフォルトは 20。",
          maximum: 100,
        },
      },
      required: ["channelId"],
    },
  },
];

/**
 * Discord ツールの executor マップを生成する。
 *
 * @param client - Discord.js クライアントインスタンス。
 * @param guildId - 操作対象のギルド ID。
 * @returns ツール名をキーとした executor マップ。
 */
export function createDiscordToolExecutors(
  client: Client,
  guildId: string,
): Record<string, ToolExecutor> {
  return {
    discord_list_members: async (input) => {
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
    },

    discord_list_channels: async () => {
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
    },

    discord_send_message: async (input) => {
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
    },

    discord_get_messages: async (input) => {
      const channelId = input.channelId as string;
      const limit = (input.limit as number | undefined) ?? 20;

      const guild = await client.guilds.fetch(guildId);
      const channel = await guild.channels.fetch(channelId);
      if (!channel || !channel.isTextBased()) {
        throw new Error(`channel ${channelId} is not a text channel`);
      }

      if (!("messages" in channel)) {
        throw new Error(`channel ${channelId} does not support messages`);
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

      log.debug(`fetched ${result.length} messages from ${channelId}`);

      // 画像添付ファイルを収集して ImageBlockParam に変換する。
      const imageBlocks: ImageBlockParam[] = [];
      for (const msg of messages.values()) {
        for (const attachment of msg.attachments.values()) {
          const mediaType = toSupportedMediaType(attachment.contentType);
          if (!mediaType) continue;

          if (attachment.size > MAX_IMAGE_BYTES) {
            log.debug(
              `skipping large image: ${attachment.name} (${attachment.size} bytes)`,
            );
            continue;
          }

          try {
            const res = await fetch(attachment.url, {
              signal: AbortSignal.timeout(IMAGE_FETCH_TIMEOUT_MS),
            });
            if (!res.ok) {
              log.warn(
                `failed to fetch image ${attachment.name}: ${res.status}`,
              );
              continue;
            }
            const buf = await res.arrayBuffer();
            const base64 = Buffer.from(buf).toString("base64");
            imageBlocks.push({
              type: "image",
              source: {
                type: "base64",
                media_type: mediaType,
                data: base64,
              },
            });
          } catch (e) {
            log.warn(`failed to fetch image ${attachment.name}:`, e);
          }
        }
      }

      const textContent = JSON.stringify(result);

      if (imageBlocks.length === 0) {
        return textContent;
      }

      return [
        { type: "text" as const, text: textContent },
        ...imageBlocks,
      ];
    },
  };
}
