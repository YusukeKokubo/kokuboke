import fs from 'node:fs/promises'
import path from 'node:path'
import {
  NO_NAME,
  type ChildTopic,
  type EngineId,
  type GroupTopic,
  type Message,
  type Topic,
} from '../../shared/types'
import { BadRequestError, ConflictError, NotFoundError } from '../errors'
import { resolveModel } from '../agent'
import { groupSummaryMd, topicClaudeMd, topicSummaryMd } from '../templates'
import {
  asTopicName,
  imagesDir,
  isGroupRef,
  logsDir,
  normalizeTopicName,
  refSlug,
  toTopicName,
  topicDir,
  topicRef,
  topicsDir,
  type TopicName,
  type VerifiedTopicRef,
  type UserName,
} from './paths'
import { localDate, localTime, stamp } from './date'
import { countUserMessages, readLastEntry, readRecent } from './log'
import { readMarkdown, writeMarkdown } from './markdown'
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

function metaFile(user: UserName, ref: VerifiedTopicRef): string {
  return path.join(topicDir(user, ref), 'topic.json')
}

async function writeMeta(user: UserName, ref: VerifiedTopicRef, meta: TopicMeta): Promise<void> {
  await fs.writeFile(metaFile(user, ref), JSON.stringify(meta, null, 2) + '\n')
}

/** 親（器作成なら無し）と slug から完成した ref を作る。 */
function makeRef(group: TopicName | undefined, slug: TopicName): VerifiedTopicRef {
  return group ? topicRef(group, slug) : topicRef(slug)
}

/** 空いている名前になるまで、末尾の数字を増やしていく。 */
async function uniqueSlug(
  user: UserName,
  group: TopicName | undefined,
  base: TopicName,
): Promise<TopicName> {
  let candidate = base
  for (let i = 2; await topicExists(user, makeRef(group, candidate)); i++) {
    // base が上限ぎりぎりだと `-2` でバイト数を超えうる。通らなければ toTopicName に落とす。
    const next = `${base}-${i}`
    candidate = asTopicName(next) ?? toTopicName(next)
  }
  return candidate
}

/** 名前なしで始めたときのフォルダ名。NAS を覗いたときに順番が分かるよう日付を入れる。 */
function placeholderSlug(): TopicName {
  const now = new Date()
  const name = `untitled-${stamp(localDate(now))}-${localTime(now).replace(':', '')}`
  return asTopicName(name) ?? toTopicName(name)
}

async function readMeta(user: UserName, ref: VerifiedTopicRef): Promise<TopicMeta> {
  try {
    const raw = await fs.readFile(metaFile(user, ref), 'utf8')
    const parsed = JSON.parse(raw) as Partial<TopicMeta>
    const slug = refSlug(ref)
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
      throw new NotFoundError('トピックが見つかりません')
    }
    throw error
  }
}

function toTopic(
  meta: TopicMeta,
  ref: VerifiedTopicRef,
  last: { at: string; text: string } | null,
): Topic {
  const choice = resolveModel(meta.engine, meta.model)
  const fields = {
    slug: meta.slug,
    name: meta.name,
    emoji: meta.emoji,
    createdAt: meta.createdAt,
    engine: choice.engine,
    model: choice.model,
    modelLabel: choice.label,
    lastMessageAt: last?.at ?? null,
    preview: last ? last.text.replace(/\s+/g, ' ').slice(0, 60) : null,
  }
  if (isGroupRef(ref)) {
    return { ...fields, kind: 'group', group: null, children: [] }
  }
  return { ...fields, kind: 'child', group: ref.topic }
}

export async function readTopic(user: UserName, ref: VerifiedTopicRef): Promise<Topic> {
  // トップレベルは器なので自分では話さない。読むログもない。
  const last = isGroupRef(ref) ? null : await readLastEntry(user, ref)
  return toTopic(await readMeta(user, ref), ref, last)
}

export async function topicExists(user: UserName, ref: VerifiedTopicRef): Promise<boolean> {
  try {
    await fs.stat(metaFile(user, ref))
    return true
  } catch {
    return false
  }
}

/** そのフォルダの直下にある、topic.json を持つフォルダの名前。 */
async function childNames(user: UserName, topic: TopicName): Promise<TopicName[]> {
  let entries: string[]
  try {
    entries = await fs.readdir(topicDir(user, topicRef(topic)))
  } catch {
    return []
  }

  const names: TopicName[] = []
  for (const name of entries) {
    // logs や images は topic.json を持たないので、ここで自然に外れる。
    const sub = asTopicName(name)
    if (!sub) continue
    if (!(await topicExists(user, topicRef(topic, sub)))) continue
    names.push(sub)
  }
  return names
}

/** 一番新しく話した順。まだ話していないものは作成日で並べる。 */
function byRecency(a: Topic, b: Topic): number {
  return (b.lastMessageAt ?? b.createdAt).localeCompare(a.lastMessageAt ?? a.createdAt)
}

export async function listChildren(user: UserName, topic: TopicName): Promise<ChildTopic[]> {
  const children: ChildTopic[] = []
  for (const sub of await childNames(user, topic)) {
    const child = await readTopic(user, topicRef(topic, sub))
    if (child.kind !== 'child') continue
    children.push(child)
  }
  return children.sort(byRecency)
}

