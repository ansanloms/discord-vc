import { assertEquals } from "@std/assert";
import { replaceTemplateVariables } from "./template.ts";

Deno.test("replaceTemplateVariables - 単一変数を置換する", () => {
  const result = replaceTemplateVariables("guild: {{GUILD_ID}}", {
    GUILD_ID: "12345",
  });
  assertEquals(result, "guild: 12345");
});

Deno.test("replaceTemplateVariables - 複数変数を置換する", () => {
  const result = replaceTemplateVariables(
    "guild: {{GUILD_ID}}, channel: {{CURRENT_CHANNEL_ID}}",
    { GUILD_ID: "111", CURRENT_CHANNEL_ID: "222" },
  );
  assertEquals(result, "guild: 111, channel: 222");
});

Deno.test("replaceTemplateVariables - 未定義キーはそのまま残す", () => {
  const result = replaceTemplateVariables(
    "{{KNOWN}} and {{UNKNOWN}}",
    { KNOWN: "yes" },
  );
  assertEquals(result, "yes and {{UNKNOWN}}");
});

Deno.test("replaceTemplateVariables - プレースホルダなしはそのまま返す", () => {
  const result = replaceTemplateVariables("no placeholders here", {
    FOO: "bar",
  });
  assertEquals(result, "no placeholders here");
});

Deno.test("replaceTemplateVariables - 空文字列で置換できる", () => {
  const result = replaceTemplateVariables("prefix {{EMPTY}} suffix", {
    EMPTY: "",
  });
  assertEquals(result, "prefix  suffix");
});

Deno.test("replaceTemplateVariables - 同一キーの複数出現を全て置換する", () => {
  const result = replaceTemplateVariables("{{X}} and {{X}}", { X: "val" });
  assertEquals(result, "val and val");
});

Deno.test("replaceTemplateVariables - ドット区切りのキーを置換する", () => {
  const result = replaceTemplateVariables(
    "server: {{discord.guild.name}}, ch: {{discord.channel.current.name}}",
    {
      "discord.guild.name": "My Server",
      "discord.channel.current.name": "general",
    },
  );
  assertEquals(result, "server: My Server, ch: general");
});
