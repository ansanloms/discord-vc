import { assertEquals } from "@std/assert";
import { OllamaLlm } from "./mod.ts";
import type { ChatResponse, Message } from "ollama";

/**
 * Ollama の chat レスポンスを生成する（テキスト応答）。
 */
function textResponse(content: string): ChatResponse {
  return {
    model: "test-model",
    created_at: new Date(),
    message: { role: "assistant", content },
    done: true,
    done_reason: "stop",
    total_duration: 0,
    load_duration: 0,
    prompt_eval_count: 0,
    prompt_eval_duration: 0,
    eval_count: 0,
    eval_duration: 0,
  } as ChatResponse;
}

/**
 * OllamaLlm のインスタンスを生成し、client.chat をモックする。
 * 呼び出しごとに responses の要素を順番に返す。
 */
function createMockedLlm(
  responses: ChatResponse[],
  config?: Partial<{
    systemPrompt: string;
    maxToolRounds: number;
  }>,
): {
  llm: OllamaLlm;
  calls: { model: string; messages: Message[] }[];
} {
  const calls: { model: string; messages: Message[] }[] = [];
  let callIndex = 0;

  const llm = new OllamaLlm({
    host: "http://localhost:11434",
    model: "test-model",
    ...config,
  });

  // client.chat をモックに差し替える。
  // messages は参照を共有するのでスナップショットを取る。
  // deno-lint-ignore no-explicit-any
  (llm as any).client.chat = (
    params: { model: string; messages: Message[] },
  ) => {
    calls.push({ ...params, messages: [...params.messages] });
    if (callIndex >= responses.length) {
      return Promise.reject(new Error("unexpected call"));
    }
    return Promise.resolve(responses[callIndex++]);
  };

  return { llm, calls };
}

Deno.test("OllamaLlm.chat: テキスト応答を返すこと", async () => {
  const { llm } = createMockedLlm([textResponse("こんにちは")]);
  assertEquals(await llm.chat("やあ"), "こんにちは");
});

Deno.test("OllamaLlm.chat: 会話履歴が蓄積されること", async () => {
  const { llm, calls } = createMockedLlm([
    textResponse("返答1"),
    textResponse("返答2"),
  ]);
  await llm.chat("一発目");
  await llm.chat("二発目");

  // systemPrompt 未指定なので user + assistant + user のみ。
  const messages = calls[1].messages;
  assertEquals(
    messages.map((m) => m.role),
    ["user", "assistant", "user"],
  );
});

Deno.test("OllamaLlm.chat: API エラー時に空文字列を返すこと", async () => {
  const llm = new OllamaLlm({
    host: "http://localhost:11434",
    model: "test-model",
  });

  // deno-lint-ignore no-explicit-any
  (llm as any).client.chat = () => Promise.reject(new Error("API error"));

  assertEquals(await llm.chat("test"), "");
});

Deno.test("OllamaLlm.chat: 失敗したリクエストが履歴に追加されないこと", async () => {
  let callCount = 0;
  const llm = new OllamaLlm({
    host: "http://localhost:11434",
    model: "test-model",
  });

  const calls: { model: string; messages: Message[] }[] = [];

  // deno-lint-ignore no-explicit-any
  (llm as any).client.chat = (
    params: { model: string; messages: Message[] },
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

  const messages = calls[1].messages;
  const userMsgs = messages.filter((m) => m.role === "user");
  assertEquals(userMsgs.length, 1);
  assertEquals(userMsgs[0].content, "成功する");
});

Deno.test("OllamaLlm.chat: systemPrompt 指定時にシステムメッセージが最初に含まれること", async () => {
  const { llm, calls } = createMockedLlm(
    [textResponse("ok")],
    { systemPrompt: "テスト用プロンプト" },
  );
  await llm.chat("hello");

  const messages = calls[0].messages;
  assertEquals(messages[0].role, "system");
  assertEquals(messages[0].content, "テスト用プロンプト");
  assertEquals(messages[1].role, "user");
});

Deno.test("OllamaLlm.chat: systemPrompt 未指定時にシステムメッセージが含まれないこと", async () => {
  const { llm, calls } = createMockedLlm([textResponse("ok")]);
  await llm.chat("hello");

  const messages = calls[0].messages;
  assertEquals(messages[0].role, "user");
});

Deno.test("OllamaLlm.chat: 履歴が MAX_HISTORY*2 を超えた場合にトリミングされること", async () => {
  const responses = Array.from({ length: 22 }, () => textResponse("reply"));
  const { llm, calls } = createMockedLlm(responses);

  for (let i = 0; i < 22; i++) {
    await llm.chat(`msg-${i}`);
  }

  // system message がないので messages = history のみ。
  const lastMessages = calls[calls.length - 1].messages;
  assertEquals(lastMessages.length <= 40, true);

  const lastMsg = lastMessages[lastMessages.length - 1];
  assertEquals(lastMsg.role, "user");
  assertEquals(lastMsg.content, "msg-21");
});

Deno.test("OllamaLlm.clearHistory: 会話履歴がクリアされること", async () => {
  const { llm, calls } = createMockedLlm([
    textResponse("返答1"),
    textResponse("返答2"),
  ]);
  await llm.chat("一発目");
  llm.clearHistory();
  await llm.chat("二発目");

  const messages = calls[1].messages;
  assertEquals(messages.length, 1);
  assertEquals(messages[0].content, "二発目");
});

Deno.test("OllamaLlm.chat: mutex により並行呼び出しが直列化されること", async () => {
  const order: string[] = [];

  const llm = new OllamaLlm({
    host: "http://localhost:11434",
    model: "test-model",
  });

  let callCount = 0;
  // deno-lint-ignore no-explicit-any
  (llm as any).client.chat = () => {
    const idx = callCount++;
    return new Promise((resolve) => {
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
  assertEquals(order, ["resolve-0", "resolve-1"]);
});

Deno.test("OllamaLlm.setContext: テンプレート変数がシステムプロンプトに反映されること", async () => {
  const { llm, calls } = createMockedLlm(
    [textResponse("ok")],
    { systemPrompt: "Guild: {{guild.name}}" },
  );
  llm.setContext({ "guild.name": "テストサーバー" });
  await llm.chat("hello");

  const messages = calls[0].messages;
  assertEquals(messages[0].role, "system");
  assertEquals(messages[0].content, "Guild: テストサーバー");
});
