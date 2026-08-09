import fs from 'node:fs/promises'
import path from 'node:path'
import { HTTPException } from 'hono/http-exception'
import type { EngineId, Topic } from '../../shared/types'
import { resolveModel } from '../agent'
import { topicClaudeMd, topicSummaryMd } from '../templates'
import {
  imagesDir,
  isTopicName,
  logsDir,
  toTopicName,
  topicDir,
  topicsDir,
  type TopicRef,
} from './paths'
import { readLastEntry } from './log'
import { ensureAgentsLink, ensureUser } from './user'

interface TopicMeta {
  slug: string
  name: string
  emoji: string
  createdAt: string
  engine?: EngineId
  model?: string
}

function metaFile(user: string, ref: TopicRef): string {
  return path.join(topicDir(user, ref), 'topic.json')
}

async function readMeta(user: string, ref: TopicRef): Promise<TopicMeta> {
  try {
    const raw = await fs.readFile(metaFile(user, ref), 'utf8')
    const parsed = JSON.parse(raw) as Partial<TopicMeta>
    const slug = ref.sub ?? ref.topic
    return {
      slug,
      name: parsed.name ?? slug,
      emoji: parsed.emoji ?? '💬',
      createdAt: parsed.createdAt ?? new Date().toISOString(),
      engine: parsed.engine,
      model: parsed.model,
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      throw new HTTPException(404, { message: 'トピックが見つかりません' })
    }
    throw error
  }
}

function toTopic(
  meta: TopicMeta,
  ref: TopicRef,
  last: { at: string; text: string } | null,
): Topic {
  const choice = resolveModel(meta.engine, meta.model)
  return {
    slug: meta.slug,
    parent: ref.sub ? ref.topic : null,
    name: meta.name,
    emoji: meta.emoji,
    createdAt: meta.createdAt,
    engine: choice.engine,
    model: choice.model,
    modelLabel: choice.label,
    lastMessageAt: last?.at ?? null,
    preview: last ? last.text.replace(/\s+/g, ' ').slice(0, 60) : null,
    children: [],
  }
}

export async function readTopic(user: string, ref: TopicRef): Promise<Topic> {
  // トップレベルは器なので自分では話さない。読むログもない。
  const last = ref.sub ? await readLastEntry(user, ref) : null
  return toTopic(await readMeta(user, ref), ref, last)
}

export async function topicExists(user: string, ref: TopicRef): Promise<boolean> {
  try {
    await fs.stat(metaFile(user, ref))
    return true
  } catch {
    return false
  }
}

/** そのフォルダの直下にある、topic.json を持つフォルダの名前。 */
async function childNames(user: string, topic: string): Promise<string[]> {
  let entries: string[]
  try {
    entries = await fs.readdir(topicDir(user, { topic }))
  } catch {
    return []
  }

  const names: string[] = []
  for (const name of entries) {
    // logs や images は topic.json を持たないので、ここで自然に外れる。
    if (!isTopicName(name)) continue
    if (!(await topicExists(user, { topic, sub: name }))) continue
    names.push(name)
  }
  return names
}

/** 一番新しく話した順。まだ話していないものは作成日で並べる。 */
function byRecency(a: Topic, b: Topic): number {
  return (b.lastMessageAt ?? b.createdAt).localeCompare(a.lastMessageAt ?? a.createdAt)
}

export async function listChildren(user: string, topic: string): Promise<Topic[]> {
  const children: Topic[] = []
  for (const sub of await childNames(user, topic)) {
    children.push(await readTopic(user, { topic, sub }))
  }
  return children.sort(byRecency)
}

export async function listTopics(user: string): Promise<Topic[]> {
  await ensureUser(user)

  let names: string[]
  try {
    names = await fs.readdir(topicsDir(user))
  } catch {
    return []
  }

  const topics: Topic[] = []
  for (const name of names) {
    // 手で置かれた不正な名前のフォルダは黙って無視する。
    if (!isTopicName(name)) continue
    if (!(await topicExists(user, { topic: name }))) continue

    const topic = await readTopic(user, { topic: name })
    topic.children = await listChildren(user, name)

    // 器自身は話さないので、一覧に出す時刻と抜粋は一番新しい子から借りる。
    const newest = topic.children[0]
    if (newest) {
      topic.lastMessageAt = newest.lastMessageAt
      topic.preview = newest.preview
    }
    topics.push(topic)
  }

  return topics.sort(byRecency)
}

