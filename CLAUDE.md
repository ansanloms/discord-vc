# discord-vc

## 開発

### リント・フォーマット

コミット前に必ず実行すること:

```sh
deno fmt                  # フォーマット
deno lint                 # リント
deno check **/*.ts        # 型チェック
```

### テスト

```sh
deno task test
```

### 実行

```sh
cp .env.example .env
# .env を埋める
deno task start
```

## プロジェクト構成

```
config/        # システムプロンプト等の設定ファイル
audio/         # PCM/WAV コーデックユーティリティ、音声再生キュー
stt/           # 音声認識インターフェース + Whisper 実装
tts/           # 音声合成インターフェース + OpenAI 互換 API 実装
llm/           # 言語モデルインターフェース + Claude / Ollama 実装
logger.ts      # 軽量構造化ロガー（LOG_LEVEL 環境変数で制御）
config.ts      # 環境変数の読み込み
services.ts    # サービスファクトリファサード
bot.ts         # Discord クライアント + 音声パイプライン制御
main.ts        # エントリポイント — 依存の組み立て
```

## コーディング規約

- コメント・JSDoc は原則日本語で記述する
- テストファイル名は `*.test.ts` とする
- ログ出力は `logger.ts` の `createLogger()` を使い、`console.xxx` を直接使わない

## 環境変数

### Discord（必須）

| 変数            | デフォルト | 説明                 |
| --------------- | ---------- | -------------------- |
| `DISCORD_TOKEN` | —          | Discord bot トークン |
| `GUILD_ID`      | —          | ギルド（サーバー）ID |

### STT（whisper.cpp）

| 変数          | デフォルト | 説明                     |
| ------------- | ---------- | ------------------------ |
| `WHISPER_URL` | —          | whisper.cpp サーバー URL |

### TTS（OpenAI 互換 API）

| 変数                 | デフォルト | 説明                    |
| -------------------- | ---------- | ----------------------- |
| `OPENAI_TTS_URL`     | —          | TTS サーバー URL        |
| `OPENAI_TTS_API_KEY` | —          | TTS サーバーの API キー |
| `OPENAI_TTS_MODEL`   | —          | TTS モデル名            |
| `OPENAI_TTS_SPEAKER` | `1`        | スピーカー識別子        |
| `OPENAI_TTS_SPEED`   | `1`        | 再生速度                |

### LLM

`LLM_TYPE` でバックエンドを選択する（デフォルト: `openai`）。

| 変数                 | デフォルト                | 説明                                                   |
| -------------------- | ------------------------- | ------------------------------------------------------ |
| `LLM_TYPE`           | `claude`                  | LLM バックエンド: `claude` / `ollama`                  |
| `SYSTEM_PROMPT_FILE` | `config/SYSTEM_PROMPT.md` | システムプロンプトファイルのパス                       |
| `MESSAGE_TEMPLATE`   | —                         | ユーザーメッセージのテンプレート（未設定時は変換なし） |

#### Claude（`LLM_TYPE=claude`）

| 変数                     | デフォルト                  | 説明                         |
| ------------------------ | --------------------------- | ---------------------------- |
| `CLAUDE_API_KEY`         | —                           | Claude API キー              |
| `CLAUDE_MODEL`           | `claude-haiku-4-5-20251001` | モデル名                     |
| `CLAUDE_MAX_TOKENS`      | `1024`                      | レスポンスの最大トークン数   |
| `CLAUDE_MAX_TOOL_ROUNDS` | `5`                         | ツール呼び出し最大ラウンド数 |

#### Ollama（`LLM_TYPE=ollama`）

| 変数                     | デフォルト               | 説明                         |
| ------------------------ | ------------------------ | ---------------------------- |
| `OLLAMA_HOST`            | `http://localhost:11434` | Ollama サーバー URL          |
| `OLLAMA_MODEL`           | —                        | モデル名                     |
| `OLLAMA_MAX_TOOL_ROUNDS` | `5`                      | ツール呼び出し最大ラウンド数 |

### 音声パイプライン

| 変数                 | デフォルト | 説明                                       |
| -------------------- | ---------- | ------------------------------------------ |
| `MIN_SPEECH_MS`      | `500`      | STT に送る最小発話時間（ミリ秒）           |
| `SPEECH_RMS`         | `200`      | 発話とみなす最小 RMS 振幅                  |
| `INTERRUPT_RMS`      | `500`      | AI の再生を中断する最小 RMS 振幅           |
| `AUTO_LEAVE_MS`      | `600000`   | 自動退出までの時間（ms）。-1 で無効        |
| `SPEECH_DEBOUNCE_MS` | `500`      | 連続発話をまとめるデバウンス待機時間（ms） |
| `NOTIFICATION_TONE`  | `true`     | 通知トーン（処理中・エラー）の有効/無効    |

### その他

| 変数        | デフォルト | 説明                                    |
| ----------- | ---------- | --------------------------------------- |
| `LOG_LEVEL` | `INFO`     | ログレベル: DEBUG / INFO / WARN / ERROR |
