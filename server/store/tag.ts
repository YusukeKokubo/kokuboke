import fs from 'node:fs/promises'
import path from 'node:path'
import type { Tag } from '../../shared/types'
import { BadRequestError, ConflictError, NotFoundError } from '../errors'
import { readMarkdown, writeMarkdown } from './markdown'
import {
  asTopicName,
  assertInsideDataDir,
  assertTopicName,
  normalizeTopicName,
  tagFile,
  tagsDir,
  toTopicName,
  type TopicName,
  type UserName,
} from './paths'
import { removeTagFromTopics, renameTagInTopics } from './topic'
import { ensureUser } from './user'

export async function listTags(user: UserName): Promise<Tag[]> {
  await ensureUser(user)
  await fs.mkdir(tagsDir(user), { recursive: true })

  let names: string[]
  try {
    names = await fs.readdir(tagsDir(user))
  } catch {
    return []
  }

  const tags: Tag[] = []
  for (const file of names) {
    if (!file.endsWith('.md')) continue
    const name = asTopicName(file.slice(0, -3))
    if (!name) continue
    tags.push({ name, text: await readMarkdown(tagFile(user, name)) })
  }
  return tags.sort((a, b) => a.name.localeCompare(b.name, 'ja'))
}

export async function readTag(user: UserName, tag: TopicName): Promise<Tag> {
  const file = tagFile(user, tag)
  try {
    await fs.stat(file)
  } catch {
    throw new NotFoundError('タグが見つかりません')
  }
  return { name: tag, text: await readMarkdown(file) }
}

export async function writeTag(user: UserName, tag: TopicName, text: string): Promise<Tag> {
  await ensureUser(user)
  await fs.mkdir(tagsDir(user), { recursive: true })
  await writeMarkdown(tagFile(user, tag), text)
  return { name: tag, text: await readMarkdown(tagFile(user, tag)) }
}

export async function createTag(user: UserName, input: { name: string; text?: string }): Promise<Tag> {
  const name = normalizeTopicName(input.name)
  if (!name) throw new BadRequestError('タグ名を入力してください')
  if (name.length > 40) throw new BadRequestError('タグ名が長すぎます')
  const tag = toTopicName(name)
  if (tag !== name) throw new BadRequestError('タグ名が不正です')

  await ensureUser(user)
  await fs.mkdir(tagsDir(user), { recursive: true })
  const file = tagFile(user, tag)
  try {
    await fs.stat(file)
    throw new ConflictError('同じ名前のタグがあります')
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
  }
  return writeTag(user, tag, input.text ?? '')
}

/** 無いタグなら空のファイルを作る。自動タグ付けから呼ぶ。 */
export async function ensureTag(user: UserName, raw: string): Promise<TopicName | null> {
  const name = normalizeTopicName(raw)
  if (!name || name.length > 40) return null
  const tag = asTopicName(name)
  if (!tag) return null
  await ensureUser(user)
  await fs.mkdir(tagsDir(user), { recursive: true })
  const file = tagFile(user, tag)
  try {
    await fs.stat(file)
  } catch {
    await writeMarkdown(file, '')
  }
  return tag
}

export async function renameTag(
  user: UserName,
  tag: TopicName,
  input: { name: string },
): Promise<Tag> {
  const name = normalizeTopicName(input.name)
  if (!name) throw new BadRequestError('タグ名を入力してください')
  if (name.length > 40) throw new BadRequestError('タグ名が長すぎます')
  const next = toTopicName(name)
  if (next !== name) throw new BadRequestError('タグ名が不正です')

  const current = await readTag(user, tag)
  if (next === tag) return current

  const dest = tagFile(user, next)
  try {
    await fs.stat(dest)
    throw new ConflictError('同じ名前のタグがあります')
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
  }

  await fs.rename(assertInsideDataDir(tagFile(user, tag)), assertInsideDataDir(dest))
  await renameTagInTopics(user, tag, next)
  return { name: next, text: current.text }
}

export async function deleteTag(user: UserName, tag: TopicName): Promise<void> {
  const file = assertInsideDataDir(tagFile(user, tag))
  try {
    await fs.unlink(file)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      throw new NotFoundError('タグが見つかりません')
    }
    throw error
  }
  await removeTagFromTopics(user, tag)
}

export async function readTagTexts(user: UserName, names: string[]): Promise<Tag[]> {
  const tags: Tag[] = []
  for (const raw of names) {
    const tag = asTopicName(raw)
    if (!tag) continue
    tags.push({ name: tag, text: await readMarkdown(tagFile(user, tag)) })
  }
  return tags
}

export function assertTagName(value: string): TopicName {
  return assertTopicName(value)
}

export function tagBasename(file: string): string {
  return path.basename(file, '.md')
}
