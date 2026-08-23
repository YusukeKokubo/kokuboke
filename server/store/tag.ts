import fs from 'node:fs/promises'
import path from 'node:path'
import { DEFAULT_TAG_EMOJI, takeEmoji } from '../../shared/emoji'
import type { Tag, TagOrganizeAction } from '../../shared/types'
import { BadRequestError, ConflictError, NotFoundError } from '../errors'
import { readMarkdown, writeMarkdown } from './markdown'
import {
  asTopicName,
  assertInsideDataDir,
  assertTopicName,
  normalizeGroup,
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

interface TagMeta {
  emoji: string
  group: string
}

function parseMetaValue(value: unknown): TagMeta | null {
  if (typeof value === 'string') {
    const emoji = takeEmoji(value)
    return emoji ? { emoji, group: '' } : null
  }
  if (!value || typeof value !== 'object') return null
  const item = value as { emoji?: unknown; group?: unknown }
  const emoji = takeEmoji(item.emoji) ?? DEFAULT_TAG_EMOJI
  const group = typeof item.group === 'string' ? normalizeGroup(item.group) : ''
  return { emoji, group }
}

async function readMetaMap(user: UserName): Promise<Record<string, TagMeta>> {
  try {
    const parsed = JSON.parse(await fs.readFile(tagsMetaFile(user), 'utf8')) as unknown
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {}
    const map: Record<string, TagMeta> = {}
    for (const [name, value] of Object.entries(parsed)) {
      const meta = parseMetaValue(value)
      if (meta) map[name] = meta
    }
    return map
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return {}
    throw error
  }
}

async function writeMetaMap(user: UserName, map: Record<string, TagMeta>): Promise<void> {
  await ensureUser(user)
  const serialized: Record<string, string | { emoji: string; group: string }> = {}
  for (const [name, meta] of Object.entries(map)) {
    serialized[name] = meta.group ? { emoji: meta.emoji, group: meta.group } : meta.emoji
  }
  await fs.writeFile(tagsMetaFile(user), JSON.stringify(serialized, null, 2) + '\n')
}

async function setMeta(
  user: UserName,
  name: string,
  input: { emoji?: string; group?: string },
): Promise<TagMeta> {
  const map = await readMetaMap(user)
  const current = map[name] ?? { emoji: DEFAULT_TAG_EMOJI, group: '' }
  const next: TagMeta = {
    emoji: takeEmoji(input.emoji) ?? current.emoji,
    group: input.group !== undefined ? normalizeGroup(input.group) : current.group,
  }
  if (current.emoji !== next.emoji || current.group !== next.group || !(name in map)) {
    map[name] = next
    await writeMetaMap(user, map)
  }
  return next
}

async function moveMeta(user: UserName, from: string, to: string): Promise<TagMeta> {
  const map = await readMetaMap(user)
  const meta = map[from] ?? { emoji: DEFAULT_TAG_EMOJI, group: '' }
  delete map[from]
  map[to] = meta
  await writeMetaMap(user, map)
  return meta
}

async function dropMeta(user: UserName, name: string): Promise<void> {
  const map = await readMetaMap(user)
  if (!(name in map)) return
  delete map[name]
  await writeMetaMap(user, map)
}

function withMeta(tag: { name: string; text: string }, map: Record<string, TagMeta>): Tag {
  const meta = map[tag.name]
  return {
    ...tag,
    emoji: meta?.emoji ?? DEFAULT_TAG_EMOJI,
    group: meta?.group ?? '',
  }
}

function compareTags(a: Tag, b: Tag): number {
  if (!a.group && b.group) return 1
  if (a.group && !b.group) return -1
  const group = a.group.localeCompare(b.group, 'ja')
  if (group !== 0) return group
  return a.name.localeCompare(b.name, 'ja')
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

  const map = await readMetaMap(user)
  const tags: Tag[] = []
  for (const file of names) {
    if (!file.endsWith('.md')) continue
    const name = asTopicName(file.slice(0, -3))
    if (!name) continue
    tags.push(withMeta({ name, text: await readMarkdown(tagFile(user, name)) }, map))
  }
  return tags.sort(compareTags)
}

export async function readTag(user: UserName, tag: TopicName): Promise<Tag> {
  const file = tagFile(user, tag)
  try {
    await fs.stat(file)
  } catch {
    throw new NotFoundError('タグが見つかりません')
  }
  const map = await readMetaMap(user)
  return withMeta({ name: tag, text: await readMarkdown(file) }, map)
}

export async function writeTag(user: UserName, tag: TopicName, text: string): Promise<Tag> {
  await ensureUser(user)
  await fs.mkdir(tagsDir(user), { recursive: true })
  await writeMarkdown(tagFile(user, tag), text)
  return readTag(user, tag)
}

export async function createTag(
  user: UserName,
  input: { name: string; text?: string; emoji?: string; group?: string },
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
  await setMeta(user, tag, { emoji: input.emoji, group: input.group ?? '' })
  return readTag(user, tag)
}

/** 無いタグなら空のファイルを作る。自動タグ付けから呼ぶ。 */
export async function ensureTag(
  user: UserName,
  raw: string,
  emoji?: string,
  group?: string,
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
    await setMeta(user, tag, { emoji, group: group ?? '' })
    return tag
  }
  return tag
}

