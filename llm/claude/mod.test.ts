import { assertEquals } from "@std/assert";
import { ClaudeLlm } from "./mod.ts";
import type Anthropic from "@anthropic-ai/sdk";
import { collectAll, collectJoined } from "../test_helpers.ts";

/**
 * messages.create のモック用レスポンスを生成する。
 * テキスト応答を返す（tool_use なし）。
 */
function textResponse(
  text: string,
): Anthropic.Messages.Message {
  return {
    id: "msg_test",
    type: "message",
    role: "assistant",
    model: "test-model",
    stop_reason: "end_turn",
    stop_sequence: null,
    content: [{ type: "text", text, citations: null }],
    usage: {
      input_tokens: 100,
      output_tokens: 50,
      cache_creation_input_tokens: 0,
      cache_read_input_tokens: 80,
      cache_creation: null,
      inference_geo: null,
      server_tool_use: null,
    },
  } as Anthropic.Messages.Message;
}

/**
 * tool_use を返すレスポンスを生成する。
 */
function toolUseResponse(
  toolName: string,
  toolId: string,
  input: Record<string, unknown>,
): Anthropic.Messages.Message {
  return {
    id: "msg_test",
    type: "message",
    role: "assistant",
    model: "test-model",
    stop_reason: "tool_use",
    stop_sequence: null,
    content: [
      {
        type: "tool_use",
        id: toolId,
        name: toolName,
        input,
        caller: null,
      } as unknown as Anthropic.ContentBlock,
    ],
    usage: {
      input_tokens: 100,
      output_tokens: 50,
      cache_creation_input_tokens: 0,
      cache_read_input_tokens: 80,
      cache_creation: null,
      inference_geo: null,
      server_tool_use: null,
    },
  } as Anthropic.Messages.Message;
}

/**
 * tool_use と中間テキストを同時に含むレスポンスを生成する。
 */
function toolUseWithTextResponse(
  text: string,
  toolName: string,
  toolId: string,
  input: Record<string, unknown>,
): Anthropic.Messages.Message {
  return {
    id: "msg_test",
    type: "message",
    role: "assistant",
    model: "test-model",
    stop_reason: "tool_use",
    stop_sequence: null,
    content: [
      { type: "text", text, citations: null },
      {
        type: "tool_use",
        id: toolId,
        name: toolName,
        input,
        caller: null,
      } as unknown as Anthropic.ContentBlock,
    ],
    usage: {
      input_tokens: 100,
      output_tokens: 50,
      cache_creation_input_tokens: 0,
      cache_read_input_tokens: 80,
      cache_creation: null,
      inference_geo: null,
      server_tool_use: null,
    },
  } as Anthropic.Messages.Message;
}

/**
 * ClaudeLlm のインスタンスを生成し、messages.create をモックする。
 * 呼び出しごとに responses の要素を順番に返す。
 */
function createMockedLlm(
  responses: Anthropic.Messages.Message[],
  config?: Partial<{
    systemPrompt: string;
    maxToolRounds: number;
  }>,
): {
  llm: ClaudeLlm;
  calls: Anthropic.Messages.MessageCreateParamsNonStreaming[];
} {
  const calls: Anthropic.Messages.MessageCreateParamsNonStreaming[] = [];
  let callIndex = 0;

  const llm = new ClaudeLlm({
    apiKey: "test-key",
    model: "test-model",
    ...config,
  });

  // messages.create をモックに差し替える。
  // messages は history への参照なので、後から変更されないようスナップショットを取る。
  // deno-lint-ignore no-explicit-any
  (llm as any).client.messages.create = (
    params: Anthropic.Messages.MessageCreateParamsNonStreaming,
  ) => {
    calls.push({ ...params, messages: [...params.messages] });
    if (callIndex >= responses.length) {
      return Promise.reject(new Error("unexpected call"));
    }
    return Promise.resolve(responses[callIndex++]);
  };

  return { llm, calls };
}

Deno.test("ClaudeLlm.chat: テキスト応答を返すこと", async () => {
  const { llm } = createMockedLlm([textResponse("こんにちは")]);
  assertEquals(await collectJoined(llm.chat("やあ")), "こんにちは");
});

