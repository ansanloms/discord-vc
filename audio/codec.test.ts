import { assertAlmostEquals, assertEquals } from "@std/assert";
import { Buffer } from "node:buffer";
import { calcRms, pcmToWav } from "./codec.ts";

Deno.test("pcmToWav: WAV ヘッダが正しい構造となること", () => {
  const pcm = Buffer.alloc(100, 0);
  const wav = pcmToWav(pcm);

  // 合計サイズ: 44 (ヘッダ) + 100 (データ)
  assertEquals(wav.length, 144);

  // RIFF マーカー
  assertEquals(wav.subarray(0, 4).toString("ascii"), "RIFF");

  // チャンクサイズ = 36 + dataSize
  assertEquals(wav.readUInt32LE(4), 136);

  // WAVE マーカー
  assertEquals(wav.subarray(8, 12).toString("ascii"), "WAVE");

  // fmt サブチャンクマーカー
  assertEquals(wav.subarray(12, 16).toString("ascii"), "fmt ");

  // サブチャンクサイズ = 16
  assertEquals(wav.readUInt32LE(16), 16);

  // オーディオフォーマット = 1 (PCM)
  assertEquals(wav.readUInt16LE(20), 1);

  // チャンネル数 = 1 (モノラル)
  assertEquals(wav.readUInt16LE(22), 1);

  // サンプルレート = 48000
  assertEquals(wav.readUInt32LE(24), 48000);

  // バイトレート = 48000 * 1 * 2 = 96000
  assertEquals(wav.readUInt32LE(28), 96000);

  // ブロックアライン = 1 * 2 = 2
  assertEquals(wav.readUInt16LE(32), 2);

  // ビット深度 = 16
  assertEquals(wav.readUInt16LE(34), 16);

  // data マーカー
  assertEquals(wav.subarray(36, 40).toString("ascii"), "data");

  // データサイズ
  assertEquals(wav.readUInt32LE(40), 100);
});

Deno.test("pcmToWav: PCM ペイロードがそのまま保持されること", () => {
  const pcm = Buffer.from([1, 2, 3, 4]);
  const wav = pcmToWav(pcm);
  assertEquals(Array.from(wav.subarray(44)), [1, 2, 3, 4]);
});

Deno.test("calcRms: 無音の場合に 0 を返すこと", () => {
  const pcm = Buffer.alloc(20, 0);
  assertEquals(calcRms(pcm), 0);
});

Deno.test("calcRms: 最大振幅の場合に 32767 を返すこと", () => {
  const samples = 100;
  const pcm = Buffer.alloc(samples * 2);
  for (let i = 0; i < samples; i++) {
    pcm.writeInt16LE(32767, i * 2);
  }
  assertAlmostEquals(calcRms(pcm), 32767, 1);
});

Deno.test("calcRms: 混合値で正しい RMS を返すこと", () => {
  // サンプル [3, 4] → RMS = sqrt((9+16)/2) = sqrt(12.5)
  const pcm = Buffer.alloc(4);
  pcm.writeInt16LE(3, 0);
  pcm.writeInt16LE(4, 2);
  assertAlmostEquals(calcRms(pcm), Math.sqrt(12.5), 0.001);
});
