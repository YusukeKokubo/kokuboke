/**
 * ログのファイル名と表示に使う日付。
 * サーバーでは TZ 環境変数に従い、画面では端末のタイムゾーンに従う。
 * それぞれの土地の時刻で整形するのが正しいので、両者を揃えなくてよい。
 * 区切りを変えると過去のログとずれるので、動かす機械では TZ を固定する。
 */

/** YYYY-MM-DD。sv-SE ロケールがこの形を返す。 */
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
