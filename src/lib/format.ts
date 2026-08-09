const TIME = new Intl.DateTimeFormat('ja-JP', { hour: '2-digit', minute: '2-digit', hour12: false })
const DAY = new Intl.DateTimeFormat('ja-JP', { month: 'long', day: 'numeric', weekday: 'short' })

export function timeLabel(iso: string): string {
  return TIME.format(new Date(iso))
}

export function dayKey(iso: string): string {
  return new Date(iso).toLocaleDateString('sv-SE')
}

/** 会話の区切りに出す見出し。今日と昨日は言葉で出す。 */
export function dayLabel(iso: string): string {
  const key = dayKey(iso)
  const today = new Date().toLocaleDateString('sv-SE')

  const yesterdayDate = new Date()
  yesterdayDate.setDate(yesterdayDate.getDate() - 1)
  const yesterday = yesterdayDate.toLocaleDateString('sv-SE')

  if (key === today) return '今日'
  if (key === yesterday) return '昨日'
  return DAY.format(new Date(iso))
}

/** 名前がまだ付いていないトピックの見出し。 */
export const NO_NAME = '名前のない話'

export function topicLabel(topic: { name: string }): string {
  return topic.name || NO_NAME
}

/** 一覧に出す「いつ話したか」。 */
export function relativeLabel(iso: string | null): string {
  if (!iso) return ''
  const key = dayKey(iso)
  const today = new Date().toLocaleDateString('sv-SE')
  if (key === today) return timeLabel(iso)
  return DAY.format(new Date(iso))
}
