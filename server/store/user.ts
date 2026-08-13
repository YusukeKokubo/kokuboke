import fs from 'node:fs/promises'
import path from 'node:path'
import { config } from '../config'
import { userClaudeMd, userProfileMd } from '../templates'
import { isTopicName, topicsDir, userDir } from './paths'

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
export async function ensureAgentsLink(dir: string): Promise<void> {
  const link = path.join(dir, 'AGENTS.md')
  try {
    // 手で置かれた実ファイルがあれば尊重する。
    await fs.lstat(link)
    return
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
  }

  try {
    await fs.symlink('CLAUDE.md', link)
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code
    if (code === 'EEXIST') return
    // リンクを張れない環境でも会話は続けられる。cursor 側で人格が効かなくなるだけ。
    console.warn(`[store] AGENTS.md のリンクを作れませんでした: ${dir}`, error)
  }
}

/** ユーザーのフォルダと雛形を用意する。既にあるファイルは触らない。 */
export async function ensureUser(user: string): Promise<void> {
  const dir = userDir(user)
  await fs.mkdir(topicsDir(user), { recursive: true })
  await writeIfMissing(path.join(dir, 'CLAUDE.md'), userClaudeMd(user))
  await writeIfMissing(path.join(dir, 'profile.md'), userProfileMd(user))
  await ensureAgentsLink(dir)
}

export async function ensureAllUsers(): Promise<void> {
  await fs.mkdir(config.dataDir, { recursive: true })

  for (const user of config.users) {
    await ensureUser(user)

    // 先に作られていたトピックにも後からリンクを足す。
    let names: string[] = []
    try {
      names = await fs.readdir(topicsDir(user))
    } catch {
      continue
    }
    for (const name of names) {
      if (!isTopicName(name)) continue
      const dir = path.join(topicsDir(user), name)
      await ensureAgentsLink(dir)

      // 中で分けている子トピックにも同じリンクが要る。掘るのは一段だけ。
      let children: string[] = []
      try {
        children = await fs.readdir(dir)
      } catch {
        continue
      }
      for (const child of children) {
        if (!isTopicName(child)) continue
        const sub = path.join(dir, child)
        if (!(await fs.stat(sub).then((s) => s.isDirectory()).catch(() => false))) continue
        if (!(await fs.stat(path.join(sub, 'topic.json')).then(() => true).catch(() => false))) {
          continue
        }
        await ensureAgentsLink(sub)
      }
    }
  }
}

async function read(file: string): Promise<string> {
  try {
    return await fs.readFile(file, 'utf8')
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return ''
    throw error
  }
}

/** 末尾の改行を揃える。空なら空ファイル。 */
async function write(file: string, text: string): Promise<void> {
  const body = text.trim()
  await fs.writeFile(file, body ? body + '\n' : '')
}

export async function readProfile(user: string): Promise<string> {
  return read(path.join(userDir(user), 'profile.md'))
}

export async function writeProfile(user: string, text: string): Promise<void> {
  await write(path.join(userDir(user), 'profile.md'), text)
}

export async function readClaude(user: string): Promise<string> {
  return read(path.join(userDir(user), 'CLAUDE.md'))
}

export async function writeClaude(user: string, text: string): Promise<void> {
  await write(path.join(userDir(user), 'CLAUDE.md'), text)
}
