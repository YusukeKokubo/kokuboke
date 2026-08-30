import path from 'node:path'
import { config } from '../config'
import { appendMemory, type AppendMemoryResult } from '../store/user'
import { familyUser, type UserName } from '../store/paths'

/**
 * remember が書いてよいのは、起動時に個人スペースの会話と確定しているときだけ。
 *
 * 文脈は mcp.json の `${KOKUBOKE_REMEMBER_USER}` 展開で届く。cursor は mcp.json に
 * 書いたキーしか子へ渡さない（親の env を丸ごと継がない。2026.08.30 に確認）。
 * 値が USERS の一員であることと、cwd が data/<user>/topics/<id> であることの
 * 両方を見る。片方だけ通っても書かない。
 */
export function personalRememberUser(
  cwd: string,
  envUser: string | undefined,
): UserName | null {
  const raw = envUser?.trim() ?? ''
  if (!raw || !config.users.includes(raw) || raw === config.familyDir) return null
  const user = raw as UserName
  if (user === familyUser()) return null

  const resolved = path.resolve(cwd)
  const root = path.resolve(config.dataDir)
  const rel = path.relative(root, resolved)
  if (!rel || rel.startsWith('..') || path.isAbsolute(rel)) return null
  const parts = rel.split(path.sep)
  if (parts.length < 3 || parts[0] !== user || parts[1] !== 'topics') return null
  return user
}

export async function remember(text: string, cwd: string): Promise<AppendMemoryResult> {
  const user = personalRememberUser(cwd, process.env.KOKUBOKE_REMEMBER_USER)
  if (!user) {
    return { ok: false, reason: 'この会話では覚え書きに書けません' }
  }
  return appendMemory(user, text)
}
