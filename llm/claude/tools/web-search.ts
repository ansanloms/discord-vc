/**
 * Claude サーバーサイド web search ツール定義。
 *
 * サーバーサイドツールのため executor は不要。
 * API 側で自動的に実行され、結果がレスポンスに含まれる。
 */

import type { WebSearchTool20250305 } from "@anthropic-ai/sdk/resources/messages";

/**
 * ツール定義。
 */
export const tool: WebSearchTool20250305 = {
  type: "web_search_20250305",
  name: "web_search",
};
