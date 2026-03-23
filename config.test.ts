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
  const tmpFile = Deno.makeTempFileSync({ suffix: ".md" });
  Deno.writeTextFileSync(tmpFile, "テスト用プロンプト\n");

  try {
    withEnv(
      {
        ...REQUIRED_VARS,
        WHISPER_URL: "http://whisper:9999",
        OPENAI_TTS_URL: "http://tts:7777",
        OPENAI_TTS_API_KEY: "sk-tts",
        OPENAI_TTS_MODEL: "tts-model",
        OPENAI_TTS_SPEAKER: "42",
        OPENAI_TTS_SPEED: "1.5",
        CLAUDE_API_KEY: "sk-test",
        CLAUDE_MODEL: "test-model",
        SYSTEM_PROMPT_FILE: tmpFile,
        MIN_SPEECH_MS: "300",
        SPEECH_RMS: "150",
        INTERRUPT_RMS: "600",
        AUTO_LEAVE_MS: "300000",
        SPEECH_DEBOUNCE_MS: "250",
      },
      () => {
        const config = loadConfig();
        assertEquals(config.discordToken, "test-token");
        assertEquals(config.guildId, "123456");
        assertEquals(config.voice, {
          minSpeechMs: 300,
          speechRms: 150,
          interruptRms: 600,
          autoLeaveMs: 300000,
          speechDebounceMs: 250,
          notificationTone: true,
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
          type: "claude",
          config: {
            apiKey: "sk-test",
            model: "test-model",
            systemPrompt: "テスト用プロンプト",
            maxTokens: 1024,
            maxToolRounds: 5,
          },
        });
      },
    );
  } finally {
    Deno.removeSync(tmpFile);
  }
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
    "CLAUDE_API_KEY",
    "CLAUDE_MODEL",
    "CLAUDE_MAX_TOKENS",
    "CLAUDE_MAX_TOOL_ROUNDS",
    "SYSTEM_PROMPT_FILE",
    "MIN_SPEECH_MS",
    "SPEECH_RMS",
    "INTERRUPT_RMS",
    "AUTO_LEAVE_MS",
  ];
  const saved: Record<string, string | undefined> = {};
  for (const key of optionalKeys) {
    saved[key] = Deno.env.get(key);
    Deno.env.delete(key);
  }

  try {
    withEnv({
      ...REQUIRED_VARS,
      SYSTEM_PROMPT_FILE: "__nonexistent__/SYSTEM_PROMPT.md",
    }, () => {
      const config = loadConfig();
      assertEquals(config.voice, {
        minSpeechMs: 500,
        speechRms: 200,
        interruptRms: 500,
        autoLeaveMs: 600000,
        speechDebounceMs: 500,
        notificationTone: true,
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
        type: "claude",
        config: {
          apiKey: undefined,
          model: "claude-haiku-4-5-20251001",
          systemPrompt: undefined,
          maxTokens: 1024,
          maxToolRounds: 5,
        },
      });
    });
  } finally {
    for (const [key, val] of Object.entries(saved)) {
      if (val !== undefined) {
        Deno.env.set(key, val);
      }
    }
  }
});

Deno.test("loadConfig: SYSTEM_PROMPT_FILE で指定したファイルからシステムプロンプトを読み込むこと", () => {
  const tmpFile = Deno.makeTempFileSync({ suffix: ".md" });
  Deno.writeTextFileSync(tmpFile, "ファイルからのプロンプト\n");

  try {
    withEnv(
      {
        ...REQUIRED_VARS,
        SYSTEM_PROMPT_FILE: tmpFile,
      },
      () => {
        const config = loadConfig();
        assertEquals(
          config.llm.config.systemPrompt,
          "ファイルからのプロンプト",
        );
      },
    );
  } finally {
    Deno.removeSync(tmpFile);
  }
});

Deno.test("loadConfig: SYSTEM_PROMPT_FILE が存在しない場合に undefined を返すこと", () => {
  withEnv(
    {
      ...REQUIRED_VARS,
      SYSTEM_PROMPT_FILE: "__nonexistent__/SYSTEM_PROMPT.md",
    },
    () => {
      const config = loadConfig();
      assertEquals(config.llm.config.systemPrompt, undefined);
    },
  );
});

Deno.test("loadConfig: AUTO_JOIN_VC 未設定の場合に false を返すこと", () => {
  const saved = Deno.env.get("AUTO_JOIN_VC");
  Deno.env.delete("AUTO_JOIN_VC");
  try {
    withEnv(REQUIRED_VARS, () => {
      const config = loadConfig();
      assertEquals(config.autoJoinVc, false);
    });
  } finally {
    if (saved !== undefined) {
      Deno.env.set("AUTO_JOIN_VC", saved);
    }
  }
});

Deno.test("loadConfig: AUTO_JOIN_VC=false の場合に false を返すこと", () => {
  withEnv({ ...REQUIRED_VARS, AUTO_JOIN_VC: "false" }, () => {
    const config = loadConfig();
    assertEquals(config.autoJoinVc, false);
  });
});

Deno.test("loadConfig: AUTO_JOIN_VC=true の場合に true を返すこと", () => {
  withEnv({ ...REQUIRED_VARS, AUTO_JOIN_VC: "true" }, () => {
    const config = loadConfig();
    assertEquals(config.autoJoinVc, true);
  });
});

Deno.test("loadConfig: AUTO_JOIN_VC にカンマ区切りチャンネル ID を指定した場合に string[] を返すこと", () => {
  withEnv(
    { ...REQUIRED_VARS, AUTO_JOIN_VC: "111111111111111111,222222222222222222" },
    () => {
      const config = loadConfig();
      assertEquals(config.autoJoinVc, [
        "111111111111111111",
        "222222222222222222",
      ]);
    },
  );
});

Deno.test("loadConfig: AUTO_JOIN_VC のカンマ区切りで空要素が除去されること", () => {
  withEnv(
    { ...REQUIRED_VARS, AUTO_JOIN_VC: "111,,222, ,333" },
    () => {
      const config = loadConfig();
      assertEquals(config.autoJoinVc, ["111", "222", "333"]);
    },
  );
});
