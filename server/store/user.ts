import fs from 'node:fs/promises'
import path from 'node:path'
import { config } from '../config'
import {
  familyAgentsMd,
  familyOrganizeMd,
  familyProfileMd,
  userAgentsMd,
  userOrganizeMd,
  userProfileMd,
} from '../templates'
import { localDate, localTime } from '../../shared/date'
import { readMarkdown, writeMarkdown } from './markdown'
import {
  assertUser,
  familyUser,
  isTopicName,
  memoryFile,
  organizeFile,
  tagsDir,
  topicsDir,
  userDir,
  type UserName,
} from './paths'

async function writeIfMissing(file: string, content: string): Promise<void> {
  try {
    await fs.writeFile(file, content, { flag: 'wx' })
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error
  }
}

/**
 * 人格ファイルは AGENTS.md 一枚。Claude Code（2.1.277 以降）も cursor-agent も、
 * 作業ディレクトリから親を遡って AGENTS.md を読む。
 *
 * 以前は CLAUDE.md を実体にして AGENTS.md → CLAUDE.md のリンクを張っていた
 * （Claude Code が AGENTS.md を読まなかったため）。その形が残っていれば、
 * 中身を AGENTS.md へ移して CLAUDE.md とリンクを消す。Claude Code は
 * CLAUDE.md が一つでもあると AGENTS.md を読まないので、残しておけない。
 *
 * リンクかどうかは見ない。SMB 越し（手元の開発サーバー）ではリンクが普通の
 * ファイルに見えるので、lstat で判断すると NAS 上のリンクを宙ぶらりんにする。
 * 代わりに AGENTS.md の中身を読んでから名前を消し、実ファイルとして書き直す。
 * リンクでも実ファイルでも結果は同じになる。
 * 手で書かれた別内容の AGENTS.md は尊重し、CLAUDE.md は .bak に退ける。
 */
export async function migratePersonaFile(dir: string): Promise<void> {
  const claude = path.join(dir, 'CLAUDE.md')
  const agents = path.join(dir, 'AGENTS.md')

  const claudeText = await readIfExists(claude)
  if (claudeText === null) return
  const agentsText = await readIfExists(agents)

  if (agentsText !== null) await fs.unlink(agents)
  await fs.writeFile(agents, agentsText ?? claudeText, 'utf8')

  if (agentsText !== null && agentsText !== claudeText) {
    await fs.rename(claude, path.join(dir, 'CLAUDE.md.bak'))
    console.warn(`[store] AGENTS.md と CLAUDE.md の中身が違うので、CLAUDE.md を CLAUDE.md.bak に退けました: ${dir}`)
    return
  }
  await fs.unlink(claude)
  console.info(`[store] CLAUDE.md を AGENTS.md に移しました: ${dir}`)
}

async function readIfExists(file: string): Promise<string | null> {
  try {
    return await fs.readFile(file, 'utf8')
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null
    throw error
  }
}

/**
 * 会話フォルダに張っていた AGENTS.md → ../../CLAUDE.md のリンクを外す。
 * SMB 越しではリンクが実ファイルに見えるので、リンクか、人直下の AGENTS.md と
 * 中身が同じなら消す。会話だけの指示として別に書かれたものは残す。
 */
export async function removeChatAgentsLink(dir: string, persona: string): Promise<void> {
  const link = path.join(dir, 'AGENTS.md')
  let stat
  try {
    stat = await fs.lstat(link)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return
    throw error
  }
  if (stat.isSymbolicLink()) {
    await fs.unlink(link)
    return
  }
  const text = await readIfExists(link)
  if (text !== null && text === persona) await fs.unlink(link)
}

