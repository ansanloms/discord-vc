import { assertEquals } from "@std/assert";
import { AnthropicLlm } from "./mod.ts";
import type Anthropic from "@anthropic-ai/sdk";

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
 * AnthropicLlm のインスタンスを生成し、messages.create をモックする。
 * 呼び出しごとに responses の要素を順番に返す。
 */
function createMockedLlm(
  responses: Anthropic.Messages.Message[],
  config?: Partial<{
    systemPrompt: string;
    maxToolRounds: number;
  }>,
): {
  llm: AnthropicLlm;
  calls: Anthropic.Messages.MessageCreateParamsNonStreaming[];
} {
  const calls: Anthropic.Messages.MessageCreateParamsNonStreaming[] = [];
  let callIndex = 0;

  const llm = new AnthropicLlm({
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

Deno.test("AnthropicLlm.chat: テキスト応答を返すこと", async () => {
  const { llm } = createMockedLlm([textResponse("こんにちは")]);
  assertEquals(await llm.chat("やあ"), "こんにちは");
});

Deno.test("AnthropicLlm.chat: 会話履歴が蓄積されること", async () => {
  const { llm, calls } = createMockedLlm([
    textResponse("返答1"),
    textResponse("返答2"),
  ]);
  await llm.chat("一発目");
  await llm.chat("二発目");

  const messages = calls[1].messages;
  assertEquals(
    messages.map((m) => m.role),
    ["user", "assistant", "user"],
  );
});

Deno.test("AnthropicLlm.chat: API エラー時に空文字列を返すこと", async () => {
  const llm = new AnthropicLlm({
    apiKey: "test-key",
    model: "test-model",
  });

  // deno-lint-ignore no-explicit-any
  (llm as any).client.messages.create = () =>
    Promise.reject(new Error("API error"));

  assertEquals(await llm.chat("test"), "");
});

Deno.test("AnthropicLlm.chat: 失敗したリクエストが履歴に追加されないこと", async () => {
  let callCount = 0;
  const llm = new AnthropicLlm({
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

  await llm.chat("失敗する");
  await llm.chat("成功する");

  // 2 回目のリクエストに失敗した 1 回目の履歴が含まれていないこと。
  const messages = calls[1].messages;
  const userMsgs = messages.filter((m) => m.role === "user");
  assertEquals(userMsgs.length, 1);
  assertEquals(userMsgs[0].content, "成功する");
});

Deno.test("AnthropicLlm.chat: systemPrompt 指定時に cache_control 付きで含まれること", async () => {
  const { llm, calls } = createMockedLlm(
    [textResponse("ok")],
    { systemPrompt: "テスト用プロンプト" },
  );
  await llm.chat("hello");

  const system = calls[0].system;
  assertEquals(Array.isArray(system), true);
  if (Array.isArray(system)) {
    assertEquals(system[0].type, "text");
    assertEquals(system[0].text, "テスト用プロンプト");
    assertEquals(system[0].cache_control, { type: "ephemeral" });
  }
});

Deno.test("AnthropicLlm.chat: systemPrompt 未指定時にシステムメッセージが含まれないこと", async () => {
  const { llm, calls } = createMockedLlm([textResponse("ok")]);
  await llm.chat("hello");
  assertEquals(calls[0].system, undefined);
});

Deno.test("AnthropicLlm.chat: tools に cache_control が付与されていること", async () => {
  const { llm, calls } = createMockedLlm([textResponse("ok")]);
  await llm.chat("test");

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

Deno.test("AnthropicLlm.chat: 履歴が MAX_HISTORY*2 を超えた場合にトリミングされること", async () => {
  const responses = Array.from({ length: 22 }, () => textResponse("reply"));
  const { llm, calls } = createMockedLlm(responses);

  for (let i = 0; i < 22; i++) {
    await llm.chat(`msg-${i}`);
  }

  // 最後のリクエストの messages が 40 以下であること。
  const lastMessages = calls[calls.length - 1].messages;
  assertEquals(lastMessages.length <= 40, true);

  // 最新のユーザーメッセージが含まれていること。
  const lastMsg = lastMessages[lastMessages.length - 1];
  assertEquals(lastMsg.role, "user");
  assertEquals(lastMsg.content, "msg-21");
});

Deno.test("AnthropicLlm.clearHistory: 会話履歴がクリアされること", async () => {
  const { llm, calls } = createMockedLlm([
    textResponse("返答1"),
    textResponse("返答2"),
  ]);
  await llm.chat("一発目");
  llm.clearHistory();
  await llm.chat("二発目");

  // クリア後の 2 回目のリクエストには 1 回目の履歴がないこと。
  const messages = calls[1].messages;
  assertEquals(messages.length, 1);
  assertEquals(messages[0].content, "二発目");
});

Deno.test("AnthropicLlm.chat: tool use ラウンドトリップが正しく動作すること", async () => {
  const { llm, calls } = createMockedLlm([
    toolUseResponse("discord_list_channels", "call_1", {}),
    textResponse("チャンネル一覧です"),
  ]);

  llm.setDiscordClient({
    // deno-lint-ignore no-explicit-any
    client: { guilds: { cache: new Map() } } as any,
    guildId: "test-guild",
  });

  const result = await llm.chat("チャンネル一覧を教えて");
  assertEquals(result, "チャンネル一覧です");
  assertEquals(calls.length, 2);
});

Deno.test("AnthropicLlm.chat: ラウンド上限に達した場合に空文字列を返すこと", async () => {
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

  assertEquals(await llm.chat("test"), "");
});

Deno.test("AnthropicLlm.chat: mutex により並行呼び出しが直列化されること", async () => {
  const order: string[] = [];

  const llm = new AnthropicLlm({
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
    llm.chat("first"),
    llm.chat("second"),
  ]);

  assertEquals(r1, "reply-0");
  assertEquals(r2, "reply-1");
  // mutex により最初の呼び出しが完了してから 2 番目が実行される。
  assertEquals(order, ["resolve-0", "resolve-1"]);
});

Deno.test("AnthropicLlm.setContext: テンプレート変数がシステムプロンプトに反映されること", async () => {
  const { llm, calls } = createMockedLlm(
    [textResponse("ok")],
    { systemPrompt: "Guild: {{guild.name}}" },
  );
  llm.setContext({ "guild.name": "テストサーバー" });
  await llm.chat("hello");

  const system = calls[0].system;
  if (Array.isArray(system)) {
    assertEquals(system[0].text, "Guild: テストサーバー");
  }
});
