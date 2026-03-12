import { assertEquals } from "@std/assert";
import { loadConfig } from "./config.ts";

/**
 * 環境変数を一時的に設定し、テスト後に元に戻すヘルパー。
 */
function withEnv(
  vars: Record<string, string>,
  fn: () => void,
): void {
  const original: Record<string, string | undefined> = {};
  for (const key of Object.keys(vars)) {
    original[key] = Deno.env.get(key);
    Deno.env.set(key, vars[key]);
  }
  try {
    fn();
  } finally {
    for (const [key, val] of Object.entries(original)) {
      if (val === undefined) {
        Deno.env.delete(key);
      } else {
        Deno.env.set(key, val);
      }
    }
  }
}

const REQUIRED_VARS = {
  DISCORD_TOKEN: "test-token",
  GUILD_ID: "123456",
};

Deno.test("loadConfig: 必須変数がすべて設定されている場合に正しい値を返すこと", () => {
  withEnv(
    {
      ...REQUIRED_VARS,
      WHISPER_URL: "http://whisper:9999",
      OPENAI_TTS_URL: "http://tts:7777",
      OPENAI_TTS_API_KEY: "sk-tts",
      OPENAI_TTS_MODEL: "tts-model",
      OPENAI_TTS_SPEAKER: "42",
      OPENAI_TTS_SPEED: "1.5",
      OPENAI_LLM_URL: "http://llm:5555",
      OPENAI_LLM_API_KEY: "sk-test",
      OPENAI_LLM_MODEL: "test-model",
      SYSTEM_PROMPT: "テスト用プロンプト",
      MIN_SPEECH_MS: "300",
      SPEECH_RMS: "150",
      INTERRUPT_RMS: "600",
    },
    () => {
      const config = loadConfig();
      assertEquals(config.discordToken, "test-token");
      assertEquals(config.guildId, "123456");
      assertEquals(config.voice, {
        minSpeechMs: 300,
        speechRms: 150,
        interruptRms: 600,
      });
      assertEquals(config.stt, {
        type: "whisper",
        config: { baseUrl: "http://whisper:9999" },
      });
      assertEquals(config.tts, {
        type: "openai",
        config: {
          baseUrl: "http://tts:7777",
          apiKey: "sk-tts",
          model: "tts-model",
          voice: "42",
          speed: 1.5,
        },
      });
      assertEquals(config.llm, {
        type: "openai",
        config: {
          baseUrl: "http://llm:5555",
          apiKey: "sk-test",
          model: "test-model",
          systemPrompt: "テスト用プロンプト",
        },
      });
    },
  );
});

Deno.test("loadConfig: オプション変数が未設定の場合にデフォルト値を返すこと", () => {
  // オプション変数を明示的に削除してからテスト
  const optionalKeys = [
    "WHISPER_URL",
    "OPENAI_TTS_URL",
    "OPENAI_TTS_API_KEY",
    "OPENAI_TTS_MODEL",
    "OPENAI_TTS_SPEAKER",
    "OPENAI_TTS_SPEED",
    "OPENAI_LLM_URL",
    "OPENAI_LLM_API_KEY",
    "OPENAI_LLM_MODEL",
    "SYSTEM_PROMPT",
    "MIN_SPEECH_MS",
    "SPEECH_RMS",
    "INTERRUPT_RMS",
  ];
  const saved: Record<string, string | undefined> = {};
  for (const key of optionalKeys) {
    saved[key] = Deno.env.get(key);
    Deno.env.delete(key);
  }

  try {
    withEnv(REQUIRED_VARS, () => {
      const config = loadConfig();
      assertEquals(config.voice, {
        minSpeechMs: 500,
        speechRms: 200,
        interruptRms: 500,
      });
      assertEquals(config.stt, {
        type: "whisper",
        config: { baseUrl: "" },
      });
      assertEquals(config.tts, {
        type: "openai",
        config: {
          baseUrl: "",
          apiKey: undefined,
          model: "",
          voice: "1",
          speed: 1,
        },
      });
      assertEquals(config.llm, {
        type: "openai",
        config: {
          baseUrl: "",
          apiKey: undefined,
          model: "",
          systemPrompt: undefined,
        },
      });
    });
  } finally {
    for (const [key, val] of Object.entries(saved)) {
      if (val !== undefined) Deno.env.set(key, val);
    }
  }
});
