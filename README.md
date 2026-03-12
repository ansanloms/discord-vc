# discord-vc

A Discord voice channel bot that listens to speech, transcribes it, generates a response via LLM, and plays back synthesized audio.

## Pipeline

```
Discord Voice Channel
  -> Opus decode (opusscript)
  -> PCM buffer
  -> Noise / length filter
  -> STT (whisper.cpp)
  -> LLM (OpenAI-compatible API)
  -> TTS (OpenAI-compatible API)
  -> Audio playback (@discordjs/voice)
```

## Requirements

- [Deno](https://deno.land/) v2+
- [whisper.cpp](https://github.com/ggml-org/whisper.cpp) server for STT
- OpenAI-compatible TTS server (e.g. [voicevox-openai-tts](https://github.com/nichiki/voicevox-openai-tts))
- OpenAI-compatible LLM server (e.g. Ollama, OpenClaw)

## Setup

```sh
cp .env.example .env
# Edit .env with your values
```

See [.env.example](.env.example) for all available environment variables.

## Usage

```sh
deno task start
```

### Slash Commands

All commands use the `/aivc` prefix and are registered as guild commands on bot startup.

| Command                | Description                                    |
| ---------------------- | ---------------------------------------------- |
| `/aivc join`           | Join the voice channel (run from VC text chat) |
| `/aivc leave`          | Disconnect from the voice channel              |
| `/aivc ping`           | Health check (replies with "pong")             |
| `/aivc message <text>` | Send text to LLM and speak the response        |
| `/aivc clear history`  | Clear LLM conversation history                 |

Commands that operate on the current voice session (`leave`, `ping`, `message`) must be run from the text chat of the VC the bot is in.

### Auto Leave

When all members leave the voice channel, the bot will automatically disconnect after a configurable timeout (default: 10 minutes). Set `AUTO_LEAVE_MS=-1` to disable.

## Development

```sh
deno fmt                  # Format
deno lint                 # Lint
deno check **/*.ts        # Type check
deno task test            # Run tests
```

## Project Structure

```
audio/         PCM/WAV codec utilities, audio playback queue
stt/           Speech-to-text interface + Whisper implementation
tts/           Text-to-speech interface + OpenAI-compatible API implementation
llm/           Language model interface + OpenAI-compatible API implementation
logger.ts      Lightweight structured logger (controlled by LOG_LEVEL)
config.ts      Environment variable loading with discriminated union config
services.ts    Service factory facade
bot.ts         Discord client + voice pipeline orchestration
main.ts        Entry point — dependency wiring
```

## Architecture

STT, TTS, and LLM backends are abstracted behind interfaces (`SpeechToText`, `TextToSpeech`, `LanguageModel`), making them swappable.

The `Config` type uses discriminated unions (`{ type, config }`) for each backend, and `services.ts` acts as a factory facade that switches on the `type` field to instantiate the correct implementation. To add a new backend, add a union variant to `config.ts` and a `case` to `services.ts`.

## Environment Variables

| Variable             | Required | Default  | Description                            |
| -------------------- | -------- | -------- | -------------------------------------- |
| `DISCORD_TOKEN`      | Yes      | —        | Discord bot token                      |
| `GUILD_ID`           | Yes      | —        | Guild (server) ID                      |
| `WHISPER_URL`        |          | —        | whisper.cpp STT server URL             |
| `OPENAI_TTS_URL`     |          | —        | OpenAI-compatible TTS server URL       |
| `OPENAI_TTS_API_KEY` |          | —        | TTS server API key                     |
| `OPENAI_TTS_MODEL`   |          | —        | TTS model name                         |
| `OPENAI_TTS_SPEAKER` |          | `1`      | TTS speaker identifier                 |
| `OPENAI_TTS_SPEED`   |          | `1`      | TTS playback speed                     |
| `OPENAI_LLM_URL`     |          | —        | OpenAI-compatible LLM server URL       |
| `OPENAI_LLM_API_KEY` |          | —        | LLM server API key                     |
| `OPENAI_LLM_MODEL`   |          | —        | LLM model name                         |
| `SYSTEM_PROMPT`      |          | —        | System prompt for LLM (omit to skip)   |
| `MIN_SPEECH_MS`      |          | `500`    | Min speech duration (ms) sent to STT   |
| `SPEECH_RMS`         |          | `200`    | Min RMS amplitude to count as speech   |
| `INTERRUPT_RMS`      |          | `500`    | Min RMS amplitude to interrupt AI      |
| `AUTO_LEAVE_MS`      |          | `600000` | Auto-leave timeout (ms). -1 to disable |
| `LOG_LEVEL`          |          | `INFO`   | Log level: DEBUG / INFO / WARN / ERROR |
