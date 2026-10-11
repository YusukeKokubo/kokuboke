import type { DiaryEntry, Message } from '../../shared/types'
import { localTime } from '../../shared/date'
import { collectAgent, resolveModel, unfence } from '../agent'
import { limiter } from '../agent/queue'
import { BadRequestError } from '../errors'
import { notifyUser } from '../push/notify'
import {
  appendProfileRevision,
  listEntries,
  readEntry,
  readPlan,
  readProfileRevisions,
  readProposal,
  removeProposal,
  writeEntry,
  writePlan,
  writeProposal,
} from '../store/diary'
import { appendMessage, readAll } from '../store/log'
import { topicDir, userDir, type TopicName, type UserName } from '../store/paths'
import { ensureTag, listTags } from '../store/tag'
import { createTopic, listDiaryTopics, listTopics, readMeta, resolveTopic } from '../store/topic'
import { readProfile, writeProfile } from '../store/user'
import { applyProfileChanges, charCount, describeChange, parseProfileChanges, PROFILE_LIMIT } from './changes'
import { diaryDateOf, shiftDate } from './clock'
import {
  profilePrompt,
  profileSystemPrompt,
  questionPrompt,
  questionSystemPrompt,
  recordPrompt,
  recordSystemPrompt,
} from './prompt'

/** 「いまなにしとる」の会話に付けるタグ。 */
export const DIARY_TAG = '日記'

/** 問いかけを書くのに待つ上限。ニュースを探すぶん返答より遅いが、枠を長く握らせない。 */
const QUESTION_TIMEOUT_MS = 2 * 60 * 1000

/** ニュースが探せなかったときや、書けなかったときの一通。 */
const PLAIN_QUESTION = '今何してる？'

/** 通知の本文に載せる長さ。 */
const PUSH_BODY_CHARS = 100

const WEEKDAYS = ['日', '月', '火', '水', '木', '金', '土']

function dateLabel(date: string): string {
  const [, month, day] = date.split('-').map(Number)
  return `${month}月${day}日`
}

/** 会話の見出し。フォルダ名にもなるので「/」は使わない。 */
export function diaryTopicName(date: string): string {
  return `${dateLabel(date)}のいまなにしとる`
}

function nowLabel(at: Date): string {
  return `${at.getMonth() + 1}月${at.getDate()}日（${WEEKDAYS[at.getDay()]}）${localTime(at)}`
}

export function topicPath(user: UserName, slug: string): string {
  return `/user/${user}/${slug}`
}

/** その日の会話を探し、無ければ作る。予定に覚えた id を先に見る。 */
async function ensureDiaryTopic(
  user: UserName,
  date: string,
  remembered: string | undefined,
): Promise<{ folder: TopicName; slug: string }> {
  if (remembered) {
    const found = await resolveTopic(user, remembered)
    if (found) return found
  }
  const listed = (await listDiaryTopics(user)).find((topic) => topic.date === date)
  if (listed) return listed

  const tag = await ensureTag(user, DIARY_TAG, '📔')
  const topic = await createTopic(user, {
    name: diaryTopicName(date),
    tags: tag ? [tag] : [],
    diary: date,
  })
  const found = await resolveTopic(user, topic.slug)
  if (!found) throw new Error('作った会話が見つかりません')
  return found
}

/** 興味の手がかり。この一週間の会話の見出し。「いまなにしとる」自身は除く。 */
async function recentNames(user: UserName, now: Date): Promise<string[]> {
  const since = now.getTime() - 7 * 24 * 60 * 60 * 1000
  const diary = new Set((await listDiaryTopics(user)).map((topic) => topic.slug))
  return (await listTopics(user))
    .filter((topic) => !diary.has(topic.slug) && topic.name)
    .filter((topic) => new Date(topic.lastMessageAt ?? topic.createdAt).getTime() >= since)
    .slice(0, 20)
    .map((topic) => topic.name)
}

/**
 * 今日の会話に問いかけを一通置いて、端末へ知らせる。
 * 置いた会話の URL の id を返す。予定には呼ぶ側が書き戻す。
 */
export async function askQuestion(
  user: UserName,
  now = new Date(),
  options: { manual?: boolean } = {},
): Promise<string> {
  const date = diaryDateOf(now)
  const plan = (await readPlan(user)) ?? { date, slots: [] }
  const remembered = plan.date === date ? plan.topic : undefined

  const release = await limiter.acquireWhenFree(user)
  let slug: string
  let text: string
  try {
    const topic = await ensureDiaryTopic(user, date, remembered)
    slug = topic.slug
    const meta = await readMeta(user, topic.folder)
    const today = await readAll(user, topic.folder)

    text = ''
    try {
      text = await collectAgent(resolveModel(meta.engine, meta.model, meta.effort), {
        cwd: topicDir(user, topic.folder),
        prompt: questionPrompt({
          now: nowLabel(now),
          profile: await readProfile(user),
          tags: (await listTags(user)).map((tag) => ({ name: tag.name, group: tag.group })),
          recentNames: await recentNames(user, now),
          today,
        }),
        systemPrompt: questionSystemPrompt(user),
        signal: AbortSignal.timeout(QUESTION_TIMEOUT_MS),
      })
    } catch (error) {
      console.error('[diary] 問いかけを書けませんでした', error)
    }
    text = unfence(text).trim() || PLAIN_QUESTION

    const message: Message = {
      id: crypto.randomUUID(),
      role: 'assistant',
      text,
      images: [],
      at: new Date().toISOString(),
    }
    await appendMessage(user, topic.folder, message)
  } finally {
    release()
  }

  // 予定を読み直してから書く。問いかけを書いている間に、見回りが別の枠を書き戻していることがある。
  // 手で聞いた分も予定に残す。残さないと、設定を変えたときにその直後の時刻を選び直してしまう。
  const latest = (await readPlan(user)) ?? plan
  const base = latest.date === date ? latest : { date, slots: [] }
  const slots = options.manual
    ? [...base.slots, { at: now.toISOString(), state: 'asked' as const }].sort((a, b) => a.at.localeCompare(b.at))
    : base.slots
  await writePlan(user, { ...base, slots, topic: slug })

  const firstLine = text.split('\n').find((line) => line.trim()) ?? text
  const sent = await notifyUser({
    recipient: user,
    title: 'いまなにしとる？',
    body: [...firstLine].slice(0, PUSH_BODY_CHARS).join(''),
    path: topicPath(user, slug),
  })
  console.log(`[diary] ${user} に問いかけた（端末 ${sent}）`)
  return slug
}

