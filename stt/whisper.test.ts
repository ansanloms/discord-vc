import { assertEquals } from "@std/assert";
import { Buffer } from "node:buffer";
import { WhisperStt } from "./whisper.ts";

type FetchArgs = { url: string; body: FormData };

function captureFetch(
  responseFactory: () => Response,
): { calls: FetchArgs[]; restore: () => void } {
  const calls: FetchArgs[] = [];
  const original = globalThis.fetch;
  globalThis.fetch = ((url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: url.toString(), body: init?.body as FormData });
    return Promise.resolve(responseFactory());
  }) as typeof fetch;
  return {
    calls,
    restore: () => {
      globalThis.fetch = original;
    },
  };
}

function okResponse(text: string): () => Response {
  return () => new Response(JSON.stringify({ text }), { status: 200 });
}

Deno.test("WhisperStt.transcribe: トリムされたテキストを返すこと", async () => {
  const { restore } = captureFetch(okResponse("  hello world  "));
  try {
    const stt = new WhisperStt({ baseUrl: "http://localhost:8178" });
    assertEquals(await stt.transcribe(Buffer.alloc(100)), "hello world");
  } finally {
    restore();
  }
});

Deno.test("WhisperStt.transcribe: [角括弧] の非音声マーカーが除去されること", async () => {
  const { restore } = captureFetch(okResponse("[BLANK_AUDIO] hello"));
  try {
    const stt = new WhisperStt({ baseUrl: "http://localhost:8178" });
    assertEquals(await stt.transcribe(Buffer.alloc(100)), "hello");
  } finally {
    restore();
  }
});

Deno.test("WhisperStt.transcribe: (丸括弧) の非音声マーカーが除去されること", async () => {
  const { restore } = captureFetch(okResponse("(無音) hello"));
  try {
    const stt = new WhisperStt({ baseUrl: "http://localhost:8178" });
    assertEquals(await stt.transcribe(Buffer.alloc(100)), "hello");
  } finally {
    restore();
  }
});

Deno.test("WhisperStt.transcribe: *アスタリスク* の非音声マーカーが除去されること", async () => {
  const { restore } = captureFetch(okResponse("*音声なし* hello"));
  try {
    const stt = new WhisperStt({ baseUrl: "http://localhost:8178" });
    assertEquals(await stt.transcribe(Buffer.alloc(100)), "hello");
  } finally {
    restore();
  }
});

Deno.test("WhisperStt.transcribe: 全てが非音声マーカーの場合に空文字列を返すこと", async () => {
  const { restore } = captureFetch(
    okResponse("[BLANK_AUDIO] (無音) *silence*"),
  );
  try {
    const stt = new WhisperStt({ baseUrl: "http://localhost:8178" });
    assertEquals(await stt.transcribe(Buffer.alloc(100)), "");
  } finally {
    restore();
  }
});

Deno.test("WhisperStt.transcribe: API エラー時に空文字列を返すこと", async () => {
  const { restore } = captureFetch(
    () => new Response("Internal Server Error", { status: 500 }),
  );
  try {
    const stt = new WhisperStt({ baseUrl: "http://localhost:8178" });
    assertEquals(await stt.transcribe(Buffer.alloc(100)), "");
  } finally {
    restore();
  }
});

Deno.test("WhisperStt.transcribe: text フィールドが無い場合に空文字列を返すこと", async () => {
  const { restore } = captureFetch(
    () => new Response(JSON.stringify({}), { status: 200 }),
  );
  try {
    const stt = new WhisperStt({ baseUrl: "http://localhost:8178" });
    assertEquals(await stt.transcribe(Buffer.alloc(100)), "");
  } finally {
    restore();
  }
});

Deno.test("WhisperStt.transcribe: 指定されたベース URL に POST されること", async () => {
  const { calls, restore } = captureFetch(okResponse("ok"));
  try {
    const stt = new WhisperStt({ baseUrl: "http://custom-host:9999" });
    await stt.transcribe(Buffer.alloc(100));
    assertEquals(calls.length, 1);
    assertEquals(calls[0].url, "http://custom-host:9999/inference");
  } finally {
    restore();
  }
});

Deno.test("WhisperStt.transcribe: FormData に response_format=json が含まれること", async () => {
  const { calls, restore } = captureFetch(okResponse("ok"));
  try {
    const stt = new WhisperStt({ baseUrl: "http://localhost:8178" });
    await stt.transcribe(Buffer.alloc(100));
    assertEquals(calls[0].body.get("response_format"), "json");
    assertEquals(calls[0].body.get("suppress_non_speech_tokens"), "true");
  } finally {
    restore();
  }
});

Deno.test("WhisperStt.transcribe: FormData に WAV ファイルが添付されること", async () => {
  const { calls, restore } = captureFetch(okResponse("ok"));
  try {
    const stt = new WhisperStt({ baseUrl: "http://localhost:8178" });
    await stt.transcribe(Buffer.alloc(100));
    const file = calls[0].body.get("file") as File;
    assertEquals(file.name, "audio.wav");
    assertEquals(file.type, "audio/wav");
    // 44 (WAV ヘッダ) + 100 (PCM データ)
    assertEquals(file.size, 144);
  } finally {
    restore();
  }
});
