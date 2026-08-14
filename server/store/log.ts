import fs from 'node:fs/promises'
import path from 'node:path'
import type { Message } from '../../shared/types'
import { config } from '../config'
import { localDate, localTime, stamp } from '../../shared/date'
import { imageName } from './image'
import { logsDir, type VerifiedTopicRef, type UserName } from './paths'

/** その日から n 日前までの日付を新しい順に並べる。 */
function recentDates(days: number): string[] {
  const out: string[] = []
  const now = new Date()
  for (let i = 0; i < days; i++) {
    const d = new Date(now)
    d.setDate(d.getDate() - i)
    out.push(localDate(d))
  }
  return out
}

function jsonlFile(user: UserName, ref: VerifiedTopicRef, date: string): string {
  return path.join(logsDir(user, ref), `${stamp(date)}.jsonl`)
}

function markdownFile(user: UserName, ref: VerifiedTopicRef, date: string): string {
  return path.join(logsDir(user, ref), `${stamp(date)}.md`)
}

async function readJsonl(file: string): Promise<Message[]> {
  let raw: string
  try {
    raw = await fs.readFile(file, 'utf8')
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []
    throw error
  }

  const messages: Message[] = []
  for (const line of raw.split('\n')) {
    if (!line.trim()) continue
    try {
      messages.push(JSON.parse(line) as Message)
    } catch {
      // 壊れた行は捨てる。人間が読む md の方は残っているので復旧はできる。
    }
  }
  return messages
}

/** 当日を含めて days 日分を古い順に返す。AI の文脈用。 */
export async function readRecent(
  user: UserName,
  ref: VerifiedTopicRef,
  days = config.contextDays,
): Promise<Message[]> {
  // readdir で実在するファイルだけ読む。日付を機械的に作って ENOENT を踏まない。
  const oldest = stamp(recentDates(days).at(-1)!)
  const all: Message[] = []
  for (const file of await listJsonlFiles(user, ref)) {
    const name = path.basename(file, '.jsonl')
    if (name < oldest) continue
    all.push(...(await readJsonl(file)))
  }
  return all
}

/** 日付名のログだけ通す。手置きの notes.jsonl などが文脈に混ざらないようにする。 */
const DATE_JSONL = /^\d{8}\.jsonl$/

/** logs/ 内の日付名 jsonl を古い順に並べる。 */
async function listJsonlFiles(user: UserName, ref: VerifiedTopicRef): Promise<string[]> {
  let files: string[]
  try {
    files = await fs.readdir(logsDir(user, ref))
  } catch {
    return []
  }
  return files
    .filter((f) => DATE_JSONL.test(f))
    .sort()
    .map((f) => path.join(logsDir(user, ref), f))
}

/** 保存されている会話を全部、古い順に返す。画面の履歴用。 */
export async function readAll(user: UserName, ref: VerifiedTopicRef): Promise<Message[]> {
  const all: Message[] = []
  for (const file of await listJsonlFiles(user, ref)) {
    all.push(...(await readJsonl(file)))
  }
  return all
}

/**
 * このトピックで本人が話した回数。名前を付ける頃合いの判断に使う。
 * 日付をまたいでも数えたいので、直近何日ではなくログを全部見る。
 * stopAt に達したら残りのファイルは読まない。
 */
export async function countUserMessages(
  user: UserName,
  ref: VerifiedTopicRef,
  stopAt?: number,
): Promise<number> {
  let count = 0
  for (const file of await listJsonlFiles(user, ref)) {
    for (const message of await readJsonl(file)) {
      if (message.role !== 'user') continue
      count++
      if (stopAt !== undefined && count >= stopAt) return count
    }
  }
  return count
}

export async function readLastEntry(user: UserName, ref: VerifiedTopicRef): Promise<Message | null> {
  // readdir 一回で実在ファイルだけ新しい順に見られるので、直近何日という打ち切りはしない。
  const files = await listJsonlFiles(user, ref)
  for (let i = files.length - 1; i >= 0; i--) {
    const messages = await readJsonl(files[i]!)
    // 空や壊れた行しか無いファイルは飛ばす（readJsonl は壊れた行を捨てる）。
    if (messages.length > 0) return messages[messages.length - 1]!
  }
  return null
}

function renderMarkdown(message: Message): string {
  const who =
    message.role === 'user' ? (message.author ?? '本人') : 'アシスタント'
  const time = localTime(new Date(message.at))

  const lines = [`## ${time} ${who}`, '']
  if (message.text.trim()) lines.push(message.text.trim(), '')
  for (const stored of message.images) {
    // md から見て images/ は隣なので相対で置く。
    lines.push(`![](images/${imageName(stored)})`, '')
  }
  return lines.join('\n')
}

/**
 * 会話を 2 通りに書き出す。md は人が読むため、jsonl は次回の読み戻しのため。
 * 片方が壊れても、もう片方から復旧できるようにしている。
 */
export async function appendMessage(user: UserName, ref: VerifiedTopicRef, message: Message): Promise<void> {
  const date = localDate(new Date(message.at))
  const dir = logsDir(user, ref)
  await fs.mkdir(dir, { recursive: true })

  await fs.appendFile(jsonlFile(user, ref, date), JSON.stringify(message) + '\n')

  const md = markdownFile(user, ref, date)
  let header = ''
  try {
    await fs.stat(md)
  } catch {
    header = `# ${date}\n\n`
  }
  await fs.appendFile(md, header + renderMarkdown(message))
}
