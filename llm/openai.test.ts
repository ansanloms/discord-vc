import { assertEquals } from "@std/assert";
import { OpenAiLlm } from "./openai.ts";

type FetchArgs = { url: string; init?: RequestInit };

/**
 * Responses API 形式のモックレスポンスを生成する。
 * Agents SDK は内部で `/v1/responses` エンドポイントを使用する。
 */
function responsesApiOk(text: string): () => Response {
  return () =>
    new Response(
      JSON.stringify({
        id: "resp_test",
        object: "response",
        status: "completed",
        output: [
          {
            type: "message",
            role: "assistant",
            content: [{ type: "output_text", text }],
          },
        ],
      }),
      {
        status: 200,
        headers: { "Content-Type": "application/json" },
      },
    );
}

function errResponse(): () => Response {
  return () => new Response("error", { status: 500 });
}

/**
 * 呼び出し履歴を記録するモック fetch を生成する。
 * OpenAI クライアントの `fetch` オプションに直接渡す。
 */
function createMockFetch(
  responseFactory: () => Response,
): { calls: FetchArgs[]; fetch: typeof globalThis.fetch } {
  const calls: FetchArgs[] = [];
  const mockFetch = ((
    url: string | URL | Request,
    init?: RequestInit,
  ) => {
    calls.push({ url: url.toString(), init });
    return Promise.resolve(responseFactory());
  }) as typeof globalThis.fetch;
  return { calls, fetch: mockFetch };
}

/**
 * 複数のレスポンスを順番に返すモック fetch を生成する。
 * SDK のリトライにも対応するため、エラーレスポンスは連続で返す。
 */
function createSequentialMockFetch(
  factories: (() => Response)[],
): { calls: FetchArgs[]; fetch: typeof globalThis.fetch } {
  const calls: FetchArgs[] = [];
  let index = 0;
  const mockFetch = ((
    url: string | URL | Request,
    init?: RequestInit,
  ) => {
    calls.push({ url: url.toString(), init });
    // 最後のファクトリを使い回す（配列外参照を防ぐ）。
    const factory = index < factories.length
      ? factories[index++]
      : factories[factories.length - 1];
    return Promise.resolve(factory());
  }) as typeof globalThis.fetch;
  return { calls, fetch: mockFetch };
}

Deno.test("OpenAiLlm.chat: アシスタントの返答を返すこと", async () => {
  const { calls, fetch } = createMockFetch(responsesApiOk("こんにちは"));
  const llm = new OpenAiLlm({
    baseUrl: "http://localhost:18789",
    model: "test-model",
    fetch,
  });
  assertEquals(await llm.chat("やあ"), "こんにちは");
  assertEquals(calls.length, 1);
});

Deno.test("OpenAiLlm.chat: API キーがある場合に Authorization ヘッダを送信すること", async () => {
  const { calls, fetch } = createMockFetch(responsesApiOk("ok"));
  const llm = new OpenAiLlm({
    baseUrl: "http://localhost:18789",
    apiKey: "secret-token",
    model: "test-model",
    fetch,
  });
  await llm.chat("test");
  const headers = new Headers(calls[0].init?.headers as HeadersInit);
  assertEquals(headers.get("Authorization"), "Bearer secret-token");
});

Deno.test("OpenAiLlm.chat: API エラー時に空文字列を返すこと", async () => {
  const { fetch } = createMockFetch(errResponse());
  const llm = new OpenAiLlm({
    baseUrl: "http://localhost:18789",
    model: "test-model",
    fetch,
  });
  assertEquals(await llm.chat("test"), "");
});

Deno.test("OpenAiLlm.chat: 失敗したリクエストが履歴に影響しないこと", async () => {
  // エラー時の呼び出し回数はリトライにより不定のため、
  // 成功時のリクエストに失敗メッセージが含まれないことを検証する。
  const { calls, fetch } = createSequentialMockFetch([
    // SDK はリトライするため、エラーレスポンスを複数返す。
    errResponse(),
    errResponse(),
    errResponse(),
    // 2 回目の chat() で成功する。
    responsesApiOk("ok"),
  ]);

  const llm = new OpenAiLlm({
    baseUrl: "http://localhost:18789",
    model: "test-model",
    fetch,
  });
  await llm.chat("失敗する");
  await llm.chat("成功する");

  // 最後のリクエスト（成功した方）を取得する。
  const lastCall = calls[calls.length - 1];
  const body = JSON.parse(lastCall.init?.body as string);
  const inputStr = JSON.stringify(body.input);
  // 失敗したメッセージは履歴に残っていないこと。
  assertEquals(inputStr.includes("失敗する"), false);
  assertEquals(inputStr.includes("成功する"), true);
});

Deno.test("OpenAiLlm.chat: systemPrompt 指定時にリクエストに含まれること", async () => {
  const { calls, fetch } = createMockFetch(responsesApiOk("ok"));
  const llm = new OpenAiLlm({
    baseUrl: "http://localhost:18789",
    model: "test-model",
    systemPrompt: "テスト用プロンプト",
    fetch,
  });
  await llm.chat("hello");
  const body = JSON.parse(calls[0].init?.body as string);
  assertEquals(typeof body.instructions, "string");
  assertEquals(body.instructions.includes("テスト用プロンプト"), true);
});

Deno.test("OpenAiLlm.chat: 指定されたベース URL に POST されること", async () => {
  const { calls, fetch } = createMockFetch(responsesApiOk("ok"));
  const llm = new OpenAiLlm({
    baseUrl: "http://custom:1234",
    model: "test-model",
    fetch,
  });
  await llm.chat("test");
  assertEquals(
    calls[0].url.startsWith("http://custom:1234/v1/responses"),
    true,
  );
});

Deno.test("OpenAiLlm.chat: 指定したモデル名がリクエストに含まれること", async () => {
  const { calls, fetch } = createMockFetch(responsesApiOk("ok"));
  const llm = new OpenAiLlm({
    baseUrl: "http://localhost:18789",
    model: "custom-model",
    fetch,
  });
  await llm.chat("test");
  const body = JSON.parse(calls[0].init?.body as string);
  assertEquals(body.model, "custom-model");
});

Deno.test("OpenAiLlm.chat: 失敗後に再試行すると正しい結果が返ること", async () => {
  const { fetch } = createSequentialMockFetch([
    errResponse(),
    errResponse(),
    errResponse(),
    responsesApiOk("成功"),
  ]);

  const llm = new OpenAiLlm({
    baseUrl: "http://localhost:18789",
    model: "test-model",
    fetch,
  });
  const first = await llm.chat("これは失敗する");
  assertEquals(first, "");
  const second = await llm.chat("これは成功する");
  assertEquals(second, "成功");
});

Deno.test("OpenAiLlm.clearHistory: 履歴がクリアされること", async () => {
  const { calls, fetch } = createMockFetch(responsesApiOk("reply"));
  const llm = new OpenAiLlm({
    baseUrl: "http://localhost:18789",
    model: "test-model",
    fetch,
  });
  await llm.chat("一発目");
  llm.clearHistory();
  await llm.chat("二発目");
  const body = JSON.parse(calls[1].init?.body as string);
  // クリア後なので入力は「二発目」のみ。
  const userInputs = (body.input as { role?: string }[]).filter(
    (item) => item.role === "user",
  );
  assertEquals(userInputs.length, 1);
});
