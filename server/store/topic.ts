import fs from 'node:fs/promises'
import path from 'node:path'
import { HTTPException } from 'hono/http-exception'
import type { EngineId, Topic } from '../../shared/types'
import { resolveModel } from '../agent'
import { topicClaudeMd, topicSummaryMd } from '../templates'
import { imagesDir, isSlug, logsDir, toSlug, topicDir, topicsDir, userDir } from './paths'
import { readLastEntry } from './log'
import { ensureUser } from './user'

interface TopicMeta {
  slug: string
  name: string
  emoji: string
  createdAt: string
  engine?: EngineId
  model?: string
}

function metaFile(user: string, topic: string): string {
  return path.join(topicDir(user, topic), 'topic.json')
}

async function readMeta(user: string, topic: string): Promise<TopicMeta> {
  try {
    const raw = await fs.readFile(metaFile(user, topic), 'utf8')
    const parsed = JSON.parse(raw) as Partial<TopicMeta>
    return {
      slug: topic,
      name: parsed.name ?? topic,
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
    lastMessageAt: last?.at ?? null,
    preview: last ? last.text.replace(/\s+/g, ' ').slice(0, 60) : null,
  }
}

export async function readTopic(user: string, topic: string): Promise<Topic> {
  return toTopic(await readMeta(user, topic), await readLastEntry(user, topic))
}

export async function topicExists(user: string, topic: string): Promise<boolean> {
  try {
    await fs.stat(metaFile(user, topic))
    return true
  } catch {
    return false
  }
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
    if (!isSlug(name)) continue
    if (!(await topicExists(user, name))) continue
    topics.push(await readTopic(user, name))
  }

  // 直近に話したものを上に。まだ話していないトピックは作成日で並べる。
  return topics.sort((a, b) => {
    const at = a.lastMessageAt ?? a.createdAt
    const bt = b.lastMessageAt ?? b.createdAt
    return bt.localeCompare(at)
  })
}

export async function createTopic(
  user: string,
  input: { name: string; emoji?: string; template?: string; engine?: string; model?: string },
): Promise<Topic> {
  const name = input.name.trim()
  if (!name) {
    throw new HTTPException(400, { message: 'トピック名を入力してください' })
  }
  if (name.length > 40) {
    throw new HTTPException(400, { message: 'トピック名が長すぎます' })
  }

  await ensureUser(user)

  const slug = toSlug(name)
  if (await topicExists(user, slug)) {
    throw new HTTPException(409, { message: '同じ名前のトピックがあります' })
  }

  const dir = topicDir(user, slug)
  await fs.mkdir(logsDir(user, slug), { recursive: true })
  await fs.mkdir(imagesDir(user, slug), { recursive: true })

  const choice = resolveModel(input.engine, input.model)
  const meta: TopicMeta = {
    slug,
    name,
    emoji: input.emoji || '💬',
    createdAt: new Date().toISOString(),
    engine: choice.engine,
    model: choice.model,
  }

  await fs.writeFile(metaFile(user, slug), JSON.stringify(meta, null, 2) + '\n')
  await fs.writeFile(path.join(dir, 'CLAUDE.md'), topicClaudeMd(input.template ?? 'plain', name))
  await fs.writeFile(path.join(dir, 'summary.md'), topicSummaryMd(name))

  return toTopic(meta, null)
}

/** いまのところ変えられるのはエンジンとモデルだけ。 */
export async function updateTopic(
  user: string,
  topic: string,
  input: { engine?: string; model?: string },
): Promise<Topic> {
  const meta = await readMeta(user, topic)
  const choice = resolveModel(input.engine ?? meta.engine, input.model ?? meta.model)

  const next: TopicMeta = { ...meta, engine: choice.engine, model: choice.model }
  await fs.writeFile(metaFile(user, topic), JSON.stringify(next, null, 2) + '\n')

  return toTopic(next, await readLastEntry(user, topic))
}

async function read(file: string): Promise<string> {
  try {
    return await fs.readFile(file, 'utf8')
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return ''
    throw error
  }
}

export async function readSummary(user: string, topic: string): Promise<string> {
  return read(path.join(topicDir(user, topic), 'summary.md'))
}

/**
 * 人物とトピックの CLAUDE.md をつないだもの。
 * Claude Code は自分で読むので使わないが、cursor-agent には本文で渡す必要がある。
 */
export async function readPersona(user: string, topic: string): Promise<string> {
  const [person, role] = await Promise.all([
    read(path.join(userDir(user), 'CLAUDE.md')),
    read(path.join(topicDir(user, topic), 'CLAUDE.md')),
  ])
  return [person.trim(), role.trim()].filter(Boolean).join('\n\n---\n\n')
}