Deno.test("ClaudeLlm.chat: 会話履歴が蓄積されること", async () => {
  const { llm, calls } = createMockedLlm([
    textResponse("返答1"),
    textResponse("返答2"),
  ]);
  await collectAll(llm.chat("一発目"));
  await collectAll(llm.chat("二発目"));

  const messages = calls[1].messages;
  assertEquals(
    messages.map((m) => m.role),
    ["user", "assistant", "user"],
  );
});

Deno.test("ClaudeLlm.chat: API エラー時に何も yield しないこと", async () => {
  const llm = new ClaudeLlm({
    apiKey: "test-key",
    model: "test-model",
  });

  // deno-lint-ignore no-explicit-any
  (llm as any).client.messages.create = () =>
    Promise.reject(new Error("API error"));

  assertEquals(await collectAll(llm.chat("test")), []);
});

Deno.test("ClaudeLlm.chat: 失敗したリクエストが履歴に追加されないこと", async () => {
  let callCount = 0;
  const llm = new ClaudeLlm({
    apiKey: "test-key",
    model: "test-model",
  });

  const calls: Anthropic.Messages.MessageCreateParamsNonStreaming[] = [];

  // deno-lint-ignore no-explicit-any
  (llm as any).client.messages.create = (
    params: Anthropic.Messages.MessageCreateParamsNonStreaming,
  ) => {
    calls.push({ ...params, messages: [...params.messages] });
    callCount++;
    if (callCount === 1) {
      return Promise.reject(new Error("fail"));
    }
    return Promise.resolve(textResponse("ok"));
  };

  await collectAll(llm.chat("失敗する"));
  await collectAll(llm.chat("成功する"));

  // 2 回目のリクエストに失敗した 1 回目の履歴が含まれていないこと。
  const messages = calls[1].messages;
  const userMsgs = messages.filter((m) => m.role === "user");
  assertEquals(userMsgs.length, 1);
  assertEquals(userMsgs[0].content, "成功する");
});

Deno.test("ClaudeLlm.chat: systemPrompt 指定時に cache_control 付きで含まれること", async () => {
  const { llm, calls } = createMockedLlm(
    [textResponse("ok")],
    { systemPrompt: "テスト用プロンプト" },
  );
  await collectAll(llm.chat("hello"));

  const system = calls[0].system;
  assertEquals(Array.isArray(system), true);
  if (Array.isArray(system)) {
    assertEquals(system[0].type, "text");
    assertEquals(system[0].text, "テスト用プロンプト");
    assertEquals(system[0].cache_control, { type: "ephemeral" });
  }
});

Deno.test("ClaudeLlm.chat: systemPrompt 未指定時にシステムメッセージが含まれないこと", async () => {
  const { llm, calls } = createMockedLlm([textResponse("ok")]);
  await collectAll(llm.chat("hello"));
  assertEquals(calls[0].system, undefined);
});

Deno.test("ClaudeLlm.chat: tools に cache_control が付与されていること", async () => {
  const { llm, calls } = createMockedLlm([textResponse("ok")]);
  await collectAll(llm.chat("test"));

  const tools = calls[0].tools!;
  // 最後のツールにのみ cache_control が付いていること。
  const last = tools[tools.length - 1];
  assertEquals(
    (last as { cache_control?: { type: string } }).cache_control,
    { type: "ephemeral" },
  );

  // 最後以外のツールには cache_control がないこと。
  if (tools.length > 1) {
    const first = tools[0];
    assertEquals(
      (first as { cache_control?: unknown }).cache_control,
      undefined,
    );
  }
});

Deno.test("ClaudeLlm.chat: 履歴が MAX_HISTORY*2 を超えた場合にトリミングされること", async () => {
  const responses = Array.from({ length: 22 }, () => textResponse("reply"));
  const { llm, calls } = createMockedLlm(responses);

  for (let i = 0; i < 22; i++) {
    await collectAll(llm.chat(`msg-${i}`));
  }

  // 最後のリクエストの messages が 40 以下であること。
  const lastMessages = calls[calls.length - 1].messages;
  assertEquals(lastMessages.length <= 40, true);

  // 最新のユーザーメッセージが含まれていること。
  const lastMsg = lastMessages[lastMessages.length - 1];
  assertEquals(lastMsg.role, "user");
  assertEquals(lastMsg.content, "msg-21");
});

