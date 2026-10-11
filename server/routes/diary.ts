import { Hono, type Context } from 'hono'
import type { DiaryAdminEntry, DiaryDay, DiaryEntry, ProfileProposal } from '../../shared/types'
import { applyProposal, askQuestion, proposeProfile, saveRecord, writeDiary } from '../diary/jobs'
import { diaryDateOf } from '../diary/clock'
import { replan } from '../diary/scheduler'
import { NotFoundError } from '../errors'
import { readJson, readText } from '../lib/body'
import { listDeviceTokens } from '../store/device'
import {
  assertDiaryDate,
  assertSettings,
  listEntries,
  readDiarySettings,
  readEntry,
  readPlan,
  readProposal,
  writeDiarySettings,
} from '../store/diary'
import { assertUser } from '../store/paths'
import { listDiaryTopics } from '../store/topic'
import { config } from '../config'
import { localTime } from '../../shared/date'
import { adminGuard } from './admin'
import { resolveSpace, spacePaths, type Space } from './space'

export const diary = new Hono()

/** 日記は個人だけ。共有スペースの経路は 404 にする。 */
function diarySpace(c: Context): Space {
  const space = resolveSpace(c)
  if (!space.diary) throw new NotFoundError('共有スペースに日記は無いよ')
  return space
}

function preview(text: string, length: number): string | null {
  const line = text.replace(/\s+/g, ' ').trim()
  return line ? line.slice(0, length) : null
}

/**
 * 聞いた日を新しい順に。答えの無かった日も、会話が残っていれば並べる。
 * 会話を消しても、書いた日記は残る。
 */
diary.on('GET', spacePaths('/diary'), async (c) => {
  const { user } = diarySpace(c)
  const days = new Map<string, DiaryDay>()
  for (const topic of await listDiaryTopics(user)) {
    days.set(topic.date, { date: topic.date, topic: topic.slug, answers: 0, firstAnswer: null, preview: null })
  }
  for (const entry of await listEntries(user)) {
    days.set(entry.date, {
      date: entry.date,
      topic: days.get(entry.date)?.topic ?? entry.topic,
      answers: entry.answers.length,
      firstAnswer: preview(entry.answers[0]?.text ?? '', 60),
      preview: preview(entry.record, 80),
    })
  }
  const list = [...days.values()].sort((a, b) => b.date.localeCompare(a.date))
  return c.json({ days: list, today: diaryDateOf(new Date()) })
})

diary.on('GET', spacePaths('/diary/:date'), async (c) => {
  const { user } = diarySpace(c)
  const date = assertDiaryDate(c.req.param('date') ?? '')
  const entry = await readEntry(user, date)
  const topic = (await listDiaryTopics(user)).find((item) => item.date === date)
  return c.json<{ entry: DiaryEntry | null; topic: string | null }>({
    entry,
    topic: topic?.slug ?? entry?.topic ?? null,
  })
})

diary.on('PUT', spacePaths('/diary/:date'), async (c) => {
  const { user } = diarySpace(c)
  const date = assertDiaryDate(c.req.param('date') ?? '')
  return c.json(await saveRecord(user, date, await readText(c.req.raw, 'record')))
})

/** 人が頼んだ書き直し。直した記録も書き直す。 */
diary.on('POST', spacePaths('/diary/:date/write'), async (c) => {
  const { user } = diarySpace(c)
  const date = assertDiaryDate(c.req.param('date') ?? '')
  const entry = await writeDiary(user, date, { force: true })
  if (!entry) throw new NotFoundError('この日はまだ答えが無いよ')
  return c.json(entry)
})

diary.on('GET', spacePaths('/profile/proposal'), async (c) => {
  const { user } = resolveSpace(c)
  return c.json<{ proposal: ProfileProposal | null }>({ proposal: await readProposal(user) })
})

/** 選んだ案を書く。何も選ばなければ全部見送り。 */
diary.on('POST', spacePaths('/profile/proposal/apply'), async (c) => {
  const { user } = resolveSpace(c)
  const body = await readJson<{ picked?: unknown }>(c.req.raw)
  const picked = Array.isArray(body.picked)
    ? body.picked.filter((id): id is string => typeof id === 'string')
    : []
  return c.json({ profile: await applyProposal(user, picked) })
})

// --- 管理画面 ---

diary.use('/api/admin/diary', adminGuard)
diary.use('/api/admin/diary/*', adminGuard)

diary.get('/api/admin/diary', async (c) => {
  const today = diaryDateOf(new Date())
  const entries: DiaryAdminEntry[] = []
  for (const name of config.users) {
    const user = assertUser(name)
    const plan = await readPlan(user)
    entries.push({
      user: name,
      settings: await readDiarySettings(user),
      hasDevice: (await listDeviceTokens(user)).length > 0,
      today:
        plan?.date === today
          ? plan.slots.map((slot) => ({ at: localTime(new Date(slot.at)), state: slot.state }))
          : [],
    })
  }
  return c.json({ entries, scheduler: config.diaryScheduler })
})

diary.put('/api/admin/diary/:user', async (c) => {
  const user = assertUser(c.req.param('user'))
  await writeDiarySettings(user, assertSettings(await readJson(c.req.raw)))
  await replan(user)
  return c.json({ settings: await readDiarySettings(user) })
})

/** 予定を待たずに一通送る。確かめるときと、聞き忘れた日のため。 */
diary.post('/api/admin/diary/:user/ask', async (c) => {
  const user = assertUser(c.req.param('user'))
  return c.json({ topic: await askQuestion(user, new Date(), { manual: true }) })
})

/** 日曜を待たずに直し案を作る。 */
diary.post('/api/admin/diary/:user/profile', async (c) => {
  const user = assertUser(c.req.param('user'))
  return c.json({ count: await proposeProfile(user) })
})
