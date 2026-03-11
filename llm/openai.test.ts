import { assertEquals, assertStringIncludes } from "@std/assert";
import { OpenAiLlm } from "./openai.ts";

type FetchArgs = { url: string; init?: RequestInit };

// 毎回新しい Response を返す（Response body は一度しか消費できないため）。
function captureFetch(
  responseFactory: () => Response,
): { calls: FetchArgs[]; restore: () => void } {
  const calls: FetchArgs[] = [];
  const original = globalThis.fetch;
  globalThis.fetch = ((url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: url.toString(), init });
    return Promise.resolve(responseFactory());
  }) as typeof fetch;
  return {
    calls,
    restore: () => {
      globalThis.fetch = original;
    },
  };
}

function okResponse(content: string): () => Response {
  return () =>
    new Response(
      JSON.stringify({ choices: [{ message: { content } }] }),
      {
        status: 200,
        headers: { "Content-Type": "application/json" },
      },
    );
}

function errResponse(): () => Response {
  return () => new Response("error", { status: 500 });
}

Deno.test("OpenAiLlm.chat: アシスタントの返答を返すこと", async () => {
  const { calls, restore } = captureFetch(okResponse("こんにちは"));
  try {
    const llm = new OpenAiLlm({
      baseUrl: "http://localhost:18789",
      model: "test-model",
      clientOptions: { maxRetries: 0 },
    });
    assertEquals(await llm.chat("やあ"), "こんにちは");
    assertEquals(calls.length, 1);
  } finally {
    restore();
  }
});

Deno.test("OpenAiLlm.chat: API キーがある場合に Authorization ヘッダを送信すること", async () => {
  const { calls, restore } = captureFetch(okResponse("ok"));
  try {
    const llm = new OpenAiLlm({
      baseUrl: "http://localhost:18789",
      apiKey: "secret-token",
      model: "test-model",
      clientOptions: { maxRetries: 0 },
    });
    await llm.chat("test");
    const headers = new Headers(calls[0].init?.headers as HeadersInit);
    assertEquals(headers.get("Authorization"), "Bearer secret-token");
  } finally {
    restore();
  }
});

Deno.test("OpenAiLlm.chat: 会話履歴が蓄積されること", async () => {
  const { calls, restore } = captureFetch(okResponse("返答"));
  try {
    const llm = new OpenAiLlm({
      baseUrl: "http://localhost:18789",
      model: "test-model",
      clientOptions: { maxRetries: 0 },
    });
    await llm.chat("一発目");
    await llm.chat("二発目");
    const body = JSON.parse(calls[1].init?.body as string);
    // systemPrompt 未指定なので user + assistant + user のみ
    assertEquals(
      body.messages.map((m: { role: string }) => m.role),
      ["user", "assistant", "user"],
    );
  } finally {
    restore();
  }
});

Deno.test("OpenAiLlm.chat: API エラー時に空文字列を返すこと", async () => {
  const { restore } = captureFetch(errResponse());
  try {
    const llm = new OpenAiLlm({
      baseUrl: "http://localhost:18789",
      model: "test-model",
      clientOptions: { maxRetries: 0 },
    });
    assertEquals(await llm.chat("test"), "");
  } finally {
    restore();
  }
});

Deno.test("OpenAiLlm.chat: 失敗したリクエストが履歴に追加されないこと", async () => {
  let callCount = 0;
  const factories = [errResponse(), okResponse("ok")];
  const original = globalThis.fetch;
  globalThis.fetch =
    (() => Promise.resolve(factories[callCount++]())) as typeof fetch;
  try {
    const llm = new OpenAiLlm({
      baseUrl: "http://localhost:18789",
      model: "test-model",
      clientOptions: { maxRetries: 0 },
    });
    await llm.chat("失敗する");
    await llm.chat("成功する");
    assertEquals(callCount, 2);
  } finally {
    globalThis.fetch = original;
  }
});

Deno.test("OpenAiLlm.chat: systemPrompt 指定時にシステムメッセージが最初に含まれること", async () => {
  const { calls, restore } = captureFetch(okResponse("ok"));
  try {
    const llm = new OpenAiLlm({
      baseUrl: "http://localhost:18789",
      model: "test-model",
      systemPrompt: "テスト用プロンプト",
      clientOptions: { maxRetries: 0 },
    });
    await llm.chat("hello");
    const body = JSON.parse(calls[0].init?.body as string);
    assertEquals(body.messages[0].role, "system");
    assertEquals(body.messages[0].content, "テスト用プロンプト");
    assertEquals(body.messages[1].role, "user");
  } finally {
    restore();
  }
});

