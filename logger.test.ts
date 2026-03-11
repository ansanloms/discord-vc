import { assertEquals, assertStringIncludes } from "@std/assert";
import { createLogger } from "./logger.ts";

/**
 * console.log / console.warn / console.error をキャプチャするヘルパー。
 * restore() で元に戻す。
 */
function captureConsole(): {
  logs: string[];
  warns: string[];
  errors: string[];
  restore: () => void;
} {
  const logs: string[] = [];
  const warns: string[] = [];
  const errors: string[] = [];

  const origLog = console.log;
  const origWarn = console.warn;
  const origError = console.error;

  console.log = (...args: unknown[]) => logs.push(args.join(" "));
  console.warn = (...args: unknown[]) => warns.push(args.join(" "));
  console.error = (...args: unknown[]) => errors.push(args.join(" "));

  return {
    logs,
    warns,
    errors,
    restore: () => {
      console.log = origLog;
      console.warn = origWarn;
      console.error = origError;
    },
  };
}

Deno.test("createLogger: info がタイムスタンプ・レベル・名前空間付きで出力されること", () => {
  const cap = captureConsole();
  try {
    const log = createLogger("test-ns");
    log.info("hello");
    assertEquals(cap.logs.length, 1);
    assertStringIncludes(cap.logs[0], "[INFO ]");
    assertStringIncludes(cap.logs[0], "[test-ns]");
    assertStringIncludes(cap.logs[0], "hello");
    // ISO タイムスタンプが含まれること
    assertStringIncludes(cap.logs[0], "T");
  } finally {
    cap.restore();
  }
});

Deno.test("createLogger: error が stderr（console.error）に出力されること", () => {
  const cap = captureConsole();
  try {
    const log = createLogger("err-ns");
    log.error("something broke");
    assertEquals(cap.logs.length, 0);
    assertEquals(cap.errors.length, 1);
    assertStringIncludes(cap.errors[0], "[ERROR]");
    assertStringIncludes(cap.errors[0], "[err-ns]");
    assertStringIncludes(cap.errors[0], "something broke");
  } finally {
    cap.restore();
  }
});

Deno.test("createLogger: warn が stderr（console.warn）に出力されること", () => {
  const cap = captureConsole();
  try {
    const log = createLogger("warn-ns");
    log.warn("caution");
    assertEquals(cap.logs.length, 0);
    assertEquals(cap.warns.length, 1);
    assertStringIncludes(cap.warns[0], "[WARN ]");
    assertStringIncludes(cap.warns[0], "caution");
  } finally {
    cap.restore();
  }
});

Deno.test("createLogger: 追加引数が出力に含まれること", () => {
  const cap = captureConsole();
  try {
    const log = createLogger("args");
    log.info("status:", 200, "ok");
    assertEquals(cap.logs.length, 1);
    assertStringIncludes(cap.logs[0], "status:");
    assertStringIncludes(cap.logs[0], "200");
    assertStringIncludes(cap.logs[0], "ok");
  } finally {
    cap.restore();
  }
});

Deno.test("createLogger: 異なる名前空間のロガーが独立して動作すること", () => {
  const cap = captureConsole();
  try {
    const logA = createLogger("aaa");
    const logB = createLogger("bbb");
    logA.info("from A");
    logB.info("from B");
    assertEquals(cap.logs.length, 2);
    assertStringIncludes(cap.logs[0], "[aaa]");
    assertStringIncludes(cap.logs[1], "[bbb]");
  } finally {
    cap.restore();
  }
});
