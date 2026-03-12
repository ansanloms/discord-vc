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
audio/         # PCM/WAV コーデックユーティリティ、音声再生キュー
stt/           # 音声認識インターフェース + Whisper 実装
tts/           # 音声合成インターフェース + OpenAI 互換 API 実装
llm/           # 言語モデルインターフェース + OpenAI 互換 API 実装
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

| 変数                 | 必須 | デフォルト | 説明                                    |
| -------------------- | ---- | ---------- | --------------------------------------- |
| `DISCORD_TOKEN`      | ✓    | —          | Discord bot トークン                    |
| `GUILD_ID`           | ✓    | —          | ギルド（サーバー）ID                    |
| `WHISPER_URL`        |      | —          | whisper.cpp STT サーバー URL            |
| `OPENAI_TTS_URL`     |      | —          | OpenAI 互換 TTS サーバー URL            |
| `OPENAI_TTS_API_KEY` |      | —          | TTS サーバーの API キー                 |
| `OPENAI_TTS_MODEL`   |      | —          | TTS モデル名                            |
| `OPENAI_TTS_SPEAKER` |      | `1`        | TTS スピーカー識別子                    |
| `OPENAI_TTS_SPEED`   |      | `1`        | TTS 再生速度                            |
| `OPENAI_LLM_URL`     |      | —          | OpenAI 互換 LLM サーバー URL            |
| `OPENAI_LLM_API_KEY` |      | —          | LLM サーバーの API キー                 |
| `OPENAI_LLM_MODEL`   |      | —          | LLM モデル名                            |
| `SYSTEM_PROMPT`      |      | —          | LLM に渡すシステムプロンプト            |
| `MIN_SPEECH_MS`      |      | `500`      | STT に送る最小発話時間（ミリ秒）        |
| `SPEECH_RMS`         |      | `200`      | 発話とみなす最小 RMS 振幅               |
| `INTERRUPT_RMS`      |      | `500`      | AI の再生を中断する最小 RMS 振幅        |
| `AUTO_LEAVE_MS`      |      | `600000`   | 自動退出までの時間（ms）。-1 で無効     |
| `LOG_LEVEL`          |      | `INFO`     | ログレベル: DEBUG / INFO / WARN / ERROR |
