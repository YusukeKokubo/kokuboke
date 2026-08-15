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
import { shortDate } from '../../shared/date'
import { countUserMessages, readLastEntry } from './log'
import { ensureChatAgentsLink, ensureUser } from './user'

export interface TopicMeta {
  /** フォルダ名。`YY-MM-DD` または `YY-MM-DD-見出し`。 */
  slug: string
  /** URL 用の uuid。古い会話には無い。 */
  id?: string
  /** 名前をまだ付けていないときは空文字。 */
  name: string
  createdAt: string
  engine?: EngineId
  model?: string
  tags?: string[]
  /**
   * 自動命名を最後に試したときの、本人の発言回数。
   * 人が付けた名前では最終回にして、以降は付け直さない。
   */
  nameTriedAt?: number
  /** 自動で名前を付けにいったかどうか。古い topic.json 向け。 */
  nameTried?: boolean
  /** 自動でタグを付けにいったかどうか。失敗しても二度は試さない。 */
  tagTried?: boolean
}

/** 本人がこの回数話したところで、会話を読んで名前を付け（直し）にいく。 */
export const AUTO_NAME_AT = [1, 3, 5] as const
export const AUTO_NAME_LAST = AUTO_NAME_AT[AUTO_NAME_AT.length - 1]

/** 本人がこれだけ話したら、会話を読んでタグを付けにいく。 */
export const AUTO_AFTER = 3

function isAutoNameTurn(count: number): boolean {
  return (AUTO_NAME_AT as readonly number[]).includes(count)
}

/** この回数までは自動命名を試済み、とみなす。 */
function nameTryAt(meta: Pick<TopicMeta, 'name' | 'nameTried' | 'nameTriedAt'>): number {
  if (typeof meta.nameTriedAt === 'number') return meta.nameTriedAt
  // 古い topic.json は nameTried か、すでに付いている名前で打ち切る。
  if (meta.nameTried || meta.name) return AUTO_NAME_LAST
  return 0
}

function metaFile(user: UserName, id: TopicName): string {
  return path.join(topicDir(user, id), 'topic.json')
}

export async function writeMeta(user: UserName, id: TopicName, meta: TopicMeta): Promise<void> {
  await fs.writeFile(metaFile(user, id), JSON.stringify(meta, null, 2) + '\n')
}

/** 空いているフォルダ名になるまで、末尾の数字を増やしていく。 */
export async function uniqueSlug(
  user: UserName,
  base: TopicName,
  except?: TopicName,
): Promise<TopicName> {
  let candidate = base
  for (let i = 2; await topicExists(user, candidate); i++) {
    if (except && candidate === except) return candidate
    const next = `${base}-${i}`
    candidate = asTopicName(next) ?? toTopicName(next)
  }
  return candidate
}

/** 作成日と見出しからフォルダ名をつくる。日付は動かさない。 */
export function topicFolderName(createdAt: Date, name = ''): TopicName {
  const prefix = shortDate(createdAt)
  const body = name ? `${prefix}-${name}` : prefix
  return asTopicName(body) ?? toTopicName(body)
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
      id: typeof parsed.id === 'string' && parsed.id ? parsed.id : undefined,
      name: parsed.name ?? '',
      createdAt: parsed.createdAt ?? new Date().toISOString(),
      engine: parsed.engine,
      model: parsed.model,
      tags: Array.isArray(parsed.tags)
        ? parsed.tags.filter((tag): tag is string => typeof tag === 'string')
        : [],
      nameTried: parsed.nameTried,
      nameTriedAt: typeof parsed.nameTriedAt === 'number' ? parsed.nameTriedAt : undefined,
      tagTried: parsed.tagTried,
    }
  } catch (error) {
    notFoundIfMissing(error)
  }
}

function publicSlug(meta: TopicMeta): string {
  return meta.id ?? meta.slug
}

function toTopic(meta: TopicMeta, last: { at: string; text: string } | null): Topic {
  const choice = resolveModel(meta.engine, meta.model)
  return {
    slug: publicSlug(meta),
    name: meta.name,
    createdAt: meta.createdAt,
    engine: choice.engine,
    model: choice.model,
    modelLabel: choice.label,
    tags: meta.tags ?? [],
    lastMessageAt: last?.at ?? null,
    preview: last ? last.text.replace(/\s+/g, ' ').slice(0, 60) : null,
  }
}

