import { config } from '../config'
import { listDeviceTokens } from '../store/device'
import { readDiarySettings, readPlan, removePlan, writePlan, type DiaryPlan } from '../store/diary'
import { assertUser, type UserName } from '../store/paths'
import { localTime } from '../../shared/date'
import { diaryDateOf, dueSlot, fillPlan, newPlan, weekdayOf } from './clock'
import { askQuestion, proposeProfile, writeDiary } from './jobs'

/** 見回りの間隔。時刻は分単位で選ぶので、一分ごとに見れば足りる。 */
const TICK_MS = 60 * 1000

/** 予定をログに残す一行。「09:58 飛ばした / 14:38 これから」。 */
function describe(plan: DiaryPlan): string {
  const label = { pending: 'これから', asked: '聞いた', skipped: '飛ばした' } as const
  const slots = plan.slots.map((slot) => `${localTime(new Date(slot.at))} ${label[slot.state]}`)
  return `${plan.date} [${slots.join(' / ') || '時刻なし'}]`
}

/** 同じ人の見回りを重ねない。問いかけを書いている間に次の見回りが来ることがある。 */
const running = new Set<string>()

/**
 * 日付が変わった（4 時を過ぎた）ら、前の日の日記を書き、日曜なら直し案も作る。
 * 予定は聞く人の分だけ作り直し、聞かない人の分は消す。
 */
async function rollOver(user: UserName, plan: DiaryPlan, today: string): Promise<void> {
  console.log(`[diary] ${user} の ${plan.date} を締める: ${describe(plan)}`)
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
    console.log(`[diary] ${user} の予定を作った: ${describe(plan)}`)
  } else if (!plan.planned) {
    // 「今すぐ聞く」だけで予定ができた日。時刻を選ばないままだと、その日はもう聞かない。
    plan = fillPlan(plan, settings, now)
    await writePlan(user, plan)
    console.log(`[diary] ${user} の予定に時刻を選び足した: ${describe(plan)}`)
  }

  const { due, late } = dueSlot(plan, now)
  if (!due && late.length === 0) return

  for (const slot of late) {
    slot.state = 'skipped'
    // 遅れて見つけた時刻。見回りが止まっていたか、サーバーが落ちていた間に過ぎている。
    console.warn(`[diary] ${user} の ${localTime(new Date(slot.at))} は ${localTime(now)} まで見回れんかったので飛ばした`)
  }
  if (due) console.log(`[diary] ${user} の ${localTime(new Date(due.at))} の分を聞く`)
  // 先に書き戻してから聞く。問いかけが長引いても、次の見回りが同じ時刻で二度聞かない。
  if (due) due.state = 'asked'
  await writePlan(user, plan)
  if (due) await askQuestion(user, now)
}

/** 設定を変えた日は、まだ来ていない時刻だけ選び直す。 */
export async function replan(user: UserName, now = new Date()): Promise<void> {
  const plan = await readPlan(user)
  if (!plan || plan.date !== diaryDateOf(now)) return
  const next = fillPlan(plan, await readDiarySettings(user), now)
  await writePlan(user, next)
  console.log(`[diary] ${user} の設定が変わったので選び直した: ${describe(next)}`)
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
  console.log('  diary    : 一分ごとに見回る')
  setInterval(tick, TICK_MS)
  tick()
}
