/**
 * テンプレート変数の置換ユーティリティ。
 *
 * `{{KEY}}` 形式のプレースホルダを、与えられた変数マップの値で置換する。
 * 変数マップに存在しないキーはそのまま残す。
 */

/**
 * テンプレート文字列中の `{{KEY}}` を `vars[KEY]` で置換する。
 *
 * @param template - プレースホルダを含むテンプレート文字列。
 * @param vars - キーと置換値のマップ。
 * @returns 置換後の文字列。
 */
export function replaceTemplateVariables(
  template: string,
  vars: Record<string, string>,
): string {
  return template.replace(/\{\{([\w.]+)\}\}/g, (match, key: string) => {
    return key in vars ? vars[key] : match;
  });
}
