import fs from 'node:fs/promises'
import path from 'node:path'
import { HTTPException } from 'hono/http-exception'
import { NO_NAME, type EngineId, type Message, type Topic } from '../../shared/types'
import { resolveModel } from '../agent'
import { groupSummaryMd, topicClaudeMd, topicSummaryMd } from '../templates'
import {
  imagesDir,
  isGroupRef,
  isTopicName,
  logsDir,
  normalizeTopicName,
  toTopicName,
  topicDir,
  topicsDir,
  type TopicRef,
} from './paths'
import { localDate, localTime, stamp } from './date'
import { countUserMessages, readLastEntry, readRecent } from './log'
import { ensureAgentsLink, ensureUser } from './user'

interface TopicMeta {
  slug: string
  /** 名前をまだ付けていないサブトピックでは空文字。 */
  name: string
  emoji: string
  createdAt: string
  engine?: EngineId
  model?: string
  /** 自動で名前を付けにいったかどうか。失敗しても二度は試さない。 */
  nameTried?: boolean
}

/** 本人がこれだけ話したら、会話を読んで名前を付けにいく。 */
const AUTO_NAME_AFTER = 3

function metaFile(user: string, ref: TopicRef): string {
  return path.join(topicDir(user, ref), 'topic.json')
}

async function writeMeta(user: string, ref: TopicRef, meta: TopicMeta): Promise<void> {
  await fs.writeFile(metaFile(user, ref), JSON.stringify(meta, null, 2) + '\n')
}

/** 同じ並びの中で slug だけ差し替えた ref を作る。 */
function withSlug(ref: TopicRef, slug: string): TopicRef {
  return isGroupRef(ref) ? { topic: slug } : { topic: ref.topic, sub: slug }
}

/** 空いている名前になるまで、末尾の数字を増やしていく。 */
async function uniqueSlug(user: string, ref: TopicRef, base: string): Promise<string> {
  let candidate = base
  for (let i = 2; await topicExists(user, withSlug(ref, candidate)); i++) {
    candidate = `${base}-${i}`
  }
  return candidate
}

