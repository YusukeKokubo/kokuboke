import fs from 'node:fs/promises'
import path from 'node:path'
import { HTTPException } from 'hono/http-exception'
import type { Topic } from '../../shared/types'
import { topicClaudeMd, topicSummaryMd } from '../templates'
import { imagesDir, isSlug, logsDir, toSlug, topicDir, topicsDir } from './paths'
import { readLastEntry } from './log'
import { ensureUser } from './user'

interface TopicMeta {
  slug: string
  name: string
  emoji: string
  createdAt: string
}

function metaFile(user: string, topic: string): string {
  return path.join(topicDir(user, topic), 'topic.json')
}

export async function readTopicMeta(user: string, topic: string): Promise<TopicMeta> {
  try {
    const raw = await fs.readFile(metaFile(user, topic), 'utf8')
    const parsed = JSON.parse(raw) as Partial<TopicMeta>
    return {
      slug: topic,
      name: parsed.name ?? topic,
      emoji: parsed.emoji ?? '💬',
      createdAt: parsed.createdAt ?? new Date().toISOString(),
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      throw new HTTPException(404, { message: 'トピックが見つかりません' })
    }
    throw error
  }
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

    const meta = await readTopicMeta(user, name)
    const last = await readLastEntry(user, name)
    topics.push({
      ...meta,
      lastMessageAt: last?.at ?? null,
      preview: last ? last.text.replace(/\s+/g, ' ').slice(0, 60) : null,
    })
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
  input: { name: string; emoji?: string; template?: string; slug?: string },
): Promise<Topic> {
  const name = input.name.trim()
  if (!name) {
    throw new HTTPException(400, { message: 'トピック名を入力してください' })
  }
  if (name.length > 40) {
    throw new HTTPException(400, { message: 'トピック名が長すぎます' })
  }

  await ensureUser(user)

  const slug = input.slug && isSlug(input.slug) ? input.slug : toSlug(name)
  if (await topicExists(user, slug)) {
    throw new HTTPException(409, { message: '同じ名前のトピックがあります' })
  }

  const dir = topicDir(user, slug)
  await fs.mkdir(logsDir(user, slug), { recursive: true })
  await fs.mkdir(imagesDir(user, slug), { recursive: true })

  const meta: TopicMeta = {
    slug,
    name,
    emoji: input.emoji || '💬',
    createdAt: new Date().toISOString(),
  }

  await fs.writeFile(metaFile(user, slug), JSON.stringify(meta, null, 2) + '\n')
  await fs.writeFile(path.join(dir, 'CLAUDE.md'), topicClaudeMd(input.template ?? 'plain', name))
  await fs.writeFile(path.join(dir, 'summary.md'), topicSummaryMd(name))

  return { ...meta, lastMessageAt: null, preview: null }
}

export async function readSummary(user: string, topic: string): Promise<string> {
  try {
    return await fs.readFile(path.join(topicDir(user, topic), 'summary.md'), 'utf8')
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return ''
    throw error
  }
}
