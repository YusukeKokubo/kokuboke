import fs from 'node:fs/promises'
import path from 'node:path'
import { type EngineId, type Topic } from '../../shared/types'
import { BadRequestError, NotFoundError } from '../errors'
import { resolveModel } from '../agent'
import {
  asTopicName,
  assertInsideDataDir,
  imagesDir,
  logsDir,
  normalizeTopicName,
  toTopicName,
  topicDir,
  topicsDir,
  type TopicName,
  type UserName,
} from './paths'
import { localDate, localTime, stamp } from '../../shared/date'
import { countUserMessages, readLastEntry } from './log'
import { ensureChatAgentsLink, ensureUser } from './user'

export interface TopicMeta {
  slug: string
  /** 名前をまだ付けていないときは空文字。 */
  name: string
  emoji: string
  createdAt: string
  engine?: EngineId
  model?: string
  tags?: string[]
  /** 自動で名前を付けにいったかどうか。失敗しても二度は試さない。 */
  nameTried?: boolean
  /** 自動でタグを付けにいったかどうか。失敗しても二度は試さない。 */
  tagTried?: boolean
}

/** 本人がこれだけ話したら、会話を読んで名前とタグを付けにいく。 */
export const AUTO_AFTER = 3

function metaFile(user: UserName, id: TopicName): string {
  return path.join(topicDir(user, id), 'topic.json')
}

export async function writeMeta(user: UserName, id: TopicName, meta: TopicMeta): Promise<void> {
  await fs.writeFile(metaFile(user, id), JSON.stringify(meta, null, 2) + '\n')
}

/** 空いている id になるまで、末尾の数字を増やしていく。 */
export async function uniqueSlug(user: UserName, base: TopicName): Promise<TopicName> {
  let candidate = base
  for (let i = 2; await topicExists(user, candidate); i++) {
    const next = `${base}-${i}`
    candidate = asTopicName(next) ?? toTopicName(next)
  }
  return candidate
}

/** 会話フォルダの id。NAS を覗いたときに順番が分かるよう日付を入れる。動かさない。 */
export function placeholderSlug(): TopicName {
  const now = new Date()
  const name = `untitled-${stamp(localDate(now))}-${localTime(now).replace(':', '')}`
  return asTopicName(name) ?? toTopicName(name)
}

/** topic.json もフォルダも無いのは「会話が無い」。それ以外はそのまま投げる。 */
function notFoundIfMissing(error: unknown): never {
  if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
    throw new NotFoundError('会話が見つかりません')
  }
  throw error
}

export async function readMeta(user: UserName, id: TopicName): Promise<TopicMeta> {
  try {
    const raw = await fs.readFile(metaFile(user, id), 'utf8')
    const parsed = JSON.parse(raw) as Partial<TopicMeta>
    return {
      slug: id,
      name: parsed.name ?? '',
      emoji: parsed.emoji ?? '💬',
      createdAt: parsed.createdAt ?? new Date().toISOString(),
      engine: parsed.engine,
      model: parsed.model,
      tags: Array.isArray(parsed.tags)
        ? parsed.tags.filter((tag): tag is string => typeof tag === 'string')
        : [],
      nameTried: parsed.nameTried,
      tagTried: parsed.tagTried,
    }
  } catch (error) {
    notFoundIfMissing(error)
  }
}

function toTopic(meta: TopicMeta, last: { at: string; text: string } | null): Topic {
  const choice = resolveModel(meta.engine, meta.model)
  return {
    slug: meta.slug,
    name: meta.name,
    emoji: meta.emoji,
    createdAt: meta.createdAt,
    engine: choice.engine,
    model: choice.model,
    modelLabel: choice.label,
    tags: meta.tags ?? [],
    lastMessageAt: last?.at ?? null,
    preview: last ? last.text.replace(/\s+/g, ' ').slice(0, 60) : null,
  }
}

export async function readTopic(user: UserName, id: TopicName): Promise<Topic> {
  return toTopic(await readMeta(user, id), await readLastEntry(user, id))
}

export async function topicExists(user: UserName, id: TopicName): Promise<boolean> {
  try {
    await fs.stat(metaFile(user, id))
    return true
  } catch {
    return false
  }
}

/** 一番新しく話した順。まだ話していないものは作成日で並べる。 */
function byRecency(a: Topic, b: Topic): number {
  return (b.lastMessageAt ?? b.createdAt).localeCompare(a.lastMessageAt ?? a.createdAt)
}

export async function listTopics(user: UserName): Promise<Topic[]> {
  await ensureUser(user)

  let names: string[]
  try {
    names = await fs.readdir(topicsDir(user))
  } catch {
    return []
  }

  const topics: Topic[] = []
  for (const name of names) {
    const id = asTopicName(name)
    if (!id) continue
    if (!(await topicExists(user, id))) continue
    topics.push(await readTopic(user, id))
  }

  return topics.sort(byRecency)
}

