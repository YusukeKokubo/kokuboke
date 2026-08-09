import fs from 'node:fs/promises'
import path from 'node:path'
import type { Message } from '../../shared/types'
import { config } from '../config'
import { localDate, localTime, stamp } from './date'
import { imageName } from './image'
import { logsDir } from './paths'

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

function jsonlFile(user: string, topic: string, date: string): string {
  return path.join(logsDir(user, topic), `${stamp(date)}.jsonl`)
}

function markdownFile(user: string, topic: string, date: string): string {
  return path.join(logsDir(user, topic), `${stamp(date)}.md`)
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

/** 当日を含めて days 日分を古い順に返す。 */
export async function readRecent(
  user: string,
  topic: string,
  days = config.contextDays,
): Promise<Message[]> {
  const dates = recentDates(days).reverse()
  const all: Message[] = []
  for (const date of dates) {
    all.push(...(await readJsonl(jsonlFile(user, topic, date))))
  }
  return all
}

export async function readLastEntry(user: string, topic: string): Promise<Message | null> {
  // 直近 30 日だけ遡る。それ以上前だと一覧では「まだ話していない」扱いでよい。
  for (const date of recentDates(30)) {
    const messages = await readJsonl(jsonlFile(user, topic, date))
    if (messages.length > 0) return messages[messages.length - 1]!
  }
  return null
}

function renderMarkdown(message: Message): string {
  const who = message.role === 'user' ? '本人' : 'アシスタント'
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
export async function appendMessage(user: string, topic: string, message: Message): Promise<void> {
  const date = localDate(new Date(message.at))
  const dir = logsDir(user, topic)
  await fs.mkdir(dir, { recursive: true })

  await fs.appendFile(jsonlFile(user, topic, date), JSON.stringify(message) + '\n')

  const md = markdownFile(user, topic, date)
  let header = ''
  try {
    await fs.stat(md)
  } catch {
    header = `# ${date}\n\n`
  }
  await fs.appendFile(md, header + renderMarkdown(message))
}
