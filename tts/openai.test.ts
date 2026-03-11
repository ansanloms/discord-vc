import { assertEquals, assertStringIncludes } from "@std/assert";
import { OpenAiTts } from "./openai.ts";

type FetchArgs = { url: string; init?: RequestInit };

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

function audioResponse(data: number[]): () => Response {
  return () => new Response(new Uint8Array(data).buffer, { status: 200 });
}

Deno.test("OpenAiTts.synthesize: 成功時に音声バイト列を返すこと", async () => {
  const { restore } = captureFetch(audioResponse([1, 2, 3, 4, 5]));
  try {
    const tts = new OpenAiTts({
      baseUrl: "http://localhost:8000",
      model: "test-model",
      voice: "1",
      clientOptions: { maxRetries: 0 },
    });
    assertEquals(Array.from(await tts.synthesize("テスト")), [1, 2, 3, 4, 5]);
  } finally {
    restore();
  }
});

Deno.test("OpenAiTts.synthesize: API エラー時に空の Buffer を返すこと", async () => {
  const { restore } = captureFetch(
    () => new Response("error", { status: 500 }),
  );
  try {
    const tts = new OpenAiTts({
      baseUrl: "http://localhost:8000",
      model: "test-model",
      voice: "1",
      clientOptions: { maxRetries: 0 },
    });
    assertEquals((await tts.synthesize("テスト")).length, 0);
  } finally {
    restore();
  }
});

Deno.test("OpenAiTts.synthesize: 指定されたベース URL に POST されること", async () => {
  const { calls, restore } = captureFetch(audioResponse([0]));
  try {
    const tts = new OpenAiTts({
      baseUrl: "http://custom:7777",
      model: "test-model",
      voice: "1",
      clientOptions: { maxRetries: 0 },
    });
    await tts.synthesize("hello");
    assertStringIncludes(calls[0].url, "http://custom:7777/v1/audio/speech");
  } finally {
    restore();
  }
});

Deno.test("OpenAiTts.synthesize: リクエストボディに正しいフィールドが含まれること", async () => {
  const { calls, restore } = captureFetch(audioResponse([0]));
  try {
    const tts = new OpenAiTts({
      baseUrl: "http://localhost:8000",
      model: "test-model",
      voice: "42",
      clientOptions: { maxRetries: 0 },
    });
    await tts.synthesize("読み上げテスト");
    const body = JSON.parse(calls[0].init?.body as string);
    assertEquals(body.model, "test-model");
    assertEquals(body.input, "読み上げテスト");
    assertEquals(body.voice, "42");
    assertEquals(body.response_format, "mp3");
    assertEquals(body.speed, 1);
  } finally {
    restore();
  }
});

Deno.test("OpenAiTts.synthesize: Content-Type が application/json であること", async () => {
  const { calls, restore } = captureFetch(audioResponse([0]));
  try {
    const tts = new OpenAiTts({
      baseUrl: "http://localhost:8000",
      model: "test-model",
      voice: "1",
      clientOptions: { maxRetries: 0 },
    });
    await tts.synthesize("test");
    const headers = new Headers(calls[0].init?.headers as HeadersInit);
    assertEquals(headers.get("Content-Type"), "application/json");
  } finally {
    restore();
  }
});

Deno.test("OpenAiTts.synthesize: 空のレスポンスボディでも正しく処理されること", async () => {
  const { restore } = captureFetch(audioResponse([]));
  try {
    const tts = new OpenAiTts({
      baseUrl: "http://localhost:8000",
      model: "test-model",
      voice: "1",
      clientOptions: { maxRetries: 0 },
    });
    assertEquals((await tts.synthesize("test")).length, 0);
  } finally {
    restore();
  }
});
