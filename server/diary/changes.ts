import type { ProfileChange } from '../../shared/types'
import { charCount } from '../../shared/profile-changes'
import { isDiaryDate } from '../store/diary'

export { applyProfileChanges, charCount, PROFILE_LIMIT } from '../../shared/profile-changes'

/** 一行の長さの上限。長い行は一時のことの書き写しになりやすい。 */
const LINE_LIMIT = 200

function lines(text: string): string[] {
  const body = text.replace(/\s+$/, '')
  return body ? body.split('\n') : []
}

function oneLine(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const text = value.trim()
  if (!text || text.includes('\n') || charCount(text) > LINE_LIMIT) return null
  return text
}

/** 根拠の日付。違う日が二つ以上ないと、一時のことと見分けがつかない。 */
function evidence(value: unknown, known: ReadonlySet<string>): string[] | null {
  if (!Array.isArray(value)) return null
  const dates = [...new Set(value.filter((d): d is string => typeof d === 'string' && isDiaryDate(d)))]
    .filter((date) => known.has(date))
    .sort()
  return dates.length >= 2 ? dates : null
}

/**
 * AI の返した JSON から、今の profile.md に当てられる案だけ残す。
 * 直す・消すの元の行が見つからない案と、根拠の足りない案は捨てる。
 * `known` は AI に渡した日記の日付。それ以外の日付は根拠に数えない。
 */
export function parseProfileChanges(
  raw: string,
  profile: string,
  known: ReadonlySet<string>,
): ProfileChange[] {
  const match = /\{[\s\S]*\}/.exec(raw)
  if (!match) return []
  let parsed: unknown
  try {
    parsed = JSON.parse(match[0])
  } catch {
    return []
  }
  const items = (parsed as { changes?: unknown }).changes
  if (!Array.isArray(items)) return []

  const existing = new Set(lines(profile).map((line) => line.trim()))
  const touched = new Set<string>()
  const changes: ProfileChange[] = []

  for (const item of items) {
    if (!item || typeof item !== 'object') continue
    const row = item as Record<string, unknown>
    const id = `c${changes.length + 1}`

    if (row.type === 'add') {
      const text = oneLine(row.text)
      const dates = evidence(row.dates, known)
      if (!text || !dates || existing.has(text)) continue
      changes.push({ id, type: 'add', text, dates })
    } else if (row.type === 'replace') {
      const from = oneLine(row.from)
      const to = oneLine(row.to)
      const dates = evidence(row.dates, known)
      if (!from || !to || !dates || from === to) continue
      if (!existing.has(from) || touched.has(from)) continue
      touched.add(from)
      changes.push({ id, type: 'replace', from, to, dates })
    } else if (row.type === 'remove') {
      const text = oneLine(row.text)
      const reason = typeof row.reason === 'string' ? row.reason.trim() : ''
      if (!text || !reason || !existing.has(text) || touched.has(text)) continue
      touched.add(text)
      changes.push({ id, type: 'remove', text, reason })
    }
  }
  return changes
}

/** 一件を一行で。見送りの記録と、次の案を作るときの手がかりに使う。 */
export function describeChange(change: ProfileChange): string {
  if (change.type === 'add') return `足す「${change.text}」`
  if (change.type === 'replace') return `直す「${change.from}」→「${change.to}」`
  return `消す「${change.text}」`
}
