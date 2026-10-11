import { localDate } from '../../shared/date'
import type { DiarySettings } from '../../shared/types'
import type { DiaryPlan, PlanSlot } from '../store/diary'

/**
 * 日記の一日の境目。夜更かしして返した答えを前の日に入れたいので、0 時ではなく 4 時で切る。
 * 日本には夏時間が無いので、4 時間ずらした時刻の日付をそのまま使える。
 */
export const DAY_START_HOUR = 4

/** 問いかけどうしの間。続けて二回鳴らないように。 */
export const MIN_GAP_MINUTES = 120

/** 止まっていた間に過ぎた時刻は、これ以上遅れていたら聞かずに捨てる。 */
export const LATE_LIMIT_MS = 30 * 60 * 1000

export function diaryDateOf(at: Date): string {
  return localDate(new Date(at.getTime() - DAY_START_HOUR * 60 * 60 * 1000))
}

/** 日記の日付の曜日。0 が日曜。 */
export function weekdayOf(date: string): number {
  return new Date(`${date}T12:00:00`).getDay()
}

/** その日の 0 時（その土地の時刻）。 */
function startOfDate(date: string): Date {
  return new Date(`${date}T00:00:00`)
}

/** YYYY-MM-DD の days 日前。 */
export function shiftDate(date: string, days: number): string {
  const at = new Date(`${date}T12:00:00`)
  at.setDate(at.getDate() + days)
  return localDate(at)
}

/**
 * 時間帯の中から、互いに MIN_GAP_MINUTES 以上離れた時刻を count 個選ぶ。
 * 間の分を先に取り除いてから残りの幅に一様に散らし、取り除いた間を戻す。
 * こうすると、どの並びも同じ確からしさで出て、間も必ず守られる。
 */
export function pickTimes(
  date: string,
  settings: Pick<DiarySettings, 'from' | 'to' | 'count'>,
  random: () => number = Math.random,
): Date[] {
  const width = (settings.to - settings.from) * 60
  let count = settings.count
  while (count > 1 && width - (count - 1) * MIN_GAP_MINUTES < 0) count--
  const slack = Math.max(0, width - (count - 1) * MIN_GAP_MINUTES)

  const offsets = Array.from({ length: count }, () => Math.floor(random() * slack)).sort(
    (a, b) => a - b,
  )
  const base = startOfDate(date).getTime() + settings.from * 60 * 60 * 1000
  return offsets.map((offset, i) => new Date(base + (offset + i * MIN_GAP_MINUTES) * 60 * 1000))
}

export function newPlan(
  date: string,
  settings: DiarySettings,
  now: Date,
  random: () => number = Math.random,
): DiaryPlan {
  // 昼過ぎに初めてオンにした日は、もう過ぎた時刻を最初から外す。過ぎたばかりの時刻を
  // 残すと、オンにした直後にいきなり鳴る。遅れて聞くのは、予定を作ったあとに止まっていた分だけ。
  const slots: PlanSlot[] = pickTimes(date, settings, random).map((at) => ({
    at: at.toISOString(),
    state: at.getTime() <= now.getTime() ? 'skipped' : 'pending',
  }))
  return { date, slots }
}

/**
 * いま聞くべき時刻。過ぎてから LATE_LIMIT_MS 以内のものだけ。
 * それより遅れたものは skipped にする（呼ぶ側が書き戻す）。
 */
export function dueSlot(plan: DiaryPlan, now: Date): { due: PlanSlot | null; late: PlanSlot[] } {
  const late: PlanSlot[] = []
  let due: PlanSlot | null = null
  for (const slot of plan.slots) {
    if (slot.state !== 'pending') continue
    const at = new Date(slot.at).getTime()
    if (at > now.getTime()) continue
    if (now.getTime() - at > LATE_LIMIT_MS) late.push(slot)
    else due ??= slot
  }
  return { due, late }
}