export async function createTopic(
  user: UserName,
  input: { name?: string; emoji?: string; engine?: string; model?: string; tags?: string[] },
): Promise<Topic> {
  const name = (input.name ?? '').trim()
  if (name.length > 40) {
    throw new BadRequestError('名前が長すぎます')
  }

  await ensureUser(user)

  const id = await uniqueSlug(user, placeholderSlug())
  await fs.mkdir(logsDir(user, id), { recursive: true })
  await fs.mkdir(imagesDir(user, id), { recursive: true })

  const choice = resolveModel(input.engine, input.model)
  const meta: TopicMeta = {
    slug: id,
    name,
    emoji: input.emoji || '💬',
    createdAt: new Date().toISOString(),
    engine: choice.engine,
    model: choice.model,
    tags: input.tags ?? [],
  }

  await writeMeta(user, id, meta)
  await ensureChatAgentsLink(topicDir(user, id))

  return toTopic(meta, null)
}

/** エンジンとモデルだけを差し替える。名前を変えるのは renameTopic。 */
export async function updateTopic(
  user: UserName,
  id: TopicName,
  input: { engine?: string; model?: string },
): Promise<Topic> {
  const meta = await readMeta(user, id)
  const choice = resolveModel(input.engine ?? meta.engine, input.model ?? meta.model)
  const next: TopicMeta = { ...meta, engine: choice.engine, model: choice.model }
  await writeMeta(user, id, next)
  return toTopic(next, await readLastEntry(user, id))
}

/** 見出しを付け直す。フォルダは動かさない。 */
export async function renameTopic(
  user: UserName,
  id: TopicName,
  input: { name: string; emoji?: string },
): Promise<Topic> {
  const name = normalizeTopicName(input.name)
  if (!name) {
    throw new BadRequestError('名前を入力してください')
  }
  if (name.length > 40) {
    throw new BadRequestError('名前が長すぎます')
  }

  const meta = await readMeta(user, id)
  const next: TopicMeta = {
    ...meta,
    name,
    emoji: input.emoji?.trim() || meta.emoji,
    nameTried: true,
  }
  await writeMeta(user, id, next)
  return toTopic(next, await readLastEntry(user, id))
}

export async function writeTags(user: UserName, id: TopicName, tags: string[]): Promise<Topic> {
  const meta = await readMeta(user, id)
  const next: TopicMeta = { ...meta, tags, tagTried: true }
  await writeMeta(user, id, next)
  return toTopic(next, await readLastEntry(user, id))
}

/**
 * 経路の検査に加え、再帰削除の直前にも保存領域の内側かを確かめる。
 */
export async function deleteTopic(user: UserName, id: TopicName): Promise<void> {
  const dir = assertInsideDataDir(topicDir(user, id))
  try {
    await fs.rm(dir, { recursive: true, force: false })
  } catch (error) {
    notFoundIfMissing(error)
  }
}

export async function shouldAutoName(user: UserName, id: TopicName): Promise<boolean> {
  const meta = await readMeta(user, id)
  if (meta.name || meta.nameTried) return false
  return (await countUserMessages(user, id, AUTO_AFTER)) >= AUTO_AFTER
}

export async function shouldAutoTag(user: UserName, id: TopicName): Promise<boolean> {
  const meta = await readMeta(user, id)
  if (meta.tagTried) return false
  return (await countUserMessages(user, id, AUTO_AFTER)) >= AUTO_AFTER
}

export async function markNameTried(user: UserName, id: TopicName): Promise<void> {
  const meta = await readMeta(user, id)
  await writeMeta(user, id, { ...meta, nameTried: true })
}

export async function markTagTried(user: UserName, id: TopicName): Promise<void> {
  const meta = await readMeta(user, id)
  await writeMeta(user, id, { ...meta, tagTried: true })
}

/** タグを改名したとき、全会話の配列を付け替える。 */
export async function renameTagInTopics(
  user: UserName,
  from: string,
  to: string,
): Promise<void> {
  for (const topic of await listTopics(user)) {
    if (!topic.tags.includes(from)) continue
    const id = asTopicName(topic.slug)
    if (!id) continue
    const tags = topic.tags.map((tag) => (tag === from ? to : tag))
    const unique = [...new Set(tags)]
    const meta = await readMeta(user, id)
    await writeMeta(user, id, { ...meta, tags: unique })
  }
}

/** タグを消したとき、全会話の配列から外す。 */
export async function removeTagFromTopics(user: UserName, tag: string): Promise<void> {
  for (const topic of await listTopics(user)) {
    if (!topic.tags.includes(tag)) continue
    const id = asTopicName(topic.slug)
    if (!id) continue
    const meta = await readMeta(user, id)
    await writeMeta(user, id, { ...meta, tags: (meta.tags ?? []).filter((item) => item !== tag) })
  }
}
