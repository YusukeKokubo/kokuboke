import fs from 'node:fs/promises'
import { organizeActionKey, type TagOrganizeAction } from '../../shared/types'
import { revisionsFile, type UserName } from './paths'
import { ensureUser } from './user'

/** 命名・タグ付け・整理のプロンプトに載せる件数。 */
export const REVISION_PROMPT_LIMIT = 20

export type NameRevision = {
  at: string
  kind: 'name'
  from: string
  to: string
  topic?: string
}

export type TagRevision = {
  at: string
  kind: 'tag'
  from: string[]
  to: string[]
  topic?: string
}

export type OrganizeRevision = {
  at: string
  kind: 'organize'
  accepted: TagOrganizeAction[]
  rejected: TagOrganizeAction[]
}

export type Revision = NameRevision | TagRevision | OrganizeRevision

/** 追記時は at をこちらで振る。ユニオンを分配して kind を残す。 */
type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never
export type RevisionInput = DistributiveOmit<Revision, 'at'>

function sameStrings(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false
  const left = [...a].sort()
  const right = [...b].sort()
  return left.every((item, i) => item === right[i])
}

function isNoop(input: RevisionInput): boolean {
  if (input.kind === 'name') return input.from === input.to
  if (input.kind === 'tag') return sameStrings(input.from, input.to)
  return input.accepted.length === 0 && input.rejected.length === 0
}

function parseRevision(line: string): Revision | null {
  const raw = line.trim()
  if (!raw) return null
  try {
    const parsed = JSON.parse(raw) as Partial<Revision>
    if (typeof parsed.at !== 'string' || !parsed.at) return null
    if (parsed.kind === 'name' && typeof parsed.from === 'string' && typeof parsed.to === 'string') {
      const topic = typeof parsed.topic === 'string' ? parsed.topic : undefined
      return { at: parsed.at, kind: 'name', from: parsed.from, to: parsed.to, topic }
    }
    if (
      parsed.kind === 'tag' &&
      Array.isArray(parsed.from) &&
      Array.isArray(parsed.to) &&
      parsed.from.every((item) => typeof item === 'string') &&
      parsed.to.every((item) => typeof item === 'string')
    ) {
      const topic = typeof parsed.topic === 'string' ? parsed.topic : undefined
      return { at: parsed.at, kind: 'tag', from: parsed.from, to: parsed.to, topic }
    }
    if (parsed.kind === 'organize' && Array.isArray(parsed.accepted) && Array.isArray(parsed.rejected)) {
      return {
        at: parsed.at,
        kind: 'organize',
        accepted: parsed.accepted.filter(isOrganizeAction),
        rejected: parsed.rejected.filter(isOrganizeAction),
      }
    }
    return null
  } catch {
    return null
  }
}

function isOrganizeAction(value: unknown): value is TagOrganizeAction {
  if (!value || typeof value !== 'object') return false
  const item = value as TagOrganizeAction
  if (item.type === 'merge') return typeof item.from === 'string' && typeof item.to === 'string'
  if (item.type === 'shelf') return typeof item.name === 'string' && typeof item.group === 'string'
  if (item.type === 'remove') return typeof item.name === 'string'
  return false
}

/** 提案のうち、人が選んだものと見送りを分ける。 */
export function splitOrganizeActions(
  proposed: TagOrganizeAction[],
  selected: TagOrganizeAction[],
): { accepted: TagOrganizeAction[]; rejected: TagOrganizeAction[] } {
  const picked = new Set(selected.map(organizeActionKey))
  return {
    accepted: selected,
    rejected: proposed.filter((action) => !picked.has(organizeActionKey(action))),
  }
}

/**
 * 人が直した対を追記する。同じなら書かない。自動の書き込みは呼ぶ側が残さない。
 */
export async function appendRevision(
  user: UserName,
  input: RevisionInput,
): Promise<Revision | null> {
  if (isNoop(input)) return null
  await ensureUser(user)
  const entry = { ...input, at: new Date().toISOString() } as Revision
  await fs.appendFile(revisionsFile(user), JSON.stringify(entry) + '\n')
  return entry
}

/** 新しい方から数えて limit 件。無いファイルは空。 */
export async function readRevisions(
  user: UserName,
  limit = REVISION_PROMPT_LIMIT,
): Promise<Revision[]> {
  try {
    const raw = await fs.readFile(revisionsFile(user), 'utf8')
    const items: Revision[] = []
    for (const line of raw.split('\n')) {
      const parsed = parseRevision(line)
      if (parsed) items.push(parsed)
    }
    return limit > 0 ? items.slice(-limit) : items
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []
    throw error
  }
}

/** プロンプトに載せる短い行。 */
export function formatRevisions(revisions: Revision[]): string {
  if (revisions.length === 0) return ''
  return revisions.map(formatRevision).join('\n')
}

function formatRevision(revision: Revision): string {
  if (revision.kind === 'name') {
    return `- 見出し: 「${revision.from}」→「${revision.to}」`
  }
  if (revision.kind === 'tag') {
    return `- タグ: [${revision.from.join('、')}] → [${revision.to.join('、')}]`
  }
  const accepted = revision.accepted.map(formatAction).filter(Boolean)
  const rejected = revision.rejected.map(formatAction).filter(Boolean)
  const parts: string[] = []
  if (accepted.length > 0) parts.push(`採用: ${accepted.join('、')}`)
  if (rejected.length > 0) parts.push(`見送り: ${rejected.join('、')}`)
  return `- 整理: ${parts.join(' / ')}`
}

function formatAction(action: TagOrganizeAction): string {
  if (action.type === 'merge') return `「${action.from}」→「${action.to}」`
  if (action.type === 'shelf') return `「${action.name}」を棚「${action.group}」`
  return `「${action.name}」を削除`
}