export async function readTopic(user: UserName, id: string): Promise<Topic> {
  const folder = await locate(user, id)
  return toTopic(await readMeta(user, folder), await readLastEntry(user, folder))
}

export async function topicExists(user: UserName, id: TopicName): Promise<boolean> {
  try {
    await fs.stat(metaFile(user, id))
    return true
  } catch {
    return false
  }
}

async function listFolders(user: UserName): Promise<TopicName[]> {
  let names: string[]
  try {
    names = await fs.readdir(topicsDir(user))
  } catch {
    return []
  }

  const folders: TopicName[] = []
  for (const name of names) {
    const id = asTopicName(name)
    if (!id) continue
    if (!(await topicExists(user, id))) continue
    folders.push(id)
  }
  return folders
}

/**
 * URL の id（uuid）またはフォルダ名から、実体のフォルダを探す。
 * 古い会話は uuid が無く、フォルダ名がそのまま URL になっている。
 */
export async function resolveTopic(
  user: UserName,
  ref: string,
): Promise<{ folder: TopicName; slug: string } | null> {
  const folder = asTopicName(ref)
  if (folder && (await topicExists(user, folder))) {
    const meta = await readMeta(user, folder)
    return { folder, slug: publicSlug(meta) }
  }

  for (const name of await listFolders(user)) {
    const meta = await readMeta(user, name)
    if (meta.id === ref) return { folder: name, slug: meta.id }
  }
  return null
}

async function locate(user: UserName, ref: string): Promise<TopicName> {
  const found = await resolveTopic(user, ref)
  if (!found) notFoundIfMissing({ code: 'ENOENT' })
  return found.folder
}

/** 一番新しく話した順。まだ話していないものは作成日で並べる。 */
function byRecency(a: Topic, b: Topic): number {
  return (b.lastMessageAt ?? b.createdAt).localeCompare(a.lastMessageAt ?? a.createdAt)
}

export async function listTopics(user: UserName): Promise<Topic[]> {
  await ensureUser(user)
  const topics: Topic[] = []
  for (const folder of await listFolders(user)) {
    topics.push(await readTopic(user, folder))
  }
  return topics.sort(byRecency)
}

export async function createTopic(
  user: UserName,
  input: { name?: string; engine?: string; model?: string; tags?: string[] },
): Promise<Topic> {
  const name = (input.name ?? '').trim()
  if (name.length > 40) {
    throw new BadRequestError('名前が長すぎます')
  }

  await ensureUser(user)

  const createdAt = new Date()
  const folder = await uniqueSlug(user, topicFolderName(createdAt, name))
  await fs.mkdir(logsDir(user, folder), { recursive: true })
  await fs.mkdir(imagesDir(user, folder), { recursive: true })

  const choice = resolveModel(input.engine, input.model)
  const named = Boolean(name)
  const meta: TopicMeta = {
    slug: folder,
    id: crypto.randomUUID(),
    name,
    createdAt: createdAt.toISOString(),
    engine: choice.engine,
    model: choice.model,
    tags: input.tags ?? [],
    ...(named ? { nameTriedAt: AUTO_NAME_LAST, nameTried: true } : {}),
  }

  await writeMeta(user, folder, meta)
  await ensureChatAgentsLink(topicDir(user, folder))

  return toTopic(meta, null)
}

/** エンジンとモデルだけを差し替える。名前を変えるのは renameTopic。 */
export async function updateTopic(
  user: UserName,
  id: string,
  input: { engine?: string; model?: string },
): Promise<Topic> {
  const folder = await locate(user, id)
  const meta = await readMeta(user, folder)
  const choice = resolveModel(input.engine ?? meta.engine, input.model ?? meta.model)
  const next: TopicMeta = { ...meta, engine: choice.engine, model: choice.model }
  await writeMeta(user, folder, next)
  return toTopic(next, await readLastEntry(user, folder))
}

