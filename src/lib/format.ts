import { localDate } from '../../shared/date'
import { NO_NAME } from '../../shared/types'

const TIME = new Intl.DateTimeFormat('ja-JP', { hour: '2-digit', minute: '2-digit', hour12: false })
const DAY = new Intl.DateTimeFormat('ja-JP', { month: 'long', day: 'numeric', weekday: 'short' })

export { NO_NAME }

export function timeLabel(iso: string): string {
  return TIME.format(new Date(iso))
}

export function dayKey(iso: string): string {
  return localDate(new Date(iso))
}

/** 端末の「今日」「昨日」を一度だけ求める。dayLabel / relativeLabel で共有する。 */
function nearbyDays() {
  const today = localDate()
  const yesterdayDate = new Date()
  yesterdayDate.setDate(yesterdayDate.getDate() - 1)
  return { today, yesterday: localDate(yesterdayDate) }
}

/** 会話の区切りに出す見出し。今日と昨日は言葉で出す。 */
export function dayLabel(iso: string): string {
  const key = dayKey(iso)
  const { today, yesterday } = nearbyDays()

  if (key === today) return '今日'
  if (key === yesterday) return '昨日'
  return DAY.format(new Date(iso))
}

export function topicLabel(topic: { name: string }): string {
  return topic.name || NO_NAME
}

/** 一覧に出す「いつ話したか」。 */
export function relativeLabel(iso: string | null): string {
  if (!iso) return ''
  if (dayKey(iso) === nearbyDays().today) return timeLabel(iso)
  return DAY.format(new Date(iso))
}