/**
 * トップレベルは常に記憶を置く器で、会話は必ずその中に作る。
 * 親に会話がありえないので、器に変えられるかどうかを気にする必要もない。
 */
export async function createTopic(
  user: string,
  input: { name: string; emoji?: string; template?: string; engine?: string; model?: string },
  parent?: string,
): Promise<Topic> {
  const name = input.name.trim()
  if (!name) {
    throw new HTTPException(400, { message: 'トピック名を入力してください' })
  }
  if (name.length > 40) {
    throw new HTTPException(400, { message: 'トピック名が長すぎます' })
  }

  await ensureUser(user)

  if (parent && !(await topicExists(user, { topic: parent }))) {
    throw new HTTPException(404, { message: 'トピックが見つかりません' })
  }

  const slug = toTopicName(name)
  const ref: TopicRef = parent ? { topic: parent, sub: slug } : { topic: slug }
  if (await topicExists(user, ref)) {
    throw new HTTPException(409, { message: '同じ名前のトピックがあります' })
  }

  const dir = topicDir(user, ref)
  if (parent) {
    await fs.mkdir(logsDir(user, ref), { recursive: true })
    await fs.mkdir(imagesDir(user, ref), { recursive: true })
  } else {
    // 器では話さないので、ログと画像の置き場は作らない。
    await fs.mkdir(dir, { recursive: true })
  }

  const choice = resolveModel(input.engine, input.model)
  const meta: TopicMeta = {
    slug,
    name,
    emoji: input.emoji || '💬',
    createdAt: new Date().toISOString(),
    engine: choice.engine,
    model: choice.model,
  }

  await fs.writeFile(metaFile(user, ref), JSON.stringify(meta, null, 2) + '\n')
  await fs.writeFile(path.join(dir, 'CLAUDE.md'), topicClaudeMd(input.template ?? 'plain', name))
  await fs.writeFile(path.join(dir, 'summary.md'), topicSummaryMd(name))
  await ensureAgentsLink(dir)

  return toTopic(meta, ref, null)
}

/** いまのところ変えられるのはエンジンとモデルだけ。 */
export async function updateTopic(
  user: string,
  ref: TopicRef,
  input: { engine?: string; model?: string },
): Promise<Topic> {
  const meta = await readMeta(user, ref)
  const choice = resolveModel(input.engine ?? meta.engine, input.model ?? meta.model)

  const next: TopicMeta = { ...meta, engine: choice.engine, model: choice.model }
  await fs.writeFile(metaFile(user, ref), JSON.stringify(next, null, 2) + '\n')

  return toTopic(next, ref, await readLastEntry(user, ref))
}

async function read(file: string): Promise<string> {
  try {
    return await fs.readFile(file, 'utf8')
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return ''
    throw error
  }
}

export async function readSummary(user: string, ref: TopicRef): Promise<string> {
  return read(path.join(topicDir(user, ref), 'summary.md'))
}

/**
 * 子で話すときは、親の記憶も一緒に効かせる。
 * 親には全体で共有する前提を、子にはその話に閉じた記憶を置く。
 */
export async function readParentSummary(user: string, ref: TopicRef): Promise<string> {
  if (!ref.sub) return ''
  return readSummary(user, { topic: ref.topic })
}

/**
 * summary.md を差し替える。書き換えるのはここだけで、AI 側には書かせない。
 * 末尾の改行を揃えるのは、手で編集した版と AI が返した版で差が出ないようにするため。
 */
export async function writeSummary(user: string, ref: TopicRef, text: string): Promise<void> {
  const body = text.trim()
  await fs.writeFile(path.join(topicDir(user, ref), 'summary.md'), body ? body + '\n' : '')
}
