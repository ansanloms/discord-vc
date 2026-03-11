/**
 * エントリポイント — 依存を組み立ててボットを起動する。
 *
 * 具象バックエンドの生成は services.ts のファクトリに委譲している。
 * バックエンドを差し替える場合は services.ts を変更すればよい。
 *
 * @module
 */

import "@std/dotenv/load";

import { createLogger } from "./logger.ts";
import { loadConfig } from "./config.ts";
import { createServices } from "./services.ts";
import { DiscordBot } from "./bot.ts";

const log = createLogger("main");

// グローバルな未ハンドル例外をキャッチしてプロセスの即死を防ぐ。
globalThis.addEventListener("unhandledrejection", (e) => {
  log.error("unhandled rejection:", e.reason);
  e.preventDefault();
});

globalThis.addEventListener("error", (e) => {
  log.error("uncaught exception:", e.error ?? e.message);
  e.preventDefault();
});

const config = loadConfig();
const { stt, llm, voicePlayer } = createServices(config);

/**
 * 現在稼働中のボットインスタンス。シグナルハンドラから参照する。
 */
let bot: DiscordBot | null = null;

Deno.addSignalListener("SIGINT", () => bot?.shutdown());
Deno.addSignalListener("SIGTERM", () => bot?.shutdown());

/**
 * 起動リトライの最大回数。
 */
const MAX_RETRIES = 5;
/**
 * リトライ間隔の初期値（ミリ秒）。指数バックオフで増加する。
 */
const BASE_DELAY_MS = 3_000;

for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
  try {
    bot = new DiscordBot(config, stt, llm, voicePlayer);
    await bot.start();
    break;
  } catch (e: unknown) {
    log.error(`start failed (attempt ${attempt}/${MAX_RETRIES}):`, e);
    if (attempt === MAX_RETRIES) {
      log.error("max retries reached, exiting");
      Deno.exit(1);
    }
    const delay = BASE_DELAY_MS * Math.pow(2, attempt - 1);
    log.info(`retrying in ${delay / 1000}s...`);
    await new Promise((r) => setTimeout(r, delay));
  }
}
