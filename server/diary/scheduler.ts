import { config } from '../config'
import { listDeviceTokens } from '../store/device'
import { readDiarySettings, readPlan, removePlan, writePlan, type DiaryPlan } from '../store/diary'
import { assertUser, type UserName } from '../store/paths'
import { diaryDateOf, dueSlot, fillPlan, newPlan, weekdayOf } from './clock'
import { askQuestion, proposeProfile, writeDiary } from './jobs'

/** 見回りの間隔。時刻は分単位で選ぶので、一分ごとに見れば足りる。 */
const TICK_MS = 60 * 1000

/** 同じ人の見回りを重ねない。問いかけを書いている間に次の見回りが来ることがある。 */
const running = new Set<string>()

/**
 * 日付が変わった（4 時を過ぎた）ら、前の日の日記を書き、日曜なら直し案も作る。
 * 予定は聞く人の分だけ作り直し、聞かない人の分は消す。
 */
async function rollOver(user: UserName, plan: DiaryPlan, today: string): Promise<void> {
  await writeDiary(user, plan.date).catch((error) => console.error('[diary] 日記を書けませんでした', error))
  if (weekdayOf(today) === 0) {
    await proposeProfile(user, today).catch((error) =>
      console.error('[diary] profile の直し案を作れませんでした', error),
    )
  }
  await removePlan(user)
}

export async function tickUser(user: UserName, now = new Date()): Promise<void> {
  const today = diaryDateOf(now)
  let plan = await readPlan(user)
  if (plan && plan.date !== today) {
    await rollOver(user, plan, today)
    plan = null
  }

  const settings = await readDiarySettings(user)
  if (!settings.enabled) return
  // Android のシェルを入れていない人には届かない。予定も作らない。
  if ((await listDeviceTokens(user)).length === 0) return

  if (!plan) {
    plan = newPlan(today, settings, now)
    await writePlan(user, plan)
  } else if (!plan.planned) {
    // 「今すぐ聞く」だけで予定ができた日。時刻を選ばないままだと、その日はもう聞かない。
    plan = fillPlan(plan, settings, now)
    await writePlan(user, plan)
  }

  const { due, late } = dueSlot(plan, now)
  if (!due && late.length === 0) return

  for (const slot of late) slot.state = 'skipped'
  // 先に書き戻してから聞く。問いかけが長引いても、次の見回りが同じ時刻で二度聞かない。
  if (due) due.state = 'asked'
  await writePlan(user, plan)
  if (due) await askQuestion(user, now)
}

/** 設定を変えた日は、まだ来ていない時刻だけ選び直す。 */
export async function replan(user: UserName, now = new Date()): Promise<void> {
  const plan = await readPlan(user)
  if (!plan || plan.date !== diaryDateOf(now)) return
  await writePlan(user, fillPlan(plan, await readDiarySettings(user), now))
}

/** 人ごとに走らせる。一人の問いかけが長引いても、ほかの人の時刻は遅らせない。 */
function tick(): void {
  const now = new Date()
  for (const name of config.users) {
    if (running.has(name)) continue
    running.add(name)
    void tickUser(assertUser(name), now)
      .catch((error) => console.error(`[diary] ${name} の見回りで失敗しました`, error))
      .finally(() => running.delete(name))
  }
}

/**
 * 見回りを始める。手元の dev は本番の写しを見ていて、写しには家族の端末も入っている。
 * そこから鳴らさないよう、本番以外では DIARY_SCHEDULER を立てたときだけ動かす。
 */
export function startDiaryScheduler(): void {
  if (!config.diaryScheduler) {
    console.log('  diary    : 見回りは止めてある（DIARY_SCHEDULER）')
    return
  }
  setInterval(tick, TICK_MS)
  tick()
}