/** 名前なしで始めたときのフォルダ名。NAS を覗いたときに順番が分かるよう日付を入れる。 */
function placeholderSlug(): string {
  const now = new Date()
  return `untitled-${stamp(localDate(now))}-${localTime(now).replace(':', '')}`
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
      nameTried: parsed.nameTried,
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
    group: isGroupRef(ref) ? null : ref.topic,
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
  const last = isGroupRef(ref) ? null : await readLastEntry(user, ref)
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
 * トップレベルは常に要約を置く器で、会話は必ずその中に作る。
 * 器に会話がありえないので、器に変えられるかどうかを気にする必要もない。
 */
export async function createTopic(
  user: string,
  input: { name?: string; emoji?: string; template?: string; engine?: string; model?: string },
  group?: string,
): Promise<Topic> {
  const name = (input.name ?? '').trim()
  // 名前なしで始められるのはサブトピックだけ。器は人が名前を付けて作る。
  if (!name && !group) {
    throw new HTTPException(400, { message: 'トピック名を入力してください' })
  }
  if (name.length > 40) {
    throw new HTTPException(400, { message: 'トピック名が長すぎます' })
  }

  await ensureUser(user)

  // group は所属先の器。ある＝子を作る、無い＝器そのものを作る。
  const isChild = Boolean(group)

  if (group && !(await topicExists(user, { topic: group }))) {
    throw new HTTPException(404, { message: 'トピックが見つかりません' })
  }

  // 子の途中は sub: ''（slug 未定）。withSlug / isGroupRef だけが解釈する。
  const base: TopicRef = group ? { topic: group, sub: '' } : { topic: '' }
  let ref: TopicRef
  if (name) {
    ref = withSlug(base, toTopicName(name))
    if (await topicExists(user, ref)) {
      throw new HTTPException(409, { message: '同じ名前のトピックがあります' })
    }
  } else {
    // 仮の名前は同じ分に二つ作られうるので、空いているものを探す。
    ref = withSlug(base, await uniqueSlug(user, base, placeholderSlug()))
  }
  const slug = ref.sub ?? ref.topic

  const dir = topicDir(user, ref)
  if (isChild) {
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

  // 名前がまだ無いときは、雛形の見出しに仮の呼び名を入れておく。
  const label = name || NO_NAME
  await writeMeta(user, ref, meta)
  await fs.writeFile(path.join(dir, 'CLAUDE.md'), topicClaudeMd(input.template ?? 'plain', label))
  await fs.writeFile(
    path.join(dir, 'summary.md'),
    isChild ? topicSummaryMd(label) : groupSummaryMd(label),
  )
  await ensureAgentsLink(dir)

  return toTopic(meta, ref, null)
}

/** エンジンとモデルだけを差し替える。名前を変えるのは renameTopic。 */
export async function updateTopic(
  user: string,
  ref: TopicRef,
  input: { engine?: string; model?: string },
): Promise<Topic> {
  const meta = await readMeta(user, ref)
  const choice = resolveModel(input.engine ?? meta.engine, input.model ?? meta.model)

  const next: TopicMeta = { ...meta, engine: choice.engine, model: choice.model }
  await writeMeta(user, ref, next)

  return toTopic(next, ref, await readLastEntry(user, ref))
}

/**
 * 名前を付け直す。フォルダ名がそのまま名前なので、フォルダごと動かす。
 * 中の logs / images / summary.md は一緒に付いてくる。AGENTS.md のリンクは
 * CLAUDE.md への相対なので、動かしても切れない。
 */
export async function renameTopic(
  user: string,
  ref: TopicRef,
  input: { name: string; emoji?: string },
): Promise<Topic> {
  const name = normalizeTopicName(input.name)
  if (!name) {
    throw new HTTPException(400, { message: 'トピック名を入力してください' })
  }
  if (name.length > 40) {
    throw new HTTPException(400, { message: 'トピック名が長すぎます' })
  }

  const meta = await readMeta(user, ref)
  const emoji = input.emoji?.trim() || meta.emoji

  let next = ref
  const desired = toTopicName(name)
  if (desired !== meta.slug) {
    // 同じ器の中で名前がぶつかったら、末尾に数字を足して避ける。
    const slug = await uniqueSlug(user, ref, desired)
    next = withSlug(ref, slug)
    await fs.rename(topicDir(user, ref), topicDir(user, next))
  }

  const slug = next.sub ?? next.topic
  const meta2: TopicMeta = { ...meta, slug, name, emoji, nameTried: true }
  await writeMeta(user, next, meta2)

  return toTopic(meta2, next, await readLastEntry(user, next))
}

/**
 * 会話を読んで名前を付ける頃合いかどうか。名前が付いた後や、
 * 一度試して失敗した後には二度と立たない。
 */
export async function shouldAutoName(user: string, ref: TopicRef): Promise<boolean> {
  if (isGroupRef(ref)) return false

  const meta = await readMeta(user, ref)
  if (meta.name || meta.nameTried) return false

  return (await countUserMessages(user, ref)) >= AUTO_NAME_AFTER
}

/** 名前が付かなかったときも、試したことだけは残す。 */
export async function markNameTried(user: string, ref: TopicRef): Promise<void> {
  const meta = await readMeta(user, ref)
  await writeMeta(user, ref, { ...meta, nameTried: true })
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

/** 器の要約を書くときの材料。中のトピックそれぞれの要約と直近の会話。 */
export interface ChildSource {
  name: string
  summary: string
  history: Message[]
}

export async function readChildSources(
  user: string,
  topic: string,
  days: number,
): Promise<ChildSource[]> {
  const children = await listChildren(user, topic)
  const sources: ChildSource[] = []
  for (const child of children) {
    const ref = { topic, sub: child.slug }
    sources.push({
      name: child.name || NO_NAME,
      summary: await readSummary(user, ref),
      history: await readRecent(user, ref, days),
    })
  }
  return sources
}

export async function readClaude(user: string, ref: TopicRef): Promise<string> {
  return read(path.join(topicDir(user, ref), 'CLAUDE.md'))
}

/**
 * 子で話すときは、器の要約も一緒に効かせる。
 * 器には全体で共有する前提を、子にはその話に閉じた要約を置く。
 */
export async function readGroupSummary(user: string, ref: TopicRef): Promise<string> {
  if (isGroupRef(ref)) return ''
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

export async function writeClaude(user: string, ref: TopicRef, text: string): Promise<void> {
  const body = text.trim()
  await fs.writeFile(path.join(topicDir(user, ref), 'CLAUDE.md'), body ? body + '\n' : '')
}
