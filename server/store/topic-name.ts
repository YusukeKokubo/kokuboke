/**
 * トピック名・予約ディレクトリ名の検査。config に依存しない。
 * config.ts と store/paths.ts の両方から見るため、ここに置く。
 */

// eslint-disable-next-line no-control-regex -- ファイル名に制御文字を入れないための検査
const FORBIDDEN = /[/\\:*?"<>|\u0000-\u001f\u007f]/
/** 落とすとき用。global な正規表現は test() で lastIndex が残るので分けて持つ。 */
export const FORBIDDEN_ALL = new RegExp(FORBIDDEN.source, 'g')

/** ext4 のファイル名は 255 バイトまで。日本語は 1 文字 3 バイトなので余裕を持たせる。 */
const MAX_BYTES = 180

/** 比較と保存の前に必ず通す。濁点の分かれた形（NFD）を合成済み（NFC）に寄せる。 */
export function normalizeTopicName(value: string): string {
  return value.normalize('NFC').trim()
}

export function isTopicName(value: string): boolean {
  const name = normalizeTopicName(value)
  if (!name || name === '.' || name === '..') return false
  // 先頭のドットは隠しファイル扱いになり、末尾のドットは SMB で落ちる。
  if (name.startsWith('.') || name.endsWith('.')) return false
  if (FORBIDDEN.test(name)) return false
  return Buffer.byteLength(name) <= MAX_BYTES
}
