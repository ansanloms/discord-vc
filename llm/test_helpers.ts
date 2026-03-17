/**
 * LLM テスト用の共有ヘルパー。
 */

/**
 * AsyncGenerator の全 yield 値を配列に収集する。
 */
export async function collectAll(
  gen: AsyncGenerator<string>,
): Promise<string[]> {
  const results: string[] = [];
  for await (const chunk of gen) {
    results.push(chunk);
  }
  return results;
}

/**
 * AsyncGenerator の全 yield 値を結合して 1 つの文字列にする。
 */
export async function collectJoined(
  gen: AsyncGenerator<string>,
): Promise<string> {
  return (await collectAll(gen)).join("");
}
