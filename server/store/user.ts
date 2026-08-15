import fs from 'node:fs/promises'
import path from 'node:path'
import { config } from '../config'
import { familyClaudeMd, userClaudeMd, userProfileMd } from '../templates'
import { readMarkdown, writeMarkdown } from './markdown'
import {
  assertUser,
  familyUser,
  isTopicName,
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
 * CLAUDE.md への AGENTS.md リンクを張る。
 *
 * Claude Code は CLAUDE.md を、cursor-agent は AGENTS.md を、どちらも親を
 * 遡って読む。同じ実体を指しておけば、人格の定義を 1 か所に保ったまま
 * 両方のエンジンで同じ振る舞いになる。Claude Code は AGENTS.md を読まないので
 * 二重に読み込まれることはない。
 */
export async function ensureAgentsLink(dir: string, target = 'CLAUDE.md'): Promise<void> {
  const link = path.join(dir, 'AGENTS.md')
  try {
    // 手で置かれた実ファイルがあれば尊重する。
    await fs.lstat(link)
    return
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
  }

  try {
    await fs.symlink(target, link)
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code
    if (code === 'EEXIST') return
    // リンクを張れない環境でも会話は続けられる。cursor 側で人格が効かなくなるだけ。
    console.warn(`[store] AGENTS.md のリンクを作れませんでした: ${dir}`, error)
  }
}

/** 会話フォルダから人（家族）直下の CLAUDE.md を指す。 */
export async function ensureChatAgentsLink(dir: string): Promise<void> {
  await ensureAgentsLink(dir, path.join('..', '..', 'CLAUDE.md'))
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
  await writeIfMissing(path.join(dir, 'CLAUDE.md'), userClaudeMd(user))
  await writeIfMissing(path.join(dir, 'profile.md'), userProfileMd(user))
  await ensureAgentsLink(dir)
}

/** 家族共有スペースのフォルダと雛形を用意する。profile.md は置かない。 */
export async function ensureFamily(): Promise<void> {
  const user = familyUser()
  const dir = userDir(user)
  await fs.mkdir(topicsDir(user), { recursive: true })
  await fs.mkdir(tagsDir(user), { recursive: true })
  await writeIfMissing(path.join(dir, 'CLAUDE.md'), familyClaudeMd())
  await ensureAgentsLink(dir)
}

async function ensureTopicAgentsLinks(user: UserName): Promise<void> {
  let names: string[]
  try {
    names = await fs.readdir(topicsDir(user))
  } catch {
    return
  }
  for (const name of names) {
    if (!isTopicName(name)) continue
    const dir = path.join(topicsDir(user), name)
    await ensureChatAgentsLink(dir)
  }
}

export async function ensureAllUsers(): Promise<void> {
  await fs.mkdir(config.dataDir, { recursive: true })

  for (const name of config.users) {
    const user = assertUser(name)
    await ensureUser(user)
    await migrateThenLink(user)
  }

  await ensureFamily()
  await migrateThenLink(familyUser())
}

async function migrateThenLink(user: UserName): Promise<void> {
  // topic.ts がこのファイルを読むので、移行は動的に取り込む。
  const { migrateNestedTopics } = await import('./migrate')
  await migrateNestedTopics(user)
  await ensureTopicAgentsLinks(user)
}

export async function readProfile(user: UserName): Promise<string> {
  return readMarkdown(path.join(userDir(user), 'profile.md'))
}

export async function writeProfile(user: UserName, text: string): Promise<void> {
  await writeMarkdown(path.join(userDir(user), 'profile.md'), text)
}

export async function readClaude(user: UserName): Promise<string> {
  return readMarkdown(path.join(userDir(user), 'CLAUDE.md'))
}

export async function writeClaude(user: UserName, text: string): Promise<void> {
  await writeMarkdown(path.join(userDir(user), 'CLAUDE.md'), text)
}
