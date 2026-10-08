/**
 * 「いま何をしているか」の一言。読むのは家族なので、道具の名前はそのまま出さず、
 * 何が起きているかだけを書く。知らない道具は「調べています」に丸める。
 *
 * どちらの CLI も道具は増えるので、対応表に無いものが来ることを前提にする。
 * 表に足すときは、実際に叩いて出てきた名前を写す（推測で書かない）。
 */
export type ActivityKind = 'read' | 'search' | 'web' | 'fetch' | 'other'

const LABELS: Record<ActivityKind, string> = {
  read: 'ファイルを見ています',
  search: '書いたものを探しています',
  web: 'ウェブで調べています',
  fetch: 'ページを読んでいます',
  other: '調べています',
}

/**
 * cursor-agent の tool_call のキー。2026.08.11-e8db854 で実際に出たのは
 * read / glob / grep / webSearch / webFetch の五つ。
 */
const CURSOR: Record<string, ActivityKind> = {
  readToolCall: 'read',
  globToolCall: 'search',
  grepToolCall: 'search',
  webSearchToolCall: 'web',
  webFetchToolCall: 'fetch',
}

/** Claude Code の tool_use の name。会話で許しているのは Read だけ。 */
const CLAUDE: Record<string, ActivityKind> = {
  Read: 'read',
  Glob: 'search',
  Grep: 'search',
  WebSearch: 'web',
  WebFetch: 'fetch',
}

/**
 * cursor-agent の tool_call 行の中身から札を選ぶ。
 * 道具の種類は `...ToolCall` というキーの名前で表され、同じ器に
 * toolCallId や startedAtMs も混ざっている。それが見つからなければ null。
 */
export function cursorActivity(toolCall: Record<string, unknown>): string | null {
  const key = Object.keys(toolCall).find((name) => name.endsWith('ToolCall'))
  if (!key) return null
  return LABELS[CURSOR[key] ?? 'other']
}

/** Claude Code の tool_use の name から札を選ぶ。 */
export function claudeActivity(name: string): string {
  return LABELS[CLAUDE[name] ?? 'other']
}
