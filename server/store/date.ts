/**
 * ログのファイル名と表示に使う日付。どちらも TZ 環境変数に従う。
 * 区切りを変えると過去のログとずれるので、動かす機械では TZ を固定する。
 */

/** TZ に従った YYYY-MM-DD。sv-SE ロケールがこの形を返す。 */
export function localDate(at: Date = new Date()): string {
  return at.toLocaleDateString('sv-SE')
}

export function localTime(at: Date): string {
  return at.toLocaleTimeString('sv-SE', { hour: '2-digit', minute: '2-digit' })
}

/** ログのファイル名に使う YYYYMMDD。 */
export function stamp(date: string): string {
  return date.replaceAll('-', '')
}