Deno.test("OpenAiLlm.chat: systemPrompt 未指定時にシステムメッセージが含まれないこと", async () => {
  const { calls, restore } = captureFetch(okResponse("ok"));
  try {
    const llm = new OpenAiLlm({
      baseUrl: "http://localhost:18789",
      model: "test-model",
      clientOptions: { maxRetries: 0 },
    });
    await llm.chat("hello");
    const body = JSON.parse(calls[0].init?.body as string);
    assertEquals(body.messages[0].role, "user");
    assertEquals(body.messages[0].content, "hello");
  } finally {
    restore();
  }
});

Deno.test("OpenAiLlm.chat: 履歴が MAX_HISTORY*2 を超えた場合にトリミングされること", async () => {
  const { calls, restore } = captureFetch(okResponse("reply"));
  try {
    const llm = new OpenAiLlm({
      baseUrl: "http://localhost:18789",
      model: "test-model",
      clientOptions: { maxRetries: 0 },
    });
    // MAX_HISTORY=20 なので 40 メッセージ（20 ターン）を超えるまで送る。
    for (let i = 0; i < 21; i++) {
      await llm.chat(`msg-${i}`);
    }
    const lastBody = JSON.parse(
      calls[calls.length - 1].init?.body as string,
    );
    const nonSystem = lastBody.messages.filter(
      (m: { role: string }) => m.role !== "system",
    );
    // 40 メッセージ以下であること（トリミング済み）
    assertEquals(nonSystem.length <= 40, true);
    // 最新のユーザーメッセージが含まれていること
    const lastUserMsg = nonSystem[nonSystem.length - 1];
    assertEquals(lastUserMsg.role, "user");
    assertEquals(lastUserMsg.content, "msg-20");
  } finally {
    restore();
  }
});

Deno.test("OpenAiLlm.chat: 指定されたベース URL に POST されること", async () => {
  const { calls, restore } = captureFetch(okResponse("ok"));
  try {
    const llm = new OpenAiLlm({
      baseUrl: "http://custom:1234",
      model: "test-model",
      clientOptions: { maxRetries: 0 },
    });
    await llm.chat("test");
    assertStringIncludes(
      calls[0].url,
      "http://custom:1234/v1/chat/completions",
    );
  } finally {
    restore();
  }
});

Deno.test("OpenAiLlm.chat: 指定したモデル名がリクエストに含まれること", async () => {
  const { calls, restore } = captureFetch(okResponse("ok"));
  try {
    const llm = new OpenAiLlm({
      baseUrl: "http://localhost:18789",
      model: "custom-model",
      clientOptions: { maxRetries: 0 },
    });
    await llm.chat("test");
    const body = JSON.parse(calls[0].init?.body as string);
    assertEquals(body.model, "custom-model");
  } finally {
    restore();
  }
});

Deno.test("OpenAiLlm.chat: choices が空の場合に空文字列を返すこと", async () => {
  const { restore } = captureFetch(
    () =>
      new Response(JSON.stringify({ choices: [] }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
  );
  try {
    const llm = new OpenAiLlm({
      baseUrl: "http://localhost:18789",
      model: "test-model",
      clientOptions: { maxRetries: 0 },
    });
    assertEquals(await llm.chat("test"), "");
  } finally {
    restore();
  }
});

Deno.test("OpenAiLlm.chat: 失敗後に再試行すると履歴が正しいこと", async () => {
  let callCount = 0;
  const factories = [errResponse(), okResponse("成功")];
  const original = globalThis.fetch;
  const calls: FetchArgs[] = [];
  globalThis.fetch = ((url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: url.toString(), init });
    return Promise.resolve(factories[callCount++]());
  }) as typeof fetch;
  try {
    const llm = new OpenAiLlm({
      baseUrl: "http://localhost:18789",
      model: "test-model",
      clientOptions: { maxRetries: 0 },
    });
    await llm.chat("これは失敗する");
    const reply = await llm.chat("これは成功する");
    assertEquals(reply, "成功");
    // 2 回目のリクエストの履歴に失敗した 1 回目が含まれていないこと
    const body = JSON.parse(calls[1].init?.body as string);
    const userMsgs = body.messages.filter(
      (m: { role: string }) => m.role === "user",
    );
    assertEquals(userMsgs.length, 1);
    assertEquals(userMsgs[0].content, "これは成功する");
  } finally {
    globalThis.fetch = original;
  }
});