export async function listTopics(user: UserName): Promise<GroupTopic[]> {
  await ensureUser(user)

  let names: string[]
  try {
    names = await fs.readdir(topicsDir(user))
  } catch {
    return []
  }

  const topics: GroupTopic[] = []
  for (const name of names) {
    // 手で置かれた不正な名前のフォルダは黙って無視する。
    const slug = asTopicName(name)
    if (!slug) continue
    if (!(await topicExists(user, topicRef(slug)))) continue

    const topic = await readTopic(user, topicRef(slug))
    if (topic.kind !== 'group') continue

    const children = await listChildren(user, slug)
    // 器自身は話さないので、一覧に出す時刻と抜粋は一番新しい子から借りる。
    const newest = children[0]
    topics.push({
      ...topic,
      children,
      lastMessageAt: newest?.lastMessageAt ?? topic.lastMessageAt,
      preview: newest?.preview ?? topic.preview,
    })
  }

  return topics.sort(byRecency)
}

/**
 * トップレベルは常に要約を置く器で、会話は必ずその中に作る。
 * 器に会話がありえないので、器に変えられるかどうかを気にする必要もない。
 */
export async function createTopic(
  user: UserName,
  input: { name?: string; emoji?: string; template?: string; engine?: string; model?: string },
  group?: TopicName,
): Promise<Topic> {
  const name = (input.name ?? '').trim()
  // 名前なしで始められるのはサブトピックだけ。器は人が名前を付けて作る。
  if (!name && !group) {
    throw new BadRequestError('トピック名を入力してください')
  }
  if (name.length > 40) {
    throw new BadRequestError('トピック名が長すぎます')
  }

  await ensureUser(user)

  // group は所属先の器。ある＝子を作る、無い＝器そのものを作る。
  const isChild = Boolean(group)

  if (group && !(await topicExists(user, topicRef(group)))) {
    throw new NotFoundError('トピックが見つかりません')
  }

  let slug: TopicName
  if (name) {
    slug = toTopicName(name)
    if (await topicExists(user, makeRef(group, slug))) {
      throw new ConflictError('同じ名前のトピックがあります')
    }
  } else {
    // 仮の名前は同じ分に二つ作られうるので、空いているものを探す。
    slug = await uniqueSlug(user, group, placeholderSlug())
  }
  const ref = makeRef(group, slug)

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
  user: UserName,
  ref: VerifiedTopicRef,
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
  user: UserName,
  ref: VerifiedTopicRef,
  input: { name: string; emoji?: string },
): Promise<Topic> {
  const name = normalizeTopicName(input.name)
  if (!name) {
    throw new BadRequestError('トピック名を入力してください')
  }
  if (name.length > 40) {
    throw new BadRequestError('トピック名が長すぎます')
  }

  const meta = await readMeta(user, ref)
  const emoji = input.emoji?.trim() || meta.emoji

  let next = ref
  const desired = toTopicName(name)
  if (desired !== meta.slug) {
    // 同じ器の中で名前がぶつかったら、末尾に数字を足して避ける。
    const group = isGroupRef(ref) ? undefined : ref.topic
    const slug = await uniqueSlug(user, group, desired)
    next = makeRef(group, slug)
    await fs.rename(topicDir(user, ref), topicDir(user, next))
  }

  const slug = refSlug(next)
  const meta2: TopicMeta = { ...meta, slug, name, emoji, nameTried: true }
  await writeMeta(user, next, meta2)

  return toTopic(meta2, next, await readLastEntry(user, next))
}

/**
 * 会話を読んで名前を付ける頃合いかどうか。名前が付いた後や、
 * 一度試して失敗した後には二度と立たない。
 */
export async function shouldAutoName(user: UserName, ref: VerifiedTopicRef): Promise<boolean> {
  if (isGroupRef(ref)) return false

  const meta = await readMeta(user, ref)
  if (meta.name || meta.nameTried) return false

  return (await countUserMessages(user, ref)) >= AUTO_NAME_AFTER
}

/** 名前が付かなかったときも、試したことだけは残す。 */
export async function markNameTried(user: UserName, ref: VerifiedTopicRef): Promise<void> {
  const meta = await readMeta(user, ref)
  await writeMeta(user, ref, { ...meta, nameTried: true })
}

export async function readSummary(user: UserName, ref: VerifiedTopicRef): Promise<string> {
  return readMarkdown(path.join(topicDir(user, ref), 'summary.md'))
}

/** 器の要約を書くときの材料。中のトピックそれぞれの要約と直近の会話。 */
export interface ChildSource {
  name: string
  summary: string
  history: Message[]
}

export async function readChildSources(
  user: UserName,
  topic: TopicName,
  days: number,
): Promise<ChildSource[]> {
  const children = await listChildren(user, topic)
  const sources: ChildSource[] = []
  for (const child of children) {
    const sub = asTopicName(child.slug)
    if (!sub) continue
    const ref = topicRef(topic, sub)
    sources.push({
      name: child.name || NO_NAME,
      summary: await readSummary(user, ref),
      history: await readRecent(user, ref, days),
    })
  }
  return sources
}

export async function readClaude(user: UserName, ref: VerifiedTopicRef): Promise<string> {
  return readMarkdown(path.join(topicDir(user, ref), 'CLAUDE.md'))
}

/**
 * 子で話すときは、器の要約も一緒に効かせる。
 * 器には全体で共有する前提を、子にはその話に閉じた要約を置く。
 */
export async function readGroupSummary(user: UserName, ref: VerifiedTopicRef): Promise<string> {
  if (isGroupRef(ref)) return ''
  return readSummary(user, topicRef(ref.topic))
}

/** summary.md を差し替える。書き換えるのはここだけで、AI 側には書かせない。 */
export async function writeSummary(user: UserName, ref: VerifiedTopicRef, text: string): Promise<void> {
  await writeMarkdown(path.join(topicDir(user, ref), 'summary.md'), text)
}

export async function writeClaude(user: UserName, ref: VerifiedTopicRef, text: string): Promise<void> {
  await writeMarkdown(path.join(topicDir(user, ref), 'CLAUDE.md'), text)
}
