import { assertEquals, assertRejects } from "@std/assert";
import { resolveSystemPrompt } from "./system-prompt.ts";

Deno.test("resolveSystemPrompt: 単一ファイルの内容を返すこと", async () => {
  const tmpFile = await Deno.makeTempFile({ suffix: ".md" });
  await Deno.writeTextFile(tmpFile, "プロンプト内容");

  try {
    const result = await resolveSystemPrompt([tmpFile], {});
    assertEquals(result, "プロンプト内容");
  } finally {
    await Deno.remove(tmpFile);
  }
});

Deno.test("resolveSystemPrompt: 複数ファイルを空行区切りで結合すること", async () => {
  const file1 = await Deno.makeTempFile({ suffix: ".md" });
  const file2 = await Deno.makeTempFile({ suffix: ".md" });
  await Deno.writeTextFile(file1, "ベースプロンプト");
  await Deno.writeTextFile(file2, "追加プロンプト");

  try {
    const result = await resolveSystemPrompt([file1, file2], {});
    assertEquals(result, "ベースプロンプト\n\n追加プロンプト");
  } finally {
    await Deno.remove(file1);
    await Deno.remove(file2);
  }
});

Deno.test("resolveSystemPrompt: テンプレート変数入りパスを解決すること", async () => {
  const dir = await Deno.makeTempDir();
  const filePath = `${dir}/test-channel.md`;
  await Deno.writeTextFile(filePath, "チャンネル固有プロンプト");

  try {
    const result = await resolveSystemPrompt(
      [`${dir}/{{channel.name}}.md`],
      { "channel.name": "test-channel" },
    );
    assertEquals(result, "チャンネル固有プロンプト");
  } finally {
    await Deno.remove(filePath);
    await Deno.remove(dir);
  }
});

Deno.test("resolveSystemPrompt: 存在しないファイルをスキップすること", async () => {
  const tmpFile = await Deno.makeTempFile({ suffix: ".md" });
  await Deno.writeTextFile(tmpFile, "存在するファイル");

  try {
    const result = await resolveSystemPrompt(
      [tmpFile, "__nonexistent__/missing.md"],
      {},
    );
    assertEquals(result, "存在するファイル");
  } finally {
    await Deno.remove(tmpFile);
  }
});

Deno.test("resolveSystemPrompt: テンプレート変数が未解決のパスをスキップすること", async () => {
  const tmpFile = await Deno.makeTempFile({ suffix: ".md" });
  await Deno.writeTextFile(tmpFile, "ベース");

  try {
    const result = await resolveSystemPrompt(
      [tmpFile, "config/{{discord.channel.current.name}}.md"],
      {},
    );
    assertEquals(result, "ベース");
  } finally {
    await Deno.remove(tmpFile);
  }
});

Deno.test("resolveSystemPrompt: 全ファイルスキップ時に undefined を返すこと", async () => {
  const result = await resolveSystemPrompt(
    ["__nonexistent__/a.md", "__nonexistent__/b.md"],
    {},
  );
  assertEquals(result, undefined);
});

Deno.test("resolveSystemPrompt: 空配列で undefined を返すこと", async () => {
  const result = await resolveSystemPrompt([], {});
  assertEquals(result, undefined);
});

Deno.test("resolveSystemPrompt: 空ファイルをスキップすること", async () => {
  const file1 = await Deno.makeTempFile({ suffix: ".md" });
  const file2 = await Deno.makeTempFile({ suffix: ".md" });
  await Deno.writeTextFile(file1, "");
  await Deno.writeTextFile(file2, "内容あり");

  try {
    const result = await resolveSystemPrompt([file1, file2], {});
    assertEquals(result, "内容あり");
  } finally {
    await Deno.remove(file1);
    await Deno.remove(file2);
  }
});

Deno.test("resolveSystemPrompt: NotFound 以外のエラーを throw すること", async () => {
  const dir = await Deno.makeTempDir();

  try {
    await assertRejects(
      () => resolveSystemPrompt([dir], {}),
    );
  } finally {
    await Deno.remove(dir);
  }
});
