/**
 * システムプロンプトの動的読み込みユーティリティ。
 *
 * ファイルパスパターンの配列を受け取り、テンプレート変数を解決してからファイルを読み込む。
 * 複数ファイルの内容は空行区切りで結合する。
 */

import { replaceTemplateVariables } from "./template.ts";

/** テンプレート変数の未解決パターン。 */
const UNRESOLVED_PATTERN = /\{\{[\w.]+\}\}/;

/**
 * システムプロンプトファイルパターンを解決し、内容を結合して返す。
 *
 * 1. 各パスの `{{KEY}}` をコンテキストで置換する。
 * 2. 未解決の変数が残るパスはスキップする。
 * 3. ファイルを読み込み、NotFound はスキップする。
 * 4. 読み込んだ内容を `\n\n` で結合する。
 *
 * @param filePatterns - ファイルパスパターンの配列。
 * @param context - テンプレート変数のコンテキスト。
 * @returns 結合されたシステムプロンプト文字列。全スキップ時は undefined。
 */
export async function resolveSystemPrompt(
  filePatterns: string[],
  context: Record<string, string>,
): Promise<string | undefined> {
  const parts: string[] = [];

  for (const pattern of filePatterns) {
    const resolvedPath = replaceTemplateVariables(pattern, context);

    // 未解決のテンプレート変数が残っていればスキップ
    if (UNRESOLVED_PATTERN.test(resolvedPath)) {
      continue;
    }

    try {
      const content = (await Deno.readTextFile(resolvedPath)).trim();
      if (content.length > 0) {
        parts.push(content);
      }
    } catch (e: unknown) {
      if (!(e instanceof Deno.errors.NotFound)) {
        throw e;
      }
    }
  }

  return parts.length > 0 ? parts.join("\n\n") : undefined;
}