function answersOf(messages: Message[]): DiaryEntry['answers'] {
  return messages
    .filter((m) => m.role === 'user')
    .map((m) => {
      const attached = m.images.length > 0 ? '（画像）' : (m.files?.length ?? 0) > 0 ? '（ファイル）' : ''
      return { at: localTime(new Date(m.at)), text: m.text.trim() || attached || '（空）' }
    })
}

/**
 * その日の日記を書く。答えが一つも無ければ書かずに null。
 * 人が記録を直した日は、force でなければ答えだけ写し直して記録は残す。
 */
export async function writeDiary(
  user: UserName,
  date: string,
  options: { force?: boolean } = {},
): Promise<DiaryEntry | null> {
  const topic = (await listDiaryTopics(user)).find((item) => item.date === date)
  if (!topic) return null

  const release = await limiter.acquireWhenFree(user)
  try {
    const conversation = await readAll(user, topic.folder)
    const answers = answersOf(conversation)
    if (answers.length === 0) return null

    const existing = await readEntry(user, date)
    if (existing?.edited && !options.force) {
      const entry = { ...existing, topic: topic.slug, answers }
      await writeEntry(user, entry)
      return entry
    }

    const meta = await readMeta(user, topic.folder)
    let record = ''
    try {
      record = unfence(
        await collectAgent(resolveModel(meta.engine, meta.model, meta.effort), {
          cwd: topicDir(user, topic.folder),
          prompt: recordPrompt({ date, conversation }),
          systemPrompt: recordSystemPrompt(),
        }),
      )
    } catch (error) {
      console.error('[diary] 記録を書けませんでした', error)
    }
    if (!record.trim()) {
      if (existing) return existing
      throw new Error('記録を書けませんでした')
    }

    const entry: DiaryEntry = { date, topic: topic.slug, answers, record: record.trim(), edited: false }
    await writeEntry(user, entry)
    return entry
  } finally {
    release()
  }
}

/** 人が記録を直した。答えは触らせない。 */
export async function saveRecord(user: UserName, date: string, record: string): Promise<DiaryEntry> {
  const existing = await readEntry(user, date)
  if (!existing) throw new BadRequestError('まだ日記が無いよ')
  const entry = { ...existing, record: record.trim(), edited: true }
  await writeEntry(user, entry)
  return entry
}

/**
 * この一週間の答えから profile.md の直し案を作る。まだ選ばれていない古い案は捨てて作り直す。
 * 答えのある日が二日に満たなければ、根拠が足りないので作らない。
 */
export async function proposeProfile(user: UserName, today = diaryDateOf(new Date())): Promise<number> {
  const since = shiftDate(today, -7)
  const entries = (await listEntries(user))
    .filter((entry) => entry.date >= since && entry.date < today && entry.answers.length > 0)
    .reverse()
  if (entries.length < 2) return 0

  const release = await limiter.acquireWhenFree(user)
  try {
    const profile = await readProfile(user)
    let text = ''
    try {
      text = await collectAgent(resolveModel(), {
        cwd: userDir(user),
        prompt: profilePrompt({
          profile,
          length: charCount(profile),
          limit: PROFILE_LIMIT,
          entries,
          revisions: await readProfileRevisions(user),
        }),
        systemPrompt: profileSystemPrompt(),
      })
    } catch (error) {
      console.error('[diary] profile の直し案を作れませんでした', error)
      return 0
    }

    const changes = parseProfileChanges(text, profile, new Set(entries.map((entry) => entry.date)))
    if (changes.length === 0) {
      await removeProposal(user)
      return 0
    }
    await writeProposal(user, { at: new Date().toISOString(), changes, limit: PROFILE_LIMIT })
    return changes.length
  } finally {
    release()
  }
}

/**
 * 選んだ案を profile.md に書く。選ばなかった案は見送りとして残し、次の案を作るときに渡す。
 * 何も選ばずに呼べば、全部見送り。
 */
export async function applyProposal(user: UserName, picked: string[]): Promise<string> {
  const proposal = await readProposal(user)
  if (!proposal) throw new BadRequestError('直し案がもう無いよ')

  const chosen = new Set(picked)
  const accepted = proposal.changes.filter((change) => chosen.has(change.id))
  const rejected = proposal.changes.filter((change) => !chosen.has(change.id))

  const profile = await readProfile(user)
  if (accepted.length > 0) {
    const next = applyProfileChanges(profile, accepted)
    const limit = proposal.limit || PROFILE_LIMIT
    if (charCount(next) > limit) {
      throw new BadRequestError(`入れると ${charCount(next)} 字になって、上限の ${limit} 字を超えるよ`)
    }
    await writeProfile(user, next)
  }

  await appendProfileRevision(user, {
    accepted: accepted.map(describeChange),
    rejected: rejected.map(describeChange),
  })
  await removeProposal(user)
  return readProfile(user)
}