Deno.test("ClaudeLlm.clearHistory: 会話履歴がクリアされること", async () => {
  const { llm, calls } = createMockedLlm([
    textResponse("返答1"),
    textResponse("返答2"),
  ]);
  await collectAll(llm.chat("一発目"));
  llm.clearHistory();
  await collectAll(llm.chat("二発目"));

  // クリア後の 2 回目のリクエストには 1 回目の履歴がないこと。
  const messages = calls[1].messages;
  assertEquals(messages.length, 1);
  assertEquals(messages[0].content, "二発目");
});

Deno.test("ClaudeLlm.chat: tool use ラウンドトリップが正しく動作すること", async () => {
  const { llm, calls } = createMockedLlm([
    toolUseResponse("discord_list_channels", "call_1", {}),
    textResponse("チャンネル一覧です"),
  ]);

  llm.setDiscordClient({
    // deno-lint-ignore no-explicit-any
    client: { guilds: { cache: new Map() } } as any,
    guildId: "test-guild",
  });

  const result = await collectJoined(llm.chat("チャンネル一覧を教えて"));
  assertEquals(result, "チャンネル一覧です");
  assertEquals(calls.length, 2);
});

Deno.test("ClaudeLlm.chat: ツールラウンド中の中間テキストが yield されること", async () => {
  const { llm } = createMockedLlm([
    toolUseWithTextResponse(
      "調べるね",
      "discord_list_channels",
      "call_1",
      {},
    ),
    textResponse("チャンネル一覧です"),
  ]);

  llm.setDiscordClient({
    // deno-lint-ignore no-explicit-any
    client: { guilds: { cache: new Map() } } as any,
    guildId: "test-guild",
  });

  const chunks = await collectAll(llm.chat("チャンネル一覧を教えて"));
  assertEquals(chunks, ["調べるね", "チャンネル一覧です"]);
});

Deno.test("ClaudeLlm.chat: ラウンド上限に達した場合に空文字列を返すこと", async () => {
  const { llm } = createMockedLlm(
    [
      toolUseResponse("discord_list_channels", "call_1", {}),
      toolUseResponse("discord_list_channels", "call_2", {}),
      toolUseResponse("discord_list_channels", "call_3", {}),
    ],
    { maxToolRounds: 1 },
  );

  llm.setDiscordClient({
    // deno-lint-ignore no-explicit-any
    client: { guilds: { cache: new Map() } } as any,
    guildId: "test-guild",
  });

  assertEquals(await collectAll(llm.chat("test")), []);
});

Deno.test("ClaudeLlm.chat: mutex により並行呼び出しが直列化されること", async () => {
  const order: string[] = [];

  const llm = new ClaudeLlm({
    apiKey: "test-key",
    model: "test-model",
  });

  let callCount = 0;
  // deno-lint-ignore no-explicit-any
  (llm as any).client.messages.create = () => {
    const idx = callCount++;
    return new Promise((resolve) => {
      // 最初の呼び出しを遅延させて、直列化されていることを確認する。
      const delay = idx === 0 ? 50 : 10;
      setTimeout(() => {
        order.push(`resolve-${idx}`);
        resolve(textResponse(`reply-${idx}`));
      }, delay);
    });
  };

  const [r1, r2] = await Promise.all([
    collectJoined(llm.chat("first")),
    collectJoined(llm.chat("second")),
  ]);

  assertEquals(r1, "reply-0");
  assertEquals(r2, "reply-1");
  // mutex により最初の呼び出しが完了してから 2 番目が実行される。
  assertEquals(order, ["resolve-0", "resolve-1"]);
});

Deno.test("ClaudeLlm.setContext: テンプレート変数がシステムプロンプトに反映されること", async () => {
  const { llm, calls } = createMockedLlm(
    [textResponse("ok")],
    { systemPrompt: "Guild: {{guild.name}}" },
  );
  llm.setContext({ "guild.name": "テストサーバー" });
  await collectAll(llm.chat("hello"));

  const system = calls[0].system;
  if (Array.isArray(system)) {
    assertEquals(system[0].text, "Guild: テストサーバー");
  }
});
