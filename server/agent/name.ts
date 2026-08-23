import { takeEmoji } from '../../shared/emoji'
import type { TagOrganizeAction } from '../../shared/types'
import { normalizeGroup, normalizeTopicName } from '../store/paths'

/**
 * 命名の返事から名前を取り出す。JSON で返すよう頼んでいるが、
 * 前置きやコードブロックが混じることがあるので、緩く拾う。
 */
export function parseName(raw: string): { name: string } | null {
  const body = raw.replace(/```[a-z]*\n?/gi, '').trim()

  let name = ''

  const start = body.indexOf('{')
  const end = body.lastIndexOf('}')
  if (start !== -1 && end > start) {
    try {
      const parsed = JSON.parse(body.slice(start, end + 1)) as { name?: unknown }
      if (typeof parsed.name === 'string') name = parsed.name
    } catch {
      // JSON になっていなければ下の行拾いに任せる
    }
  }

  // JSON から名前が取れなければ、最初の行をそのまま名前として扱う。本文に
  // 中括弧が混じっているだけの返事もここで拾える。捨てるのは行の端に中括弧が
  // 来た形だけ（整形 JSON の一行目の `{`、name の無い `{}` など）。
  // 行の途中に混じっているだけなら `集合 {1,2} の話` のような普通の名前なので残す。
  if (!name) {
    const line = body.split('\n').find((l) => l.trim())?.trim() ?? ''
    name = line.startsWith('{') || line.endsWith('}') ? '' : line
  }

  name = normalizeTopicName(name.replace(/^[-*\s"'「『]+|["'」』\s]+$/g, '')).slice(0, 40)
  if (!name) return null

  return { name }
}

export interface ProposedTag {
  name: string
  emoji?: string
  group?: string
}

/** タグ付けの返事から名前と、あれば絵文字を取り出す。 */
export function parseTags(raw: string): ProposedTag[] {
  const body = raw.replace(/```[a-z]*\n?/gi, '').trim()
  const start = body.indexOf('{')
  const end = body.lastIndexOf('}')
  if (start === -1 || end <= start) return []

  try {
    const parsed = JSON.parse(body.slice(start, end + 1)) as { tags?: unknown }
    if (!Array.isArray(parsed.tags)) return []
    return parsed.tags
      .map((tag): ProposedTag | null => {
        if (typeof tag === 'string') {
          const name = normalizeTopicName(tag)
          return name ? { name } : null
        }
        if (!tag || typeof tag !== 'object') return null
        const item = tag as { name?: unknown; emoji?: unknown; group?: unknown }
        if (typeof item.name !== 'string') return null
        const name = normalizeTopicName(item.name)
        if (!name) return null
        const emoji = takeEmoji(item.emoji)
        const group = typeof item.group === 'string' ? normalizeGroup(item.group) : ''
        const proposed: ProposedTag = { name }
        if (emoji) proposed.emoji = emoji
        if (group) proposed.group = group
        return proposed
      })
      .filter((tag): tag is ProposedTag => tag !== null)
      .slice(0, 2)
  } catch {
    return []
  }
}

function asAction(raw: unknown): TagOrganizeAction | null {
  if (!raw || typeof raw !== 'object') return null
  const item = raw as { type?: unknown; from?: unknown; to?: unknown; name?: unknown; group?: unknown }
  if (item.type === 'merge' && typeof item.from === 'string' && typeof item.to === 'string') {
    const from = normalizeTopicName(item.from)
    const to = normalizeTopicName(item.to)
    return from && to ? { type: 'merge', from, to } : null
  }
  if (item.type === 'shelf' && typeof item.name === 'string' && typeof item.group === 'string') {
    const name = normalizeTopicName(item.name)
    const group = normalizeGroup(item.group)
    return name && group ? { type: 'shelf', name, group } : null
  }
  if (item.type === 'remove' && typeof item.name === 'string') {
    const name = normalizeTopicName(item.name)
    return name ? { type: 'remove', name } : null
  }
  return null
}

/** 整理の返事から、寄せ・棚・削除の提案を取り出す。 */
export function parseOrganize(raw: string): TagOrganizeAction[] {
  const body = raw.replace(/```[a-z]*\n?/gi, '').trim()
  const start = body.indexOf('{')
  const end = body.lastIndexOf('}')
  if (start === -1 || end <= start) return []

  try {
    const parsed = JSON.parse(body.slice(start, end + 1)) as { actions?: unknown }
    if (!Array.isArray(parsed.actions)) return []
    return parsed.actions
      .map(asAction)
      .filter((action): action is TagOrganizeAction => action !== null)
      .slice(0, 40)
  } catch {
    return []
  }
}
