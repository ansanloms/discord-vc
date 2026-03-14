/**
 * Discord チャンネルのメッセージ取得ツール。
 *
 * テキストメッセージに加え、サポートされる画像添付ファイルを
 * base64 エンコードして返す。
 */

import { Buffer } from "node:buffer";
import type { Client } from "discord.js";
import type {
  ImageBlockParam,
  Tool,
} from "@anthropic-ai/sdk/resources/messages";
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
 * ツール定義。
 */
export const tool: Tool = {
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
        minimum: 1,
        maximum: 100,
      },
    },
    required: ["channelId"],
  },
};

/**
 * ツールを実行する。
 *
 * 画像添付ファイルがある場合はテキスト + 画像ブロックの配列を返す。
 * 画像がない場合は JSON 文字列を返す。
 */
export async function execute(
  client: Client,
  guildId: string,
  input: Record<string, unknown>,
): Promise<
  string | ({ type: "text"; text: string } | ImageBlockParam)[]
> {
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
}
