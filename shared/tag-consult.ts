/**
 * タグ本文の相談。AI は話しながら、まとまったところで新しい本文の全文を
 * `<proposal>` で囲んで返す。ファイルは書き換えず、どの直しを入れるかは画面で選ぶ。
 */

/** 相談のやり取り一回分。サーバーへは毎回これを丸ごと送る（どこにも保存しない）。 */
export interface ConsultTurn {
  role: 'user' | 'assistant'
  /** assistant の回は、返事と `<proposal>` を含んだ生の返答。 */
  text: string
}

const OPEN = '<proposal>'
const CLOSE = '</proposal>'

/**
 * 返答を、話し言葉の部分と本文の案に分ける。流している途中でも呼べる。
 * `writing` は開きタグまで届いて閉じタグがまだの間。
 */
export function splitConsult(raw: string): {
  reply: string
  proposal: string | null
  writing: boolean
} {
  const start = raw.lastIndexOf(OPEN)
  if (start < 0) {
    // 開きタグの途中まで届いている間は、それを返事として見せない。
    return {
      reply: trimPartialTag(raw).trim(),
      proposal: null,
      writing: false,
    }
  }
  const before = raw.slice(0, start)
  const rest = raw.slice(start + OPEN.length)
  const end = rest.indexOf(CLOSE)
  if (end < 0) return { reply: before.trim(), proposal: null, writing: true }
  const after = rest.slice(end + CLOSE.length)
  const reply = [before.trim(), after.trim()].filter(Boolean).join('\n\n')
  return { reply, proposal: unfence(rest.slice(0, end)), writing: false }
}

function trimPartialTag(text: string): string {
  for (let size = OPEN.length - 1; size > 0; size--) {
    if (text.endsWith(OPEN.slice(0, size))) return text.slice(0, -size)
  }
  return text
}

function unfence(text: string): string {
  const body = text.trim()
  const match = /^```[^\n]*\n([\s\S]*)\n```$/.exec(body)
  if (!match || match[1]!.includes('```')) return body
  return match[1]!
}

/** 行単位の差分。置き換えは連続した削除と追加を一つの塊に、足すだけ・消すだけは一行ずつにする。 */
export type DiffSegment =
  { kind: 'same'; lines: string[] } | { kind: 'change'; id: number; removed: string[]; added: string[] }

function lines(text: string): string[] {
  const body = text.replace(/\s+$/, '')
  return body ? body.split('\n') : []
}

export function lineDiff(before: string, after: string): DiffSegment[] {
  const a = lines(before)
  const b = lines(after)
  // 最長共通部分列。本文は長くても数十行なので素直な表で足りる。
  const table = Array.from({ length: a.length + 1 }, () => new Array<number>(b.length + 1).fill(0))
  for (let i = a.length - 1; i >= 0; i--) {
    for (let j = b.length - 1; j >= 0; j--) {
      table[i]![j] =
        a[i] === b[j] ? table[i + 1]![j + 1]! + 1 : Math.max(table[i + 1]![j]!, table[i]![j + 1]!)
    }
  }

  const segments: DiffSegment[] = []
  let id = 0
  const push = (kind: 'same' | 'removed' | 'added', line: string) => {
    const last = segments.at(-1)
    if (kind === 'same') {
      if (last?.kind === 'same') last.lines.push(line)
      else segments.push({ kind: 'same', lines: [line] })
      return
    }
    if (last?.kind === 'change') {
      last[kind].push(line)
      return
    }
    const change = {
      kind: 'change' as const,
      id: id++,
      removed: [] as string[],
      added: [] as string[],
    }
    change[kind].push(line)
    segments.push(change)
  }

  let i = 0
  let j = 0
  while (i < a.length || j < b.length) {
    if (i < a.length && j < b.length && a[i] === b[j]) {
      push('same', a[i]!)
      i++
      j++
    } else if (j < b.length && (i >= a.length || table[i]![j + 1]! >= table[i + 1]![j]!)) {
      push('added', b[j]!)
      j++
    } else {
      push('removed', a[i]!)
      i++
    }
  }
  return splitOneSided(segments)
}

/**
 * 足すだけ・消すだけの塊は一行ずつ選べるようにばらす。
 * 置き換えは、元の行と新しい行を一緒に選ばないと意味が崩れるので塊のまま。
 */
function splitOneSided(segments: DiffSegment[]): DiffSegment[] {
  let id = 0
  return segments.flatMap((segment): DiffSegment[] => {
    if (segment.kind === 'same') return [segment]
    if (segment.removed.length > 0 && segment.added.length > 0) return [{ ...segment, id: id++ }]
    return [
      ...segment.removed.map((line) => ({ kind: 'change' as const, id: id++, removed: [line], added: [] })),
      ...segment.added.map((line) => ({ kind: 'change' as const, id: id++, removed: [], added: [line] })),
    ]
  })
}

/** 選んだ塊だけ案の側を採り、残りは元のまま。 */
export function applyDiff(segments: DiffSegment[], picked: ReadonlySet<number>): string {
  const out: string[] = []
  for (const segment of segments) {
    if (segment.kind === 'same') out.push(...segment.lines)
    else out.push(...(picked.has(segment.id) ? segment.added : segment.removed))
  }
  return out.length > 0 ? out.join('\n') + '\n' : ''
}
