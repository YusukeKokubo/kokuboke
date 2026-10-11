import fs from 'node:fs/promises'
import path from 'node:path'
import type { DiaryEntry, DiarySettings, ProfileChange, ProfileProposal } from '../../shared/types'
import { BadRequestError } from '../errors'
import { diaryDir, diaryEntryFile, type UserName } from './paths'

/** 既定は止めておく。聞くのは管理画面でオンにした人だけ。 */
export const DEFAULT_DIARY_SETTINGS: DiarySettings = { enabled: false, from: 9, to: 21, count: 3 }

/** 一日に聞ける回数の上限。時刻どうしを 2 時間空けるので、これ以上は入りきらない。 */
export const MAX_ASKS = 6

const DATE = /^\d{4}-\d{2}-\d{2}$/

export function isDiaryDate(value: string): boolean {
  return DATE.test(value)
}

export function assertDiaryDate(value: string): string {
  if (!isDiaryDate(value)) throw new BadRequestError('日付が不正です')
  return value
}

function settingsFile(user: UserName): string {
  return path.join(diaryDir(user), 'settings.json')
}

function planFile(user: UserName): string {
  return path.join(diaryDir(user), 'plan.json')
}

function proposalFile(user: UserName): string {
  return path.join(diaryDir(user), 'profile-proposal.json')
}

/**
 * profile.md の直し案で見送ったもの。revisions.jsonl は命名とタグ付けのプロンプトに
 * 丸ごと載るので、そちらへは混ぜない。
 */
function profileRevisionsFile(user: UserName): string {
  return path.join(diaryDir(user), 'profile-revisions.jsonl')
}

async function readJsonFile(file: string): Promise<unknown> {
  try {
    return JSON.parse(await fs.readFile(file, 'utf8')) as unknown
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code
    if (code === 'ENOENT' || error instanceof SyntaxError) return null
    throw error
  }
}

async function writeJsonFile(file: string, value: unknown): Promise<void> {
  await fs.mkdir(path.dirname(file), { recursive: true })
  await fs.writeFile(file, JSON.stringify(value, null, 2) + '\n')
}

function intIn(value: unknown, min: number, max: number): number | null {
  return typeof value === 'number' && Number.isInteger(value) && value >= min && value <= max
    ? value
    : null
}

/** 壊れた値や欠けた値は既定に落とす。 */
export function normalizeSettings(raw: unknown): DiarySettings {
  const row = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {}
  const from = intIn(row.from, 4, 23) ?? DEFAULT_DIARY_SETTINGS.from
  const to = intIn(row.to, 5, 24) ?? DEFAULT_DIARY_SETTINGS.to
  const count = intIn(row.count, 1, MAX_ASKS) ?? DEFAULT_DIARY_SETTINGS.count
  const ok = to > from
  return {
    enabled: row.enabled === true,
    from: ok ? from : DEFAULT_DIARY_SETTINGS.from,
    to: ok ? to : DEFAULT_DIARY_SETTINGS.to,
    count,
  }
}

/** 画面から来た値。直さずに弾く。黙って既定に落とすと、何が入ったのか分からなくなる。 */
export function assertSettings(raw: unknown): DiarySettings {
  const row = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {}
  const from = intIn(row.from, 4, 23)
  const to = intIn(row.to, 5, 24)
  const count = intIn(row.count, 1, MAX_ASKS)
  if (typeof row.enabled !== 'boolean' || from === null || to === null || count === null) {
    throw new BadRequestError('設定の形が不正です')
  }
  if (to <= from) throw new BadRequestError('終わりは始まりより後にしてね')
  // 2 時間ずつ空けるので、幅が足りないと全部は入らない。
  if ((to - from) * 60 < (count - 1) * 120) {
    throw new BadRequestError(`${to - from} 時間の幅に ${count} 回は入らないよ`)
  }
  return { enabled: row.enabled, from, to, count }
}

export async function readDiarySettings(user: UserName): Promise<DiarySettings> {
  return normalizeSettings(await readJsonFile(settingsFile(user)))
}

export async function writeDiarySettings(user: UserName, settings: DiarySettings): Promise<void> {
  await writeJsonFile(settingsFile(user), settings)
}