/** 見出しを付け直す。uuid のある会話はフォルダ名も合わせる。URL は動かない。 */
export async function renameTopic(
  user: UserName,
  id: string,
  input: { name: string; autoAt?: number },
): Promise<Topic> {
  const name = normalizeTopicName(input.name)
  if (!name) {
    throw new BadRequestError('名前を入力してください')
  }
  if (name.length > 40) {
    throw new BadRequestError('名前が長すぎます')
  }

  let folder = await locate(user, id)
  const meta = await readMeta(user, folder)
  const triedAt = input.autoAt ?? AUTO_NAME_LAST
  const next: TopicMeta = {
    ...meta,
    name,
    nameTriedAt: triedAt,
    nameTried: triedAt >= AUTO_NAME_LAST,
  }

  if (meta.id) {
    const dest = await uniqueSlug(user, topicFolderName(new Date(meta.createdAt), name), folder)
    if (dest !== folder) {
      await fs.rename(
        assertInsideDataDir(topicDir(user, folder)),
        assertInsideDataDir(topicDir(user, dest)),
      )
      folder = dest
    }
    next.slug = folder
  }

  await writeMeta(user, folder, next)
  return toTopic(next, await readLastEntry(user, folder))
}

export async function writeTags(user: UserName, id: string, tags: string[]): Promise<Topic> {
  const folder = await locate(user, id)
  const meta = await readMeta(user, folder)
  const next: TopicMeta = { ...meta, tags, tagTried: true }
  await writeMeta(user, folder, next)
  return toTopic(next, await readLastEntry(user, folder))
}

/**
 * 経路の検査に加え、再帰削除の直前にも保存領域の内側かを確かめる。
 */
export async function deleteTopic(user: UserName, id: string): Promise<void> {
  const folder = await locate(user, id)
  const dir = assertInsideDataDir(topicDir(user, folder))
  try {
    await fs.rm(dir, { recursive: true, force: false })
  } catch (error) {
    notFoundIfMissing(error)
  }
}

export async function shouldAutoName(user: UserName, id: string): Promise<boolean> {
  const folder = await locate(user, id)
  const meta = await readMeta(user, folder)
  const count = await countUserMessages(user, folder, AUTO_NAME_LAST)
  return isAutoNameTurn(count) && nameTryAt(meta) < count
}

export async function shouldAutoTag(user: UserName, id: string): Promise<boolean> {
  const folder = await locate(user, id)
  const meta = await readMeta(user, folder)
  if (meta.tagTried) return false
  return (await countUserMessages(user, folder, AUTO_AFTER)) >= AUTO_AFTER
}

export async function markNameTried(user: UserName, id: string): Promise<void> {
  const folder = await locate(user, id)
  const meta = await readMeta(user, folder)
  const count = await countUserMessages(user, folder, AUTO_NAME_LAST)
  await writeMeta(user, folder, {
    ...meta,
    nameTriedAt: count,
    nameTried: count >= AUTO_NAME_LAST,
  })
}

export async function markTagTried(user: UserName, id: string): Promise<void> {
  const folder = await locate(user, id)
  const meta = await readMeta(user, folder)
  await writeMeta(user, folder, { ...meta, tagTried: true })
}

/** タグを改名したとき、全会話の配列を付け替える。 */
export async function renameTagInTopics(
  user: UserName,
  from: string,
  to: string,
): Promise<void> {
  for (const topic of await listTopics(user)) {
    if (!topic.tags.includes(from)) continue
    const folder = await locate(user, topic.slug)
    const tags = topic.tags.map((tag) => (tag === from ? to : tag))
    const unique = [...new Set(tags)]
    const meta = await readMeta(user, folder)
    await writeMeta(user, folder, { ...meta, tags: unique })
  }
}

/** タグを消したとき、全会話の配列から外す。 */
export async function removeTagFromTopics(user: UserName, tag: string): Promise<void> {
  for (const topic of await listTopics(user)) {
    if (!topic.tags.includes(tag)) continue
    const folder = await locate(user, topic.slug)
    const meta = await readMeta(user, folder)
    await writeMeta(user, folder, { ...meta, tags: (meta.tags ?? []).filter((item) => item !== tag) })
  }
}
