import { assertEquals, assertThrows } from "@std/assert";
import { resolveSystemPrompt } from "./system-prompt.ts";

Deno.test("resolveSystemPrompt: 単一ファイルの内容を返すこと", () => {
  const tmpFile = Deno.makeTempFileSync({ suffix: ".md" });
  Deno.writeTextFileSync(tmpFile, "プロンプト内容");

  try {
    const result = resolveSystemPrompt([tmpFile], {});
    assertEquals(result, "プロンプト内容");
  } finally {
    Deno.removeSync(tmpFile);
  }
});

Deno.test("resolveSystemPrompt: 複数ファイルを空行区切りで結合すること", () => {
  const file1 = Deno.makeTempFileSync({ suffix: ".md" });
  const file2 = Deno.makeTempFileSync({ suffix: ".md" });
  Deno.writeTextFileSync(file1, "ベースプロンプト");
  Deno.writeTextFileSync(file2, "追加プロンプト");

  try {
    const result = resolveSystemPrompt([file1, file2], {});
    assertEquals(result, "ベースプロンプト\n\n追加プロンプト");
  } finally {
    Deno.removeSync(file1);
    Deno.removeSync(file2);
  }
});

Deno.test("resolveSystemPrompt: テンプレート変数入りパスを解決すること", () => {
  const dir = Deno.makeTempDirSync();
  const filePath = `${dir}/test-channel.md`;
  Deno.writeTextFileSync(filePath, "チャンネル固有プロンプト");

  try {
    const result = resolveSystemPrompt(
      [`${dir}/{{channel.name}}.md`],
      { "channel.name": "test-channel" },
    );
    assertEquals(result, "チャンネル固有プロンプト");
  } finally {
    Deno.removeSync(filePath);
    Deno.removeSync(dir);
  }
});

Deno.test("resolveSystemPrompt: 存在しないファイルをスキップすること", () => {
  const tmpFile = Deno.makeTempFileSync({ suffix: ".md" });
  Deno.writeTextFileSync(tmpFile, "存在するファイル");

  try {
    const result = resolveSystemPrompt(
      [tmpFile, "__nonexistent__/missing.md"],
      {},
    );
    assertEquals(result, "存在するファイル");
  } finally {
    Deno.removeSync(tmpFile);
  }
});

Deno.test("resolveSystemPrompt: テンプレート変数が未解決のパスをスキップすること", () => {
  const tmpFile = Deno.makeTempFileSync({ suffix: ".md" });
  Deno.writeTextFileSync(tmpFile, "ベース");

  try {
    const result = resolveSystemPrompt(
      [tmpFile, "config/{{discord.channel.current.name}}.md"],
      {},
    );
    assertEquals(result, "ベース");
  } finally {
    Deno.removeSync(tmpFile);
  }
});

Deno.test("resolveSystemPrompt: 全ファイルスキップ時に undefined を返すこと", () => {
  const result = resolveSystemPrompt(
    ["__nonexistent__/a.md", "__nonexistent__/b.md"],
    {},
  );
  assertEquals(result, undefined);
});

Deno.test("resolveSystemPrompt: 空配列で undefined を返すこと", () => {
  const result = resolveSystemPrompt([], {});
  assertEquals(result, undefined);
});

Deno.test("resolveSystemPrompt: 空ファイルをスキップすること", () => {
  const file1 = Deno.makeTempFileSync({ suffix: ".md" });
  const file2 = Deno.makeTempFileSync({ suffix: ".md" });
  Deno.writeTextFileSync(file1, "");
  Deno.writeTextFileSync(file2, "内容あり");

  try {
    const result = resolveSystemPrompt([file1, file2], {});
    assertEquals(result, "内容あり");
  } finally {
    Deno.removeSync(file1);
    Deno.removeSync(file2);
  }
});

Deno.test("resolveSystemPrompt: NotFound 以外のエラーを throw すること", () => {
  // ディレクトリを読もうとすると IsADirectory エラーが発生する
  const dir = Deno.makeTempDirSync();

  try {
    assertThrows(
      () => resolveSystemPrompt([dir], {}),
    );
  } finally {
    Deno.removeSync(dir);
  }
});