/** 一つの問いかけの予定。at は ISO。 */
export interface PlanSlot {
  at: string
  state: 'pending' | 'asked' | 'skipped'
}

/**
 * その日の予定。日記の一日（04:00 から翌 04:00）ごとに作り直す。
 * 時刻をメモリーにだけ持つと、差し替えで再起動した日に予定が消えるのでファイルに残す。
 */
export interface DiaryPlan {
  date: string
  /** 今日の会話の URL の id。まだ一度も聞いていなければ無い。 */
  topic?: string
  slots: PlanSlot[]
}

function isSlot(value: unknown): value is PlanSlot {
  if (!value || typeof value !== 'object') return false
  const row = value as Record<string, unknown>
  return (
    typeof row.at === 'string' &&
    (row.state === 'pending' || row.state === 'asked' || row.state === 'skipped')
  )
}

export async function readPlan(user: UserName): Promise<DiaryPlan | null> {
  const raw = await readJsonFile(planFile(user))
  if (!raw || typeof raw !== 'object') return null
  const row = raw as Record<string, unknown>
  if (typeof row.date !== 'string' || !isDiaryDate(row.date)) return null
  return {
    date: row.date,
    topic: typeof row.topic === 'string' && row.topic ? row.topic : undefined,
    slots: Array.isArray(row.slots) ? row.slots.filter(isSlot) : [],
  }
}

export async function writePlan(user: UserName, plan: DiaryPlan): Promise<void> {
  await writeJsonFile(planFile(user), plan)
}

export async function removePlan(user: UserName): Promise<void> {
  await fs.rm(planFile(user), { force: true })
}

// --- 日記の本文 ---

/** 答えの行。続きの行は二字下げて、一つの答えの中の改行を保つ。 */
function renderAnswers(answers: DiaryEntry['answers']): string {
  if (answers.length === 0) return '（なし）'
  return answers
    .map((answer) => {
      const [first = '', ...rest] = answer.text.trim().split('\n')
      return [`- ${answer.at} ${first}`, ...rest.map((line) => `  ${line}`)].join('\n')
    })
    .join('\n')
}

export function renderEntry(entry: DiaryEntry): string {
  return [
    '---',
    `date: ${entry.date}`,
    `topic: ${entry.topic}`,
    `answers: ${entry.answers.length}`,
    `edited: ${entry.edited}`,
    '---',
    '',
    '## 答え',
    '',
    renderAnswers(entry.answers),
    '',
    '## 記録',
    '',
    entry.record.trim(),
    '',
  ].join('\n')
}

function parseAnswers(block: string): DiaryEntry['answers'] {
  const answers: DiaryEntry['answers'] = []
  for (const line of block.split('\n')) {
    const head = /^- (\d{2}:\d{2}) ?(.*)$/.exec(line)
    if (head) {
      answers.push({ at: head[1]!, text: head[2]! })
      continue
    }
    const last = answers.at(-1)
    if (last && line.startsWith('  ')) last.text += `\n${line.slice(2)}`
  }
  return answers
}

/** 手で直されて形が崩れていても、読めるところまでは読む。 */
export function parseEntry(raw: string, fallbackDate: string): DiaryEntry {
  const front: Record<string, string> = {}
  let body = raw
  const match = /^---\n([\s\S]*?)\n---\n?/.exec(raw)
  if (match) {
    for (const line of match[1]!.split('\n')) {
      const at = line.indexOf(':')
      if (at > 0) front[line.slice(0, at).trim()] = line.slice(at + 1).trim()
    }
    body = raw.slice(match[0].length)
  }

  const answersAt = body.indexOf('## 答え')
  const recordAt = body.indexOf('## 記録')
  const answers =
    answersAt >= 0
      ? parseAnswers(body.slice(answersAt + '## 答え'.length, recordAt > answersAt ? recordAt : undefined))
      : []
  const record = recordAt >= 0 ? body.slice(recordAt + '## 記録'.length).trim() : body.trim()

  return {
    date: isDiaryDate(front.date ?? '') ? front.date! : fallbackDate,
    topic: front.topic ?? '',
    answers,
    record,
    edited: front.edited === 'true',
  }
}

