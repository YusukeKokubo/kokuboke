import fs from 'node:fs/promises'
import path from 'node:path'
import { config } from '../config'
import { userClaudeMd, userProfileMd } from '../templates'
import { topicsDir, userDir } from './paths'

async function writeIfMissing(file: string, content: string): Promise<void> {
  try {
    await fs.writeFile(file, content, { flag: 'wx' })
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error
  }
}

/** ユーザーのフォルダと雛形を用意する。既にあるファイルは触らない。 */
export async function ensureUser(user: string): Promise<void> {
  const dir = userDir(user)
  await fs.mkdir(topicsDir(user), { recursive: true })
  await writeIfMissing(path.join(dir, 'CLAUDE.md'), userClaudeMd(user))
  await writeIfMissing(path.join(dir, 'profile.md'), userProfileMd(user))
}

export async function ensureAllUsers(): Promise<void> {
  await fs.mkdir(config.dataDir, { recursive: true })
  for (const user of config.users) {
    await ensureUser(user)
  }
}

export async function readProfile(user: string): Promise<string> {
  return read(path.join(userDir(user), 'profile.md'))
}

async function read(file: string): Promise<string> {
  try {
    return await fs.readFile(file, 'utf8')
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return ''
    throw error
  }
}
