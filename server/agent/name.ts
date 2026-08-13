import { normalizeTopicName } from '../store/paths'

/**
 * 命名の返事から名前と絵文字を取り出す。JSON で返すよう頼んでいるが、
 * 前置きやコードブロックが混じることがあるので、緩く拾う。
 */
export function parseName(raw: string): { name: string; emoji?: string } | null {
  const body = raw.replace(/```[a-z]*\n?/gi, '').trim()

  let name = ''
  let emoji: string | undefined

  const start = body.indexOf('{')
  const end = body.lastIndexOf('}')
  if (start !== -1 && end > start) {
    try {
      const parsed = JSON.parse(body.slice(start, end + 1)) as { name?: unknown; emoji?: unknown }
      if (typeof parsed.name === 'string') name = parsed.name
      if (typeof parsed.emoji === 'string') emoji = parsed.emoji
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

  // 絵文字は一文字だけ受け取る。判断できない形なら既定に任せる。
  const first = emoji ? Array.from(emoji)[0] : undefined
  return { name, emoji: first && /\p{Extended_Pictographic}/u.test(first) ? first : undefined }
}