export async function readEntry(user: UserName, date: string): Promise<DiaryEntry | null> {
  try {
    return parseEntry(await fs.readFile(diaryEntryFile(user, date), 'utf8'), date)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null
    throw error
  }
}

export async function writeEntry(user: UserName, entry: DiaryEntry): Promise<void> {
  const file = diaryEntryFile(user, entry.date)
  await fs.mkdir(path.dirname(file), { recursive: true })
  await fs.writeFile(file, renderEntry(entry))
}

/** 書いてある日記を新しい順に。年のフォルダと MM-DD.md だけ拾う。 */
export async function listEntries(user: UserName): Promise<DiaryEntry[]> {
  let years: string[]
  try {
    years = await fs.readdir(diaryDir(user))
  } catch {
    return []
  }

  const dates: string[] = []
  for (const year of years.filter((name) => /^\d{4}$/.test(name))) {
    const files = await fs.readdir(path.join(diaryDir(user), year)).catch(() => [] as string[])
    for (const file of files) {
      const match = /^(\d{2}-\d{2})\.md$/.exec(file)
      if (match) dates.push(`${year}-${match[1]}`)
    }
  }
  dates.sort().reverse()

  const entries = await Promise.all(dates.map((date) => readEntry(user, date)))
  return entries.filter((entry): entry is DiaryEntry => entry !== null)
}

// --- profile.md の直し案 ---

function isChange(value: unknown): value is ProfileChange {
  if (!value || typeof value !== 'object') return false
  const row = value as Record<string, unknown>
  const strings = (v: unknown) => Array.isArray(v) && v.every((item) => typeof item === 'string')
  if (typeof row.id !== 'string') return false
  if (row.type === 'add') return typeof row.text === 'string' && strings(row.dates)
  if (row.type === 'replace') {
    return typeof row.from === 'string' && typeof row.to === 'string' && strings(row.dates)
  }
  if (row.type === 'remove') return typeof row.text === 'string' && typeof row.reason === 'string'
  return false
}

export async function readProposal(user: UserName): Promise<ProfileProposal | null> {
  const raw = await readJsonFile(proposalFile(user))
  if (!raw || typeof raw !== 'object') return null
  const row = raw as Record<string, unknown>
  if (typeof row.at !== 'string' || !Array.isArray(row.changes)) return null
  const changes = row.changes.filter(isChange)
  if (changes.length === 0) return null
  return { at: row.at, changes, limit: typeof row.limit === 'number' ? row.limit : 0 }
}

export async function writeProposal(user: UserName, proposal: ProfileProposal): Promise<void> {
  await writeJsonFile(proposalFile(user), proposal)
}

export async function removeProposal(user: UserName): Promise<void> {
  await fs.rm(proposalFile(user), { force: true })
}

export interface ProfileRevision {
  at: string
  accepted: string[]
  rejected: string[]
}

export async function appendProfileRevision(
  user: UserName,
  input: Omit<ProfileRevision, 'at'>,
): Promise<void> {
  if (input.accepted.length === 0 && input.rejected.length === 0) return
  const file = profileRevisionsFile(user)
  await fs.mkdir(path.dirname(file), { recursive: true })
  await fs.appendFile(file, JSON.stringify({ ...input, at: new Date().toISOString() }) + '\n')
}

/** 新しい方から limit 件。 */
export async function readProfileRevisions(user: UserName, limit = 10): Promise<ProfileRevision[]> {
  let raw: string
  try {
    raw = await fs.readFile(profileRevisionsFile(user), 'utf8')
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []
    throw error
  }
  const items: ProfileRevision[] = []
  for (const line of raw.split('\n')) {
    if (!line.trim()) continue
    try {
      const row = JSON.parse(line) as Partial<ProfileRevision>
      if (typeof row.at === 'string' && Array.isArray(row.accepted) && Array.isArray(row.rejected)) {
        items.push({ at: row.at, accepted: row.accepted, rejected: row.rejected })
      }
    } catch {
      // 壊れた行は捨てる。
    }
  }
  return items.slice(-limit)
}
