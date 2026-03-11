import { assertEquals } from "@std/assert";
import { splitSentences } from "./player.ts";

Deno.test("splitSentences: 「。」で分割されること", () => {
  assertEquals(splitSentences("こんにちは。ありがとう。"), [
    "こんにちは。",
    "ありがとう。",
  ]);
});

Deno.test("splitSentences: 改行で分割されること", () => {
  assertEquals(splitSentences("一行目\n二行目\n"), ["一行目", "二行目"]);
});

Deno.test("splitSentences: 前後の空白がトリムされ空要素が除外されること", () => {
  assertEquals(splitSentences("  テスト。  "), ["テスト。"]);
});

Deno.test("splitSentences: 空文字列の場合に空配列を返すこと", () => {
  assertEquals(splitSentences(""), []);
});

Deno.test("splitSentences: 区切り文字がない場合に単一要素の配列を返すこと", () => {
  assertEquals(splitSentences("区切りなし"), ["区切りなし"]);
});

Deno.test("splitSentences: 「。」と改行が混在しても正しく分割されること", () => {
  assertEquals(splitSentences("最初。\n次。"), ["最初。", "次。"]);
});