export async function renameTag(
  user: UserName,
  tag: TopicName,
  input: { name?: string; emoji?: string; group?: string },
): Promise<Tag> {
  await readTag(user, tag)
  const name = input.name !== undefined ? normalizeTopicName(input.name) : tag
  if (!name) throw new BadRequestError('タグ名を入力してください')
  if (name.length > 40) throw new BadRequestError('タグ名が長すぎます')
  const next = toTopicName(name)
  if (next !== name) throw new BadRequestError('タグ名が不正です')

  if (next === tag) {
    await setMeta(user, tag, { emoji: input.emoji, group: input.group })
    return readTag(user, tag)
  }

  const dest = tagFile(user, next)
  try {
    await fs.stat(dest)
    throw new ConflictError('同じ名前のタグがあります')
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
  }

  await fs.rename(assertInsideDataDir(tagFile(user, tag)), assertInsideDataDir(dest))
  await moveMeta(user, tag, next)
  if (input.emoji !== undefined || input.group !== undefined) {
    await setMeta(user, next, { emoji: input.emoji, group: input.group })
  }
  await renameTagInTopics(user, tag, next)
  return readTag(user, next)
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
  await dropMeta(user, tag)
  await removeTagFromTopics(user, tag)
}

export async function readTagTexts(user: UserName, names: string[]): Promise<Tag[]> {
  const map = await readMetaMap(user)
  const tags: Tag[] = []
  for (const raw of names) {
    const tag = asTopicName(raw)
    if (!tag) continue
    tags.push(withMeta({ name: tag, text: await readMarkdown(tagFile(user, tag)) }, map))
  }
  return tags
}

/** 寄せ先が無ければ改名。あれば本文を足して、会話を付け替え、元を消す。 */
export async function mergeTags(user: UserName, from: TopicName, to: TopicName): Promise<Tag> {
  if (from === to) return readTag(user, to)
  const source = await readTag(user, from)
  try {
    await fs.stat(tagFile(user, to))
  } catch {
    return renameTag(user, from, { name: to })
  }

  const dest = await readTag(user, to)
  const parts = [dest.text.trim(), source.text.trim()].filter(Boolean)
  await writeMarkdown(tagFile(user, to), parts.join('\n\n'))
  if (!dest.group && source.group) {
    await setMeta(user, to, { group: source.group })
  }
  await renameTagInTopics(user, from, to)
  await fs.unlink(assertInsideDataDir(tagFile(user, from)))
  await dropMeta(user, from)
  return readTag(user, to)
}

export async function applyOrganize(user: UserName, actions: TagOrganizeAction[]): Promise<Tag[]> {
  for (const action of actions) {
    if (action.type !== 'merge') continue
    const from = asTopicName(action.from)
    const toName = normalizeTopicName(action.to)
    if (!from || !toName || toName.length > 40) continue
    const to = asTopicName(toName)
    if (!to) continue
    try {
      await readTag(user, from)
    } catch {
      continue
    }
    await mergeTags(user, from, to)
  }

  for (const action of actions) {
    if (action.type !== 'shelf') continue
    const name = asTopicName(action.name)
    if (!name) continue
    try {
      await renameTag(user, name, { group: action.group })
    } catch {
      // 寄せたあと無くなっている名前は飛ばす
    }
  }

  for (const action of actions) {
    if (action.type !== 'remove') continue
    const name = asTopicName(action.name)
    if (!name) continue
    try {
      await deleteTag(user, name)
    } catch {
      // 既に寄せて消えている名前は飛ばす
    }
  }

  return listTags(user)
}

export function assertTagName(value: string): TopicName {
  return assertTopicName(value)
}

export function tagBasename(file: string): string {
  return path.basename(file, '.md')
}
