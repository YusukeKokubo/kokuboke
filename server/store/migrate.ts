import fs from 'node:fs/promises'
import path from 'node:path'
import { readMarkdown, writeMarkdown } from './markdown'
import {
  asTopicName,
  tagFile,
  tagsDir,
  topicDir,
  topicsDir,
  type TopicName,
  type UserName,
} from './paths'
import {
  readMeta,
  topicFolderName,
  topicExists,
  uniqueSlug,
  writeMeta,
  type TopicMeta,
} from './topic'
import { ensureChatAgentsLink } from './user'

async function hasTopicJson(dir: string): Promise<boolean> {
  try {
    await fs.stat(path.join(dir, 'topic.json'))
    return true
  } catch {
    return false
  }
}

async function childIds(dir: string): Promise<string[]> {
  let entries: string[]
  try {
    entries = await fs.readdir(dir)
  } catch {
    return []
  }
  const names: string[] = []
  for (const name of entries) {
    if (!asTopicName(name)) continue
    if (await hasTopicJson(path.join(dir, name))) names.push(name)
  }
  return names
}

async function writeTagIfMissing(user: UserName, tag: TopicName, text: string): Promise<void> {
  await fs.mkdir(tagsDir(user), { recursive: true })
  const file = tagFile(user, tag)
  try {
    await fs.stat(file)
  } catch {
    await writeMarkdown(file, text)
  }
}

/**
 * 器と子の二段を、id フォルダと tags/{器名}.md に移す。
 * すでに一段なら何もしない。
 */
export async function migrateNestedTopics(user: UserName): Promise<void> {
  const root = topicsDir(user)
  let names: string[]
  try {
    names = await fs.readdir(root)
  } catch {
    return
  }

  for (const name of names) {
    const group = asTopicName(name)
    if (!group) continue
    const dir = path.join(root, name)
    if (!(await hasTopicJson(dir))) continue

    const children = await childIds(dir)
    if (children.length === 0) continue

    let groupMeta: TopicMeta
    try {
      groupMeta = await readMeta(user, group)
    } catch {
      continue
    }
    const tagName = asTopicName(groupMeta.name) ?? group
    const summary = await readMarkdown(path.join(dir, 'summary.md'))
    await writeTagIfMissing(user, tagName, summary)

    for (const child of children) {
      const childDir = path.join(dir, child)
      const keepId = child.startsWith('untitled-') ? asTopicName(child) : null
      const id =
        keepId && !(await topicExists(user, keepId))
          ? keepId
          : await uniqueSlug(user, topicFolderName(new Date()))

      const dest = topicDir(user, id)
      await fs.rename(childDir, dest)

      let meta: TopicMeta
      try {
        meta = await readMeta(user, id)
      } catch {
        continue
      }
      await writeMeta(user, id, { ...meta, slug: id, tags: [tagName] })
      await fs.rm(path.join(dest, 'CLAUDE.md'), { force: true })
      await fs.rm(path.join(dest, 'summary.md'), { force: true })
      await fs.rm(path.join(dest, 'AGENTS.md'), { force: true })
      await ensureChatAgentsLink(dest)
    }

    await fs.rm(dir, { recursive: true, force: true })
  }
}

/**
 * 古い untitled フォルダに uuid を振り、`YY-MM-DD` / `YY-MM-DD-見出し` へ動かす。
 * すでに id があり、フォルダ名も合っていれば触らない。
 * topic.json の知らないキー（昔の emoji など）は残す。
 */
export async function migrateTopicIds(user: UserName): Promise<void> {
  const root = topicsDir(user)
  let names: string[]
  try {
    names = await fs.readdir(root)
  } catch {
    return
  }

  for (const name of names) {
    const folder = asTopicName(name)
    if (!folder) continue
    const file = path.join(topicDir(user, folder), 'topic.json')
    if (!(await hasTopicJson(topicDir(user, folder)))) continue

    let raw: Record<string, unknown>
    try {
      raw = JSON.parse(await fs.readFile(file, 'utf8')) as Record<string, unknown>
    } catch {
      continue
    }

    const topicName = typeof raw.name === 'string' ? raw.name : ''
    const createdAt =
      typeof raw.createdAt === 'string' && !Number.isNaN(Date.parse(raw.createdAt))
        ? new Date(raw.createdAt)
        : new Date()
    const id = typeof raw.id === 'string' && raw.id ? raw.id : crypto.randomUUID()
    const dest = await uniqueSlug(user, topicFolderName(createdAt, topicName), folder)

    let current = folder
    if (dest !== folder) {
      await fs.rename(topicDir(user, folder), topicDir(user, dest))
      current = dest
    }

    if (raw.id === id && raw.slug === current) continue
    await fs.writeFile(
      path.join(topicDir(user, current), 'topic.json'),
      JSON.stringify({ ...raw, id, slug: current }, null, 2) + '\n',
    )
  }
}