/** ユーザーのフォルダと雛形を用意する。既にあるファイルは触らない。家族スペースは先頭で分岐する。 */
export async function ensureUser(user: UserName): Promise<void> {
  if (user === familyUser()) {
    await ensureFamily()
    return
  }

  const dir = userDir(user)
  await fs.mkdir(topicsDir(user), { recursive: true })
  await fs.mkdir(tagsDir(user), { recursive: true })
  await migratePersonaFile(dir)
  await writeIfMissing(path.join(dir, 'AGENTS.md'), userAgentsMd(user))
  await writeIfMissing(path.join(dir, 'profile.md'), userProfileMd(user))
  await writeIfMissing(organizeFile(user), userOrganizeMd(user))
}

/** 家族共有スペースのフォルダと雛形を用意する。 */
export async function ensureFamily(): Promise<void> {
  const user = familyUser()
  const dir = userDir(user)
  await fs.mkdir(topicsDir(user), { recursive: true })
  await fs.mkdir(tagsDir(user), { recursive: true })
  await migratePersonaFile(dir)
  await writeIfMissing(path.join(dir, 'AGENTS.md'), familyAgentsMd())
  await writeIfMissing(path.join(dir, 'profile.md'), familyProfileMd())
  await writeIfMissing(organizeFile(user), familyOrganizeMd())
}

async function removeTopicAgentsLinks(user: UserName): Promise<void> {
  let names: string[]
  try {
    names = await fs.readdir(topicsDir(user))
  } catch {
    return
  }
  const persona = await readAgents(user)
  for (const name of names) {
    if (!isTopicName(name)) continue
    await removeChatAgentsLink(path.join(topicsDir(user), name), persona)
  }
}

export async function ensureAllUsers(): Promise<void> {
  await fs.mkdir(config.dataDir, { recursive: true })

  for (const name of config.users) {
    const user = assertUser(name)
    await ensureUser(user)
    await migrateThenUnlink(user)
  }

  await ensureFamily()
  await migrateThenUnlink(familyUser())
}

async function migrateThenUnlink(user: UserName): Promise<void> {
  // topic.ts がこのファイルを読むので、移行は動的に取り込む。
  const { migrateNestedTopics } = await import('./migrate')
  await migrateNestedTopics(user)
  await removeTopicAgentsLinks(user)
}

export async function readProfile(user: UserName): Promise<string> {
  return readMarkdown(path.join(userDir(user), 'profile.md'))
}

export async function writeProfile(user: UserName, text: string): Promise<void> {
  await writeMarkdown(path.join(userDir(user), 'profile.md'), text)
}

export async function readAgents(user: UserName): Promise<string> {
  return readMarkdown(path.join(userDir(user), 'AGENTS.md'))
}

export async function writeAgents(user: UserName, text: string): Promise<void> {
  await writeMarkdown(path.join(userDir(user), 'AGENTS.md'), text)
}

export async function readOrganize(user: UserName): Promise<string> {
  return readMarkdown(organizeFile(user))
}

export async function writeOrganize(user: UserName, text: string): Promise<void> {
  await writeMarkdown(organizeFile(user), text)
}

export async function readMemory(user: UserName): Promise<string> {
  return readMarkdown(memoryFile(user))
}

export type AppendMemoryResult = { ok: true } | { ok: false; reason: string }

/**
 * 日時を添えて追記する。空は断る。追記後に上限を超えるなら書かずに断る。
 * 雛形は置かない。無ければこの呼び出しで作る。
 */
export async function appendMemory(user: UserName, text: string): Promise<AppendMemoryResult> {
  const body = text.trim()
  if (!body) return { ok: false, reason: '覚える内容が空です' }

  const file = memoryFile(user)
  const existing = await readMemory(user)
  const now = new Date()
  const block = `## ${localDate(now)} ${localTime(now)}\n\n${body}\n`
  const next = existing ? `${existing.replace(/\n+$/, '')}\n\n${block}` : block
  if (Buffer.byteLength(next, 'utf8') > config.memoryMaxBytes) {
    return { ok: false, reason: '覚え書きが上限に達しています。人が整理するまで追加できません' }
  }

  await fs.writeFile(file, next, 'utf8')
  return { ok: true }
}
