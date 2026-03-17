/**
 * 名前空間付きの軽量構造化ロガー。
 *
 * ログレベルは環境変数 LOG_LEVEL で制御する（デフォルト: INFO）。
 * 有効な値: DEBUG | INFO | WARN | ERROR（大文字小文字不問）。
 *
 * @example
 * ```ts
 * const log = createLogger("stt");
 * log.info("文字起こし開始");
 * log.error("API エラー:", status, body);
 * ```
 */

/**
 * サポートするログレベル（重要度の昇順）。
 */
export type LogLevel = "DEBUG" | "INFO" | "WARN" | "ERROR";

const LEVEL_ORDER: Record<LogLevel, number> = {
  DEBUG: 0,
  INFO: 1,
  WARN: 2,
  ERROR: 3,
};

/**
 * 環境変数から LOG_LEVEL を読み取る。未設定・無効値の場合は INFO を返す。
 */
function getMinLevel(): LogLevel {
  try {
    const env = Deno.env.get("LOG_LEVEL")?.toUpperCase();
    if (env && env in LEVEL_ORDER) {
      return env as LogLevel;
    }
  } catch {
    // --allow-env が付与されていない場合はデフォルトに落ちる
  }
  return "INFO";
}

const minLevel = getMinLevel();

/**
 * createLogger が返すロガーインターフェース。
 */
export interface Logger {
  debug(msg: string, ...args: unknown[]): void;
  info(msg: string, ...args: unknown[]): void;
  warn(msg: string, ...args: unknown[]): void;
  error(msg: string, ...args: unknown[]): void;
}

/**
 * 指定した名前空間に紐づくロガーを生成する。
 * 各ログ行には ISO タイムスタンプ、レベル、名前空間プレフィクスが付く。
 *
 * DEBUG/INFO は stdout、WARN/ERROR は stderr に出力する。
 *
 * @param namespace - サブシステムの短い識別子（例: "stt", "tts"）。
 */
export function createLogger(namespace: string): Logger {
  function emit(level: LogLevel, msg: string, args: unknown[]): void {
    if (LEVEL_ORDER[level] < LEVEL_ORDER[minLevel]) {
      return;
    }
    const ts = new Date().toISOString();
    const prefix = `${ts} [${level.padEnd(5)}] [${namespace}]`;
    if (level === "ERROR") {
      console.error(prefix, msg, ...args);
    } else if (level === "WARN") {
      console.warn(prefix, msg, ...args);
    } else {
      console.log(prefix, msg, ...args);
    }
  }

  return {
    debug: (msg, ...args) => emit("DEBUG", msg, args),
    info: (msg, ...args) => emit("INFO", msg, args),
    warn: (msg, ...args) => emit("WARN", msg, args),
    error: (msg, ...args) => emit("ERROR", msg, args),
  };
}
