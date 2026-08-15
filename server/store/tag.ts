import fs from 'node:fs/promises'
import path from 'node:path'
import { DEFAULT_TAG_EMOJI, takeEmoji } from '../../shared/emoji'
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
  tagsMetaFile,
  toTopicName,
  type TopicName,
  type UserName,
} from './paths'
import { removeTagFromTopics, renameTagInTopics } from './topic'
import { ensureUser } from './user'

async function readEmojiMap(user: UserName): Promise<Record<string, string>> {
  try {
    const parsed = JSON.parse(await fs.readFile(tagsMetaFile(user), 'utf8')) as unknown
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {}
    const map: Record<string, string> = {}
    for (const [name, value] of Object.entries(parsed)) {
      const emoji = takeEmoji(value)
      if (emoji) map[name] = emoji
    }
    return map
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return {}
    throw error
  }
}

async function writeEmojiMap(user: UserName, map: Record<string, string>): Promise<void> {
  await ensureUser(user)
  await fs.writeFile(tagsMetaFile(user), JSON.stringify(map, null, 2) + '\n')
}

async function setEmoji(user: UserName, name: string, emoji?: string): Promise<string> {
  const map = await readEmojiMap(user)
  const next = takeEmoji(emoji) ?? map[name] ?? DEFAULT_TAG_EMOJI
  if (map[name] !== next) {
    map[name] = next
    await writeEmojiMap(user, map)
  }
  return next
}

async function moveEmoji(user: UserName, from: string, to: string): Promise<string> {
  const map = await readEmojiMap(user)
  const emoji = map[from] ?? DEFAULT_TAG_EMOJI
  delete map[from]
  map[to] = emoji
  await writeEmojiMap(user, map)
  return emoji
}

async function dropEmoji(user: UserName, name: string): Promise<void> {
  const map = await readEmojiMap(user)
  if (!(name in map)) return
  delete map[name]
  await writeEmojiMap(user, map)
}

function withEmoji(tag: { name: string; text: string }, map: Record<string, string>): Tag {
  return { ...tag, emoji: map[tag.name] ?? DEFAULT_TAG_EMOJI }
}

export async function listTags(user: UserName): Promise<Tag[]> {
  await ensureUser(user)
  await fs.mkdir(tagsDir(user), { recursive: true })

  let names: string[]
  try {
    names = await fs.readdir(tagsDir(user))
  } catch {
    return []
  }

  const map = await readEmojiMap(user)
  const tags: Tag[] = []
  for (const file of names) {
    if (!file.endsWith('.md')) continue
    const name = asTopicName(file.slice(0, -3))
    if (!name) continue
    tags.push(withEmoji({ name, text: await readMarkdown(tagFile(user, name)) }, map))
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
  const map = await readEmojiMap(user)
  return withEmoji({ name: tag, text: await readMarkdown(file) }, map)
}

export async function writeTag(user: UserName, tag: TopicName, text: string): Promise<Tag> {
  await ensureUser(user)
  await fs.mkdir(tagsDir(user), { recursive: true })
  await writeMarkdown(tagFile(user, tag), text)
  return readTag(user, tag)
}

export async function createTag(
  user: UserName,
  input: { name: string; text?: string; emoji?: string },
): Promise<Tag> {
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
  await writeMarkdown(file, input.text ?? '')
  const emoji = await setEmoji(user, tag, input.emoji)
  return { name: tag, emoji, text: await readMarkdown(file) }
}

/** 無いタグなら空のファイルを作る。自動タグ付けから呼ぶ。 */
export async function ensureTag(
  user: UserName,
  raw: string,
  emoji?: string,
): Promise<TopicName | null> {
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
    await setEmoji(user, tag, emoji)
    return tag
  }
  return tag
}

export async function renameTag(
  user: UserName,
  tag: TopicName,
  input: { name?: string; emoji?: string },
): Promise<Tag> {
  const current = await readTag(user, tag)
  const name = input.name !== undefined ? normalizeTopicName(input.name) : tag
  if (!name) throw new BadRequestError('タグ名を入力してください')
  if (name.length > 40) throw new BadRequestError('タグ名が長すぎます')
  const next = toTopicName(name)
  if (next !== name) throw new BadRequestError('タグ名が不正です')

  if (next === tag) {
    const emoji = await setEmoji(user, tag, input.emoji)
    return { ...current, emoji }
  }

  const dest = tagFile(user, next)
  try {
    await fs.stat(dest)
    throw new ConflictError('同じ名前のタグがあります')
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
  }

  await fs.rename(assertInsideDataDir(tagFile(user, tag)), assertInsideDataDir(dest))
  const emoji = await moveEmoji(user, tag, next)
  if (input.emoji) await setEmoji(user, next, input.emoji)
  await renameTagInTopics(user, tag, next)
  return { name: next, emoji: takeEmoji(input.emoji) ?? emoji, text: current.text }
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
  await dropEmoji(user, tag)
  await removeTagFromTopics(user, tag)
}

export async function readTagTexts(user: UserName, names: string[]): Promise<Tag[]> {
  const map = await readEmojiMap(user)
  const tags: Tag[] = []
  for (const raw of names) {
    const tag = asTopicName(raw)
    if (!tag) continue
    tags.push(withEmoji({ name: tag, text: await readMarkdown(tagFile(user, tag)) }, map))
  }
  return tags
}

export function assertTagName(value: string): TopicName {
  return assertTopicName(value)
}

export function tagBasename(file: string): string {
  return path.basename(file, '.md')
}
