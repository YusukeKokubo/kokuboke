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
  placeholderSlug,
  readMeta,
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
      const id = keepId && !(await topicExists(user, keepId)) ? keepId : await uniqueSlug(user, placeholderSlug())

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
